// Pure execution + feasibility logic. Three distinct signals the app must never
// collapse into one number:
//   • Deadline demand  — the math to finish every stated goal by the deadline.
//   • Current commitment — what the user is committing to this week.
//   • Recent execution — what they've actually been sustaining.
// No I/O; callers pass in the derived numbers.

// Recommended starting commitments for a sustainable rebuild (used as defaults
// when settings carry none). Not forced globally — a user can edit them.
export const DEFAULT_COMMITMENTS = {
  focusHours: 10,
  freshProblems: 10,
  readySolves: 6,
  coldResolves: 3,
  systemDesignSessions: 2,
  fundamentalsSessions: 1,
};

export function withCommitmentDefaults(c) {
  return { ...DEFAULT_COMMITMENTS, ...(c || {}) };
}

// Per-metric progress vs commitment. `actuals` keys mirror commitment keys.
export function commitmentProgress(commitments, actuals) {
  const c = withCommitmentDefaults(commitments);
  const a = actuals || {};
  const rows = {};
  for (const k of Object.keys(c)) {
    const target = c[k] || 0;
    const actual = a[k] || 0;
    const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : (actual > 0 ? 100 : 100);
    rows[k] = { target, actual, pct, met: target === 0 || actual >= target };
  }
  return rows;
}

// Execution state — weights the commitments that actually signal readiness
// higher than minor reading. Hours + DSA readiness dominate.
const WEIGHTS = {
  focusHours: 0.30,
  readySolves: 0.30,
  freshProblems: 0.15,
  coldResolves: 0.15,
  systemDesignSessions: 0.10,
  // fundamentalsSessions stays visible but doesn't drive the state.
};

// cycleAgeDays: how long since a re-entry anchor was set (null if none).
export function executionState(commitments, actuals, cycleAgeDays) {
  const rows = commitmentProgress(commitments, actuals);
  // Weighted attainment across the signal metrics (each capped at 100%).
  let score = 0, wSum = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (!rows[k]) continue;
    score += w * Math.min(1, (rows[k].actual || 0) / (rows[k].target || 1));
    wSum += w;
  }
  const pct = wSum > 0 ? Math.round((score / wSum) * 100) : 0;

  // A recent return gets a grace window: "rebuilding", not "off-track", for the
  // first 14 days after re-entry — unless they're already hitting their targets.
  const rebuilding = cycleAgeDays != null && cycleAgeDays <= 14 && pct < 80;
  let status, label;
  if (rebuilding) { status = 'rebuilding'; label = 'Rebuilding'; }
  else if (pct >= 80) { status = 'on'; label = 'On track'; }
  else if (pct >= 50) { status = 'at-risk'; label = 'At risk'; }
  else { status = 'off'; label = 'Off track'; }

  return { status, label, pct, rows };
}

// Feasibility — is the offer deadline still reachable? Distinguishes the
// curriculum-minute requirement (meaningful) from the 500-problem volume
// (aspirational). We do NOT declare the goal unrealistic on the 500 bar alone.
//
// Inputs (per week where noted):
//   weeksLeft            — calendar weeks to the deadline
//   remainTopicMin       — estimated minutes of remaining curriculum
//   lcRemaining          — unique problems left to the 500 volume target
//   commitmentHours      — the user's committed weekly focus hours
//   recentWeeklyHours    — trailing sustained hours (may be 0 after a break)
export function feasibilityState({ weeksLeft, remainTopicMin, lcRemaining, commitmentHours, recentWeeklyHours }) {
  if (!weeksLeft || weeksLeft <= 0) return { status: 'unknown', label: '—', reason: 'Set a goal date to forecast feasibility.' };
  // Curriculum hours the remainder demands per week (readiness-critical), plus a
  // light LC learning load — but the 500 volume is treated as aspirational, so
  // only a fraction of it counts toward the deadline-critical estimate.
  const curriculumHrsPerWeek = (remainTopicMin / 60) / weeksLeft;
  const lcLearnHrsPerWeek = ((lcRemaining * 18) / 60) / weeksLeft * 0.5; // half-weight: volume is aspirational
  const demandHrsPerWeek = Math.round((curriculumHrsPerWeek + lcLearnHrsPerWeek) * 10) / 10;
  // Sustainable ceiling: the larger of what they commit to and what they've
  // recently sustained (a break shouldn't drive this to zero).
  const capacity = Math.max(commitmentHours || 0, recentWeeklyHours || 0, 8);

  let status, label;
  if (demandHrsPerWeek <= capacity * 0.75) { status = 'comfortable'; label = 'Comfortable'; }
  else if (demandHrsPerWeek <= capacity) { status = 'achievable'; label = 'Achievable'; }
  else if (demandHrsPerWeek <= capacity * 1.5) { status = 'aggressive'; label = 'Aggressive but possible'; }
  else { status = 'unrealistic'; label = 'Unrealistic at this pace'; }

  return {
    status, label, demandHrsPerWeek, capacityHrsPerWeek: Math.round(capacity * 10) / 10,
    reason: `Remaining curriculum + core LC ≈ ${demandHrsPerWeek}h/wk vs a sustainable ~${Math.round(capacity)}h/wk. The 500-problem target is aspirational volume, not a deadline gate.`,
  };
}

// A weighted "sustainable weekly hours" from recent windows — recent weeks count
// more, and we never let a long gap drive it to zero for planning (floor via the
// commitment happens at the feasibility layer, not here).
export function recentWeeklyHours({ last7Hours = 0, last14Hours = 0, last21Hours = 0 }) {
  // last14/last21 are cumulative totals; convert to per-week averages.
  const w1 = last7Hours;
  const w2 = last14Hours / 2;
  const w3 = last21Hours / 3;
  // Weight the most recent week highest.
  const parts = [[w1, 0.5], [w2, 0.3], [w3, 0.2]].filter(([v]) => v != null);
  const num = parts.reduce((s, [v, w]) => s + v * w, 0);
  const den = parts.reduce((s, [, w]) => s + w, 0);
  return den > 0 ? Math.round((num / den) * 10) / 10 : 0;
}
