// Session expectations — the coach's concrete "definition of done" for a topic.
// One shared model behind four surfaces: disclosed on the prep screen before you
// start, checked off live under the timer, confirmed on the wrap-up screen, and
// editable from the Day view. Kept here so they all stay in lock-step.
//
// Expectations scale to the session length. A 30-minute block shouldn't demand a
// 90-minute workload, so each area defines three tiers — a short session leans on
// revision and one small rep; a long one goes deep. Every tier still ladders up
// to the same FAANG-readiness goal; it just right-sizes the ask.
import { el, clear } from './util.js';

// Per-area defaults by session length: { short, medium, long }. Used when a topic
// has no authored or user-set expectations — every session gets a real, correctly
// sized definition of done the moment you start it.
export const AREA_OBJECTIVES = {
  'DSA': {
    short: [
      'Recall this topic’s pattern and template from memory — no notes.',
      'Solve one easy problem in it (or re-do one you’ve seen before).',
      'Log it with pattern + outcome.',
    ],
    medium: [
      'Name the pattern this topic drills, and when it applies.',
      'Solve 2 problems — code that passes on LeetCode.',
      'For each, jot the one-line insight (pattern + why it works).',
      'Log the problems with pattern + outcome.',
    ],
    long: [
      'Name the pattern and write its template cold.',
      'Solve 3 problems, laddering easy → medium → hard.',
      'Re-solve one from a blank editor, no peeking, under time.',
      'Write the one-line insight for each.',
      'Log them all; flag any to re-solve in a few days.',
    ],
  },
  'System Design': {
    short: [
      'Re-read one section and restate its key tradeoff out loud.',
      'Redraw one component of the design from memory.',
      'Note the one thing to dig into next session.',
    ],
    medium: [
      'State the functional + non-functional requirements.',
      'Do the napkin math out loud: QPS and storage.',
      'Draw the core component diagram.',
      'For the main choices, name the tradeoff and the alternative.',
    ],
    long: [
      'State the functional + non-functional requirements.',
      'Do the napkin math: QPS, storage, bandwidth.',
      'Draw the component diagram end to end.',
      'For every choice, name the tradeoff and the alternative out loud.',
      'Name the bottleneck and how you’d scale past it.',
      'Walk the whole design top-to-bottom as if in the interview.',
    ],
  },
  'CS Fundamentals': {
    short: [
      'Re-read one section and explain it back closed-book.',
      'Rate your confidence on that concept.',
      'Note the one thing to revisit next.',
    ],
    medium: [
      'Read the planned section actively (not a skim).',
      'Explain each key concept back in your own words, closed-book.',
      'Do a couple of the guide’s exercises hands-on.',
      'Rate your confidence on the concepts you covered.',
    ],
    long: [
      'Read the topic guide actively, end to end.',
      'Explain each key concept back closed-book.',
      'Do the guide’s exercises hands-on — type them, don’t just read.',
      'Answer the guide’s self-check questions from memory.',
      'Rate your confidence on each concept before you end.',
    ],
  },
  'Reading': {
    short: [
      'Read a few pages — for what you carry out, not page count.',
      'Mark the one line that stops you.',
    ],
    medium: [
      'Read the section you set out to.',
      'Mark the one line that stops you.',
      'Write the single thought in your own words (Reading → reflect).',
    ],
    long: [
      'Read a full chapter or your target section.',
      'Mark the lines that stop you.',
      'Write a short reflection in your own words (Reading → reflect).',
    ],
  },
  'Behavioral': {
    short: [
      'Refine one STAR story’s opening line and its number.',
      'Say it out loud once, timed.',
    ],
    medium: [
      'Structure one story: Situation, Task, Action, Result.',
      'Put a number on the impact.',
      'Say it out loud, timed to about two minutes.',
    ],
    long: [
      'Structure two stories: Situation, Task, Action, Result.',
      'Lead each with the decision; put numbers on the impact.',
      'Say each out loud, timed to about two minutes.',
    ],
  },
  'default': {
    short: [
      'Work through a focused chunk of the guide.',
      'Explain the main idea back in your own words.',
    ],
    medium: [
      'Work through the topic’s guide actively.',
      'Explain the main idea back in your own words.',
      'Write a one-line note on what you carried out.',
    ],
    long: [
      'Work through the guide thoroughly.',
      'Explain each idea back in your own words.',
      'Do any exercises hands-on.',
      'Write a note on what you carried out.',
    ],
  },
};

// Which tier a session length falls into. Durations offered are 10/25/50/90, so
// short covers a quick 25, medium a standard 50, long a deep 90.
export function sessionBand(minutes) {
  const m = Number(minutes) || 50;
  return m <= 35 ? 'short' : m <= 70 ? 'medium' : 'long';
}

// The real intensity of a session = its length AND how spent you'll be. A long
// block on a fresh weekend morning is a deep session; the same length after a
// draining workday should be light. `load` is the predicted cognitive load at the
// block's start (0–100, stored by the planner); omit it to size by length alone.
export function sessionTier(minutes, load) {
  const d = sessionBand(minutes);
  if (load == null || Number.isNaN(Number(load))) return d;
  const L = Number(load);
  if (L >= 66) return 'short';                     // spent → light, whatever the length
  if (L >= 45) return d === 'long' ? 'medium' : d; // moderate → cap the ask at standard
  return d;                                         // fresh → the full length tier
}

// The badge a block wears so the plan reads at a glance: Light for drained /
// low-capacity times, Deep for fresh, longer sittings. Standard wears none.
export function sessionBadge(minutes, load) {
  const t = sessionTier(minutes, load);
  if (t === 'short') return { label: 'Light', cls: 'light' };
  if (t === 'long') return { label: 'Deep', cls: 'deep' };
  return null;
}

function tierNote(minutes, load) {
  return { short: 'A light session — keep it gentle; small reps still move the needle.',
           medium: 'A solid session — get real work done.',
           long: 'A deep session — go for depth and reps.' }[sessionTier(minutes, load)];
}
// Pick a tier from a tiered object; a plain array (legacy / flat authored) is
// returned unchanged so it applies at every intensity.
function pickTier(set, minutes, load) {
  if (Array.isArray(set)) return set;
  if (!set || typeof set !== 'object') return [];
  const t = sessionTier(minutes, load);
  return set[t] || set.medium || set.long || set.short || [];
}

// The effective expectations for a topic at a given session intensity, in
// precedence order: what you set yourself → authored coach content → area default.
// A user-set list is literal (no scaling); authored/area sets scale to intensity.
export function resolveObjectives(item, minutes, load) {
  if (!item) return [];
  if (Array.isArray(item.objectives)) return item.objectives; // user override — literal
  const c = item.coach && typeof item.coach === 'object' ? item.coach : null;
  const co = c ? c.objectives : null;
  if (co && (Array.isArray(co) ? co.length : typeof co === 'object')) return pickTier(co, minutes, load);
  return pickTier(AREA_OBJECTIVES[item.area] || AREA_OBJECTIVES.default, minutes, load);
}

const dedup = (arr) => { const seen = new Set(); const out = []; for (const x of arr) { if (x && !seen.has(x)) { seen.add(x); out.push(x); } } return out; };

// The full menu of goals for a topic — the union of its intensity tiers (or its
// authored / user pool). Bigger than a single session, so consecutive sessions
// can draw a *different* deliberate subset instead of repeating one fixed list.
export function poolFor(item) {
  if (!item) return [];
  if (Array.isArray(item.objectives) && item.objectives.length) return dedup(item.objectives);
  const c = item.coach && typeof item.coach === 'object' ? item.coach : null;
  const co = c ? c.objectives : null;
  if (co && !Array.isArray(co) && typeof co === 'object') return dedup([...(co.short || []), ...(co.medium || []), ...(co.long || [])]);
  if (Array.isArray(co) && co.length) return dedup(co);
  const set = AREA_OBJECTIVES[item.area] || AREA_OBJECTIVES.default;
  return dedup([...(set.short || []), ...(set.medium || []), ...(set.long || [])]);
}

// Build the deliberate goal set for ONE session: unmet goals carried over from the
// last session come first (a real second chance), then fresh goals rotated through
// the pool by `seq` (the session number) so successive sessions differ. `count` is
// the intensity-sized number of goals. Returns [{text, met:false}].
export function buildSessionGoals({ item, minutes, load, prior = [], seq = 0 } = {}) {
  const count = Math.max(1, resolveObjectives(item, minutes, load).length);
  const pool = poolFor(item);
  const chosen = [];
  for (const g of prior) { if (g && !g.met && !chosen.includes(g.text)) chosen.push(g.text); if (chosen.length >= count) break; }
  if (pool.length) {
    const start = ((seq % pool.length) + pool.length) % pool.length;
    for (let k = 0; k < pool.length && chosen.length < count; k++) {
      const t = pool[(start + k) % pool.length];
      if (!chosen.includes(t)) chosen.push(t);
    }
  }
  return chosen.slice(0, count).map((text) => ({ text, met: false }));
}

export function goalsProgress(goals) {
  const g = Array.isArray(goals) ? goals : [];
  return { total: g.length, done: g.filter((x) => x && x.met).length };
}

// A live, tappable checklist over THIS session's goals ([{text, met}]). Progress
// count, the first unmet item flagged as current, met items struck through, an
// all-met nudge. `onToggle(text)` persists and returns the new goal list; the
// component repaints from it. `note` is the intensity line. Per-session by design.
export function renderChecklist(goals, { onToggle, doneLabel, note } = {}) {
  let list = (Array.isArray(goals) ? goals : []).map((g) => ({ text: g.text, met: !!g.met }));
  const box = el('div', { class: 'fc-obj-box' });
  const paint = () => {
    clear(box);
    const done = list.filter((o) => o.met).length;
    const allMet = list.length > 0 && done === list.length;
    const currentIdx = list.findIndex((o) => !o.met);
    box.append(el('div', { class: 'fc-obj-top' }, [
      el('div', { class: 'fc-head', text: 'This session — meet these' }),
      el('div', { class: 'fc-obj-count' + (allMet ? ' all' : ''), text: `${done}/${list.length}` }),
    ]));
    list.forEach((o, i) => {
      const isCurrent = !allMet && i === currentIdx;
      box.append(el('button', {
        class: 'fc-obj' + (o.met ? ' met' : '') + (isCurrent ? ' current' : ''),
        type: 'button', title: o.met ? 'Met — tap to undo' : 'Tap when you’ve met this',
        onclick: async () => {
          if (onToggle) { const ng = await onToggle(o.text); if (Array.isArray(ng)) list = ng.map((g) => ({ text: g.text, met: !!g.met })); }
          else { o.met = !o.met; }
          paint();
        },
      }, [
        el('span', { class: 'fc-obj-mark', text: o.met ? '✓' : (isCurrent ? '›' : '') }),
        el('span', { class: 'fc-obj-text', text: o.text }),
      ]));
    });
    box.append(allMet
      ? el('div', { class: 'fc-obj-note done', text: doneLabel || '✓ Every expectation met — mark this topic done when you end.' })
      : el('div', { class: 'fc-obj-note', text: (note ? note + ' ' : '') + 'Tick each honestly as you meet it.' }));
  };
  paint();
  return box;
}

// The intensity line for a session (exported so callers can pass it as `note`).
export function tierLine(minutes, load) { return tierNote(minutes, load); }

// A read-only preview of THIS session's goals for the prep screen.
export function renderPreview(goals) {
  const list = Array.isArray(goals) ? goals : [];
  if (!list.length) return null;
  const done = list.filter((o) => o.met).length;
  return el('div', { class: 'prep-obj' }, [
    el('div', { class: 'prep-obj-head' }, [
      el('span', { text: 'What you’ll accomplish' }),
      done ? el('span', { class: 'prep-obj-count', text: `${done}/${list.length} so far` }) : null,
    ]),
    el('ul', { class: 'prep-obj-list' }, list.map((o) =>
      el('li', { class: o.met ? 'met' : '' }, [
        el('span', { class: 'prep-obj-mark', text: o.met ? '✓' : '○' }),
        el('span', { text: o.text }),
      ]))),
  ]);
}

// The Day-view expectations panel. It opens in CHECK mode: big, tappable rows to
// mark which expectations you met in that session — retroactively, off-timer,
// whenever — persisting immediately via onToggle. Editing the wording (add /
// reword / remove) lives behind a secondary "Edit" toggle, so the common case
// (logging what you accomplished) is the obvious one, not an afterthought.
// Operates on THIS session's goals ([{text,met}]). onToggle(text) → new goal list;
// onSave(list, done) saves an edited list; onClose fires after close so the caller
// can repaint. `note` is the intensity line.
export function openObjectivesEditor({ goals, title, note, onToggle, onSave, onClose } = {}) {
  let mode = 'check';
  const seed = (Array.isArray(goals) ? goals : []).map((g) => ({ text: g.text, met: !!g.met }));
  const body = el('div', { class: 'oe-body' });
  const controls = el('div', { class: 'oe-controls' });

  // CHECK mode — the tick-off checklist (same component as the timer), so marking
  // met here works exactly like it does live, and persists on tap.
  function checkView() {
    return el('div', { class: 'focus-coach oe-check-wrap' }, [
      renderChecklist(seed, {
        note,
        // keep `seed` in sync so a switch to Edit mode reflects the ticks.
        onToggle: onToggle ? async (t) => {
          const ng = await onToggle(t);
          if (Array.isArray(ng)) { seed.length = 0; ng.forEach((g) => seed.push({ text: g.text, met: !!g.met })); }
          return ng;
        } : undefined,
        doneLabel: '✓ Every expectation met — nice work.',
      }),
    ]);
  }

  // EDIT mode — add, reword, remove; Save writes the list (and its ticks) back.
  function editView() {
    const rows = seed.map((g) => ({ text: g.text, met: g.met }));
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
    // stash for the Save handler in controls
    editView._collect = () => {
      const kept = rows.filter((r) => !r.removed && r.text.trim());
      return { list: kept.map((r) => r.text.trim()), done: kept.filter((r) => r.met).map((r) => r.text.trim()) };
    };
    return el('div', {}, [list, addBtn]);
  }

  function render() {
    clear(body); clear(controls);
    if (mode === 'check') {
      body.append(checkView());
      controls.append(
        el('button', { class: 'btn btn-primary btn-block', type: 'button', text: 'Done', onclick: () => close() }),
        el('button', { class: 'oe-mode', type: 'button', text: '✎ Edit the expectations', onclick: () => { mode = 'edit'; render(); } }),
      );
    } else {
      body.append(editView());
      controls.append(
        el('button', { class: 'btn btn-primary btn-block oe-save', type: 'button', text: 'Save', onclick: () => {
          const { list, done } = editView._collect();
          // reflect locally so check mode is fresh
          seed.length = 0; list.forEach((t) => seed.push({ text: t, met: done.includes(t) }));
          if (onSave) onSave(list, done);
          mode = 'check'; render();
        } }),
        el('button', { class: 'oe-mode', type: 'button', text: '‹ Back to the checklist', onclick: () => { mode = 'check'; render(); } }),
      );
    }
  }

  const card = el('div', { class: 'lc-card oe-card' }, [
    el('div', { class: 'lc-head' }, [
      el('div', { class: 'lc-title', text: 'What you met' }),
      el('button', { class: 'lc-close', type: 'button', 'aria-label': 'Close', text: '✕', onclick: () => close() }),
    ]),
    el('p', { class: 'oe-sub', text: title || '' }),
    body,
    controls,
  ]);
  render();
  const overlay = el('div', { class: 'lc-overlay' }, [card]);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  function close() { overlay.classList.remove('show'); setTimeout(() => { overlay.remove(); if (onClose) onClose(); }, 200); }
}
