// One-time curriculum rebase for the recovery scenario: re-sequence the
// job-switch plan so the user restarts cleanly from study week 6 instead of
// seeing every old week-1..5 item as emergency overdue work.
//
// SAFETY: this ONLY changes items' `week` field — it never removes an item, so
// it can never create a dangling `dependsOn`. It is ID-scoped (touches only the
// exact ids below), so any plan lacking them is a no-op, and it is flag-guarded
// so it runs at most once. Deprioritized storage internals are pushed to a late
// week rather than deleted.
import { STORES, getAll, get, put, bulkPut } from './db.js';

const FLAG = 'migration:recovery-rebase-2026-w6';

// Explicit week assignments (study-week sequence).
const WEEK_BY_ID = {
  // Week 6 — re-entry focus
  'dsa-method': 6, 'dsa-patterns': 6, 'p0-lc-arrays': 6, 'p0-lc-twopointers': 6,
  'p0-sd-latency': 6, 'fund-db-essentials': 6, 'p1-dsa-daily': 6,
  // Week 7
  'p0-lc-stacks': 7, 'p0-lc-binsearch': 7, 'p1-ll-concept': 7, 'p1-ll-impl': 7,
  'p0-sd-scaling': 7, 'fund-web-http': 7, 'p1-dsa-resolve': 7, 'p1-sd-estimate': 7,
  'p2-referrals': 7,
  // Applications should start early, not at the old week 16.
  'p3-apply': 10,
  // Deprioritized storage internals — pushed late, not removed (keeps deps safe).
  'p0-store-embedded': 20, 'p0-store-timeseries': 20, 'p0-store-rocksdb': 12,
};

// Title-based best-effort for items whose ids we can't assume (Trees/Graphs):
// week 8 = Trees, week 9 = Graphs, matched within the DSA area only.
const TITLE_RULES = [
  { week: 8, area: 'DSA', re: /\btree/i },
  { week: 9, area: 'DSA', re: /\bgraph/i },
];

export async function runRecoveryRebase() {
  try {
    const done = await get(STORES.kv, FLAG);
    if (done && done.v) return { ran: false };
    const items = await getAll(STORES.items);
    // Guard: only act when this looks like the job-switch plan (its ids present).
    // Do NOT set the flag yet if the plan isn't loaded — otherwise a first boot
    // on an empty DB (before import) would permanently skip the rebase. Retry on
    // later boots (cheap: just a getAll) until the plan appears.
    const present = items.some((it) => WEEK_BY_ID[it.id] != null);
    if (!present) return { ran: false };

    const changed = [];
    for (const it of items) {
      let target = WEEK_BY_ID[it.id];
      if (target == null) {
        for (const r of TITLE_RULES) {
          if ((it.area || '') === r.area && r.re.test(it.title || '')) { target = r.week; break; }
        }
      }
      if (target != null && it.week !== target) { changed.push({ ...it, week: target }); }
    }
    if (changed.length) await bulkPut(STORES.items, changed);
    await put(STORES.kv, { k: FLAG, v: true });
    return { ran: true, reweighted: changed.length };
  } catch {
    return { ran: false };
  }
}
