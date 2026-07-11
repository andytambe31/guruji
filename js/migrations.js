// Migrations — two kinds, one place.
//
// 1. SCHEMA migrations: the canonical data file carries a `schemaVersion`. When
//    an older file is loaded (e.g. your iCloud file after the app gains a new
//    feature), migrate() runs the upgrade steps in order so it never breaks.
//
// 2. CONTENT patches: a small "migration file" that describes edits to your
//    plan (add a topic, change its estimate, move a phase) as a list of ops,
//    applied on top of your current data instead of regenerating the whole
//    plan.json. Applied once, tracked by id.

export const SCHEMA_VERSION = 5;

// Each step upgrades a canonical data object *in place* to `to`.
const MIGRATIONS = [
  {
    to: 2,
    description: 'legacy single-plan { phases } → { plans: [...] }',
    up(d) {
      if (!Array.isArray(d.plans)) {
        d.plans = [{
          id: 'plan',
          name: (d.meta && d.meta.name) || 'Plan',
          goal: (d.meta && d.meta.target) || '',
          phases: Array.isArray(d.phases) ? d.phases : [],
        }];
        delete d.phases;
      }
    },
  },
  {
    to: 3,
    description: 'add schedule blocks + life-context, backfill item fields',
    up(d) {
      if (!Array.isArray(d.blocks)) d.blocks = [];
      if (!('context' in d)) d.context = null;
      for (const pl of d.plans || []) {
        for (const ph of pl.phases || []) {
          for (const it of ph.items || []) {
            if (it.recurring === undefined) it.recurring = false;
            if (it.area === undefined) it.area = null;
          }
        }
      }
    },
  },
  {
    to: 4,
    description: 'add day commitments (gym/walk) + routine settings support',
    up(d) {
      if (!Array.isArray(d.busy)) d.busy = [];
      // Note: `settings` is intentionally left absent if the file has none, so
      // a fresh plan's meta (goalDate/bedtime) can seed it on ingest without a
      // migration-fabricated default clobbering it.
    },
  },
  {
    to: 5,
    description: 'reading practice (current book, intent, reflections)',
    up() {
      // `reading` is left absent when the file has none, so a fresh plan's
      // meta.reading can seed the current book on ingest. Additive + absence-
      // tolerant — nothing to backfill here.
    },
  },
];

function currentVersion(d) {
  return (d && (d.schemaVersion ?? d.version)) || 1;
}

// Upgrade a parsed data file to the current schema. Returns the migrated copy
// plus which steps ran (for user feedback). Never mutates the input.
export function migrate(raw) {
  const d = JSON.parse(JSON.stringify(raw || {}));
  const from = currentVersion(d);
  let v = from;
  const applied = [];
  for (const m of MIGRATIONS) {
    if (m.to > v) { m.up(d); v = m.to; applied.push(m); }
  }
  d.schemaVersion = SCHEMA_VERSION;
  delete d.version;
  return { data: d, from, to: SCHEMA_VERSION, applied: applied.map((m) => ({ to: m.to, description: m.description })) };
}

// ---------- Content patches ----------
const OPS = ['add-item', 'update-item', 'remove-item', 'add-phase', 'set-meta'];

export function isPatch(obj) {
  return !!(obj && typeof obj === 'object' && (obj.app === 'guruji-patch' || (Array.isArray(obj.ops) && !Array.isArray(obj.plans))));
}

export function validatePatch(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Not a JSON object.'] };
  if (!Array.isArray(obj.ops) || !obj.ops.length) errors.push('Migration has no "ops" array.');
  (obj.ops || []).forEach((o, i) => {
    if (!o || !o.op) { errors.push(`op[${i}] is missing "op"`); return; }
    if (!OPS.includes(o.op)) errors.push(`op[${i}] unknown op "${o.op}"`);
    if ((o.op === 'update-item' || o.op === 'remove-item') && !o.id) errors.push(`op[${i}] (${o.op}) needs an "id"`);
    if (o.op === 'add-item' && (!o.item || !o.item.id)) errors.push(`op[${i}] (add-item) needs item.id`);
    if (o.op === 'add-phase' && (!o.phase || !o.phase.id || !o.plan)) errors.push(`op[${i}] (add-phase) needs plan + phase.id`);
  });
  return { ok: errors.length === 0, errors };
}

// Apply patch ops to a canonical data object (assumed already at current
// schema). Returns { data, applied } — `applied` counts ops that actually
// changed something, so a patch that matched nothing can be flagged. Never
// mutates the input.
export function applyPatchOps(data, ops) {
  const d = JSON.parse(JSON.stringify(data));
  let applied = 0;
  const findItem = (id) => {
    for (const pl of d.plans || []) {
      for (const ph of pl.phases || []) {
        const it = (ph.items || []).find((x) => x.id === id);
        if (it) return { pl, ph, it };
      }
    }
    return null;
  };
  const findPhase = (planId, phaseId) => {
    const pl = (d.plans || []).find((p) => p.id === planId);
    return pl ? (pl.phases || []).find((ph) => ph.id === phaseId) || null : null;
  };

  for (const o of ops) {
    if (o.op === 'add-item') {
      const ph = findPhase(o.plan, o.phase);
      if (ph) { ph.items = ph.items || []; if (!ph.items.some((x) => x.id === o.item.id)) { ph.items.push(o.item); applied++; } }
    } else if (o.op === 'update-item') {
      const f = findItem(o.id);
      if (f) { Object.assign(f.it, o.set || {}); applied++; }
    } else if (o.op === 'remove-item') {
      const f = findItem(o.id);
      if (f) { f.ph.items = f.ph.items.filter((x) => x.id !== o.id); applied++; }
    } else if (o.op === 'add-phase') {
      const pl = (d.plans || []).find((p) => p.id === o.plan);
      if (pl) { pl.phases = pl.phases || []; if (!pl.phases.some((x) => x.id === o.phase.id)) { pl.phases.push(o.phase); applied++; } }
    } else if (o.op === 'set-meta') {
      d.meta = { ...(d.meta || {}), ...(o.set || {}) }; applied++;
    }
  }
  return { data: d, applied };
}
