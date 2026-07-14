// CS Fundamentals — a bundled content track of thorough study guides, seeded
// once into its own "CS Fundamentals" track so the guides are browsable in the
// desktop Plan view (matching the CS-Fundamentals area the concepts + nuggets
// already use). Same shape as the System Design Interview pack: appended AFTER
// the real curriculum in `order`, idempotent, and re-import-tolerant (keyed on
// the track's phase existing).
import { STORES, getAll, put, bulkPut } from './db.js';
import { CSF_TCP_TLS_GUIDE } from './csf-tcptls.js';
import { CSF_ENCODING_GUIDE } from './csf-encoding.js';
import { CSF_LLM_PATTERNS_GUIDE } from './csf-llm-patterns.js';

const TRACK_ID = 'csf';
const PHASE_ID = 'csf-core';

// Each authored guide: a browsable study item under the CS Fundamentals track.
const GUIDES = [
  { id: 'csf-tcp-tls', title: 'TCP & TLS Handshakes', group: 'Networking', notes: CSF_TCP_TLS_GUIDE },
  { id: 'csf-encoding', title: 'Character Encoding (charset, Unicode, UTF-8)', group: 'Networking', notes: CSF_ENCODING_GUIDE },
  { id: 'csf-llm-patterns', title: 'Design Patterns: LLM-in-the-loop Event Pipeline', group: 'Architecture', notes: CSF_LLM_PATTERNS_GUIDE },
];

export async function seedCSFundamentalsContent() {
  try {
    const [phases, items, plansRec] = await Promise.all([
      getAll(STORES.phases),
      getAll(STORES.items),
      getAll(STORES.kv).then((rows) => rows.find((r) => r.k === 'plans')),
    ]);
    // Cheap early out once the track exists AND every guide is present — but new
    // guides added in later versions still get seeded into an existing install.
    const haveItem = new Set(items.map((it) => it.id));
    if (phases.some((p) => p.id === PHASE_ID) && GUIDES.every((g) => haveItem.has(g.id))) return { ran: false };

    const maxItemOrder = items.reduce((m, it) => Math.max(m, it.order ?? 0), 0);
    const maxPhaseOrder = phases.reduce((m, p) => Math.max(m, p.order ?? 0), 0);
    const existingIds = new Set(items.map((it) => it.id));

    // 1) Ensure the track exists in the plans list.
    const plans = (plansRec && Array.isArray(plansRec.v)) ? plansRec.v.slice() : [];
    if (!plans.some((p) => p.id === TRACK_ID)) {
      const maxPlanOrder = plans.reduce((m, p) => Math.max(m, p.order ?? 0), -1);
      plans.push({ id: TRACK_ID, name: 'CS Fundamentals', goal: 'Deep-dive references for the fundamentals behind system design.', order: maxPlanOrder + 1 });
      await put(STORES.kv, { k: 'plans', v: plans });
    }

    // 2) Ensure the phase exists (don't re-put an existing one — that would
    // reshuffle its order when we're only adding a new guide).
    if (!phases.some((p) => p.id === PHASE_ID)) {
      await put(STORES.phases, {
        id: PHASE_ID, name: 'CS Fundamentals', weeks: [], dateRange: '',
        track: TRACK_ID, order: maxPhaseOrder + 1,
      });
    }

    // 3) Add each guide as an item (skip any that already exist).
    const newItems = [];
    let order = maxItemOrder + 1;
    for (const g of GUIDES) {
      if (existingIds.has(g.id)) continue;
      newItems.push({
        id: g.id,
        title: g.title,
        phase: PHASE_ID,
        track: TRACK_ID,
        week: null,
        area: 'CS Fundamentals',
        group: g.group,
        mode: 'TRANSIT', // reading / concept work
        estMinutes: 40,
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
    if (newItems.length) await bulkPut(STORES.items, newItems);

    return { ran: true, added: newItems.length };
  } catch {
    return { ran: false };
  }
}
