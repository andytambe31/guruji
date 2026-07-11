// Small DOM + formatting helpers. No dependencies.

export const MODES = ['DESK', 'TRANSIT', 'WIND_DOWN'];
export const MODE_LABEL = {
  DESK: 'Desk',
  TRANSIT: 'Transit',
  WIND_DOWN: 'Wind-down',
};
// Sunday-first to match JS Date.getDay(); schedule uses these 3-letter codes.
export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DAY_LABEL = {
  SUN: 'Sun', MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat',
};

// Create an element with props/attrs and children.
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in node && k !== 'list') {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else {
      node.setAttribute(k, v);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Append children, skipping null/false/undefined. Native node.append() would
// otherwise stringify them and render literal "null"/"false" text.
export function fill(node, children) {
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// "HH:MM" -> minutes since midnight
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// mm:ss for the Pomodoro clock
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function fmtTimeOfDay(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 < 12 ? 'am' : 'pm';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

export function todayCode(date = new Date()) {
  return DAYS[date.getDay()];
}

// A compact duration: 0m · 45m · 1h · 5h 40m
export function fmtDur(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

// ---- date helpers for habit streaks (work on "YYYY-MM-DD" strings) ----
export function todayISO(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  // whole days from a to b (b - a), both "YYYY-MM-DD"
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  return Math.round((db - da) / 86400000);
}
export function addDaysISO(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- cognitive load (a deliberately rough gauge, not a measurement) ----
// Fresh in the morning; each of today's sessions adds load (hard DESK work
// more than a gentle read); it recovers as time passes since a session ended
// (your break). Reinforces quality over quantity, nothing more.
// How you feel right now — a state that arrives already elevated and discharges
// over time. `level` is the starting hit to your capacity; `tau` is how slowly
// it fades (minutes to lose ~63%): a heavy lunch passes in an hour or two, sleep
// debt or feeling unwell lingers most of the day. Pick the one that fits and the
// gauge — and the coach's call — bend to match.
export const CONTEXTS = {
  commuted: { label: 'Just commuted', level: 22, tau: 60 },   // settles quickly once you sit down
  postmeal: { label: 'After a big meal', level: 30, tau: 100 }, // the post-lunch dip
  wired: { label: 'Wired / restless', level: 26, tau: 90 },    // caffeinated or anxious, hard to settle
  office: { label: 'After work', level: 38, tau: 130 },
  sleepy: { label: 'Sleepy / groggy', level: 50, tau: 220 },   // under-slept — hangs around
  drained: { label: 'Drained', level: 50, tau: 160 },
  unwell: { label: 'Under the weather', level: 60, tau: 320 }, // off all day
};

export function estimateCognitiveLoad(log, context = null, now = new Date()) {
  const DIFFICULTY = { DESK: 1.0, TRANSIT: 0.8, WIND_DOWN: 0.35 };
  const LOAD_PER_MIN = 0.9;   // ~50 min of deep work ≈ 45 points at its peak
  const RECOVERY_TAU = 50;    // minutes; larger = slower recovery
  const today = todayISO(now);
  const nowMs = now.getTime();

  // time-of-day baseline: ~0 at 6am, drifting up to ~22 by midnight
  const hours = now.getHours() + now.getMinutes() / 60;
  let load = Math.max(0, Math.min(22, ((hours - 6) / 18) * 22));

  for (const e of log) {
    if (e.date !== today || !e.endedAt) continue;
    const end = new Date(e.endedAt).getTime();
    if (Number.isNaN(end)) continue;
    const minsSince = Math.max(0, (nowMs - end) / 60000);
    const diff = DIFFICULTY[e.mode] ?? 0.7;
    const raw = (e.focusMinutes || 0) * diff * LOAD_PER_MIN;
    load += raw * Math.exp(-minsSince / RECOVERY_TAU);
  }

  // life context (office / commute / drained) — starts high, discharges slowly
  if (context && context.key && CONTEXTS[context.key] && context.setAt) {
    const c = CONTEXTS[context.key];
    const mins = Math.max(0, (nowMs - new Date(context.setAt).getTime()) / 60000);
    if (Number.isFinite(mins)) load += c.level * Math.exp(-mins / c.tau);
  }

  return Math.max(0, Math.min(100, Math.round(load)));
}

// Is this mode's demand within your current capacity? Deep work needs more
// headroom than a gentle read. Fuzzy on purpose — a nudge, not a lock.
export function withinCapacity(mode, load) {
  const GATE = { DESK: 66, TRANSIT: 82, WIND_DOWN: 200 };
  return load < (GATE[mode] ?? 82);
}

export function loadStatus(pct) {
  if (pct < 35) return { tone: 'low', note: 'Fresh — take on the hard stuff.' };
  if (pct < 65) return { tone: 'mid', note: 'Warmed up. Focus still in the tank.' };
  if (pct < 85) return { tone: 'high', note: 'Filling up — an easier rep, or a break.' };
  return { tone: 'max', note: 'Spent. Step away — quality over quantity.' };
}

// Streak + recency for a habit, from the set of dates it was done.
export function habitStats(dates, today = todayISO()) {
  const set = new Set(dates);
  if (set.size === 0) return { ever: false, streak: 0, daysSince: Infinity, last: null };
  const sorted = [...set].sort();
  const last = sorted[sorted.length - 1];
  const daysSince = daysBetween(last, today);
  let streak = 0;
  if (daysSince <= 1) {
    let cur = last;
    while (set.has(cur)) { streak++; cur = addDaysISO(cur, -1); }
  }
  return { ever: true, streak, daysSince, last };
}

export function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

let toastTimer = null;
export function toast(msg, isErr = false) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', { class: 'toast' });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle('err', !!isErr);
  // force reflow so re-triggering the transition works
  void t.offsetWidth;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Monotonic counter guarantees uniqueness even for many synchronous calls in
// one tick (performance.now() can return the same value across a tight loop).
let _uidCounter = 0;
export function uid(prefix = 'x') {
  _uidCounter = (_uidCounter + 1) % 1e9;
  const t = Math.floor(performance.now()).toString(36);
  return `${prefix}-${t}-${_uidCounter.toString(36)}`;
}
