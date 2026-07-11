// Higher-level data operations over the IndexedDB layer.
import { STORES, getAll, get, put, del, replaceStores, clearStore, bulkPut } from './db.js';
import { uid, todayISO, nowMinutes, toMinutes } from './util.js';
import { planDay, reflow, clampDur, DAY_START, DAY_END } from './schedule.js';
import { SCHEMA_VERSION } from './migrations.js';

// ---------- Routine settings (bedtime, goal countdown) ----------
const DEFAULT_SETTINGS = { bedtime: '23:30', goalDate: null, goalLabel: '' };
export async function getSettings() {
  const rec = await get(STORES.kv, 'settings');
  return { ...DEFAULT_SETTINGS, ...(rec ? rec.v : {}) };
}
export async function setSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...(patch || {}) };
  await put(STORES.kv, { k: 'settings', v: next });
  return next;
}

// ---------- Reading practice (current book, intent, reflections) ----------
// Reading isn't a streak to protect — it's a practice: read with intent, keep
// the lines that land, and say the thought in your own words so it stays.
const DEFAULT_READING = { current: null, shelf: [], reflections: [] };
export async function getReading() {
  const rec = await get(STORES.kv, 'reading');
  return { ...DEFAULT_READING, ...(rec ? rec.v : {}) };
}
export async function setReading(v) {
  await put(STORES.kv, { k: 'reading', v });
  return v;
}
export async function setCurrentBook({ title, author, intent, totalPages } = {}) {
  const r = await getReading();
  r.current = {
    title: title || '', author: author || '', intent: intent || '',
    page: 0, totalPages: totalPages || null, startedAt: new Date().toISOString(),
  };
  r.reflections = [];
  return setReading(r);
}
export async function updateCurrentBook(patch) {
  const r = await getReading();
  if (!r.current) return r;
  r.current = { ...r.current, ...(patch || {}) };
  return setReading(r);
}
export async function addReflection({ line, thought } = {}) {
  const r = await getReading();
  r.reflections = r.reflections || [];
  r.reflections.push({ id: uid('ref'), date: todayISO(), line: line || '', thought: thought || '' });
  return setReading(r);
}
export async function deleteReflection(id) {
  const r = await getReading();
  r.reflections = (r.reflections || []).filter((x) => x.id !== id);
  return setReading(r);
}
export async function finishCurrentBook({ verdict, recommend, rating } = {}) {
  const r = await getReading();
  if (!r.current) return r;
  r.shelf = r.shelf || [];
  r.shelf.unshift({
    ...r.current, reflections: r.reflections || [],
    verdict: verdict || '', recommend: recommend || '', rating: rating || null,
    finishedAt: new Date().toISOString(),
  });
  r.current = null;
  r.reflections = [];
  return setReading(r);
}

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

// ---------- Day blocks (adaptive schedule) ----------
// Blocks live in the `schedule` store, tagged kind:'block'. Each block reserves
// time for a study item on a given date; `pinned` means the user placed/moved
// it and auto-reflow won't slide it.
export async function getBlocks() {
  const rows = await getAll(STORES.schedule);
  return rows
    .filter((r) => r && r.kind === 'block')
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.start - b.start));
}
export async function getBlocksForDate(date) {
  return (await getBlocks()).filter((b) => b.date === date);
}
export async function deleteBlock(id) {
  return del(STORES.schedule, id);
}
export async function setBlockStatus(id, status) {
  const b = await get(STORES.schedule, id);
  if (!b) return null;
  b.status = status;
  if (status === 'done') b.pinned = true; // it happened — freeze it in place
  await put(STORES.schedule, b);
  return b;
}

// ---------- Commitments (fixed busy blocks: gym, walk, meetings…) ----------
export async function getBusyForDate(date) {
  const rows = await getAll(STORES.schedule);
  return rows.filter((r) => r && r.kind === 'busy' && r.date === date).sort((a, b) => a.start - b.start);
}
export async function putBusy({ date, start, minutes, label, drain }) {
  const rec = { kind: 'busy', id: uid('busy'), date, start, minutes, label: label || 'Busy', drain: drain || 'none' };
  await put(STORES.schedule, rec);
  await reflowDate(date);
  return rec;
}
export async function deleteBusy(id) {
  const b = await get(STORES.schedule, id);
  await del(STORES.schedule, id);
  if (b) await reflowDate(b.date);
  return b;
}

// Re-pack a day so nothing overlaps: pinned/done blocks and commitments keep
// their time, the rest flow around them.
export async function reflowDate(date) {
  const [blocks, busy] = await Promise.all([getBlocksForDate(date), getBusyForDate(date)]);
  if (!blocks.length) return [];
  const packed = reflow(blocks, busy);
  await bulkPut(STORES.schedule, packed.map((b) => ({ ...b, kind: 'block' })));
  return packed;
}

// Auto-plan a date: lay the next surfaceable item per area into the free
// windows around commitments, load-aware, capped at bedtime. Keeps pinned/done.
export async function autoPlanDay(date, { now = new Date() } = {}) {
  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));

  const perArea = [];
  const seenArea = new Set();
  for (const it of items) {
    if (it.status !== 'todo') continue;
    if (!(it.dependsOn || []).every((d) => statusById.get(d) === 'done')) continue;
    const a = it.area || 'Study';
    if (seenArea.has(a)) continue;
    seenArea.add(a);
    perArea.push(it);
  }

  const [existing, busy, settings, context] = await Promise.all([
    getBlocksForDate(date), getBusyForDate(date), getSettings(), getContext(),
  ]);
  const keep = existing.filter((b) => b.pinned || b.status === 'done');
  for (const b of existing) {
    if (!(b.pinned || b.status === 'done')) await del(STORES.schedule, b.id);
  }

  const bedMin = settings.bedtime ? toMinutes(settings.bedtime) : DAY_END;
  const endMin = Math.min(DAY_END, bedMin);
  const taken = new Set(keep.map((b) => b.itemId));
  const cands = perArea.filter((it) => !taken.has(it.id));
  const startMin = date === todayISO(now) ? Math.ceil((nowMinutes(now) + 5) / 15) * 15 : DAY_START;

  const planOpts = { startMin, endMin, busy, context };
  // If it's too late for anything to fit today, still propose from the day start.
  let fresh = planDay(date, cands, planOpts);
  if (!fresh.length && cands.length) fresh = planDay(date, cands, { endMin, busy, context });
  const rows = fresh.map((b) => ({ kind: 'block', id: uid('blk'), ...b }));
  await bulkPut(STORES.schedule, rows);
  await reflowDate(date);
  return getBlocksForDate(date);
}

// Manually reserve a specific item at a specific time (pinned by intent).
export async function blockItem(itemId, date, startMin) {
  const it = await get(STORES.items, itemId);
  if (!it) return null;
  const rec = {
    kind: 'block',
    id: uid('blk'),
    itemId,
    area: it.area || 'Study',
    title: it.title || '',
    mode: it.mode,
    date,
    start: startMin,
    minutes: clampDur(it.estMinutes),
    status: 'planned',
    pinned: true,
  };
  await put(STORES.schedule, rec);
  await reflowDate(date);
  return rec;
}

// Set a block to an exact start time (user chose it) — pins and re-packs.
export async function retimeBlock(id, startMin) {
  const b = await get(STORES.schedule, id);
  if (!b) return null;
  b.start = Math.max(0, Math.min(23 * 60 + 59, startMin));
  b.pinned = true;
  await put(STORES.schedule, b);
  await reflowDate(b.date);
  return b;
}

// Move a block to another date; it flows into that day (source day re-packs).
export async function moveBlockToDate(id, date) {
  const b = await get(STORES.schedule, id);
  if (!b) return null;
  const from = b.date;
  b.date = date;
  b.pinned = false; // let the coach slot it into the new day
  await put(STORES.schedule, b);
  if (from !== date) await reflowDate(from);
  await reflowDate(date);
  return b;
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

  // Seed routine settings from the plan's meta, then let a full backup override.
  const metaSettings = {};
  if (meta.goalDate !== undefined) metaSettings.goalDate = meta.goalDate;
  if (meta.goalLabel !== undefined) metaSettings.goalLabel = meta.goalLabel;
  if (meta.bedtime !== undefined) metaSettings.bedtime = meta.bedtime;
  if (Object.keys(metaSettings).length) await setSettings(metaSettings);
  if (plan.settings) await setSettings(plan.settings);

  // Reading practice: a full backup restores it; a fresh plan may seed the
  // current book from meta.reading (only if you don't already have one).
  if (plan.reading) {
    await setReading(plan.reading);
  } else if (meta.reading && meta.reading.title) {
    const r = await getReading();
    if (!r.current) await setCurrentBook(meta.reading);
  }

  // Import may restore a full backup that carries the log, schedule + context.
  if (Array.isArray(plan.log)) {
    await replaceStores({ [STORES.log]: plan.log.map((l) => ({ id: l.id || uid('log'), ...l })) });
  }
  // Blocks and commitments share the schedule store — restore them together so
  // one doesn't wipe the other.
  if (Array.isArray(plan.blocks) || Array.isArray(plan.busy)) {
    const sched = [
      ...(plan.blocks || []).map((b) => ({ kind: 'block', id: b.id || uid('blk'), ...b })),
      ...(plan.busy || []).map((b) => ({ kind: 'busy', id: b.id || uid('busy'), ...b })),
    ];
    await replaceStores({ [STORES.schedule]: sched });
  }
  if ('context' in plan) {
    await setContext(plan.context || null);
  }

  return { plans: planRecords.length, phases: phaseRecords.length, items: itemRecords.length };
}

// ---------- Content-patch tracking (applied once, by id) ----------
export async function getAppliedPatches() {
  const rec = await get(STORES.kv, 'appliedPatches');
  return rec ? rec.v : [];
}
export async function markPatchApplied(id) {
  const cur = await getAppliedPatches();
  if (!cur.includes(id)) { cur.push(id); await put(STORES.kv, { k: 'appliedPatches', v: cur }); }
}

// ---------- Full backup export ----------
// Reconstruct a plan.json-shaped object plus schedule + log for round-tripping.
export async function buildExport() {
  const [meta, plans, phases, items, log, blocks, context, settings, reading] = await Promise.all([
    getMeta(), getPlans(), getPhases(), getItems(), getLog(), getBlocks(), getContext(), getSettings(), getReading(),
  ]);
  const allSchedule = await getAll(STORES.schedule);
  const busy = allSchedule.filter((r) => r && r.kind === 'busy')
    .map((b) => ({ id: b.id, date: b.date, start: b.start, minutes: b.minutes, label: b.label, drain: b.drain || 'none' }));

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

  // Blocks carry only what's needed to reconstruct the schedule (drop kind).
  const blocksOut = blocks.map((b) => ({
    id: b.id, itemId: b.itemId, area: b.area, title: b.title, mode: b.mode,
    date: b.date, start: b.start, minutes: b.minutes, status: b.status, pinned: !!b.pinned,
  }));

  return {
    meta: meta || {},
    plans: plansOut,
    blocks: blocksOut,
    busy,
    context: context || null,
    settings,
    reading,
    log,
    exportedAt: new Date().toISOString(),
    app: 'guruji',
    schemaVersion: SCHEMA_VERSION,
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
