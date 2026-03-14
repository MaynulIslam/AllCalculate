const functions = require('firebase-functions');
const admin     = require('firebase-admin');
const stripe    = require('stripe')(functions.config().stripe.secret_key);

admin.initializeApp();
const db = admin.firestore();

// ── Price ID → tier name map ──────────────────────────────────────────────────
const PRICE_TO_TIER = {
  'price_1TAsSzA4zaUVQc8ceNW3tIJH': 'basic',      // $1/mo  – 500 saves
  'price_1TAsUYA4zaUVQc8cHyqQHIHy': 'executive',  // $2/mo  – 1500 saves
  'price_1TAsVBA4zaUVQc8c6ZDxQA4K': 'premium',    // $5/mo  – unlimited
};

// ── 1. Create Stripe Checkout Session ────────────────────────────────────────
// Called from the frontend when user clicks "Upgrade"
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
  // Must be signed in
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in to upgrade.');
  }

  const { priceId } = data;
  if (!PRICE_TO_TIER[priceId]) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid price ID.');
  }

  const uid   = context.auth.uid;
  const email = context.auth.token.email || '';

  // Look up or create Stripe customer
  const userRef  = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  let stripeCustomerId = userSnap.exists ? userSnap.data().stripeCustomerId : null;

  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email,
      metadata: { firebaseUID: uid },
    });
    stripeCustomerId = customer.id;
    await userRef.set({ stripeCustomerId }, { merge: true });
  }

  // Cancel any existing active subscription first
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: 'active',
    limit: 5,
  });
  for (const sub of subs.data) {
    await stripe.subscriptions.cancel(sub.id);
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    mode:                'subscription',
    customer:            stripeCustomerId,
    line_items:          [{ price: priceId, quantity: 1 }],
    success_url:         'https://easycalculator.live/pricing.html?success=true',
    cancel_url:          'https://easycalculator.live/pricing.html?cancelled=true',
    client_reference_id: uid,
    metadata:            { firebaseUID: uid },
  });

  return { sessionId: session.id, url: session.url };
});

// ── 2. Stripe Webhook ─────────────────────────────────────────────────────────
// Stripe calls this URL after payment events
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig           = req.headers['stripe-signature'];
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const subscription = event.data.object;

  // Helper: get Firebase UID from Stripe customer metadata
  async function getUid(customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    return customer.metadata?.firebaseUID || null;
  }

  switch (event.type) {

    // Payment succeeded — upgrade the tier
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const priceId = subscription.items.data[0]?.price?.id;
      const tier    = PRICE_TO_TIER[priceId] || 'free';
      const uid     = await getUid(subscription.customer);
      if (uid) {
        await db.collection('users').doc(uid).set(
          { tier, stripeSubscriptionId: subscription.id, stripeStatus: subscription.status },
          { merge: true }
        );
        console.log(`✅ User ${uid} upgraded to ${tier}`);
      }
      break;
    }

    // Subscription cancelled / payment failed — revert to free
    case 'customer.subscription.deleted': {
      const uid = await getUid(subscription.customer);
      if (uid) {
        await db.collection('users').doc(uid).set(
          { tier: 'free', stripeSubscriptionId: null, stripeStatus: 'cancelled' },
          { merge: true }
        );
        console.log(`ℹ️ User ${uid} reverted to free`);
      }
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  res.json({ received: true });
});
