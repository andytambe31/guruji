// Import / export plumbing. Parse + validate a plan, ingest it, and build a
// downloadable backup. No network — everything is local file / clipboard.
import { ingestPlan, buildExport, normalizePlans } from './store.js';
import { MODES } from './util.js';

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

// Full import pipeline from raw text. Returns { ok, errors, summary }.
export async function importFromText(text, opts = {}) {
  const { value, error } = parseJSON(text);
  if (error) return { ok: false, errors: [`Invalid JSON: ${error}`], summary: null };
  const v = validatePlan(value);
  if (!v.ok) return { ok: false, errors: v.errors, summary: null };
  const summary = await ingestPlan(value, opts);
  return { ok: true, errors: [], summary };
}

// Trigger a download of the current state as a JSON file.
export async function exportToFile() {
  const data = await buildExport();
  const json = JSON.stringify(data, null, 2);
  const stamp = data.exportedAt.slice(0, 10);
  const name = `guruji-${stamp}-export.json`;
  const blob = new Blob([json], { type: 'application/json' });
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
