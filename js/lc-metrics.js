// Pure LeetCode derived metrics — computed from the raw session log, not from a
// deduped snapshot, so we can tell a *fresh* first encounter from a *cold*
// re-solve and preserve the full solve journey. No I/O; takes the log array.
//
// A log entry looks like { date, leetcode: [{ slug, title, pattern, difficulty,
// outcome, note }], ... }. `outcome` is graded by the ladder in outcomes.js.
import { addDaysISO } from './util.js';
import { isReadySolve, normalizeOutcome, outcomeRank } from './outcomes.js';

// slug key: fall back to a slugified title so untitled/manual entries still group.
export const slugOf = (p) => (p.slug || (p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '');

// Flatten the log to a time-ordered list of individual problem attempts.
// Each: { slug, title, pattern, difficulty, outcome (normalized), date }.
export function attemptStream(log) {
  const out = [];
  for (const e of (log || [])) {
    const date = e.date || (e.endedAt || '').slice(0, 10);
    for (const p of (e.leetcode || [])) {
      const slug = slugOf(p); if (!slug) continue;
      out.push({ slug, title: p.title || p.slug || slug, pattern: p.pattern || null, difficulty: p.difficulty || null, outcome: normalizeOutcome(p.outcome), date: date || '' });
    }
  }
  // Stable order: by date, preserving original order within a day.
  return out.map((a, i) => ({ ...a, _i: i })).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x._i - y._i)).map(({ _i, ...a }) => a);
}

// The full progression for one slug, oldest → newest. Foundational for review
// scheduling and a problem-detail view. e.g. attempted → hints → independent → cold.
export function lcProgression(log, slug) {
  const key = String(slug || '').toLowerCase();
  return attemptStream(log).filter((a) => a.slug === key);
}

// The earliest date each slug was ever seen — so "fresh" means first-ever
// encounter, and a re-solve of a known slug is never counted as fresh.
function firstSeenBySlug(stream) {
  const first = new Map();
  for (const a of stream) if (!first.has(a.slug)) first.set(a.slug, a.date);
  return first;
}

// Weekly (or N-day) outcome aggregates, derived from the full log.
//  - freshUnique: distinct slugs whose FIRST-EVER attempt falls in the window.
//  - coldResolves: 'cold' attempts in the window (re-solves of known slugs).
//  - readySolves: independent+ attempts (reps) in the window — includes cold.
//  - per-outcome counts of attempts in the window.
export function weeklyLcAggregates(log, today, days = 7) {
  const stream = attemptStream(log);
  const first = firstSeenBySlug(stream);
  const start = addDaysISO(today, -(days - 1));
  const inWin = (d) => d >= start && d <= today;

  const byOutcome = { attempted: 0, solution: 0, hints: 0, independent: 0, explained: 0, cold: 0 };
  const freshSlugs = new Set();
  let attempts = 0, readySolves = 0, coldResolves = 0;
  for (const a of stream) {
    if (!inWin(a.date)) continue;
    attempts++;
    if (byOutcome[a.outcome] != null) byOutcome[a.outcome]++;
    if (isReadySolve(a.outcome)) readySolves++;
    if (a.outcome === 'cold') coldResolves++;
    if (first.get(a.slug) === a.date && a.date >= start) freshSlugs.add(a.slug);
  }
  return { days, attempts, freshUnique: freshSlugs.size, readySolves, coldResolves, byOutcome };
}

// ---- Pattern mastery (deterministic, no scoring model) ----
// Map the wizard's pattern labels onto the curated problem-bank concept ids so
// mastery lines up with the "This week" problem lists.
const PATTERN_TO_CONCEPT = {
  'two pointers': 'two-pointers', 'sliding window': 'sliding-window', 'prefix sum': 'prefix-sum',
  hashing: 'arrays-hashing', 'stack / monotonic stack': 'stack', 'linked list': 'linked-list',
  'binary search': 'binary-search', 'trees (dfs/bfs)': 'trees', graphs: 'graphs', 'heap / top-k': 'heap',
  backtracking: 'backtracking', 'dynamic programming': 'dynamic-programming', greedy: 'greedy', intervals: 'greedy',
};
const conceptOfPattern = (pattern) => PATTERN_TO_CONCEPT[String(pattern || '').toLowerCase().trim()] || null;

// concepts: array of { id, name } (from PROBLEM_BANK) to report on, incl. untouched.
// Status per concept:
//   untouched  — no attempts
//   learning   — attempts exist, but < 2 distinct slugs ever solved independent+
//   practiced  — ≥ 2 distinct slugs solved independent+
//   ready      — ≥ 3 distinct independent+ slugs AND ≥ 1 cold re-solve in the pattern
export function patternMastery(log, concepts) {
  const stream = attemptStream(log);
  // Per concept: attempts, distinct ready slugs, any cold.
  const agg = new Map(); // conceptId -> { attempts, ready:Set, cold:bool }
  const ensure = (id) => { if (!agg.has(id)) agg.set(id, { attempts: 0, ready: new Set(), cold: false }); return agg.get(id); };
  for (const a of stream) {
    const cid = conceptOfPattern(a.pattern);
    if (!cid) continue;
    const g = ensure(cid);
    g.attempts++;
    if (isReadySolve(a.outcome)) g.ready.add(a.slug);
    if (a.outcome === 'cold') g.cold = true;
  }
  const classify = (g) => {
    if (!g || g.attempts === 0) return 'untouched';
    const r = g.ready.size;
    if (r >= 3 && g.cold) return 'ready';
    if (r >= 2) return 'practiced';
    return 'learning';
  };
  return (concepts || []).map((c) => {
    const g = agg.get(c.id);
    return { id: c.id, name: c.name, status: classify(g), attempts: g ? g.attempts : 0, readyDistinct: g ? g.ready.size : 0, cold: g ? g.cold : false };
  });
}

// ---- Cold-review scheduler (derived, minimal) ----
// A slug becomes review-due once it reached independent+ and enough time has
// passed without an appropriate later cold solve:
//   • no cold since qualifying: due at qualify + 3 days   (stage "first")
//   • cold exists: due at last-cold + 14 days             (stage "second")
// Reviews never inflate unique volume — they are re-solves of known slugs.
export function reviewsDue(log, today, { firstGapDays = 3, secondGapDays = 14 } = {}) {
  const stream = attemptStream(log);
  const bySlug = new Map();
  for (const a of stream) { if (!bySlug.has(a.slug)) bySlug.set(a.slug, []); bySlug.get(a.slug).push(a); }
  const due = [];
  for (const [slug, atts] of bySlug) {
    const qualify = atts.find((a) => outcomeRank(a.outcome) >= 3); // independent or explained (or cold)
    if (!qualify) continue;
    const colds = atts.filter((a) => a.outcome === 'cold' && a.date >= qualify.date);
    let dueSince, stage;
    if (colds.length === 0) { dueSince = addDaysISO(qualify.date, firstGapDays); stage = 'first'; } else {
      const lastCold = colds[colds.length - 1].date;
      dueSince = addDaysISO(lastCold, secondGapDays); stage = 'second';
      // stage-2 tops out after the second cold — consider it retained.
      if (colds.length >= 2) continue;
    }
    if (today >= dueSince) {
      const last = atts[atts.length - 1];
      due.push({ slug, title: last.title, pattern: last.pattern, stage, dueSince });
    }
  }
  return due.sort((a, b) => (a.dueSince < b.dueSince ? -1 : 1));
}
