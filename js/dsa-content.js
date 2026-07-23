// DSA Patterns — a bundled track of pattern-first, LeetCode-specific study
// guides, seeded once into its own "DSA Patterns" track so they're browsable in
// the Plan view and readable on the phone. Same shape as the CS Fundamentals
// pack: appended after the real curriculum, idempotent, re-import tolerant, and
// content-refreshing (an edit to a shipped guide reaches an already-seeded
// install in place, preserving the item's status/order/progress).
import { STORES, getAll, put, bulkPut } from './db.js';
import { DSA_HEAPS_GUIDE } from './dsa-heaps.js';

const TRACK_ID = 'dsa';
const PHASE_ID = 'dsa-patterns';

// Each authored guide: a browsable study item under the DSA Patterns track.
const GUIDES = [
  { id: 'dsa-heaps', title: 'Heaps & Top-K on LeetCode', group: 'Heaps', notes: DSA_HEAPS_GUIDE },
];

export async function seedDSAContent() {
  try {
    const [phases, items, plansRec] = await Promise.all([
      getAll(STORES.phases),
      getAll(STORES.items),
      getAll(STORES.kv).then((rows) => rows.find((r) => r.k === 'plans')),
    ]);
    const itemsById = new Map(items.map((it) => [it.id, it]));
    // Which guides need writing: missing (new install) or drifted (edited text).
    const guidesToWrite = GUIDES.filter((g) => {
      const ex = itemsById.get(g.id);
      return !ex || ex.notes !== g.notes || ex.title !== g.title || ex.group !== g.group;
    });
    if (phases.some((p) => p.id === PHASE_ID) && guidesToWrite.length === 0) return { ran: false };

    const maxItemOrder = items.reduce((m, it) => Math.max(m, it.order ?? 0), 0);
    const maxPhaseOrder = phases.reduce((m, p) => Math.max(m, p.order ?? 0), 0);

    // 1) Ensure the track exists in the plans list.
    const plans = (plansRec && Array.isArray(plansRec.v)) ? plansRec.v.slice() : [];
    if (!plans.some((p) => p.id === TRACK_ID)) {
      const maxPlanOrder = plans.reduce((m, p) => Math.max(m, p.order ?? 0), -1);
      plans.push({ id: TRACK_ID, name: 'DSA Patterns', goal: 'Pattern-first, LeetCode-specific deep dives.', order: maxPlanOrder + 1 });
      await put(STORES.kv, { k: 'plans', v: plans });
    }

    // 2) Ensure the phase exists (don't re-put an existing one — that reshuffles order).
    if (!phases.some((p) => p.id === PHASE_ID)) {
      await put(STORES.phases, {
        id: PHASE_ID, name: 'DSA Patterns', weeks: [], dateRange: '',
        track: TRACK_ID, order: maxPhaseOrder + 1,
      });
    }

    // 3) Add missing guides, refresh drifted ones in place (keep status/order/progress).
    const newItems = [];
    let order = maxItemOrder + 1;
    let refreshed = 0;
    for (const g of guidesToWrite) {
      const ex = itemsById.get(g.id);
      if (ex) {
        newItems.push({ ...ex, title: g.title, group: g.group, area: 'DSA', notes: g.notes });
        refreshed += 1;
      } else {
        newItems.push({
          id: g.id,
          title: g.title,
          phase: PHASE_ID,
          track: TRACK_ID,
          week: null,
          area: 'DSA',
          group: g.group,
          mode: 'TRANSIT', // reading / concept work — fits a commute or a light slot
          estMinutes: 30,
          recurring: false,
          dependsOn: [],
          status: 'todo',
          notes: g.notes,
          coach: null,
          doneObjectives: [],
          objectives: undefined,
          order: order++,
        });
      }
    }
    if (newItems.length) await bulkPut(STORES.items, newItems);

    return { ran: true, added: newItems.length - refreshed, refreshed };
  } catch {
    return { ran: false };
  }
}
