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
 *   container {Element} — panel is injected after this element
 *   getData   {Function}— called at save time; returns snapshot object
 */
export function initSavePanel({ calcId, calcLabel, calcIcon = '💾', container, getData }) {

  let currentUser = null;
  let userTier    = 'free';
  let savedCount  = 0;

  // ── Inject DOM ──
  const wrap = document.createElement('div');
  wrap.className = 'csp-wrap';
  wrap.innerHTML = `
    <div class="csp-save-row">
      <button class="csp-save-btn">${calcIcon} Save this result</button>
    </div>
    <div class="csp-list-section">
      <div class="csp-list-heading">Your saved ${esc(calcLabel)} sessions</div>
      <ul class="csp-list"></ul>
    </div>`;
  container.insertAdjacentElement('afterend', wrap);

  const saveRow    = wrap.querySelector('.csp-save-row');
  const saveBtn    = wrap.querySelector('.csp-save-btn');
  const listEl     = wrap.querySelector('.csp-list');

  // ── Auth state ──
  document.addEventListener('acAuthChange', async e => {
    currentUser = e.detail.user;
    userTier    = e.detail.userTier    || 'free';
    savedCount  = e.detail.savedCount  || 0;

    if (currentUser) {
      await loadMiniList();
    } else {
      listEl.innerHTML = `
        <li class="csp-item-noauth">
          <button class="csp-signin-prompt">Sign in to save sessions</button>
        </li>`;
      listEl.querySelector('.csp-signin-prompt').addEventListener('click', showAuthModal);
    }
  });

  // ── Save button click ──
  saveBtn.addEventListener('click', () => {
    if (!currentUser) { showAuthModal(); return; }
    showNameInput();
  });

  function showNameInput() {
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const defaultName = `${calcLabel} — ${today}`;

    saveBtn.style.display = 'none';

    const form = document.createElement('div');
    form.className = 'csp-name-form';
    form.innerHTML = `
      <input  type="text"  class="csp-name-input"  value="${esc(defaultName)}" placeholder="Session name">
      <button class="csp-confirm-btn">✓ Save</button>
      <button class="csp-cancel-btn">✗</button>
      <div    class="csp-limit-msg" style="display:none"></div>`;
    saveRow.appendChild(form);

    const nameInput  = form.querySelector('.csp-name-input');
    const confirmBtn = form.querySelector('.csp-confirm-btn');
    const cancelBtn  = form.querySelector('.csp-cancel-btn');
    const limitMsg   = form.querySelector('.csp-limit-msg');

    nameInput.focus();
    nameInput.select();

    cancelBtn.addEventListener('click', () => {
      form.remove();
      saveBtn.style.display = '';
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
        saveBtn.style.display = '';
        await loadMiniList();
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

  // ── Load mini list from Firestore ──
  async function loadMiniList() {
    if (!currentUser) return;
    try {
      const q    = query(
        collection(db, 'users', currentUser.uid, 'sessions'),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);

      const items = [];
      snap.forEach(d => {
        if (d.data().calculator === calcId) items.push({ id: d.id, data: d.data() });
      });

      listEl.innerHTML = '';
      if (items.length === 0) {
        listEl.innerHTML = '<li class="csp-item-empty">No saved sessions yet.</li>';
        return;
      }
      items.forEach(({ id, data }) => listEl.appendChild(buildMiniItem(id, data)));
    } catch (err) {
      console.error('Mini list load error:', err);
    }
  }

  // ── Build one mini list item ──
  function buildMiniItem(id, data) {
    const li = document.createElement('li');
    li.className = 'csp-item';
    li.innerHTML = `
      <div class="csp-item-header">
        <span class="csp-item-label">${esc(data.label || 'Session')}</span>
        <span class="csp-item-preview">${esc(data.preview || '')}</span>
        <span class="csp-item-date">${fmtDate(data.createdAt)}</span>
        <div class="csp-item-actions">
          <button class="csp-item-edit-btn" title="Rename">✏️</button>
          <button class="csp-item-del-btn"  title="Delete">🗑️</button>
        </div>
        <span class="csp-item-arrow">›</span>
      </div>
      <div class="csp-item-body">${renderCalcTemplate(data)}</div>`;

    const header    = li.querySelector('.csp-item-header');
    const actions   = li.querySelector('.csp-item-actions');
    const editBtn   = li.querySelector('.csp-item-edit-btn');
    const delBtn    = li.querySelector('.csp-item-del-btn');
    const labelSpan = li.querySelector('.csp-item-label');

    // Toggle expand/collapse
    header.addEventListener('click', e => {
      if (!e.target.closest('.csp-item-actions') && !e.target.closest('.csp-rename-input')) {
        li.classList.toggle('open');
      }
    });

    // Inline rename
    editBtn.addEventListener('click', e => {
      e.stopPropagation();
      const currentName = labelSpan.textContent;
      const input       = document.createElement('input');
      input.type        = 'text';
      input.className   = 'csp-rename-input';
      input.value       = currentName;
      labelSpan.replaceWith(input);
      editBtn.style.display = 'none';
      input.focus();
      input.select();

      async function commitRename() {
        const newName = input.value.trim() || currentName;
        const newSpan = document.createElement('span');
        newSpan.className   = 'csp-item-label';
        newSpan.textContent = newName;
        input.replaceWith(newSpan);
        editBtn.style.display = '';
        if (newName !== currentName && currentUser) {
          try {
            await updateDoc(doc(db, 'users', currentUser.uid, 'sessions', id), { label: newName });
          } catch (err) { console.error('Rename error:', err); }
        }
      }

      input.addEventListener('blur', commitRename);
      input.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter')  { e2.preventDefault(); input.blur(); }
        if (e2.key === 'Escape') { input.value = currentName; input.blur(); }
      });
    });

    // Inline delete with confirm
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      editBtn.style.display = 'none';
      delBtn.style.display  = 'none';

      const confirmRow = document.createElement('div');
      confirmRow.style.cssText = 'display:flex;align-items:center;gap:4px;flex-shrink:0';
      confirmRow.innerHTML = `
        <span style="font-size:.72rem;color:rgba(255,255,255,.5);white-space:nowrap">Delete?</span>
        <button class="csp-del-yes">Yes</button>
        <button class="csp-del-no">No</button>`;
      actions.appendChild(confirmRow);

      // Style the confirm buttons
      confirmRow.querySelector('.csp-del-yes').style.cssText =
        'padding:2px 8px;font-size:.72rem;font-weight:700;background:none;border:1.5px solid rgba(248,113,113,.5);border-radius:5px;color:#f87171;cursor:pointer';
      confirmRow.querySelector('.csp-del-no').style.cssText =
        'padding:2px 8px;font-size:.72rem;font-weight:700;background:none;border:1.5px solid rgba(255,255,255,.2);border-radius:5px;color:rgba(255,255,255,.5);cursor:pointer';

      confirmRow.querySelector('.csp-del-no').addEventListener('click', e2 => {
        e2.stopPropagation();
        confirmRow.remove();
        editBtn.style.display = '';
        delBtn.style.display  = '';
      });

      confirmRow.querySelector('.csp-del-yes').addEventListener('click', async e2 => {
        e2.stopPropagation();
        const yesBtn       = e2.currentTarget;
        yesBtn.textContent = '…';
        yesBtn.disabled    = true;
        try {
          await deleteDoc(doc(db, 'users', currentUser.uid, 'sessions', id));
          savedCount = Math.max(0, savedCount - 1);
          await setDoc(doc(db, 'users', currentUser.uid, 'profile', 'data'),
                       { savedCount }, { merge: true });
          li.remove();
          if (listEl.querySelectorAll('.csp-item').length === 0) {
            listEl.innerHTML = '<li class="csp-item-empty">No saved sessions yet.</li>';
          }
        } catch (err) {
          console.error('Delete error:', err);
          confirmRow.remove();
          editBtn.style.display = '';
          delBtn.style.display  = '';
        }
      });
    });

    return li;
  }

  // ── Public API ──
  function onResultReady() {
    saveRow.classList.add('visible');
    if (saveBtn) {
      saveBtn.disabled    = false;
      saveBtn.textContent = `${calcIcon} Save this result`;
    }
  }

  function onResultCleared() {
    saveRow.classList.remove('visible');
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
