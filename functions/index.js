const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret }  = require('firebase-functions/params');
const admin             = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// ── Secrets (stored in Google Cloud Secret Manager) ───────────────────────────
const stripeSecretKey    = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

// ── Price ID → tier name map ──────────────────────────────────────────────────
const PRICE_TO_TIER = {
  'price_1TAsSzA4zaUVQc8ceNW3tIJH': 'basic',      // $1/mo  – 500 saves
  'price_1TAsUYA4zaUVQc8cHyqQHIHy': 'executive',  // $2/mo  – 1500 saves
  'price_1TAsVBA4zaUVQc8c6ZDxQA4K': 'premium',    // $5/mo  – unlimited
};

// ── 1. Create Stripe Checkout Session ────────────────────────────────────────
exports.createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to upgrade.');
    }

    const { priceId } = request.data;
    if (!PRICE_TO_TIER[priceId]) {
      throw new HttpsError('invalid-argument', 'Invalid price ID.');
    }

    const stripe = require('stripe')(stripeSecretKey.value());
    const uid    = request.auth.uid;
    const email  = request.auth.token.email || '';

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
      status:   'active',
      limit:    5,
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
  }
);

// ── 2. Stripe Webhook ─────────────────────────────────────────────────────────
exports.stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    const stripe = require('stripe')(stripeSecretKey.value());
    const sig    = req.headers['stripe-signature'];

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const subscription = event.data.object;

    async function getUid(customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      return customer.metadata?.firebaseUID || null;
    }

    switch (event.type) {

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
  }
);
