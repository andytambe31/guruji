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
