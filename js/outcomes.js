// The LeetCode outcome ladder — the single source of truth for how a solve is
// graded and what counts toward interview readiness. Kept view-free so the data
// layer (store) and the UI (wizard, roadmap, progress) can all share it.
//
// Readiness only accrues from "solved independently" and above. Reading the
// solution or leaning on hints is real effort, logged as *attempted* — you spent
// the time, but it doesn't prove you can do it cold in an interview. `rank`
// orders the ladder (for mastery scoring); `ready` is the gate.
export const LC_OUTCOMES = [
  { key: 'attempted', label: 'Attempted', rank: 0, ready: false },
  { key: 'solution', label: 'Read solution', rank: 1, ready: false },
  { key: 'hints', label: 'With hints', rank: 2, ready: false },
  { key: 'independent', label: 'Independent', rank: 3, ready: true },
  { key: 'explained', label: 'Indep. + explained', rank: 4, ready: true },
  { key: 'cold', label: 'Cold re-solve', rank: 5, ready: true },
];

// Legacy keys from the earlier 3-level scale, mapped onto the new ladder so old
// logs (and synced snapshots) still read and count correctly.
const LEGACY_OUTCOME = { solved: 'independent', hint: 'hints', stuck: 'attempted' };
export const normalizeOutcome = (o) => LEGACY_OUTCOME[o] || o || null;

const OUTCOME_BY_KEY = Object.fromEntries(LC_OUTCOMES.map((o) => [o.key, o]));

export const LC_OUTCOME_LABEL = {
  ...Object.fromEntries(LC_OUTCOMES.map((o) => [o.key, o.label])),
  solved: 'Independent', hint: 'With hints', stuck: 'Attempted', // legacy display
};

// Only an independent (or better) solve counts toward interview-readiness.
export const isReadySolve = (o) => { const d = OUTCOME_BY_KEY[normalizeOutcome(o)]; return !!(d && d.ready); };
export const outcomeRank = (o) => { const d = OUTCOME_BY_KEY[normalizeOutcome(o)]; return d ? d.rank : -1; };
