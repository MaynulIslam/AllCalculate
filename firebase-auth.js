/**
 * firebase-auth.js
 * Shared Firebase authentication module for AllCalculate.com
 * Handles: Sign In / Sign Up / Google auth / navbar UI / auth modal injection
 * Include on every page EXCEPT simple-calculator.html (it has its own inline Firebase).
 */

import { initializeApp, getApps, getApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
         signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Firebase config loaded from external file (kept out of version control) ──
// See firebase-config.js — never hardcode credentials here.
import { firebaseConfig } from './firebase-config.js';
const app  = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Exports for page-specific scripts that import this module
export { app, auth, db };

const TIER_LIMITS = { free: 5, basic: 500, executive: 1500, premium: Infinity };
let userTier   = 'free';
let savedCount = 0;

// ── HTML escape ──
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ════════════════════════════════════════
//  AUTH MODAL — injected dynamically
// ════════════════════════════════════════
function injectModal() {
  if (document.getElementById('authOverlay')) return; // already present on page
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="auth-overlay" id="authOverlay" style="display:none">
      <div class="auth-modal">
        <button class="auth-close" id="authClose">✕</button>
        <h2 class="auth-title">Welcome Back</h2>
        <p class="auth-subtitle">Sign in to save your calculation history</p>
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="signin">Sign In</button>
          <button class="auth-tab" data-tab="signup">Sign Up</button>
        </div>
        <form class="auth-form" id="signinForm">
          <input type="email"    class="auth-input" id="siEmail" placeholder="Email address" autocomplete="email">
          <input type="password" class="auth-input" id="siPass"  placeholder="Password" autocomplete="current-password">
          <div class="auth-error" id="siError"></div>
          <button type="submit" class="auth-submit" id="siSubmit">Sign In</button>
        </form>
        <form class="auth-form" id="signupForm" style="display:none">
          <input type="email"    class="auth-input" id="suEmail" placeholder="Email address" autocomplete="email">
          <input type="password" class="auth-input" id="suPass"  placeholder="Password (min 6 chars)" autocomplete="new-password">
          <div class="auth-error" id="suError"></div>
          <button type="submit" class="auth-submit" id="suSubmit">Create Free Account</button>
        </form>
        <div class="auth-divider"><span>or</span></div>
        <button class="auth-google-btn" id="authGoogleBtn">
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>`;
  document.body.appendChild(wrap.firstElementChild);

  // Close handlers
  document.getElementById('authClose').addEventListener('click', hideModal);
  document.getElementById('authOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal();
  });

  // Tab switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const w = tab.dataset.tab;
      document.getElementById('signinForm').style.display = w === 'signin' ? 'flex' : 'none';
      document.getElementById('signupForm').style.display = w === 'signup' ? 'flex' : 'none';
    });
  });

  // Sign In
  document.getElementById('signinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('siSubmit');
    const err = document.getElementById('siError');
    err.textContent = ''; btn.textContent = 'Signing in…'; btn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth,
        document.getElementById('siEmail').value,
        document.getElementById('siPass').value);
      hideModal();
    } catch (er) {
      err.textContent = friendlyErr(er.code);
    } finally {
      btn.textContent = 'Sign In'; btn.disabled = false;
    }
  });

  // Sign Up
  document.getElementById('signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('suSubmit');
    const err = document.getElementById('suError');
    err.textContent = ''; btn.textContent = 'Creating…'; btn.disabled = true;
    try {
      await createUserWithEmailAndPassword(auth,
        document.getElementById('suEmail').value,
        document.getElementById('suPass').value);
      hideModal();
    } catch (er) {
      err.textContent = friendlyErr(er.code);
    } finally {
      btn.textContent = 'Create Free Account'; btn.disabled = false;
    }
  });

  // Google
  document.getElementById('authGoogleBtn').addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      hideModal();
    } catch (er) {
      if (er.code !== 'auth/popup-closed-by-user') console.error(er);
    }
  });
}

export function showAuthModal() {
  if (!document.getElementById('authOverlay')) injectModal();
  document.getElementById('authOverlay').style.display = 'flex';
}
function hideModal() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('siError').textContent = '';
  document.getElementById('suError').textContent = '';
}

// ════════════════════════════════════════
//  NAVBAR AUTH UI
// ════════════════════════════════════════
function updateNavAuth(user) {
  const navAuth = document.getElementById('navAuth');
  if (!navAuth) return;

  if (user) {
    const displayName = user.displayName || '';
    const email       = user.email || '';
    const name        = displayName || email.split('@')[0] || 'User';
    const initials    = displayName
      ? displayName.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
      : (email[0] || 'U').toUpperCase();
    const lim      = TIER_LIMITS[userTier];
    const limStr   = lim === Infinity ? '∞' : lim;
    const tierName = userTier[0].toUpperCase() + userTier.slice(1);

    navAuth.innerHTML = `
      <div class="nav-user-chip" id="navUserChip">
        <div class="nav-user-avatar">${initials}</div>
        <span class="nav-user-name">${esc(name)}</span>
        <span class="nav-user-caret">▾</span>
        <div class="nav-user-dropdown">
          <div class="nav-dropdown-info">
            <div class="nav-dropdown-name">${esc(displayName || name)}</div>
            <div class="nav-dropdown-email">${esc(email)}</div>
            <div class="nav-dropdown-tier" id="navDropdownTier">
              ${tierName} Plan · ${savedCount}/${limStr} saves
            </div>
          </div>
          <a class="nav-dropdown-item nav-dropdown-link" href="saved-sessions.html">
            📋 Saved Calculations
          </a>
          <a class="nav-dropdown-item nav-dropdown-link nav-upgrade-link" href="pricing.html">
            ⚡ Upgrade Plan
          </a>
          <div class="nav-dropdown-item nav-dropdown-signout" id="navSignOutBtn">
            ↪ Sign Out
          </div>
        </div>
      </div>`;

    document.getElementById('navUserChip').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('navUserChip').classList.toggle('open');
    });
    document.getElementById('navSignOutBtn').addEventListener('click', async e => {
      e.stopPropagation();
      await signOut(auth);
    });
  } else {
    navAuth.innerHTML = `<button class="nav-signin-btn" id="navSignInBtn">Sign In</button>`;
    document.getElementById('navSignInBtn').addEventListener('click', showAuthModal);
  }
}

// Close dropdown on outside click
document.addEventListener('click', () => {
  const chip = document.getElementById('navUserChip');
  if (chip) chip.classList.remove('open');
});

// ════════════════════════════════════════
//  AUTH STATE LISTENER
// ════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const ref  = doc(db, 'users', user.uid, 'profile', 'data');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        userTier   = snap.data().tier       || 'free';
        savedCount = snap.data().savedCount || 0;
      } else {
        await setDoc(ref, { tier: 'free', savedCount: 0, createdAt: serverTimestamp() });
        userTier = 'free'; savedCount = 0;
      }
    } catch (e) { console.error('Profile load error:', e); }
  } else {
    userTier = 'free'; savedCount = 0;
  }

  updateNavAuth(user);

  // Cache auth state globally so pricing page can read it synchronously
  window.__easycalcAuth = { user, userTier, savedCount, db, auth };

  // Let page-specific code hook into auth state changes
  document.dispatchEvent(new CustomEvent('acAuthChange', {
    detail: { user, userTier, savedCount, db, auth }
  }));

  // Also fire easycalc:authReady for pricing page
  window.dispatchEvent(new CustomEvent('easycalc:authReady', {
    detail: { user, userTier, savedCount, db, auth }
  }));
});

// ── Error messages ──
function friendlyErr(code) {
  return ({
    'auth/user-not-found':       'No account found with this email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-credential':   'Invalid email or password.',
    'auth/invalid-email':        'Please enter a valid email.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Please try again later.',
  })[code] || 'Something went wrong. Please try again.';
}

// ── Wire up the static navSignInBtn immediately (before Firebase resolves auth state) ──
function setupNavSignIn() {
  const btn = document.getElementById('navSignInBtn');
  if (btn && !btn._authWired) {
    btn.addEventListener('click', showAuthModal);
    btn._authWired = true;
  }
}

// ── Init on DOM ready ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectModal(); setupNavSignIn(); });
} else {
  injectModal();
  setupNavSignIn();
}
