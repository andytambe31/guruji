// Higher-level data operations over the IndexedDB layer.
import { STORES, getAll, get, put, del, replaceStores, clearStore } from './db.js';
import { uid } from './util.js';

// ---------- Plan meta ----------
export async function getMeta() {
  const rec = await get(STORES.kv, 'meta');
  return rec ? rec.v : null;
}
export async function setMeta(meta) {
  return put(STORES.kv, { k: 'meta', v: meta || {} });
}

// ---------- Cognitive-load context (office / commute / …) ----------
export async function getContext() {
  const rec = await get(STORES.kv, 'context');
  return rec ? rec.v : null;
}
export async function setContext(v) {
  return put(STORES.kv, { k: 'context', v: v || null });
}

// ---------- Plans (top-level tracks) ----------
export async function getPlans() {
  const rec = await get(STORES.kv, 'plans');
  const list = rec ? rec.v : [];
  return list.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Normalize either the new { plans:[{id,name,goal,phases}] } shape or the old
// single-plan { phases:[...] } shape into an array of plans.
export function normalizePlans(raw) {
  if (raw && Array.isArray(raw.plans) && raw.plans.length) {
    return raw.plans.map((pl, i) => ({
      id: pl.id || `plan-${i}`,
      name: pl.name || pl.id || `Plan ${i + 1}`,
      goal: pl.goal || '',
      phases: Array.isArray(pl.phases) ? pl.phases : [],
    }));
  }
  return [{
    id: 'plan',
    name: (raw && raw.meta && raw.meta.name) || 'Plan',
    goal: (raw && raw.meta && raw.meta.target) || '',
    phases: raw && Array.isArray(raw.phases) ? raw.phases : [],
  }];
}

// ---------- Phases + items ----------
export async function getPhases() {
  const phases = await getAll(STORES.phases);
  return phases.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export async function getItems() {
  const items = await getAll(STORES.items);
  return items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export async function getItem(id) {
  return get(STORES.items, id);
}
export async function setItemStatus(id, status) {
  const item = await get(STORES.items, id);
  if (!item) return null;
  item.status = status;
  await put(STORES.items, item);
  return item;
}

export async function hasPlan() {
  const items = await getAll(STORES.items);
  return items.length > 0;
}

// The core coaching selection: given a mode, return the single next `todo`
// item of that mode whose dependsOn are ALL `done`. Order = import order.
export async function nextItemForMode(mode) {
  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  for (const it of items) {
    if (it.mode !== mode) continue;
    if (it.status !== 'todo') continue;
    const deps = it.dependsOn || [];
    const ready = deps.every((d) => statusById.get(d) === 'done');
    if (ready) return it;
  }
  return null;
}

export function areaOf(item) { return (item && item.area) || 'Study'; }

// Next surfaceable todo item within an area (deps satisfied), in plan order.
export async function nextItemForArea(area) {
  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  for (const it of items) {
    if (areaOf(it) !== area) continue;
    if (it.status !== 'todo') continue;
    if ((it.dependsOn || []).every((d) => statusById.get(d) === 'done')) return it;
  }
  return null;
}

// Areas that have at least one surfaceable item, in plan order of first item.
export async function availableAreas() {
  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const seen = [];
  for (const it of items) {
    if (it.status !== 'todo') continue;
    if (!(it.dependsOn || []).every((d) => statusById.get(d) === 'done')) continue;
    const a = areaOf(it);
    if (!seen.includes(a)) seen.push(a);
  }
  return seen;
}

// Is an item currently surfaceable (deps satisfied)?
export function depsSatisfied(item, statusById) {
  return (item.dependsOn || []).every((d) => statusById.get(d) === 'done');
}

// ---------- Schedule ----------
export async function getSchedule() {
  const rows = await getAll(STORES.schedule);
  // stable sort by day index then start
  return rows.sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
}
export async function saveScheduleRows(rows) {
  // rows: array of {id?, day, start, end, mode}
  const withIds = rows.map((r, i) => ({
    id: r.id || uid('pk'),
    day: r.day,
    start: r.start,
    end: r.end,
    mode: r.mode,
    _order: i,
  }));
  await replaceStores({ [STORES.schedule]: withIds });
  return withIds;
}
export async function clearSchedule() {
  return clearStore(STORES.schedule);
}

// ---------- Log ----------
export async function getLog() {
  const rows = await getAll(STORES.log);
  return rows.sort((a, b) => (a.endedAt || '').localeCompare(b.endedAt || ''));
}
export async function addLogEntry(entry) {
  const rec = { id: uid('log'), ...entry };
  await put(STORES.log, rec);
  return rec;
}

// ---------- Plan ingest (import) ----------
// Accepts a parsed plan object matching PLAN_SCHEMA and writes it into the DB,
// replacing existing plan data. Schedule is only replaced if the plan carries
// one AND (replaceSchedule) — otherwise the user's edited schedule is kept.
export async function ingestPlan(plan, { mergeStatus = true } = {}) {
  const meta = plan.meta || {};
  const plans = normalizePlans(plan);

  // Preserve existing statuses so re-importing a fresh plan.json doesn't wipe
  // progress unless the imported item explicitly carries a status.
  const existing = await getItems();
  const prevStatus = new Map(existing.map((i) => [i.id, i.status]));

  const planRecords = [];
  const phaseRecords = [];
  const itemRecords = [];
  let phaseOrder = 0;
  let order = 0;

  plans.forEach((pl, plIdx) => {
    planRecords.push({ id: pl.id, name: pl.name, goal: pl.goal || '', order: plIdx });
    (pl.phases || []).forEach((ph) => {
      phaseRecords.push({
        id: ph.id,
        name: ph.name || ph.id,
        weeks: ph.weeks || [],
        dateRange: ph.dateRange || '',
        track: pl.id,
        order: phaseOrder++,
      });
      (ph.items || []).forEach((it) => {
        let status = it.status || 'todo';
        if (mergeStatus && prevStatus.has(it.id) && (!it.status || it.status === 'todo')) {
          status = prevStatus.get(it.id);
        }
        itemRecords.push({
          id: it.id,
          title: it.title || '(untitled)',
          phase: ph.id, // the containing phase is authoritative
          track: pl.id,
          week: it.week ?? null,
          area: it.area || null,
          group: it.group || null,
          mode: it.mode,
          estMinutes: it.estMinutes ?? null,
          recurring: !!it.recurring,
          dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [],
          status,
          order: order++,
        });
      });
    });
  });

  await replaceStores({
    [STORES.phases]: phaseRecords,
    [STORES.items]: itemRecords,
  });
  await setMeta(meta);
  await put(STORES.kv, { k: 'plans', v: planRecords });

  // Import may restore a full backup that carries the log.
  if (Array.isArray(plan.log)) {
    await replaceStores({ [STORES.log]: plan.log.map((l) => ({ id: l.id || uid('log'), ...l })) });
  }

  return { plans: planRecords.length, phases: phaseRecords.length, items: itemRecords.length };
}

// ---------- Full backup export ----------
// Reconstruct a plan.json-shaped object plus schedule + log for round-tripping.
export async function buildExport() {
  const [meta, plans, phases, items, log] = await Promise.all([
    getMeta(), getPlans(), getPhases(), getItems(), getLog(),
  ]);

  const itemsByPhase = new Map();
  for (const it of items) {
    if (!itemsByPhase.has(it.phase)) itemsByPhase.set(it.phase, []);
    itemsByPhase.get(it.phase).push({
      id: it.id,
      title: it.title,
      phase: it.phase,
      week: it.week,
      area: it.area || undefined,
      group: it.group || undefined,
      mode: it.mode,
      estMinutes: it.estMinutes,
      recurring: it.recurring || undefined,
      dependsOn: it.dependsOn || [],
      status: it.status || 'todo',
    });
  }

  const phasesByTrack = new Map();
  for (const ph of phases) {
    if (!phasesByTrack.has(ph.track)) phasesByTrack.set(ph.track, []);
    phasesByTrack.get(ph.track).push({
      id: ph.id,
      name: ph.name,
      weeks: ph.weeks,
      dateRange: ph.dateRange,
      items: itemsByPhase.get(ph.id) || [],
    });
  }

  const plansOut = plans.map((pl) => ({
    id: pl.id,
    name: pl.name,
    goal: pl.goal || undefined,
    phases: phasesByTrack.get(pl.id) || [],
  }));

  return {
    meta: meta || {},
    plans: plansOut,
    log,
    exportedAt: new Date().toISOString(),
    app: 'guruji',
    version: 2,
  };
}

export async function wipeAll() {
  await Promise.all([
    clearStore(STORES.kv),
    clearStore(STORES.phases),
    clearStore(STORES.items),
    clearStore(STORES.schedule),
    clearStore(STORES.log),
  ]);
}
