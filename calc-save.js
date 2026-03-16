/**
 * calc-save.js
 * Shared save-panel module for AllCalculate.com calculators.
 * Exports:
 *   initSavePanel(config)    → { onResultReady, onResultCleared }
 *   renderCalcTemplate(data) → HTML string
 */

import { db, showAuthModal } from './firebase-auth.js';
import {
  collection, addDoc, getDocs, query, orderBy,
  updateDoc, deleteDoc, doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Tier limits (kept in sync with firebase-auth.js) ──
const TIER_LIMITS = { free: 5, basic: 500, executive: 1500, premium: Infinity };

// ── Helpers ──
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ═══════════════════════════════════════════════════
//  initSavePanel
// ═══════════════════════════════════════════════════
/**
 * @param {object} config
 *   calcId    {string}  — e.g. 'mortgage'
 *   calcLabel {string}  — e.g. 'Mortgage'
 *   calcIcon  {string}  — e.g. '🏠'
 *   container {Element} — (unused legacy param, kept for compatibility)
 *   getData   {Function}— called at save time; returns snapshot object
 */
export function initSavePanel({ calcId, calcLabel, calcIcon = '💾', container, getData }) {

  let currentUser = null;
  let userTier    = 'free';
  let savedCount  = 0;

  // ── Inject widget into .calc-header ──
  const calcHeader = document.querySelector('.calc-header');

  const widget = document.createElement('div');
  widget.className = 'csp-header-widget';
  widget.innerHTML = `
    <button class="csp-save-btn" disabled>Save this result</button>
    <a href="saved-sessions.html" class="csp-sessions-link">Your Sessions →</a>`;

  // Wrap existing h1/breadcrumb in .csp-title-wrap, then append widget alongside it
  if (calcHeader) {
    const titleWrap = document.createElement('div');
    titleWrap.className = 'csp-title-wrap';
    while (calcHeader.firstChild) {
      titleWrap.appendChild(calcHeader.firstChild);
    }
    calcHeader.appendChild(titleWrap);
    calcHeader.appendChild(widget);
  } else if (container) {
    // Fallback: insert after the container element
    container.insertAdjacentElement('afterend', widget);
  }

  const saveBtn = widget.querySelector('.csp-save-btn');

  // ── Auth state ──
  document.addEventListener('acAuthChange', e => {
    currentUser = e.detail.user;
    userTier    = e.detail.userTier   || 'free';
    savedCount  = e.detail.savedCount || 0;
  });

  // ── Save button click ──
  saveBtn.addEventListener('click', () => {
    if (!currentUser) { showAuthModal(); return; }
    showNameInput();
  });

  function showNameInput() {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const defaultName = `${calcLabel} — ${today}`;

    saveBtn.disabled = true;

    const form = document.createElement('div');
    form.className = 'csp-name-form';
    form.innerHTML = `
      <input  type="text"  class="csp-name-input"  value="${esc(defaultName)}" placeholder="Session name">
      <button class="csp-confirm-btn">✓ Save</button>
      <button class="csp-cancel-btn">✗</button>
      <div    class="csp-limit-msg" style="display:none"></div>`;
    widget.insertBefore(form, widget.querySelector('.csp-sessions-link'));

    const nameInput  = form.querySelector('.csp-name-input');
    const confirmBtn = form.querySelector('.csp-confirm-btn');
    const cancelBtn  = form.querySelector('.csp-cancel-btn');
    const limitMsg   = form.querySelector('.csp-limit-msg');

    nameInput.focus();
    nameInput.select();

    cancelBtn.addEventListener('click', () => {
      form.remove();
      saveBtn.disabled = false;
    });

    async function doSave() {
      const label = nameInput.value.trim() || defaultName;
      const limit = TIER_LIMITS[userTier] ?? 5;

      if (savedCount >= limit) {
        limitMsg.textContent   = `You've reached your ${limit}-session limit. Upgrade to save more.`;
        limitMsg.style.display = 'block';
        return;
      }

      confirmBtn.textContent = '…';
      confirmBtn.disabled    = true;

      try {
        const snapshot = getData();
        await addDoc(collection(db, 'users', currentUser.uid, 'sessions'), {
          ...snapshot,
          calculator: calcId,
          label,
          createdAt: serverTimestamp()
        });

        savedCount++;
        await setDoc(doc(db, 'users', currentUser.uid, 'profile', 'data'),
                     { savedCount }, { merge: true });

        form.remove();
        saveBtn.disabled = false;
        // Brief "Saved!" confirmation
        saveBtn.textContent = `✓ Saved!`;
        setTimeout(() => { saveBtn.textContent = 'Save this result'; }, 2000);
      } catch (err) {
        console.error('Save error:', err);
        confirmBtn.textContent = '✓ Save';
        confirmBtn.disabled    = false;
        limitMsg.textContent   = 'Save failed. Please try again.';
        limitMsg.style.display = 'block';
      }
    }

    confirmBtn.addEventListener('click', doSave);
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter')  doSave();
      if (e.key === 'Escape') cancelBtn.click();
    });
  }

  // ── Public API ──
  function onResultReady() {
    saveBtn.disabled = false;
  }

  function onResultCleared() {
    saveBtn.disabled = true;
  }

  return { onResultReady, onResultCleared };
}

// ═══════════════════════════════════════════════════
//  renderCalcTemplate
// ═══════════════════════════════════════════════════
/**
 * Returns an HTML string for the expanded session card body.
 * Handles all calculator types.
 */
export function renderCalcTemplate(data) {
  const e = esc;
  const calculator = data.calculator || 'simple-calculator';

  // ── Simple Calculator (legacy: data.calculations array) ──
  if (calculator === 'simple-calculator' || data.calculations) {
    const calcs = data.calculations || [];
    if (!calcs.length) return '<p class="csp-tmpl-empty">No calculations recorded.</p>';
    return `<table class="csp-tmpl-table">
      <thead><tr><th>Expression</th><th style="text-align:right">Result</th></tr></thead>
      <tbody>${calcs.map(c => `
        <tr>
          <td>${e(c.expr)}</td>
          <td style="text-align:right;font-weight:600">${e(c.result)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  // ── Scientific Calculator ──
  if (calculator === 'scientific') {
    const calcs = data.calculations || [];
    if (!calcs.length) return '<p class="csp-tmpl-empty">No calculations recorded.</p>';
    return `<table class="csp-tmpl-table">
      <thead><tr><th>Expression</th><th style="text-align:right">Result</th></tr></thead>
      <tbody>${calcs.map(c => `
        <tr>
          <td>${e(c.expr)}</td>
          <td style="text-align:right;font-weight:600">${e(c.result)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  // ── GPA Calculator ──
  if (calculator === 'gpa') {
    const courses = data.courses || [];
    return `<div class="csp-tmpl">
      ${courses.length > 0 ? `
      <div class="csp-tmpl-section">
        <div class="csp-tmpl-heading">Courses</div>
        <table class="csp-tmpl-table">
          <thead><tr><th>Course</th><th>Grade</th><th style="text-align:right">Credits</th></tr></thead>
          <tbody>${courses.map(c => `
            <tr>
              <td>${e(c.name || '–')}</td>
              <td>${e(c.grade || '–')}</td>
              <td style="text-align:right">${e(String(c.credits || '–'))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
      <div class="csp-tmpl-section">
        <div class="csp-tmpl-heading">Results</div>
        <div class="csp-tmpl-row highlight"><span>Semester GPA</span><span>${e(String(data.semGPA || '–'))}</span></div>
        <div class="csp-tmpl-row"><span>Cumulative GPA</span><span>${e(String(data.cumGPA || '–'))}</span></div>
        <div class="csp-tmpl-row"><span>Total Credits</span><span>${e(String(data.totalCredits || '–'))}</span></div>
      </div>
    </div>`;
  }

  // ── Square Footage Calculator ──
  if (calculator === 'square-footage') {
    const rooms = data.rooms || [];
    return `<div class="csp-tmpl">
      ${rooms.length > 0 ? `
      <div class="csp-tmpl-section">
        <div class="csp-tmpl-heading">Rooms</div>
        <table class="csp-tmpl-table">
          <thead><tr><th>Room</th><th style="text-align:right">Area (sq ft)</th></tr></thead>
          <tbody>${rooms.map(r => `
            <tr>
              <td>${e(r.name || '–')}</td>
              <td style="text-align:right">${e(String(r.area || 0))}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
      <div class="csp-tmpl-section">
        <div class="csp-tmpl-heading">Results</div>
        <div class="csp-tmpl-row highlight"><span>Total Area</span><span>${e(String(data.totalArea || '–'))} sq ft</span></div>
        ${data.totalWithWaste ? `<div class="csp-tmpl-row"><span>With Waste Factor</span><span>${e(String(data.totalWithWaste))} sq ft</span></div>` : ''}
        ${data.totalCost ? `<div class="csp-tmpl-row"><span>Est. Material Cost</span><span>${e(String(data.totalCost))}</span></div>` : ''}
      </div>
    </div>`;
  }

  // ── Generic: all Group 2 calculators (inputs + results objects) ──
  const inp     = data.inputs  || {};
  const res     = data.results || {};
  const inpKeys = Object.keys(inp);
  const resKeys = Object.keys(res);

  return `<div class="csp-tmpl">
    ${inpKeys.length > 0 ? `
    <div class="csp-tmpl-section">
      <div class="csp-tmpl-heading">Inputs</div>
      ${inpKeys.map(k => `
        <div class="csp-tmpl-row">
          <span>${e(k)}</span>
          <span>${e(String(inp[k]))}</span>
        </div>`).join('')}
    </div>` : ''}
    ${resKeys.length > 0 ? `
    <div class="csp-tmpl-section">
      <div class="csp-tmpl-heading">Results</div>
      ${resKeys.map((k, i) => `
        <div class="csp-tmpl-row${i === 0 ? ' highlight' : ''}">
          <span>${e(k)}</span>
          <span>${e(String(res[k]))}</span>
        </div>`).join('')}
    </div>` : ''}
  </div>`;
}
