// Import / export plumbing. Parse + validate a plan, ingest it, and build a
// downloadable backup. No network — everything is local file / clipboard.
import { ingestPlan, mergeRemote, buildExport, buildContentPatch, normalizePlans, hasPlan, getAppliedPatches, markPatchApplied } from './store.js';
import { MODES } from './util.js';
import { migrate, isPatch, validatePatch, applyPatchOps } from './migrations.js';

// Validate either the multi-plan { plans:[...] } shape or the legacy single
// { phases:[...] } shape. Returns { ok, errors:[], plan }.
export function validatePlan(raw) {
  const errors = [];
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, errors: ['Not a JSON object.'], plan: null };
  }
  if (!Array.isArray(raw.plans) && !Array.isArray(raw.phases)) {
    errors.push('Expected a "plans" array (or a legacy "phases" array).');
  }

  const plans = normalizePlans(raw);
  const ids = new Set();
  let itemCount = 0;

  plans.forEach((pl) => {
    if (!Array.isArray(pl.phases)) { errors.push(`plan "${pl.id}" missing phases array`); return; }
    pl.phases.forEach((ph, pi) => {
      if (!ph || typeof ph !== 'object') { errors.push(`${pl.id} phase[${pi}] is not an object`); return; }
      if (!ph.id) errors.push(`${pl.id} phase[${pi}] missing id`);
      if (!Array.isArray(ph.items)) { errors.push(`phase "${ph.id || pi}" missing items array`); return; }
      ph.items.forEach((it, ii) => {
        itemCount++;
        const where = `item ${ph.id || pi}[${ii}]`;
        if (!it || typeof it !== 'object') { errors.push(`${where} not an object`); return; }
        if (!it.id) errors.push(`${where} missing id`);
        else if (ids.has(it.id)) errors.push(`duplicate item id "${it.id}"`);
        else ids.add(it.id);
        if (!it.title) errors.push(`${where} missing title`);
        if (!MODES.includes(it.mode)) errors.push(`${where} has invalid mode "${it.mode}"`);
        if (it.dependsOn && !Array.isArray(it.dependsOn)) errors.push(`${where} dependsOn must be an array`);
        if (it.status && !['todo', 'done', 'skipped'].includes(it.status)) errors.push(`${where} invalid status "${it.status}"`);
      });
    });
  });

  // Dependency ids must reference known items (across all plans).
  plans.forEach((pl) => (pl.phases || []).forEach((ph) => (ph.items || []).forEach((it) => {
    (it.dependsOn || []).forEach((d) => {
      if (!ids.has(d)) errors.push(`item "${it.id}" dependsOn unknown id "${d}"`);
    });
  })));

  if (itemCount === 0) errors.push('Plan has no items.');

  return { ok: errors.length === 0, errors, plan: raw };
}

// A full device snapshot from the app (guruji.json) — carries live tracking
// (log / schedule) or a device tag, unlike a bare authored plan.json. These get
// merged, not restored.
export function isSyncSnapshot(v) {
  return !!(v && typeof v === 'object' && v.app === 'guruji' && Array.isArray(v.plans)
    && ('device' in v || Array.isArray(v.log) || Array.isArray(v.blocks)));
}

export function parseJSON(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

// Read a File object as text.
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Full import pipeline from raw text. Auto-detects a content-patch vs a full
// plan/backup, and runs schema migrations on the latter. Returns { ok, errors,
// summary, kind }.
export async function importFromText(text, opts = {}) {
  const { onProgress, ...ingestOpts } = opts;
  const step = async (info) => { if (onProgress) await onProgress(info); };

  const { value, error } = parseJSON(text);
  if (error) return { ok: false, errors: [`Invalid JSON: ${error}`], summary: null };

  if (isPatch(value)) { await step({ phase: 'patch' }); return applyPatch(value); }

  // A full device snapshot (guruji.json) is *merged* under the sync authority
  // model — not wholesale-restored — so loading the desktop's copy never wipes
  // the phone's day, and vice versa. `replace:true` forces a full restore.
  if (!opts.replace && isSyncSnapshot(value)) {
    await step({ phase: 'merge' });
    const res = await mergeRemote(value);
    return { ok: !!res.ok, errors: res.ok ? [] : ['Could not merge snapshot.'], summary: res, kind: 'sync' };
  }

  // Bring any older file up to the current schema before validating/ingesting.
  const { data, from, to, applied } = migrate(value);
  const v = validatePlan(data);
  if (!v.ok) return { ok: false, errors: v.errors, summary: null };
  // Surface a real schema upgrade before we save, so the migration is visible.
  if (applied.length) await step({ phase: 'migrate', from, to, applied });
  await step({ phase: 'save' });
  const summary = await ingestPlan(data, ingestOpts);
  return { ok: true, errors: [], summary, kind: 'plan', migrated: applied, from, to };
}

// Apply a content-patch (migration file) on top of the current data, once.
export async function applyPatch(patch) {
  const pv = validatePatch(patch);
  if (!pv.ok) return { ok: false, errors: pv.errors, summary: null };
  if (!(await hasPlan())) {
    return { ok: false, errors: ['Load a plan before applying a migration.'], summary: null };
  }
  if (patch.id) {
    const done = await getAppliedPatches();
    if (done.includes(patch.id)) {
      return { ok: true, errors: [], summary: { items: 0 }, kind: 'patch', already: true, description: patch.description || '' };
    }
  }
  const current = await buildExport();          // canonical, current-schema snapshot
  const { data: patched, applied } = applyPatchOps(current, patch.ops);
  if (applied === 0) {
    return { ok: false, errors: ['This migration changed nothing — check the plan / phase / item ids in its ops.'], summary: null };
  }
  // A reset-status patch must overwrite statuses, so don't preserve the old
  // ones on re-ingest — otherwise the merge would undo the reset.
  const resets = (patch.ops || []).some((o) => o.op === 'reset-status');
  const summary = await ingestPlan(patched, { mergeStatus: !resets });
  if (patch.id) await markPatchApplied(patch.id);
  return { ok: true, errors: [], summary, kind: 'patch', applied, description: patch.description || '' };
}

function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

// The canonical sync file: a stable name so it overwrites the same file in
// iCloud Drive each time. Load it on your other device to pick up changes.
export async function exportCanonical() {
  const data = await buildExport();
  return download('guruji.json', JSON.stringify(data, null, 2));
}

// The same canonical snapshot as a JSON string — for writing straight into a
// linked file (File System Access API) or sharing via the share sheet.
export async function snapshotText() {
  return JSON.stringify(await buildExport(), null, 2);
}

// A dated, never-overwritten snapshot — for keeping history / manual backups.
export async function exportToFile() {
  const data = await buildExport();
  const stamp = data.exportedAt.slice(0, 10);
  return download(`guruji-${stamp}-export.json`, JSON.stringify(data, null, 2));
}

// A timestamped content patch — your desktop-authored notes as a migration
// file. Applying it on another device only updates notes (nothing else), and
// it applies once. This is how content flows to the phone / canonical file
// without overwriting that device's tracking.
export async function exportContentPatch() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const patch = await buildContentPatch(stamp);
  if (!patch.ops.length) return { ok: false, count: 0 };
  const name = `guruji-content-${stamp}.guruji.json`;
  download(name, JSON.stringify(patch, null, 2));
  return { ok: true, count: patch.ops.length, name };
}
