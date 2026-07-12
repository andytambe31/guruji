// Session expectations — the coach's concrete "definition of done" for a topic.
// One shared model behind three surfaces: disclosed on the prep screen before you
// start, checked off live under the timer, confirmed on the wrap-up screen, and
// editable from the Day view. Kept here so all four stay in lock-step.
import { el, clear } from './util.js';

// Per-area defaults, used when a topic has no authored or user-set expectations.
// Generic but concrete and checkable — every session gets a real definition of
// done the moment you start it.
export const AREA_OBJECTIVES = {
  'DSA': [
    'Name the pattern this topic drills, and when it applies.',
    'Solve at least 2 problems — code that passes on LeetCode.',
    'Re-solve one from a blank editor, no peeking, under time.',
    'Write the one-line insight for each (pattern + why it works).',
    'Log the problems in the tracker with pattern + outcome.',
  ],
  'System Design': [
    'State the functional + non-functional requirements.',
    'Do the napkin math out loud: QPS and storage.',
    'Draw the component diagram end to end.',
    'For every choice, name the tradeoff and the alternative.',
    'Name the likely bottleneck and how you’d scale past it.',
  ],
  'CS Fundamentals': [
    'Read the topic guide actively, end to end (not a skim).',
    'Explain each key concept back in your own words, closed-book.',
    'Do the guide’s exercises hands-on — type them, don’t just read.',
    'Answer the guide’s self-check questions from memory.',
    'Rate your confidence on each concept before you end.',
  ],
  'Reading': [
    'Read the section you set out to — for what you carry out, not page count.',
    'Mark the one line that stops you.',
    'Write the single thought in your own words (Reading → reflect).',
  ],
  'Behavioral': [
    'Structure one story: Situation, Task, Action, Result.',
    'Put a number on the impact.',
    'Say it out loud, timed to about two minutes.',
  ],
  'default': [
    'Work through the topic’s guide actively.',
    'Explain the main idea back in your own words.',
    'Write a one-line note on what you carried out.',
  ],
};

// The effective expectations for a topic, in precedence order:
// what you set yourself → authored coach content → the area default.
export function resolveObjectives(item) {
  if (!item) return [];
  if (Array.isArray(item.objectives)) return item.objectives; // user-set (may be empty = "none")
  const c = item.coach && typeof item.coach === 'object' ? item.coach : null;
  if (c && Array.isArray(c.objectives) && c.objectives.length) return c.objectives;
  return AREA_OBJECTIVES[item.area] || AREA_OBJECTIVES.default;
}

export function objectivesProgress(item) {
  const list = resolveObjectives(item);
  const met = new Set(Array.isArray(item.doneObjectives) ? item.doneObjectives : []);
  return { total: list.length, done: list.filter((o) => met.has(o)).length };
}

// A live, tappable checklist: progress count, the first unmet item flagged as the
// current focus, met items struck through, an all-met nudge. `onToggle(text)`
// persists and returns the new met-list. Shared by the timer's coach panel and
// the wrap-up confirm. Returns the box node; it repaints itself on each tap.
export function renderChecklist(item, { onToggle, doneLabel } = {}) {
  const objectives = resolveObjectives(item);
  const met = new Set(Array.isArray(item.doneObjectives) ? item.doneObjectives : []);
  const box = el('div', { class: 'fc-obj-box' });
  const paint = () => {
    clear(box);
    const done = objectives.filter((o) => met.has(o)).length;
    const allMet = objectives.length > 0 && done === objectives.length;
    const currentIdx = objectives.findIndex((o) => !met.has(o));
    box.append(el('div', { class: 'fc-obj-top' }, [
      el('div', { class: 'fc-head', text: 'This session — meet these' }),
      el('div', { class: 'fc-obj-count' + (allMet ? ' all' : ''), text: `${done}/${objectives.length}` }),
    ]));
    objectives.forEach((o, i) => {
      const on = met.has(o);
      const isCurrent = !allMet && i === currentIdx;
      box.append(el('button', {
        class: 'fc-obj' + (on ? ' met' : '') + (isCurrent ? ' current' : ''),
        type: 'button', title: on ? 'Met — tap to undo' : 'Tap when you’ve met this',
        onclick: async () => {
          const list = onToggle ? await onToggle(o) : (on ? [...met].filter((x) => x !== o) : [...met, o]);
          met.clear(); (list || []).forEach((x) => met.add(x));
          item.doneObjectives = list || [];
          paint();
        },
      }, [
        el('span', { class: 'fc-obj-mark', text: on ? '✓' : (isCurrent ? '›' : '') }),
        el('span', { class: 'fc-obj-text', text: o }),
      ]));
    });
    box.append(allMet
      ? el('div', { class: 'fc-obj-note done', text: doneLabel || '✓ Every expectation met — mark this topic done when you end.' })
      : el('div', { class: 'fc-obj-note', text: 'Tick each as you meet it. Honest ticks only — this is how the coach knows to move on.' }));
  };
  paint();
  return box;
}

// A read-only preview for the prep screen: what you're about to take on. No
// checkboxes — just the list and where you stand if you've been here before.
export function renderPreview(item) {
  const objectives = resolveObjectives(item);
  if (!objectives.length) return null;
  const met = new Set(Array.isArray(item.doneObjectives) ? item.doneObjectives : []);
  const done = objectives.filter((o) => met.has(o)).length;
  return el('div', { class: 'prep-obj' }, [
    el('div', { class: 'prep-obj-head' }, [
      el('span', { text: 'What you’ll accomplish' }),
      done ? el('span', { class: 'prep-obj-count', text: `${done}/${objectives.length} so far` }) : null,
    ]),
    el('ul', { class: 'prep-obj-list' }, objectives.map((o) =>
      el('li', { class: met.has(o) ? 'met' : '' }, [
        el('span', { class: 'prep-obj-mark', text: met.has(o) ? '✓' : '○' }),
        el('span', { text: o }),
      ]))),
  ]);
}

// The Day-view editor: add, reword, remove, and tick expectations for a topic —
// so you can shape what "done" means after the fact. `onSave(list, done)` gets
// the final expectation texts (in order) and which of them are ticked.
export function openObjectivesEditor({ item, onSave } = {}) {
  const objectives = resolveObjectives(item);
  const metSet = new Set(Array.isArray(item.doneObjectives) ? item.doneObjectives : []);
  // Working rows carry their own met flag, so editing an item's text keeps its tick.
  const rows = objectives.map((text) => ({ text, met: metSet.has(text) }));

  const list = el('div', { class: 'oe-list' });
  const rowNode = (row) => {
    const check = el('button', {
      class: 'oe-check' + (row.met ? ' on' : ''), type: 'button', title: 'Met?',
      text: row.met ? '✓' : '', onclick: () => { row.met = !row.met; check.classList.toggle('on', row.met); check.textContent = row.met ? '✓' : ''; },
    });
    const input = el('input', {
      class: 'oe-input', type: 'text', value: row.text, placeholder: 'An expectation…',
      oninput: (e) => { row.text = e.target.value; },
    });
    const del = el('button', { class: 'oe-del', type: 'button', title: 'Remove', text: '✕', onclick: () => { node.remove(); row.removed = true; } });
    const node = el('div', { class: 'oe-row' }, [check, input, del]);
    return node;
  };
  rows.forEach((r) => list.append(rowNode(r)));

  const addBtn = el('button', { class: 'oe-add', type: 'button', text: '＋ Add an expectation', onclick: () => {
    const r = { text: '', met: false }; rows.push(r); const n = rowNode(r); list.append(n); n.querySelector('.oe-input').focus();
  } });

  const save = () => {
    const kept = rows.filter((r) => !r.removed && r.text.trim());
    const finalList = kept.map((r) => r.text.trim());
    const done = kept.filter((r) => r.met).map((r) => r.text.trim());
    close();
    if (onSave) onSave(finalList, done);
  };

  const card = el('div', { class: 'lc-card oe-card' }, [
    el('div', { class: 'lc-head' }, [
      el('div', { class: 'lc-title', text: 'Session expectations' }),
      el('button', { class: 'lc-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
    ]),
    el('p', { class: 'oe-sub', text: item.title }),
    list,
    addBtn,
    el('button', { class: 'btn btn-primary btn-block oe-save', type: 'button', text: 'Save expectations', onclick: save }),
  ]);
  const overlay = el('div', { class: 'lc-overlay' }, [card]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  function close() { overlay.classList.remove('show'); setTimeout(() => overlay.remove(), 200); }
}
