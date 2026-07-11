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

// How well a mode fits the current load: fresh → deep work, spent → gentle.
function modeFit(mode, load) {
  if (load < 40) return { DESK: 3, TRANSIT: 2, WIND_DOWN: 1 }[mode] ?? 1.5;
  if (load < 65) return { DESK: 2, TRANSIT: 3, WIND_DOWN: 1.5 }[mode] ?? 1.5;
  return { DESK: 0.5, TRANSIT: 1.5, WIND_DOWN: 3 }[mode] ?? 1.5;
}

// A realistic break after a session — longer after deep work, and longer still
// when you're already loaded (the break is where load recovers).
function breakAfter(mode, loadAfter) {
  let brk = mode === 'DESK' ? 15 : mode === 'TRANSIT' ? 12 : 8;
  if (loadAfter > 65) brk += 8;
  if (loadAfter > 82) brk += 10;
  return Math.min(brk, 30);
}

// Per-area / per-item session caps so a day is full but not absurd.
const AREA_CAP = { WIND_DOWN: 1 };   // reading: once is enough
const AREA_CAP_DEFAULT = 3;
const ITEM_CAP = 2;                  // don't schedule the same topic more than twice

// Fill the day's free windows with as many sessions as realistically fit:
// deep work while fresh, alternating areas for variety, gentler work as load
// climbs, breaks between, tapering off when you're too spent to absorb more.
// `cands` is [{ area, item }] — the next surfaceable item per area.
export function planDay(date, cands, opts = {}) {
  const { startMin = DAY_START, endMin = DAY_END, busy = [], context = null, maxStudyMinutes = 360, pinned = [] } = opts;
  // Fresh sessions route around both commitments and any already-pinned blocks.
  const windows = freeWindows(startMin, endMin, [...busy, ...pinned]);
  const placed = [];
  const itemCount = new Map();
  const areaCount = new Map();
  let studyTotal = 0;
  let lastArea = null;

  const capForArea = (mode) => AREA_CAP[mode] ?? AREA_CAP_DEFAULT;
  const score = (c, load) => modeFit(c.item.mode, load)
    + (c.area !== lastArea ? 0.6 : 0)
    - (itemCount.get(c.item.id) || 0) * 1.5;

  for (const [wStart, wEnd] of windows) {
    let cursor = wStart;
    while (studyTotal < maxStudyMinutes) {
      const avail = wEnd - cursor;
      if (avail < 15) break;
      const load = predictLoadAt(cursor, { context, placed: [...pinned, ...placed], busy });

      // Eligible: under its caps AND its mode is within capacity at this load.
      const eligible = cands.filter((c) =>
        (itemCount.get(c.item.id) || 0) < ITEM_CAP &&
        (areaCount.get(c.area) || 0) < capForArea(c.item.mode) &&
        withinCapacity(c.item.mode, load));
      if (!eligible.length) break; // too loaded (or capped) for anything — rest

      eligible.sort((a, b) => score(b, load) - score(a, load));
      const pick = eligible[0];
      const minutes = Math.max(15, Math.min(clampDur(pick.item.estMinutes), avail));

      placed.push({
        itemId: pick.item.id, area: pick.area, title: pick.item.title || '', mode: pick.item.mode,
        date, start: cursor, minutes, status: 'planned', pinned: false,
      });
      itemCount.set(pick.item.id, (itemCount.get(pick.item.id) || 0) + 1);
      areaCount.set(pick.area, (areaCount.get(pick.area) || 0) + 1);
      studyTotal += minutes;
      lastArea = pick.area;

      const loadAfter = predictLoadAt(cursor + minutes, { context, placed: [...pinned, ...placed], busy });
      cursor += minutes + breakAfter(pick.item.mode, loadAfter);
    }
  }
  return placed;
}

// Lay blocks out in the exact order given, from `startMin`, around fixed
// `busy` obstacles, with a break after each. Used when you drag to reorder.
export function sequence(blocks, { startMin = DAY_START, busy = [] } = {}) {
  const fixed = busy.map((x) => ({ start: x.start, minutes: x.minutes }));
  let cursor = startMin;
  for (const b of blocks) {
    const s = pushPastFixed(Math.max(cursor, startMin), b.minutes, fixed);
    b.start = s;
    cursor = s + b.minutes + breakAfter(b.mode, 55);
  }
  return blocks.sort((a, b) => a.start - b.start);
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
