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

// A realistic, structured break after a session: a proper long reset every
// ~2 hours of study, otherwise 12–20 min scaled to the session's length and
// how loaded you are. Never the pointless 8-minute stub.
function breakAfter(minutes, loadAfter, sinceLong = 0, deep = false) {
  if (deep) {
    // A break restores less when you're more depleted, so breaks lengthen as
    // cognitive load climbs through the day: a quick breather in the morning,
    // a proper decompress in the evening for the same recovery. A couple of
    // real recharges punctuate the day; relaxed breathers fill between.
    if (sinceLong >= 165) return loadAfter > 80 ? 70 : loadAfter > 60 ? 55 : 45;
    return loadAfter > 80 ? 35 : loadAfter > 60 ? 28 : 20;
  }
  if (sinceLong >= 110) return 30;                 // long break — stretch, eat, walk
  let brk = minutes >= 50 ? 20 : minutes >= 30 ? 15 : 12;
  if (loadAfter > 70) brk += 5;
  return Math.min(brk, 25);
}

// How long a single session runs. On an ordinary day, one topic's estimate
// (capped ~90 min). In `deep` mode (a wide-open weekend), the coach builds
// longer focused blocks while you're fresh — up to ~2.5 hours of one thing —
// tapering as load climbs, so eight hours of study lands as a few big sittings
// plus lighter work, not a dozen little ones.
function sessionMinutes(item, load, avail, deep, remaining) {
  const base = clampDur(item.estMinutes); // 10..90
  if (!deep) return Math.max(15, Math.min(base, avail));
  const target = load < 40 ? 150 : load < 60 ? 110 : load < 72 ? 75 : 45;
  let want = Math.max(base, target);
  if (remaining > 0) want = Math.min(want, Math.max(45, remaining)); // don't blow far past the day's total
  return Math.max(15, Math.min(want, avail));
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
  const { startMin = DAY_START, endMin = DAY_END, busy = [], context = null, maxStudyMinutes = 360, pinned = [], focusArea = null, itemCap = ITEM_CAP, areaCapDefault = AREA_CAP_DEFAULT, deep = false, loadBias = 0 } = opts;
  // A day you've told the coach is draining reads as more loaded throughout, so
  // sessions skew gentler (and wear a Light badge), not just fewer.
  const loadAt = (t) => Math.min(100, Math.max(0, predictLoadAt(t, { context, placed: [...pinned, ...placed], busy }) + loadBias));
  // Fresh sessions route around both commitments and any already-pinned blocks.
  const windows = freeWindows(startMin, endMin, [...busy, ...pinned]);
  const placed = [];
  const itemCount = new Map();
  const areaCount = new Map();
  let studyTotal = 0;
  let sinceLong = 0;
  let lastArea = null;

  const capForArea = (mode) => AREA_CAP[mode] ?? areaCapDefault;
  const score = (c, load) => modeFit(c.item.mode, load)
    + (c.area !== lastArea ? 0.6 : 0)
    + (focusArea && c.area === focusArea ? 1.3 : 0)
    - (itemCount.get(c.item.id) || 0) * 1.5;

  for (const [wStart, wEnd] of windows) {
    let cursor = wStart;
    while (studyTotal < maxStudyMinutes) {
      const avail = wEnd - cursor;
      if (avail < 15) break;
      const load = loadAt(cursor);

      // Candidates still under their caps — if none, we've scheduled all we
      // should, so this window (and day) is done.
      const underCaps = cands.filter((c) =>
        (itemCount.get(c.item.id) || 0) < itemCap &&
        (areaCount.get(c.area) || 0) < capForArea(c.item.mode));
      if (!underCaps.length) break;

      // Of those, which fit the current cognitive load. If nothing fits right
      // now (too loaded), advance and let load decay rather than abandoning the
      // rest of the window — e.g. an office evening that's fine to study by
      // 8–9pm even when 6pm is still too heavy from the workday.
      const eligible = underCaps.filter((c) => withinCapacity(c.item.mode, load));
      if (!eligible.length) { cursor += 30; continue; }

      eligible.sort((a, b) => score(b, load) - score(a, load));
      const pick = eligible[0];
      const minutes = sessionMinutes(pick.item, load, avail, deep, maxStudyMinutes - studyTotal);

      placed.push({
        itemId: pick.item.id, area: pick.area, title: pick.item.title || '', mode: pick.item.mode,
        date, start: cursor, minutes, status: 'planned', pinned: false,
        // Predicted cognitive load when this block begins — how spent you'll be.
        // Drives the session's intensity: high load → light goals, and a badge.
        load: Math.round(load),
      });
      itemCount.set(pick.item.id, (itemCount.get(pick.item.id) || 0) + 1);
      areaCount.set(pick.area, (areaCount.get(pick.area) || 0) + 1);
      studyTotal += minutes;
      sinceLong += minutes;
      lastArea = pick.area;

      const loadAfter = loadAt(cursor + minutes);
      const brk = breakAfter(minutes, loadAfter, sinceLong, deep);
      // Only a genuine long recharge resets the "time since a real break" clock;
      // short breathers accumulate toward the next one.
      if (brk >= (deep ? 45 : 30)) sinceLong = 0;
      cursor += minutes + brk;
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
    cursor = s + b.minutes + breakAfter(b.minutes, 50, 0);
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
