// Higher-level data operations over the IndexedDB layer.
import { STORES, getAll, get, put, del, replaceStores, clearStore, bulkPut } from './db.js';
import { uid, todayISO, addDaysISO, daysBetween, nowMinutes, toMinutes } from './util.js';
import { buildSessionGoals } from './objectives.js';
import { planDay, reflow, sequence, clampDur, DAY_START, DAY_END } from './schedule.js';
import { SCHEMA_VERSION } from './migrations.js';

// ---------- Routine settings (bedtime, goal countdown) ----------
const DEFAULT_SETTINGS = {
  bedtime: '23:30', wake: null, freshenMinutes: 30, goalDate: null, goalLabel: '',
  // Recurring routine: which weekdays (0=Sun … 6=Sat) are office days by default,
  // and your usual office timing. The wizard pre-fills from these; a per-day
  // override in the wizard doesn't change the routine.
  officeDays: [1, 2, 3, 4, 5], officeLeave: 510, officeCommute: 60, officeBack: 1080, getReady: 30,
  // Working assumed on weekdays; place defaults to home (flip per-day in the
  // wizard). Home work hours are blocked just like office hours, minus commute.
  workPlace: 'home', workStart: 540, workEnd: 1020,
};
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
export async function removeShelfBook(finishedAt) {
  const r = await getReading();
  r.shelf = (r.shelf || []).filter((x) => x.finishedAt !== finishedAt);
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

// ---------- One-time startup migrations ----------
// Guruji was a work-in-progress for a long stretch, and the tracking stores
// accumulated throwaway data from that build-out. Treat 2026-07-13 — the first
// day of real study — as day one: purge every dated activity (logged sessions,
// planned blocks, commitments) from before it, so the streak, hours logged and
// plan adherence all start clean from today. Runs exactly once per device,
// gated by a kv flag; today's and future records are left untouched. The plan
// itself (phases, items, notes) is content, not tracking, so it's never touched.
const FRESH_START_CUTOFF = '2026-07-13';
export async function runStartupMigrations() {
  const flagKey = 'migration:fresh-start-2026-07-13';
  try {
    const done = await get(STORES.kv, flagKey);
    if (done && done.v) return { ran: false };
    let removed = 0;
    for (const store of [STORES.log, STORES.schedule]) {
      const all = await getAll(store);
      const stale = all.filter((r) => typeof r.date === 'string' && r.date < FRESH_START_CUTOFF);
      for (const r of stale) { await del(store, r.id); removed += 1; }
    }
    await put(STORES.kv, { k: flagKey, v: true });
    return { ran: true, removed };
  } catch {
    return { ran: false };
  }
}

// ---------- Cognitive-load context (office / commute / …) ----------
export async function getContext() {
  const rec = await get(STORES.kv, 'context');
  return rec ? rec.v : null;
}
export async function setContext(v) {
  return put(STORES.kv, { k: 'context', v: v || null });
}

// ---------- Active focus session (survives an app close) ----------
// Persisted when a focus session starts so the app can resume it — with an
// accurate wall-clock timer — if you reopen after accidentally closing.
export async function getActiveSession() {
  const rec = await get(STORES.kv, 'activeSession');
  return rec ? rec.v : null;
}
export async function setActiveSession(v) {
  return put(STORES.kv, { k: 'activeSession', v: v || null });
}
export async function clearActiveSession() {
  return put(STORES.kv, { k: 'activeSession', v: null });
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

// Session expectations — the coach's concrete "definition of done" for a topic.
// Which ones you've met is progress (like status), stored on the item and keyed
// by the objective's text so it survives content edits and re-imports. Toggling
// returns the updated met-list so the caller can repaint.
export async function toggleObjective(id, text) {
  const item = await get(STORES.items, id);
  if (!item) return null;
  const done = Array.isArray(item.doneObjectives) ? item.doneObjectives.slice() : [];
  const at = done.indexOf(text);
  if (at >= 0) done.splice(at, 1); else done.push(text);
  item.doneObjectives = done;
  await put(STORES.items, item);
  return done;
}

// Set a topic's expectations yourself (from the Day view). Stores a user override
// that wins over authored/area-default expectations, and re-syncs which are met
// to the surviving texts. Passing an empty list means "no expectations here."
export async function setObjectives(id, list, done = []) {
  const item = await get(STORES.items, id);
  if (!item) return null;
  const clean = (Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean);
  item.objectives = clean;
  const keep = new Set(clean);
  item.doneObjectives = (Array.isArray(done) ? done : []).map((s) => String(s).trim()).filter((s) => keep.has(s));
  await put(STORES.items, item);
  return item;
}

// Study content for a topic (authored on desktop). Stored on the item so it
// round-trips through export/import and survives phone syncs (see ingestPlan).
export async function setItemNotes(id, notes) {
  const item = await get(STORES.items, id);
  if (!item) return null;
  item.notes = notes || '';
  await put(STORES.items, item);
  return item;
}

// Build a content-only patch (all topics that have notes) for syncing your
// desktop-authored study material to another device. Applied on the other end
// it only updates notes — tracking, schedule and status there are untouched —
// and it's tagged with a timestamp so it applies once. `stamp` is supplied by
// the caller (the browser clock).
export async function buildContentPatch(stamp) {
  const items = await getItems();
  const ops = items
    .filter((i) => i.notes && i.notes.trim())
    .map((i) => ({ op: 'update-item', id: i.id, set: { notes: i.notes } }));
  return {
    app: 'guruji-patch',
    id: `content-${stamp}`,
    description: `Study content · ${ops.length} ${ops.length === 1 ? 'topic' : 'topics'}`,
    ops,
  };
}

// Put every topic back to one status (default: not-started). Returns how many
// changed — the one-tap way to undo accidental Done/Skip marks.
export async function resetAllStatuses(status = 'todo') {
  const items = await getItems();
  let changed = 0;
  for (const it of items) {
    if (it.status !== status) { it.status = status; await put(STORES.items, it); changed++; }
  }
  return changed;
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
// Clear study blocks you could never have done: ones scheduled before you were
// up (a stale plan from when the coach thought you woke earlier), and — on today
// — ones already fully in the past that you never started. A block you actually
// logged time against, or marked done, is history and is always kept. Returns
// how many were reclaimed so the day view can say so. This is what makes the day
// "smart enough" to drop an 8:30 DSA slot once you've told it you woke at 9:30.
export async function reclaimStaleBlocks(date, now = new Date()) {
  // Only ever touches today: past days are history, and a future day's plan is
  // freshly built from the correct wake time, so there's nothing to reclaim.
  if (date !== todayISO(now)) return 0;
  const [blocks, settings, studiedByBlock] = await Promise.all([
    getBlocksForDate(date), getSettings(), studiedMinutesByBlock(),
  ]);
  const wakeStart = settings.wake != null ? toMinutes(settings.wake) : null;
  const nowMin = nowMinutes(now);
  let removed = 0;
  for (const b of blocks) {
    if (b.status === 'done') continue;                       // already done — keep
    if ((studiedByBlock.get(b.id) || 0) > 0) continue;       // real time logged — keep
    const beforeWake = wakeStart != null && b.start < wakeStart;
    const fullyPast = (b.start + (b.minutes || 0)) <= nowMin;
    if (beforeWake || fullyPast) { await del(STORES.schedule, b.id); removed += 1; }
  }
  return removed;
}
// A single planned block by id — used to recover its predicted load (and thus
// its session intensity) on the prep / focus screens.
export async function getBlock(id) {
  const b = await get(STORES.schedule, id);
  return b && b.kind === 'block' ? b : null;
}

// ---- Per-session goals ----
// Each planned session (block) owns its goals, so completion is per-session, not
// per-topic: today's DSA block and tomorrow's are independent. Goals are built
// the first time a block needs them — unmet goals from the topic's previous
// session carry forward (a real second chance), and fresh goals rotate in so
// successive sessions differ. See buildSessionGoals in objectives.js.
export async function ensureBlockGoals(id) {
  const block = await get(STORES.schedule, id);
  if (!block || block.kind !== 'block') return [];
  if (Array.isArray(block.goals) && block.goals.length) return block.goals;
  const item = await get(STORES.items, block.itemId);
  if (!item) return [];
  const all = await getBlocks();
  // Prior sessions of this same topic (strictly before this block in time).
  const priors = all
    .filter((b) => b.kind === 'block' && b.itemId === block.itemId && b.id !== block.id &&
      (b.date < block.date || (b.date === block.date && (b.start || 0) < (block.start || 0))))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start || 0) - (b.start || 0)));
  const last = [...priors].reverse().find((b) => Array.isArray(b.goals) && b.goals.length);
  block.goals = buildSessionGoals({
    item, minutes: block.minutes, load: block.load,
    prior: last ? last.goals : [], seq: priors.length,
  });
  await put(STORES.schedule, block);
  return block.goals;
}
export async function toggleBlockGoal(id, text) {
  await ensureBlockGoals(id);
  const block = await get(STORES.schedule, id);
  if (!block || !Array.isArray(block.goals)) return [];
  const g = block.goals.find((x) => x.text === text);
  if (g) g.met = !g.met;
  await put(STORES.schedule, block);
  return block.goals;
}
export async function setBlockGoals(id, goals) {
  const block = await get(STORES.schedule, id);
  if (!block) return [];
  block.goals = (Array.isArray(goals) ? goals : [])
    .map((x) => ({ text: String(x.text || '').trim(), met: !!x.met }))
    .filter((x) => x.text);
  await put(STORES.schedule, block);
  return block.goals;
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
export async function putBusy({ date, start, minutes, label, drain, transit }) {
  const rec = { kind: 'busy', id: uid('busy'), date, start, minutes, label: label || 'Busy', drain: drain || 'none', transit: !!transit };
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
// Tick a commitment off (or un-tick it). A done commitment stops counting as an
// obstacle, so reassessing plans study into the time it used to hold.
export async function setBusyStatus(id, status) {
  const b = await get(STORES.schedule, id);
  if (!b || b.kind !== 'busy') return null;
  b.status = status;
  await put(STORES.schedule, b);
  // No reflow here — ticking a commitment off is just a state change; you drive
  // the re-fit explicitly with Reassess, so nothing shuffles under you.
  return b;
}
// Re-planning fully re-specifies the day's commitments, so clear the old ones
// first — otherwise each re-plan stacks another gym/walk/office.
export async function clearBusyForDate(date) {
  const rows = await getBusyForDate(date);
  for (const b of rows) await del(STORES.schedule, b.id);
}

// Two things can't happen at once. Fixed commitments (office, commute, meals)
// anchor; movable ones (gym, walk, errands) slide to the next free slot so no
// commitment overlaps another.
function slidePast(start, minutes, intervals) {
  let s = start;
  let moved = true;
  while (moved) {
    moved = false;
    for (const p of intervals) {
      const pe = p.start + p.minutes;
      if (s < pe && s + minutes > p.start) { s = pe; moved = true; }
    }
  }
  return s;
}
export async function deconflictBusy(date) {
  const all = await getBusyForDate(date);
  const anchors = all.filter((b) => !isMovableBusy(b)).map((b) => ({ start: b.start, minutes: b.minutes }));
  const movable = all.filter(isMovableBusy).sort((a, b) => a.start - b.start);
  const placed = [...anchors];
  for (const m of movable) {
    const s = slidePast(m.start, m.minutes, placed);
    if (s !== m.start) { m.start = s; await put(STORES.schedule, m); }
    placed.push({ start: m.start, minutes: m.minutes });
  }
}

// Re-pack a day so nothing overlaps: pinned/done blocks and commitments keep
// their time, the rest flow around them.
export async function reflowDate(date) {
  const [blocks, busy] = await Promise.all([getBlocksForDate(date), getBusyForDate(date)]);
  if (!blocks.length) return [];
  // Done commitments are no longer obstacles — study may flow through their time.
  const packed = reflow(blocks, busy.filter((b) => b.status !== 'done'));
  await bulkPut(STORES.schedule, packed.map((b) => ({ ...b, kind: 'block' })));
  return packed;
}

// Auto-plan a date: lay the next surfaceable item per area into the free
// windows around commitments, load-aware, capped at bedtime. Keeps pinned/done.
export async function autoPlanDay(date, { now = new Date(), focusArea = null, maxStudyMinutes, weekend = false, loadBias = 0 } = {}) {
  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));

  // Every surfaceable item is a candidate — the planner fills free time with
  // as many sessions as realistically fit, so a wide-open day gets a full plan.
  const surfaceable = [];
  for (const it of items) {
    if (it.status !== 'todo') continue;
    if (!(it.dependsOn || []).every((d) => statusById.get(d) === 'done')) continue;
    surfaceable.push(it);
  }

  const [existing, busy, settings, context, studiedByBlock] = await Promise.all([
    getBlocksForDate(date), getBusyForDate(date), getSettings(), getContext(), studiedMinutesByBlock(),
  ]);
  // Keep manually-pinned and completed work — and any block you've already logged
  // real focus time against, so re-planning never throws away a session you sat
  // (e.g. "25 / 60 min" survives a Reassess). Auto commute-study (onCommute) is
  // still regenerated so re-planning doesn't leave a stale duplicate behind.
  const keep = existing.filter((b) =>
    b.status === 'done' || (b.pinned && !b.onCommute) || (studiedByBlock.get(b.id) || 0) > 0);
  const keepSet = new Set(keep);
  for (const b of existing) {
    if (!keepSet.has(b)) await del(STORES.schedule, b.id);
  }

  // A bedtime at/after midnight (e.g. 12:00am) belongs to the *next* calendar
  // day, so it must not collapse today's study window to nothing — treat an
  // early-morning bedtime as end-of-day.
  let bedMin = settings.bedtime ? toMinutes(settings.bedtime) : DAY_END;
  if (bedMin < 5 * 60) bedMin += 24 * 60;
  const endMin = Math.min(DAY_END, bedMin);
  const taken = new Set(keep.map((b) => b.itemId));

  // Commute windows (transit commitments) become transit-study sessions — that
  // dead hour on the train is exactly when concept-level work fits.
  // Commitments you've ticked off (had lunch, did the walk) are behind you —
  // drop them as obstacles so reassessing reclaims that time for study.
  const activeBusy = busy.filter((b) => b.status !== 'done');
  const commuteWindows = activeBusy.filter((b) => b.transit).sort((a, b) => a.start - b.start);
  // Reading is low-effort — you're absorbing, not grinding — so on office days
  // it rides the commute first, freeing your desk hours for DSA / system design.
  // Concept-level TRANSIT work fills any remaining commute windows.
  const readingItems = surfaceable.filter((it) => it.mode === 'WIND_DOWN' && !taken.has(it.id));
  const transitItems = surfaceable.filter((it) => it.mode === 'TRANSIT' && !taken.has(it.id));
  const commuteCands = [...readingItems, ...transitItems];
  const commuteBlocks = [];
  let tIdx = 0;
  for (const cw of commuteWindows) {
    const it = commuteCands[tIdx];
    if (!it) break;
    tIdx++;
    taken.add(it.id);
    commuteBlocks.push({
      kind: 'block', id: uid('blk'), itemId: it.id, area: it.area || 'Study', title: it.title || '',
      mode: it.mode, date, start: cw.start,
      // Reading fills the whole ride; concept work uses its usual length.
      minutes: it.mode === 'WIND_DOWN' ? cw.minutes : Math.min(clampDur(it.estMinutes), cw.minutes),
      status: 'planned', pinned: true, onCommute: true,
    });
  }

  const cands = surfaceable
    .filter((it) => !taken.has(it.id))
    .map((it) => ({ area: it.area || 'Study', item: it }));
  // Earliest the day can begin: after you're up and freshened up.
  const wakeStart = settings.wake != null
    ? toMinutes(settings.wake) + (settings.freshenMinutes ?? 30)
    : DAY_START;
  const startMin = date === todayISO(now)
    ? Math.max(Math.ceil((nowMinutes(now) + 5) / 15) * 15, wakeStart)
    : wakeStart;

  // Obstacles the fresh plan flows around: all commitments (incl. full commute
  // windows), kept pinned/done blocks, and the commute-study we just placed.
  const pinned = [
    ...keep.map((b) => ({ start: b.start, minutes: b.minutes, mode: b.mode })),
    ...commuteWindows.map((b) => ({ start: b.start, minutes: b.minutes, mode: 'TRANSIT' })),
    ...commuteBlocks.map((b) => ({ start: b.start, minutes: b.minutes, mode: b.mode })),
  ];
  // Weekends are wide open and meant for real progress: build longer, deeper
  // focus blocks (up to ~2.5h while fresh) so a full ~8-hour study day lands as
  // a few big sittings plus lighter work, spread across the day — not a dozen
  // little sessions.
  const planOpts = {
    startMin, endMin, busy: activeBusy.filter((b) => !b.transit), context, pinned, focusArea, maxStudyMinutes, loadBias,
    ...(weekend ? { itemCap: 2, areaCapDefault: 4, deep: true } : {}),
  };
  // If it's too late for anything to fit today, still propose from the day start.
  let fresh = planDay(date, cands, planOpts);
  if (!fresh.length && cands.length) fresh = planDay(date, cands, { ...planOpts, startMin: undefined });
  const rows = [...commuteBlocks, ...fresh.map((b) => ({ kind: 'block', id: uid('blk'), ...b }))];
  // No final reflow here — planDay already lays a clean, break-scaled layout
  // that respects the wake start and routes around commitments + pinned blocks.
  await bulkPut(STORES.schedule, rows);
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

// Replace what a scheduled block is *for* while keeping its exact time slot —
// "I'm booked to study DSA at 11, but I'd rather read." Repoints the block at a
// new item (area/title/mode follow); start, length and date are untouched, so
// nothing else on the day shifts. Pinned, since it's now an explicit choice.
export async function swapBlockItem(blockId, newItemId) {
  const [b, it] = await Promise.all([get(STORES.schedule, blockId), get(STORES.items, newItemId)]);
  if (!b || b.kind !== 'block' || !it) return null;
  b.itemId = newItemId;
  b.area = it.area || 'Study';
  b.title = it.title || '';
  b.mode = it.mode;
  b.onCommute = false; // a hand-picked swap isn't tied to the old commute slot
  b.pinned = true;
  await put(STORES.schedule, b);
  return b;
}

// Reorder the day: lay the planned blocks out in the given id order, from the
// day's start, around commitments and any completed sessions. Dragging makes
// the sequence the intent, so individual pins are cleared.
export async function resequenceBlocks(date, orderedIds) {
  const [blocks, busy, settings] = await Promise.all([
    getBlocksForDate(date), getBusyForDate(date), getSettings(),
  ]);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const done = blocks.filter((b) => b.status === 'done');
  const planned = orderedIds.map((id) => byId.get(id)).filter((b) => b && b.status !== 'done');
  for (const b of blocks) if (b.status !== 'done' && !orderedIds.includes(b.id)) planned.push(b);

  const wakeStart = settings.wake != null ? toMinutes(settings.wake) + (settings.freshenMinutes ?? 30) : DAY_START;
  const startMin = date === todayISO()
    ? Math.max(Math.ceil((nowMinutes() + 5) / 15) * 15, wakeStart)
    : wakeStart;

  sequence(planned, { startMin, busy: [...busy, ...done] });
  await bulkPut(STORES.schedule, planned.map((b) => ({ ...b, kind: 'block', pinned: false })));
  return getBlocksForDate(date);
}

// Running late: push this block (and everything after it) later by `delta`
// minutes, re-sequencing the tail around commitments. If the tail spills past
// bedtime, the last sessions shrink to fit, then drop — so the day self-heals.
export async function pushBlock(id, delta) {
  const b0 = await get(STORES.schedule, id);
  if (!b0) return null;
  const date = b0.date;
  const [blocks, busy, settings] = await Promise.all([
    getBlocksForDate(date), getBusyForDate(date), getSettings(),
  ]);
  const planned = blocks.filter((b) => b.status !== 'done').sort((a, b) => a.start - b.start);
  const done = blocks.filter((b) => b.status === 'done');
  const idx = planned.findIndex((b) => b.id === id);
  if (idx < 0) return null;

  const head = planned.slice(0, idx);
  const tail = planned.slice(idx);
  // Shift the whole tail later by `delta`, PRESERVING the gaps (breaks) between
  // blocks — only nudge a block further when a fixed commitment is in the way.
  // (Re-sequencing from scratch would flatten the day's break rhythm.)
  const fixed = [...busy, ...done, ...head].map((x) => ({ start: x.start, minutes: x.minutes }));
  let prevEnd = -Infinity;
  for (const bl of tail) {
    let s = slidePast(Math.max(0, bl.start + delta), bl.minutes, fixed);
    if (s < prevEnd) s = slidePast(prevEnd, bl.minutes, fixed); // keep order, no overlap
    bl.start = s;
    prevEnd = s + bl.minutes;
  }

  let bed = settings.bedtime ? toMinutes(settings.bedtime) : DAY_END;
  if (bed < 5 * 60) bed += 24 * 60; // a past-midnight bedtime is late, not early
  const kept = [];
  const dropped = [];
  for (const b of tail) {
    if (b.start >= bed) { dropped.push(b); continue; }
    if (b.start + b.minutes > bed) b.minutes = bed - b.start; // squeeze into what's left
    if (b.minutes < 15) { dropped.push(b); continue; }
    kept.push(b);
  }
  for (const d of dropped) await del(STORES.schedule, d.id);
  await bulkPut(STORES.schedule, kept.map((b) => ({ ...b, kind: 'block', pinned: false })));
  return getBlocksForDate(date);
}

// Reorder the whole day — study sessions AND movable commitments (gym, walk,
// errands) as one sequence — laid out from the day's start around the things
// that are genuinely fixed: office hours, the commute, meals, and done work.
// Work (in-office or from-home) is immovable — it anchors the day and study
// routes around it. Without 'Work' here, a from-home block was treated as
// movable and slid past the meal anchors into the evening, leaving the 9–5 open.
const FIXED_LABELS = new Set(['Breakfast', 'Lunch', 'Dinner', 'Office', 'Work']);
export function isMovableBusy(b) { return !(b.transit || FIXED_LABELS.has(b.label)); }

export async function resequenceMixed(date, orderedIds) {
  const [blocks, busy, settings] = await Promise.all([
    getBlocksForDate(date), getBusyForDate(date), getSettings(),
  ]);
  const done = blocks.filter((b) => b.status === 'done');
  const fixedBusy = busy.filter((b) => !isMovableBusy(b));
  const movableBusy = busy.filter(isMovableBusy);
  const pool = [...blocks.filter((b) => b.status !== 'done'), ...movableBusy];
  const byId = new Map(pool.map((x) => [x.id, x]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const x of pool) if (!orderedIds.includes(x.id)) ordered.push(x);

  const wakeStart = settings.wake != null ? toMinutes(settings.wake) + (settings.freshenMinutes ?? 30) : DAY_START;
  const startMin = date === todayISO() ? Math.max(Math.ceil((nowMinutes() + 5) / 15) * 15, wakeStart) : wakeStart;
  sequence(ordered, { startMin, busy: [...fixedBusy, ...done] });
  const rows = ordered.map((x) => (x.kind === 'busy' ? { ...x } : { ...x, kind: 'block', pinned: false }));
  await bulkPut(STORES.schedule, rows);
  return getBlocksForDate(date);
}

// Set a block to an exact start time (user chose it) — pins and re-packs.
// Retime a block. Pass `minutes` to also resize it (editing the end time);
// omit it to just move the start and keep the duration. Either way it pins.
export async function retimeBlock(id, startMin, minutes) {
  const b = await get(STORES.schedule, id);
  if (!b) return null;
  b.start = Math.max(0, Math.min(23 * 60 + 59, startMin));
  if (minutes != null) b.minutes = Math.max(10, Math.min(240, Math.round(minutes)));
  b.pinned = true;
  await put(STORES.schedule, b);
  await reflowDate(b.date);
  return b;
}

// Retime a commitment directly (drag-free manual edit of its start / end).
export async function retimeBusy(id, startMin, minutes) {
  const b = await get(STORES.schedule, id);
  if (!b) return null;
  b.start = Math.max(0, Math.min(23 * 60 + 59, startMin));
  if (minutes != null) b.minutes = Math.max(5, Math.min(720, Math.round(minutes)));
  await put(STORES.schedule, b);
  await reflowDate(b.date); // study flows around the new times
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

// ---- Commute revision deck ----
// The material to revise, drawn only from what you've already studied deeply:
// concepts you've rated, DSA patterns you've practiced, and problems you've
// solved (with your own notes). Never new content — that's the line we don't cross.
export async function computeDeck() {
  const log = await getLog();
  const conceptLatest = new Map();
  const lc = [];
  for (const e of log) {
    if (Array.isArray(e.concepts)) for (const r of e.concepts) if (r && r.concept) conceptLatest.set(r.concept, { concept: r.concept, confidence: r.confidence, topic: e.itemTitle || '', date: e.date });
    if (Array.isArray(e.leetcode)) for (const p of e.leetcode) lc.push({ ...p, date: e.date });
  }
  const probMap = new Map();
  for (const p of lc) { const k = p.slug || p.title; if (k) probMap.set(k, p); }
  const patCount = new Map();
  for (const p of lc) if (p.pattern) patCount.set(p.pattern, (patCount.get(p.pattern) || 0) + 1);
  return {
    concepts: [...conceptLatest.values()],
    problems: [...probMap.values()],
    patterns: [...patCount.entries()].map(([pattern, count]) => ({ pattern, count })),
  };
}
// Lightweight spaced-repetition memory: per-card confidence + last-seen, so shaky
// cards resurface first next time. Keyed by "concept:x" / "pattern:x" / "lc:slug".
export async function getReviseState() {
  const rec = await get(STORES.kv, 'reviseState');
  return rec ? rec.v : {};
}
export async function setReviseState(v) {
  return put(STORES.kv, { k: 'reviseState', v: v || {} });
}

// ---- Drills spaced-rep memory ----
// Per-drill record { conf: 'got'|'missed', at, seen } so missed fill-in-the-blank
// cards resurface first next time. Keyed by drill id.
export async function getDrillState() {
  const rec = await get(STORES.kv, 'drillState');
  return rec ? rec.v : {};
}
export async function setDrillState(v) {
  return put(STORES.kv, { k: 'drillState', v: v || {} });
}

// ---- "How did I do?" — a single day score ----
// Rolls a day's real activity into one number: did you put in the study time,
// meet your session goals, do your LeetCode, read, clear your commitments, and
// actually capture it in the app? Each part only counts when the day expected it
// (no LeetCode planned → LeetCode doesn't drag the score). Surfaces the single
// worst gap so a bad day gets a clear, honest nudge.
export async function computeDayScore(date) {
  const [blocks, busy, log] = await Promise.all([getBlocksForDate(date), getBusyForDate(date), getLog()]);
  const dayLog = log.filter((e) => e.date === date);

  const planned = blocks.reduce((s, b) => s + (b.minutes || 0), 0);
  // Study time = minutes attributed to THIS day's actual blocks — exactly what the
  // block cards show (their "X / planned"). Summing every focus entry on the date
  // would double-count sessions on blocks since re-planned away, so the score's
  // total wouldn't match the cards (178 vs a visible 105).
  const blockIds = new Set(blocks.map((b) => b.id));
  const studied = log.reduce((s, e) => (e.blockId && blockIds.has(e.blockId)) ? s + Math.max(0, Math.round(e.focusMinutes || 0)) : s, 0);
  let goalTot = 0; let goalMet = 0;
  for (const b of blocks) if (Array.isArray(b.goals)) { goalTot += b.goals.length; goalMet += b.goals.filter((g) => g.met).length; }
  let lcCount = 0; for (const e of dayLog) if (Array.isArray(e.leetcode)) lcCount += e.leetcode.length;
  const hasDSA = blocks.some((b) => b.area === 'DSA');
  const hasReadingBlock = blocks.some((b) => b.area === 'Reading');
  const didRead = dayLog.some((e) => e.area === 'Reading' && (e.focusMinutes || 0) > 0);
  const PASSIVE = new Set(['Office', 'Work', 'Freshen up', 'Commute']);
  const doable = busy.filter((b) => !b.transit && !PASSIVE.has(b.label));
  const doneCommit = doable.filter((b) => b.status === 'done').length;
  const engaged = goalMet > 0 || dayLog.some((e) => (e.focusMinutes || 0) > 0 || (Array.isArray(e.leetcode) && e.leetcode.length) || (Array.isArray(e.concepts) && e.concepts.length));

  // The LeetCode daily target derives from the run-to-goal pace (Path), spread
  // across ~5 study days a week — so it tightens as the deadline nears and as you
  // fall behind. Falls back to a flat 3 with no goal date.
  let lcTarget = 3;
  try {
    const road = await computeRoadmap();
    const perWeek = road && road.pacing && road.pacing.lc ? road.pacing.lc.perWeek : null;
    if (perWeek) lcTarget = Math.max(1, Math.min(6, Math.round(perWeek / 5)));
  } catch { /* keep the flat fallback */ }

  const components = [
    { key: 'study', label: 'Study', weight: 28, relevant: planned > 0, ratio: planned > 0 ? Math.min(1, studied / planned) : 0, detail: planned > 0 ? `${studied}/${planned}m` : `${studied}m`, over: planned > 0 && studied > planned },
    { key: 'goals', label: 'Goals', weight: 22, relevant: goalTot > 0, ratio: goalTot > 0 ? goalMet / goalTot : 0, detail: `${goalMet}/${goalTot}` },
    { key: 'leetcode', label: 'LeetCode', weight: 18, relevant: hasDSA || lcCount > 0, ratio: Math.min(1, lcCount / lcTarget), detail: `${lcCount}/${lcTarget}` },
    { key: 'reading', label: 'Reading', weight: 10, relevant: hasReadingBlock, ratio: didRead ? 1 : 0, detail: didRead ? 'done' : '—' },
    { key: 'commitments', label: 'Commitments', weight: 10, relevant: doable.length > 0, ratio: doable.length ? doneCommit / doable.length : 0, detail: `${doneCommit}/${doable.length}` },
    { key: 'engagement', label: 'Logged it', weight: 12, relevant: true, ratio: engaged ? 1 : 0, detail: engaged ? 'yes' : 'no' },
  ];
  const rel = components.filter((c) => c.relevant);
  const wsum = rel.reduce((s, c) => s + c.weight, 0) || 1;
  const score = Math.round((rel.reduce((s, c) => s + c.weight * c.ratio, 0) / wsum) * 100);

  const LOW = {
    study: 'No study logged yet — start a session, or log the time you put in.',
    goals: 'No session goals ticked — mark what you actually met.',
    leetcode: 'Zero LeetCode today — even one keeps you moving toward 500.',
    reading: 'No reading today — a few pages keeps the habit alive.',
    commitments: 'None of your commitments marked done yet.',
    engagement: 'Nothing logged today — the app can only coach what it sees.',
  };
  const gaps = rel.filter((c) => c.ratio <= 0.15).sort((a, b) => b.weight - a.weight);
  const lowlight = gaps.length ? { key: gaps[0].key, msg: LOW[gaps[0].key] } : null;
  const verdict = score >= 85 ? 'Strong day' : score >= 65 ? 'Solid' : score >= 45 ? 'Middling' : score >= 25 ? 'Slow going' : 'Barely started';
  const tone = score >= 65 ? 'ok' : score >= 40 ? 'mid' : 'low';

  return { date, score, verdict, tone, components, lowlight, planned, studied, isToday: date === todayISO(), hasData: rel.length > 0 };
}

// Log time you studied *without* the timer — you forgot to start focus mode but
// still put in the work. Creates a real session entry against the block, so its
// minutes count everywhere a timed session would (the block's "X / reserved",
// Progress, the streak) and the block survives a re-plan.
export async function logManualSession(block, minutes, problems = []) {
  const mins = Math.max(1, Math.round(minutes || 0));
  const now = new Date();
  return addLogEntry({
    itemId: block.itemId,
    itemTitle: block.title || '',
    mode: block.mode,
    area: block.area || null,
    blockId: block.id,
    date: block.date, // the day the block is on
    startedAt: now.toISOString(),
    endedAt: now.toISOString(),
    plannedMinutes: block.minutes,
    focusMinutes: mins,
    problems: Array.isArray(problems) ? problems : [],
    manual: true, // logged by hand, not the timer
    result: 'done',
  });
}

// Attach LeetCode problems to a block's session — from the post-session wizard,
// or retroactively from the Day. Stored as a problems-only log entry (no minutes)
// so it feeds the LeetCode dashboard without counting as a study session.
export async function logLeetcodeForBlock(block, entries) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const now = new Date();
  return addLogEntry({
    itemId: block.itemId,
    itemTitle: block.title || '',
    mode: block.mode,
    area: block.area || 'DSA',
    blockId: block.id,
    date: block.date,
    startedAt: now.toISOString(),
    endedAt: now.toISOString(),
    focusMinutes: 0,     // problems-only — not a timed session
    leetcode: entries,
    manual: true,
    result: 'logged',
  });
}

// Attach concept-confidence ratings to a topic (CS Fundamentals) — from the
// post-session wizard or retroactively from the Day. Stored as a ratings-only
// log entry (no minutes) so it feeds the confidence dashboard without counting
// as a study session.
export async function logConceptsForBlock(block, ratings) {
  if (!Array.isArray(ratings) || !ratings.length) return null;
  const now = new Date();
  return addLogEntry({
    itemId: block.itemId,
    itemTitle: block.title || '',
    mode: block.mode,
    area: block.area || 'CS Fundamentals',
    blockId: block.id,
    date: block.date,
    startedAt: now.toISOString(),
    endedAt: now.toISOString(),
    focusMinutes: 0,
    concepts: ratings,
    manual: true,
    result: 'logged',
  });
}

// Actual focused minutes per planned block, summed from the session log. Lets
// the Day view show what you *really* studied against what a block reserved —
// so a 150-min block you only sat with for 25 reads honestly, not as "done =
// 150 studied". Keyed by blockId, which is unique per block.
export async function studiedMinutesByBlock() {
  const log = await getLog();
  const m = new Map();
  for (const e of log) {
    if (!e.blockId) continue;
    m.set(e.blockId, (m.get(e.blockId) || 0) + Math.max(0, Math.round(e.focusMinutes || 0)));
  }
  return m;
}

// ---------- Effort metrics (the feedback loop) ----------
// Derived entirely from what the app already records: the session log (actual
// focus time), the schedule (what was planned), and item statuses (progress).
export async function computeStats(now = new Date()) {
  const [log, sched, items] = await Promise.all([getLog(), getAll(STORES.schedule), getItems()]);
  const today = todayISO(now);
  const blocks = sched.filter((r) => r && r.kind === 'block');

  const byDate = new Map();   // date -> minutes actually studied
  const byArea = new Map();   // area -> minutes
  const lc = [];              // LeetCode problems: {title, pattern, difficulty, outcome, note, date}
  const conceptLatest = new Map(); // concept -> {confidence, date, topic} (latest rating wins)
  let totalMinutes = 0;
  let sessions = 0;
  for (const e of log) {
    const m = Math.max(0, Math.round(e.focusMinutes || 0));
    // A problems/ratings-only entry (retroactive log) has no minutes — it's not
    // a study session, so it mustn't inflate the session count or the day.
    if (m > 0) {
      totalMinutes += m; sessions += 1;
      byDate.set(e.date, (byDate.get(e.date) || 0) + m);
      byArea.set(e.area || 'Study', (byArea.get(e.area || 'Study') || 0) + m);
    }
    if (Array.isArray(e.leetcode)) {
      for (const p of e.leetcode) lc.push({ ...p, date: e.date });
    }
    // log is sorted oldest→newest, so later ratings overwrite earlier ones — the
    // dashboard reflects your *current* standing on each concept.
    if (Array.isArray(e.concepts)) {
      for (const r of e.concepts) if (r && r.concept) conceptLatest.set(r.concept, { confidence: r.confidence, date: e.date, topic: e.itemTitle || '' });
    }
  }
  const minutesOn = (d) => byDate.get(d) || 0;

  let weekMinutes = 0;
  for (let k = 0; k < 7; k++) weekMinutes += minutesOn(addDaysISO(today, -k));

  // Current streak: consecutive days with study, ending today (or yesterday if
  // you haven't studied yet today, so it isn't "broken" mid-day).
  let streak = 0;
  let cursor = minutesOn(today) > 0 ? today : addDaysISO(today, -1);
  while (minutesOn(cursor) > 0) { streak += 1; cursor = addDaysISO(cursor, -1); }

  // Plan adherence: of past days that had a study plan, how many you followed
  // through on (logged at least one real session).
  const plannedDates = new Set(blocks.filter((b) => b.date <= today).map((b) => b.date));
  let followed = 0;
  for (const d of plannedDates) if (minutesOn(d) > 0) followed += 1;
  const plannedDays = plannedDates.size;
  const adherencePct = plannedDays ? Math.round((followed / plannedDays) * 100) : null;

  const last14 = [];
  for (let k = 13; k >= 0; k--) { const d = addDaysISO(today, -k); last14.push({ date: d, minutes: minutesOn(d) }); }

  // ---- LeetCode roll-ups ----
  // A revisited problem stays in the log (history + daily activity), but counts
  // once toward how many *distinct* problems you've solved — re-grinding Two Sum
  // must never inflate the solved total or the coverage bars. Dedup by slug,
  // keeping the latest entry per problem (lc is oldest→newest) so a re-tag wins.
  const lcKey = (p) => (p.slug || p.url || p.title || '').toString().toLowerCase().trim();
  const lcUniqueMap = new Map();
  for (const p of lc) { const k = lcKey(p); if (k) lcUniqueMap.set(k, p); }
  const lcUniqueList = [...lcUniqueMap.values()];

  // Coverage (by pattern / difficulty) reflects distinct problems, not attempts.
  const lcPattern = new Map(); const lcDiff = new Map();
  for (const p of lcUniqueList) {
    if (p.pattern) lcPattern.set(p.pattern, (lcPattern.get(p.pattern) || 0) + 1);
    if (p.difficulty) lcDiff.set(p.difficulty, (lcDiff.get(p.difficulty) || 0) + 1);
  }
  // Daily activity counts every logged problem — a revisit is still work done.
  const lcDay = new Map();
  for (const p of lc) lcDay.set(p.date, (lcDay.get(p.date) || 0) + 1);
  const lcLast14 = [];
  for (let k = 13; k >= 0; k--) { const d = addDaysISO(today, -k); lcLast14.push({ date: d, count: lcDay.get(d) || 0 }); }
  const lcToday = lcDay.get(today) || 0;
  let lcWeek = 0; for (let k = 0; k < 7; k++) lcWeek += lcDay.get(addDaysISO(today, -k)) || 0;

  // Most recent sessions first, so the effort total is auditable. Only real
  // timed/manual sessions (with minutes) — not problems-only entries.
  const recentSessions = [...log].filter((e) => (e.focusMinutes || 0) > 0).reverse().slice(0, 15).map((e) => ({
    date: e.date,
    area: e.area || 'Study',
    title: e.itemTitle || '',
    minutes: Math.max(0, Math.round(e.focusMinutes || 0)),
    result: e.result || '',
  }));

  return {
    totalMinutes, weekMinutes, todayMinutes: minutesOn(today), sessions,
    streak, studyDays: byDate.size,
    plannedDays, followedThrough: followed, adherencePct,
    last14, recentSessions,
    byArea: [...byArea.entries()].map(([area, minutes]) => ({ area, minutes })).sort((a, b) => b.minutes - a.minutes),
    topicsDone: items.filter((i) => i.status === 'done').length,
    topicsTotal: items.length,
    lcTotal: lc.length,          // every logged attempt (activity — revisits count)
    lcUnique: lcUniqueMap.size,  // distinct problems solved (revisits don't double-count)
    lcGoal: 500,                 // the aggressive FAANG-ready bar; only new problems move it
    lcToday, lcWeek,
    lcByDifficulty: LC_DIFF_ORDER.map((d) => ({ difficulty: d, count: lcDiff.get(d) || 0 })).filter((x) => x.count),
    lcByPattern: [...lcPattern.entries()].map(([pattern, count]) => ({ pattern, count })).sort((a, b) => b.count - a.count),
    lcLast14,
    lcRecent: [...lc].reverse().slice(0, 25),
    conceptsTotal: conceptLatest.size,
    conceptConfidence: (() => {
      const c = { solid: 0, shaky: 0, noyet: 0 };
      for (const v of conceptLatest.values()) if (c[v.confidence] != null) c[v.confidence] += 1;
      return c;
    })(),
    // What to review: everything not yet solid, weakest first.
    conceptsReview: [...conceptLatest.entries()]
      .filter(([, v]) => v.confidence && v.confidence !== 'solid')
      .map(([concept, v]) => ({ concept, confidence: v.confidence, topic: v.topic, date: v.date }))
      .sort((a, b) => (a.confidence === 'noyet' ? 0 : 1) - (b.confidence === 'noyet' ? 0 : 1)),
  };
}
const LC_DIFF_ORDER = ['Easy', 'Medium', 'Hard'];

// ---------- Roadmap: the strategic view of the whole run to the goal ----------
// Ties the plan's phase/week trajectory, the countdown, and everything captured
// (LeetCode solves, concepts, topics, effort) into one "are we on track, and what
// does each week/month/quarter demand?" model. Pure derivation — no new tracking.
export async function computeRoadmap() {
  const [meta, settings, plans, phases, items, stats] = await Promise.all([
    getMeta(), getSettings(), getPlans(), getPhases(), getItems(), computeStats(),
  ]);
  const today = todayISO();
  const goalDate = settings.goalDate || (meta && meta.goalDate) || null;
  const goalLabel = settings.goalLabel || (meta && meta.goalLabel) || 'the goal';
  const target = (meta && meta.target) || '';
  const startDate = (meta && meta.startWeekOf) || today;

  const daysLeft = goalDate ? Math.max(0, daysBetween(today, goalDate)) : null;
  const daysTotal = goalDate ? Math.max(1, daysBetween(startDate, goalDate)) : null;
  const daysElapsed = daysTotal != null ? Math.max(0, Math.min(daysTotal, daysBetween(startDate, today))) : null;
  const pctTime = daysTotal ? Math.min(100, Math.round((daysElapsed / daysTotal) * 100)) : null;
  const weeksLeft = daysLeft != null ? Math.max(0.5, daysLeft / 7) : null;
  const currentWeek = Math.max(1, Math.floor(daysBetween(startDate, today) / 7) + 1);

  // The FAANG plan (has the offer goal); Reading/side plans don't drive the arc.
  const primary = plans.find((p) => /offer|job|fang|faang/i.test(`${p.goal || ''} ${p.id}`)) || plans[0];
  const primaryId = primary ? primary.id : null;

  const weekStartDate = (n) => addDaysISO(startDate, (n - 1) * 7);
  const parseWeeks = (w) => {
    const s = Array.isArray(w) ? (w[0] || '') : String(w || '');
    let m;
    if ((m = s.match(/^(\d+)\s*-\s*(\d+)$/))) return [+m[1], +m[2]];
    if ((m = s.match(/^(\d+)\s*\+$/))) return [+m[1], null];
    if ((m = s.match(/^(\d+)$/))) return [+m[1], +m[1]];
    return [null, null];
  };
  const itemsByPhase = new Map();
  for (const it of items) {
    if (!itemsByPhase.has(it.phase)) itemsByPhase.set(it.phase, []);
    itemsByPhase.get(it.phase).push(it);
  }

  const roadPhases = phases
    .filter((ph) => !primaryId || ph.track === primaryId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((ph) => {
      const [wStart, wEnd] = parseWeeks(ph.weeks);
      const its = itemsByPhase.get(ph.id) || [];
      const total = its.length;
      const done = its.filter((i) => i.status === 'done').length;
      const skipped = its.filter((i) => i.status === 'skipped').length;
      const pct = total ? Math.round(((done + skipped) / total) * 100) : 0;
      let status = 'upcoming';
      if (total && done + skipped >= total) status = 'done';
      else if (wStart && currentWeek >= wStart && (wEnd == null || currentWeek <= wEnd)) status = 'current';
      else if (wEnd != null && currentWeek > wEnd) status = 'behind';
      return {
        id: ph.id, name: ph.name, weekStart: wStart, weekEnd: wEnd,
        startDate: wStart ? weekStartDate(wStart) : startDate,
        endDate: wEnd ? addDaysISO(startDate, wEnd * 7 - 1) : goalDate,
        total, done, skipped, pct, status,
        areas: [...new Set(its.map((i) => i.area).filter(Boolean))],
      };
    });
  const currentPhase = roadPhases.find((p) => p.status === 'current')
    || roadPhases.find((p) => p.status === 'behind')
    || roadPhases.find((p) => p.status !== 'done') || null;

  // Pacing — what the remaining work demands per week to land by the deadline.
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const primaryItems = items.filter((i) => !primaryId || i.track === primaryId);
  const topicsTotal = primaryItems.length;
  const topicsDone = primaryItems.filter((i) => i.status === 'done').length;
  const todo = primaryItems.filter((i) => i.status === 'todo');
  const topicsRemaining = todo.length;
  const remainTopicMin = todo.reduce((s, i) => s + (i.estMinutes || 45), 0);
  const lcRemaining = Math.max(0, stats.lcGoal - stats.lcUnique);
  const remainLCMin = lcRemaining * 18; // ~18 min per problem, ballpark
  const hoursNeeded = weeksLeft ? Math.round(((remainTopicMin + remainLCMin) / weeksLeft / 60) * 10) / 10 : null;
  const hoursActual = Math.round((stats.weekMinutes / 60) * 10) / 10;
  const lcPerWeek = weeksLeft ? Math.ceil(lcRemaining / weeksLeft) : null;
  const topicsPerWeek = weeksLeft ? Math.ceil(topicsRemaining / weeksLeft) : null;

  // On track = progress keeping up with elapsed time (small grace).
  const lcPct = stats.lcGoal ? Math.round((stats.lcUnique / stats.lcGoal) * 100) : 0;
  const topicPct = topicsTotal ? Math.round((topicsDone / topicsTotal) * 100) : 0;
  const expected = pctTime != null ? pctTime : 0;
  const onTrackLC = lcPct >= expected - 8;
  const onTrackTopics = topicPct >= expected - 8;

  const nextTopics = todo
    .filter((i) => depsSatisfied(i, statusById))
    .slice(0, 5)
    .map((i) => ({ id: i.id, title: i.title, area: i.area, group: i.group, est: i.estMinutes }));

  const horizon = (weeks) => ({
    weeks,
    lc: Math.min(lcRemaining, Math.ceil((lcPerWeek || 0) * weeks)),
    topics: Math.min(topicsRemaining, Math.ceil((topicsPerWeek || 0) * weeks)),
    hours: hoursNeeded != null ? Math.round(hoursNeeded * weeks) : null,
    endDate: addDaysISO(today, Math.round(weeks * 7)),
  });

  return {
    goalDate, goalLabel, target, startDate,
    daysLeft, daysTotal, daysElapsed, pctTime,
    weeksLeft: weeksLeft != null ? Math.round(weeksLeft) : null, currentWeek,
    phases: roadPhases, currentPhase,
    onTrack: onTrackLC && onTrackTopics,
    pacing: {
      lc: { done: stats.lcUnique, goal: stats.lcGoal, remaining: lcRemaining, perWeek: lcPerWeek, actualPerWeek: stats.lcWeek, pct: lcPct, onTrack: onTrackLC },
      topics: { done: topicsDone, total: topicsTotal, remaining: topicsRemaining, perWeek: topicsPerWeek, pct: topicPct, onTrack: onTrackTopics },
      concepts: { solid: stats.conceptConfidence.solid, shaky: stats.conceptConfidence.shaky, noyet: stats.conceptConfidence.noyet, total: stats.conceptsTotal },
      hours: { needed: hoursNeeded, actual: hoursActual },
    },
    nextTopics, byArea: stats.byArea, lcByPattern: stats.lcByPattern,
    horizons: { week: horizon(1), month: horizon(4.33), quarter: horizon(13) },
  };
}

// ---------- Plan ingest (import) ----------
// Accepts a parsed plan object matching PLAN_SCHEMA and writes it into the DB,
// replacing existing plan data. Schedule is only replaced if the plan carries
// one AND (replaceSchedule) — otherwise the user's edited schedule is kept.
export async function ingestPlan(plan, { mergeStatus = true } = {}) {
  const meta = plan.meta || {};
  const plans = normalizePlans(plan);

  // Preserve existing statuses so re-importing a fresh plan.json doesn't wipe
  // progress unless the imported item explicitly carries a status. Study notes
  // (authored on desktop) are content, not progress — always kept unless the
  // incoming file has non-empty notes for that item, so syncing your phone's
  // file never clobbers what you wrote on the desktop.
  const existing = await getItems();
  const prevStatus = new Map(existing.map((i) => [i.id, i.status]));
  const prevNotes = new Map(existing.map((i) => [i.id, i.notes]));
  const prevCoach = new Map(existing.map((i) => [i.id, i.coach]));
  const prevObjectives = new Map(existing.map((i) => [i.id, i.doneObjectives]));
  const prevObjList = new Map(existing.map((i) => [i.id, i.objectives]));

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
        // Non-empty incoming notes win; otherwise keep what's already here so a
        // phone import never wipes desktop-authored content.
        const incomingNotes = typeof it.notes === 'string' && it.notes.trim() ? it.notes : '';
        const notes = incomingNotes || prevNotes.get(it.id) || '';
        // Per-topic focus-mode coaching (session plan + resources). Like notes,
        // it's content: incoming wins, else keep what's here so a phone sync
        // never wipes it.
        const incomingCoach = it.coach && typeof it.coach === 'object' ? it.coach : null;
        const coach = incomingCoach || prevCoach.get(it.id) || null;
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
          notes,
          coach,
          // Which session expectations you've met — progress, always preserved.
          doneObjectives: Array.isArray(it.doneObjectives) ? it.doneObjectives : (prevObjectives.get(it.id) || []),
          // A user-set expectation list (from the Day view) is progress-like: keep
          // it unless the incoming file explicitly carries one.
          objectives: Array.isArray(it.objectives) ? it.objectives : prevObjList.get(it.id),
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
  if (Array.isArray(meta.officeDays)) metaSettings.officeDays = meta.officeDays;
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
  // A full backup carries the live focus session so the other device can show
  // "studying now". A plain plan / content patch has no such key — leave the
  // local session untouched then.
  if ('activeSession' in plan) {
    await setActiveSession(plan.activeSession || null);
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
    .map((b) => ({ id: b.id, date: b.date, start: b.start, minutes: b.minutes, label: b.label, drain: b.drain || 'none', transit: !!b.transit }));

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
      notes: it.notes || undefined, // desktop-authored study content
      coach: it.coach || undefined, // per-topic focus-mode coaching
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
    date: b.date, start: b.start, minutes: b.minutes, status: b.status, pinned: !!b.pinned, onCommute: !!b.onCommute,
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
    activeSession: await getActiveSession(), // so another device sees a live session
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
