// Schedule seed + active-pocket resolution.
import { getSchedule, saveScheduleRows } from './store.js';
import { DAYS, toMinutes, todayCode, nowMinutes } from './util.js';

// Seed schedule from PLAN_SCHEMA.md. Editable once loaded — this is only the
// starting point so the Now view has something to reason about before import.
export const SEED_SCHEDULE = [
  { day: 'MON', start: '10:00', end: '13:00', mode: 'DESK' },
  { day: 'TUE', start: '08:00', end: '09:00', mode: 'TRANSIT' },
  { day: 'TUE', start: '19:00', end: '20:15', mode: 'WIND_DOWN' },
  { day: 'WED', start: '08:00', end: '09:00', mode: 'TRANSIT' },
  { day: 'WED', start: '19:00', end: '20:15', mode: 'WIND_DOWN' },
  { day: 'THU', start: '08:00', end: '09:00', mode: 'TRANSIT' },
  { day: 'THU', start: '19:00', end: '20:15', mode: 'WIND_DOWN' },
  { day: 'FRI', start: '10:00', end: '13:00', mode: 'DESK' },
  { day: 'SAT', start: '14:00', end: '17:00', mode: 'DESK' },
  { day: 'SUN', start: '14:00', end: '17:00', mode: 'DESK' },
];

// Ensure a schedule exists in the DB; seed it on first run.
export async function ensureSchedule() {
  const rows = await getSchedule();
  if (rows.length === 0) {
    return saveScheduleRows(SEED_SCHEDULE);
  }
  return rows;
}

function dayIndex(code) {
  return DAYS.indexOf(code);
}

// Return the pocket active at `date`, or null. A pocket is [start, end).
export function activePocket(rows, date = new Date()) {
  const day = todayCode(date);
  const mins = nowMinutes(date);
  const todays = rows.filter((r) => r.day === day);
  for (const r of todays) {
    const s = toMinutes(r.start);
    const e = toMinutes(r.end);
    if (mins >= s && mins < e) return r;
  }
  return null;
}

// Return the next upcoming pocket (soonest in the week from `date`), or null.
export function nextPocket(rows, date = new Date()) {
  if (!rows.length) return null;
  const nowDay = date.getDay();
  const mins = nowMinutes(date);

  let best = null;
  let bestDelta = Infinity;
  for (const r of rows) {
    const rDay = dayIndex(r.day);
    if (rDay < 0) continue;
    const s = toMinutes(r.start);
    // minutes from now until this pocket starts, searching forward a week
    let dayDelta = (rDay - nowDay + 7) % 7;
    let delta = dayDelta * 1440 + (s - mins);
    if (delta <= 0) delta += 7 * 1440; // already passed today -> next week
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { ...r, startsInMinutes: delta };
    }
  }
  return best;
}

// Build a friendly "when" string for an upcoming pocket.
export function whenLabel(pocket, date = new Date()) {
  if (!pocket) return '';
  const mins = pocket.startsInMinutes;
  if (mins == null) return '';
  if (mins < 60) return `in ${mins} min`;
  const nowDay = date.getDay();
  const rDay = DAYS.indexOf(pocket.day);
  const dayDelta = (rDay - nowDay + 7) % 7;
  if (dayDelta === 0) return `today at ${pocket.start}`;
  if (dayDelta === 1) return `tomorrow at ${pocket.start}`;
  const dayName = { SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' }[pocket.day];
  return `${dayName} at ${pocket.start}`;
}
