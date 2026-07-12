// LeetCode problem logger — a reusable wizard. Almost nothing to type: paste the
// problem URL (the title is derived from it), then tap difficulty / pattern /
// outcome. Only the note is free text, and it's optional. Used after a DSA focus
// session and retroactively from a Day block.
import { el, clear, toast } from '../util.js';

export const LC_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
export const LC_OUTCOMES = [
  { key: 'solved', label: 'Solved' },
  { key: 'hint', label: 'Needed a hint' },
  { key: 'stuck', label: "Couldn't crack it" },
];
export const LC_OUTCOME_LABEL = Object.fromEntries(LC_OUTCOMES.map((o) => [o.key, o.label]));
// The ~15 patterns from the DSA pattern catalog, so the by-pattern view is clean.
export const LC_PATTERNS = [
  'Two pointers', 'Sliding window', 'Prefix sum', 'Hashing',
  'Stack / Monotonic stack', 'Linked list', 'Binary search',
  'Trees (DFS/BFS)', 'Graphs', 'Heap / Top-K', 'Backtracking',
  'Dynamic programming', 'Greedy', 'Intervals', 'Bit manipulation', 'Math', 'Other',
];

// "https://leetcode.com/problems/two-sum/" -> { slug:'two-sum', title:'Two Sum' }.
// If it isn't a LeetCode URL, treat the text as a title and slugify it.
export function parseLeetcode(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  let slug; let title = ''; let url = null;
  if (m) { slug = m[1].toLowerCase(); url = s.split(/\s+/)[0]; } else {
    slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    title = s;
  }
  if (!title) title = slug ? slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : '';
  return { slug, title, url };
}

// Opens the wizard overlay. onSave(entries) fires with the full list on Save.
export function openLeetcodeWizard({ initial = [], onSave } = {}) {
  const entries = (initial || []).map((e) => ({ ...e }));
  let diff = null; let pattern = ''; let outcome = null;

  const urlInput = el('input', { type: 'text', class: 'lc-url', placeholder: 'Paste the LeetCode URL (or type the title)', spellcheck: false, autocapitalize: 'none' });
  const preview = el('span', { class: 'lc-preview' });
  urlInput.addEventListener('input', () => { const p = parseLeetcode(urlInput.value); preview.textContent = p.title ? `→ ${p.title}` : ''; });

  const chipRow = (opts, keyOf, labelOf, get, set) => {
    const row = el('div', { class: 'lc-chips' });
    const paint = () => row.querySelectorAll('.lc-chip').forEach((c) => c.classList.toggle('on', c.dataset.k === String(get())));
    opts.forEach((o) => {
      const k = keyOf(o);
      row.append(el('button', { class: 'lc-chip', type: 'button', dataset: { k: String(k) }, text: labelOf(o), onclick: () => { set(get() === k ? null : k); paint(); } }));
    });
    return { row, paint };
  };
  const diffRow = chipRow(LC_DIFFICULTIES, (x) => x, (x) => x, () => diff, (v) => { diff = v; });
  const outRow = chipRow(LC_OUTCOMES, (o) => o.key, (o) => o.label, () => outcome, (v) => { outcome = v; });

  const patternSel = el('select', { class: 'lc-select' }, [
    el('option', { value: '', text: 'Pattern…' }),
    ...LC_PATTERNS.map((p) => el('option', { value: p, text: p })),
  ]);
  patternSel.addEventListener('change', () => { pattern = patternSel.value; });
  const noteInput = el('input', { type: 'text', class: 'lc-note', placeholder: 'Optional note — the insight or the mistake' });

  const list = el('div', { class: 'lc-list' });
  const renderList = () => {
    clear(list);
    if (!entries.length) { list.append(el('div', { class: 'lc-empty', text: 'No problems added yet.' })); return; }
    entries.forEach((e, i) => list.append(el('div', { class: 'lc-row' }, [
      el('div', { class: 'lc-row-main' }, [
        el('span', { class: 'lc-row-title', text: e.title || e.slug }),
        el('span', { class: 'lc-row-meta', text: [e.difficulty, e.pattern, e.outcome ? LC_OUTCOME_LABEL[e.outcome] : null].filter(Boolean).join(' · ') }),
      ]),
      el('button', { class: 'lc-row-x', type: 'button', text: '×', 'aria-label': 'Remove', onclick: () => { entries.splice(i, 1); renderList(); syncSave(); } }),
    ])));
  };

  const resetForm = () => {
    urlInput.value = ''; preview.textContent = ''; diff = null; pattern = ''; outcome = null;
    patternSel.value = ''; noteInput.value = ''; diffRow.paint(); outRow.paint();
  };
  const addProblem = () => {
    const p = parseLeetcode(urlInput.value);
    if (!p.title) { toast('Paste a URL or type the problem', true); return false; }
    entries.push({ slug: p.slug, title: p.title, url: p.url, difficulty: diff, pattern: pattern || null, outcome, note: noteInput.value.trim() || null });
    renderList(); resetForm(); syncSave(); urlInput.focus();
    return true;
  };

  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => {
    if (urlInput.value.trim() && !addProblem()) return; // auto-add a pending problem
    close(); if (onSave) onSave(entries);
  } });
  const syncSave = () => { saveBtn.textContent = entries.length ? `Save · ${entries.length}` : 'Save'; };

  const card = el('div', { class: 'lc-card' }, [
    el('div', { class: 'lc-head' }, [
      el('div', { class: 'lc-title', text: 'LeetCode problems' }),
      el('button', { class: 'lc-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
    ]),
    list,
    el('div', { class: 'lc-form' }, [
      el('div', { class: 'lc-field' }, [urlInput, preview]),
      el('div', { class: 'lc-flabel', text: 'Difficulty' }), diffRow.row,
      el('div', { class: 'lc-flabel', text: 'Pattern' }), patternSel,
      el('div', { class: 'lc-flabel', text: 'Outcome' }), outRow.row,
      noteInput,
      el('button', { class: 'btn btn-ghost btn-block lc-add', type: 'button', text: '＋ Add problem', onclick: addProblem }),
    ]),
    saveBtn,
  ]);
  const overlay = el('div', { class: 'lc-overlay' }, [card]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  renderList(); syncSave();
  setTimeout(() => urlInput.focus(), 60);

  function close() { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); }
}
