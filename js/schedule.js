// Adaptive day scheduling — pure functions, no DB.
//
// The coach lays study blocks into the day's FREE windows (around fixed
// commitments like the gym or a walk), ordering them by the cognitive load it
// predicts you'll have at each time — hard work in low-load windows, gentle
// work when you're spent. Blocks you pin keep their time; the rest re-pack
// around the pinned ones and the commitments.
import { withinCapacity, CONTEXTS } from './util.js';

export const DAY_START = 9 * 60;   // 9:00am — earliest the coach will book
export const DAY_END = 22 * 60;    // 10:00pm — fallback latest (bedtime overrides)
export const GAP = 10;             // minutes of breathing room between blocks
export const MIN_WINDOW = 15;      // ignore free gaps smaller than this

const DIFFICULTY = { DESK: 1.0, TRANSIT: 0.8, WIND_DOWN: 0.35 };
const HARD_FIRST = { DESK: 0, TRANSIT: 1, WIND_DOWN: 2 };
const EASY_FIRST = { DESK: 2, TRANSIT: 1, WIND_DOWN: 0 };

export function clampDur(m) {
  const v = Number(m) || 45;
  return Math.max(10, Math.min(90, Math.round(v)));
}

// How much a draining commitment weighs on you afterward, and how long it lingers.
const DRAIN = { low: { level: 28, tau: 60 }, high: { level: 55, tau: 120 } };

// Predicted cognitive load at minute-of-day `tMin`, mirroring the live gauge:
// time-of-day baseline + decaying life-context + decaying load from blocks
// already scheduled earlier today + the after-effect of draining commitments
// (office work, a hard gym session) that have finished by then.
export function predictLoadAt(tMin, { context = null, placed = [], busy = [] } = {}) {
  const hours = tMin / 60;
  let load = Math.max(0, Math.min(22, ((hours - 6) / 18) * 22));

  if (context && context.key && CONTEXTS[context.key] && context.setAt) {
    const d = new Date(context.setAt);
    const setMin = d.getHours() * 60 + d.getMinutes();
    const mins = Math.max(0, tMin - setMin);
    load += CONTEXTS[context.key].level * Math.exp(-mins / CONTEXTS[context.key].tau);
  }
  for (const b of placed) {
    const end = b.start + b.minutes;
    if (end > tMin) continue;
    const diff = DIFFICULTY[b.mode] ?? 0.7;
    load += b.minutes * diff * 0.9 * Math.exp(-(tMin - end) / 50);
  }
  for (const b of busy) {
    const d = DRAIN[b.drain];
    if (!d) continue;
    const end = b.start + b.minutes;
    if (end > tMin) continue;
    load += d.level * Math.exp(-(tMin - end) / d.tau);
  }
  return Math.max(0, Math.min(100, Math.round(load)));
}

// Free intervals in [start, end] once `busy` commitments are removed.
export function freeWindows(start, end, busy = []) {
  const bs = busy
    .map((b) => [b.start, b.start + b.minutes])
    .filter(([s, e]) => e > start && s < end)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = start;
  for (const [s, e] of bs) {
    if (s > cur) out.push([cur, Math.min(s, end)]);
    cur = Math.max(cur, e);
    if (cur >= end) break;
  }
  if (cur < end) out.push([cur, end]);
  return out.filter(([s, e]) => e - s >= MIN_WINDOW);
}

// Which remaining item best fits this slot given predicted load and space:
// fresh → hardest that fits capacity; loaded → gentlest. Returns index or -1.
function chooseIndex(items, load, avail) {
  const fits = items.map((it, i) => ({ it, i })).filter(({ it }) => clampDur(it.estMinutes) <= avail);
  if (!fits.length) return -1;
  const ok = fits.filter(({ it }) => withinCapacity(it.mode, load));
  const pool = ok.length ? ok : fits;
  const order = load < 50 ? HARD_FIRST : EASY_FIRST;
  pool.sort((a, b) => (order[a.it.mode] ?? 1) - (order[b.it.mode] ?? 1));
  return pool[0].i;
}

// Lay out fresh blocks for `items` into the day's free windows, load-aware.
export function planDay(date, items, opts = {}) {
  const { startMin = DAY_START, endMin = DAY_END, busy = [], context = null } = opts;
  const windows = freeWindows(startMin, endMin, busy);
  const remaining = [...items];
  const placed = [];

  for (const [wStart, wEnd] of windows) {
    let cursor = wStart;
    while (remaining.length) {
      const avail = wEnd - cursor;
      if (avail < 10) break;
      const load = predictLoadAt(cursor, { context, placed, busy });
      const idx = chooseIndex(remaining, load, avail);
      if (idx === -1) break;
      const it = remaining.splice(idx, 1)[0];
      const minutes = clampDur(it.estMinutes);
      placed.push({
        itemId: it.id, area: it.area || 'Study', title: it.title || '', mode: it.mode,
        date, start: cursor, minutes, status: 'planned', pinned: false,
      });
      cursor += minutes + GAP;
    }
  }
  return placed;
}

// Re-pack a day: pinned/done blocks and `obstacles` (commitments) keep their
// time; floating blocks flow into the earliest free slots around them.
export function reflow(blocks, obstacles = []) {
  const fixedBlocks = blocks.filter((b) => b.pinned).sort((a, b) => a.start - b.start);
  const floating = blocks.filter((b) => !b.pinned).sort((a, b) => a.start - b.start);
  const fixed = [...fixedBlocks, ...obstacles].map((x) => ({ start: x.start, minutes: x.minutes }));

  let cursor = DAY_START;
  for (const b of floating) {
    let start = Math.max(cursor, DAY_START);
    start = pushPastFixed(start, b.minutes, fixed);
    b.start = start;
    cursor = start + b.minutes + GAP;
  }
  return [...fixedBlocks, ...floating].sort((a, b) => a.start - b.start);
}

// Slide `start` forward until [start, start+minutes] clears every fixed interval.
function pushPastFixed(start, minutes, fixed) {
  let s = start;
  let moved = true;
  while (moved) {
    moved = false;
    for (const p of fixed) {
      const pEnd = p.start + p.minutes + GAP;
      if (s < pEnd && s + minutes + GAP > p.start) { s = pEnd; moved = true; }
    }
  }
  return s;
}
