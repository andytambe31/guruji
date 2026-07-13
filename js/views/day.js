// Day — the adaptive schedule. "Plan my day" opens a short wizard (a few
// grouped steps, Next / Back) covering your rhythm, work + commute, life +
// meals, and focus. The coach then lays study into the free time around it —
// deep work when it predicts you're fresh, gentler work after a draining task,
// the commute turned into transit study. Retime any block by editing its start
// or end time; push the day when you're running late.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS, toast } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, swapBlockItem, putBusy, deleteBusy, retimeBusy, setBusyStatus, getSettings, setSettings,
  clearBusyForDate, deconflictBusy, arrangeCommitments, pushBlock, depsSatisfied, studiedMinutesByBlock, logManualSession, logLeetcodeForBlock, logConceptsForBlock,
  getItem, ensureBlockGoals, toggleBlockGoal, setBlockGoals, computeDayScore, reclaimStaleBlocks, extendBlock,
} from '../store.js';
import { downloadICS } from '../ics.js';
import { openLeetcodeWizard } from './leetcode-wizard.js';
import { openConceptWizard } from './concept-wizard.js';
import { openObjectivesEditor, goalsProgress, sessionBadge, tierLine } from '../objectives.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WHEN = [
  { label: 'This morning', val: 10 * 60 },
  { label: 'Around midday', val: 13 * 60 },
  { label: 'This afternoon', val: 15 * 60 },
  { label: 'This evening', val: 18 * 60 },
  { label: 'Later tonight', val: 20 * 60 },
];
// Gym/walk can be scheduled before work — the coach wakes you early enough.
const WHEN_ACT = [{ label: 'Early — before work', val: 'prework' }, ...WHEN];
const DUR = [
  { label: 'Quick — under 30 min', val: 30 },
  { label: 'About an hour', val: 60 },
  { label: 'A couple of hours', val: 120 },
];
const DRAIN = [
  { label: 'No — it’s a break', val: 'none' },
  { label: 'A little', val: 'low' },
  { label: 'Yeah — I’ll be wiped', val: 'high' },
];
const WAKE = [
  { label: 'Around 7', val: 7 * 60 },
  { label: '8:30', val: 8 * 60 + 30 },
  { label: '9:30', val: 9 * 60 + 30 },
  { label: 'Around 11', val: 11 * 60 },
];
const OFFICE_LEAVE = [
  { label: '7:30', val: 7 * 60 + 30 },
  { label: '8:00', val: 8 * 60 },
  { label: '8:30', val: 8 * 60 + 30 },
  { label: '9:00', val: 9 * 60 },
];
const COMMUTE = [
  { label: '~30 minutes', val: 30 },
  { label: '~45 minutes', val: 45 },
  { label: 'About an hour', val: 60 },
  { label: 'An hour and a half', val: 90 },
];
const OFFICE_BACK = [
  { label: 'Around 5pm', val: 17 * 60 },
  { label: 'Around 6pm', val: 18 * 60 },
  { label: 'Around 7pm', val: 19 * 60 },
  { label: 'Around 8pm', val: 20 * 60 },
];
// Work-from-home hours — no commute, but the workday is still blocked so study
// never lands on top of it.
const WORK_START = [
  { label: '8:00', val: 8 * 60 },
  { label: '9:00', val: 9 * 60 },
  { label: '9:30', val: 9 * 60 + 30 },
  { label: '10:00', val: 10 * 60 },
];
const WORK_END = [
  { label: 'Around 4pm', val: 16 * 60 },
  { label: 'Around 5pm', val: 17 * 60 },
  { label: 'Around 6pm', val: 18 * 60 },
  { label: 'Around 7pm', val: 19 * 60 },
];
const MEALS = [
  { key: 'breakfast', label: 'Breakfast', minutes: 20 },
  { key: 'lunch', label: 'Lunch', start: 13 * 60, minutes: 45 },
  { key: 'dinner', label: 'Dinner', start: 20 * 60, minutes: 60 },
];
// `loadBias` lifts the predicted cognitive load across the whole day: telling the
// coach you're already drained makes every session read lighter (gentler goals,
// more Light badges), not just fewer minutes.
const INTENSITY = [
  { key: 'light', label: 'Light', max: 360, loadBias: 0 },
  { key: 'normal', label: 'Normal', max: 300, loadBias: 0 },
  { key: 'packed', label: 'Packed & draining', max: 150, loadBias: 26 },
];
const STEPS = [
  { key: 'work', title: 'Work & commute' },
  { key: 'rhythm', title: 'Your rhythm' },
  { key: 'life', title: 'Life & meals' },
  { key: 'focus', title: 'Focus' },
];

export async function renderDay(mount, { navigate }) {
  if (!(await hasPlan())) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h1', { text: 'No plan yet.' }),
      el('p', { class: 'muted', text: 'Import your plan from Data, top-right — then the coach can block time for you.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', text: 'Import a plan', onclick: () => navigate('/data') }),
    ]));
    return;
  }

  let date = todayISO();
  let adding = false;
  let pl = null; // the planning wizard state, when active
  let planAreas = []; // study areas available (for the focus step)
  const wrap = el('div', { class: 'day-wrap' });
  mount.append(wrap);
  await paint({ reclaim: true });

  function relLabel(d) {
    const t = todayISO();
    if (d === t) return 'Today';
    if (d === addDaysISO(t, 1)) return 'Tomorrow';
    if (d === addDaysISO(t, -1)) return 'Yesterday';
    const wd = DAYS[new Date(d + 'T00:00:00').getDay()];
    return wd.charAt(0) + wd.slice(1).toLowerCase();
  }
  function dateLabel(d) {
    const x = new Date(d + 'T00:00:00');
    return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
  }
  function dayWord() {
    const t = todayISO();
    return date === t ? 'today' : date === addDaysISO(t, 1) ? 'tomorrow' : `on ${relLabel(date)}`;
  }

  async function paint({ reclaim = false } = {}) {
    // On landing on the day (mount or date change), drop study blocks you couldn't
    // have done — scheduled before you were up, or already fully past today with
    // nothing logged. Only here, not on every internal repaint, so a reflow that
    // momentarily slides a block earlier isn't mistaken for a stale one.
    if (reclaim && !pl) { const reclaimed = await reclaimStaleBlocks(date); if (reclaimed) toast(reclaimed === 1 ? 'Cleared a slot you’d already slept past' : `Cleared ${reclaimed} lapsed slots`); }
    const [blocks, busy, items, settings, studied] = await Promise.all([
      getBlocksForDate(date), getBusyForDate(date), getItems(), getSettings(), studiedMinutesByBlock(),
    ]);
    planAreas = [...new Set(items.map((i) => i.area).filter(Boolean).filter((a) => a !== 'Reading'))];

    // What a block can be swapped for: the next unlocked to-do in each area that
    // isn't already on today's plan — the eligible things worth focusing on.
    const surfaceable = surfaceAreas(items);
    const bookedIds = new Set(blocks.map((b) => b.itemId));
    const swapOptions = surfaceable.filter((o) => !bookedIds.has(o.item.id));
    // A topic's key concepts (for the CS Fundamentals confidence wizard).
    const conceptsByItem = new Map(items.map((i) => [i.id, (i.coach && Array.isArray(i.coach.concepts)) ? i.coach.concepts : []]));
    // Full item behind each block — for its session expectations (view/edit/tick).
    const itemsById = new Map(items.map((i) => [i.id, i]));
    // Each block's own goal set (per-session; built lazily, carried forward).
    const goalsByBlock = new Map(await Promise.all(blocks.map(async (b) => [b.id, await ensureBlockGoals(b.id)])));

    const head = el('div', { class: 'day-head' }, [
      el('button', { class: 'day-nav', text: '‹', 'aria-label': 'Previous day', onclick: async () => { date = addDaysISO(date, -1); adding = false; pl = null; await paint({ reclaim: true }); } }),
      el('div', { class: 'day-title' }, [
        el('div', { class: 'day-rel', text: relLabel(date) }),
        el('div', { class: 'day-date', text: dateLabel(date) }),
      ]),
      el('button', { class: 'day-nav', text: '›', 'aria-label': 'Next day', onclick: async () => { date = addDaysISO(date, 1); adding = false; pl = null; await paint({ reclaim: true }); } }),
    ]);

    if (pl) { fill(clear(wrap), [wizardCard(settings)]); return; }

    const timeline = el('div', { class: 'timeline' });
    // A commute becomes transit study — hide the raw commute row it's covering.
    const covered = (bb) => bb.transit && blocks.some((bl) => bl.onCommute && bl.start < bb.start + bb.minutes && bl.start + bl.minutes > bb.start);
    const busyShown = busy.filter((bb) => !covered(bb));
    const entries = [
      ...blocks.map((b) => ({ t: b.start, end: b.start + b.minutes, kind: 'block', b, node: blockCard(b, studied.get(b.id) || 0, swapOptions, conceptsByItem.get(b.itemId) || [], itemsById.get(b.itemId) || null, goalsByBlock.get(b.id) || []) })),
      ...busyShown.map((b) => ({ t: b.start, end: b.start + b.minutes, kind: 'busy', b, node: busyCard(b) })),
    ].sort((a, b) => a.t - b.t || (a.kind === 'busy' ? -1 : 1));
    if (!entries.length) {
      timeline.append(el('p', { class: 'muted day-empty', text: `Nothing booked for ${relLabel(date).toLowerCase()}. Let the coach plan it around your day.` }));
    } else {
      // A quiet "Up · 7:00am" marker so the day's first move has a clear start —
      // shown when we know your wake time and the day genuinely begins the morning.
      const wakeMin = settings.wake ? toMinutes(settings.wake) : null;
      if (wakeMin != null && entries[0].t <= 12 * 60 && entries[0].t - wakeMin <= 180 && entries[0].t >= wakeMin) {
        timeline.append(el('div', { class: 'wake-row', text: `Up · ${fmtTimeOfDay(wakeMin)}` }));
      }
      for (let i = 0; i < entries.length; i++) {
        timeline.append(entries[i].node);
        const cur = entries[i];
        const nxt = entries[i + 1];
        if (nxt && cur.kind === 'block' && nxt.kind === 'block') {
          const gap = nxt.t - cur.end;
          if (gap >= 8) timeline.append(el('div', { class: 'break-row', text: `· ${gap} min break ·` }));
        }
      }
    }

    // The top of the day: a "how did I do?" score for today / past days (real
    // activity, not the plan's intent); for a future day being planned, keep the
    // one-line mix so you still see what's booked.
    let whyNode = null;
    if (blocks.length) {
      if (date > todayISO()) {
        const why = planWhy(blocks, items, settings);
        whyNode = el('div', { class: 'plan-why' }, [el('div', { class: 'plan-why-mix', text: why.mix })]);
      } else {
        whyNode = scoreCard(await computeDayScore(date));
      }
    }

    const surfaceableAreas = surfaceable;
    const footer = el('div', { class: 'day-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { pl = freshPlan(settings); adding = false; await paint(); } }),
      // Changed a commitment (dropped an event, added the gym)? Re-fit the study
      // around it using the day's existing inputs — no wizard to walk again.
      blocks.length ? el('button', {
        class: 'btn btn-ghost btn-block', style: 'margin-top:9px',
        text: 'Reassess around my commitments',
        title: 'Re-lay your study around the current commitments using this day’s settings — skips the wizard',
        onclick: reassess,
      }) : null,
      el('div', { class: 'day-sub' }, [
        el('button', { class: 'btn-link day-inline', text: adding ? 'Never mind' : '+ Add a block', onclick: async () => { adding = !adding; await paint(); } }),
        (blocks.length || busy.length) ? el('button', { class: 'btn-link day-inline', text: 'Export to Calendar', onclick: () => downloadICS(blocks, `guruji-${date}.ics`, { calName: 'Guruji study' }) }) : null,
      ]),
      adding ? addForm(surfaceableAreas) : null,
    ]);

    fill(clear(wrap), [head, whyNode, timeline, footer]);
  }

  // Re-fit the study around the day's *current* commitments without re-opening
  // the wizard. autoPlanDay reads the live busy blocks (so a dropped or added
  // event is honoured) and keeps done + manually pinned/swapped work; we just
  // replay the day's remembered intensity / focus lean. Weekend is re-derived
  // from the date so reassessing a Saturday still aims high.
  async function reassess() {
    const settings = await getSettings();
    const dow = new Date(date + 'T00:00:00').getDay();
    const weekend = dow === 0 || dow === 6;
    const intensity = INTENSITY.find((i) => i.key === (settings.lastPlanIntensity || 'normal'))
      || INTENSITY.find((i) => i.key === 'normal');
    let maxStudy = intensity ? intensity.max : undefined;
    if (weekend && maxStudy != null) maxStudy = Math.round(maxStudy * 1.6);
    const loadBias = intensity ? (intensity.loadBias || 0) : 0;
    // First tidy the commitments themselves: separate any that now overlap (e.g. a
    // walk you dragged onto dinner) and re-apply the physiological order, then
    // re-fit study around the corrected commitments.
    await deconflictBusy(date);
    await arrangeCommitments(date);
    await autoPlanDay(date, { focusArea: settings.lastPlanFocusArea || null, maxStudyMinutes: maxStudy, weekend, loadBias });
    toast('Re-fit your day around your commitments');
    await paint();
  }

  function freshPlan(settings) {
    // Recurring routine: on a weekday we assume you're working — the whole point
    // is that your 9–5 gets blocked so study never lands on it. Whether that's
    // in-office (with a commute that becomes transit study) or from home is a
    // toggle you can flip; it only changes the commute, never *whether* you work.
    const dow = new Date(date + 'T00:00:00').getDay();
    const weekend = dow === 0 || dow === 6; // no work question on Sat / Sun
    const working = !weekend;
    const place = settings.workPlace || 'home'; // remembered from last plan
    const office = {
      on: working, place,
      leave: settings.officeLeave ?? 510, commute: settings.officeCommute ?? 60, back: settings.officeBack ?? 1080,
      start: settings.workStart ?? 9 * 60, end: settings.workEnd ?? 17 * 60,
    };
    const commuting = working && place === 'office';
    return {
      step: 0,
      weekend,
      wake: commuting ? office.leave - (settings.getReady ?? 30) : (settings.wake ? toMinutes(settings.wake) : null),
      bedtime: settings.bedtime || '23:30',
      getReady: settings.getReady ?? 30,
      office,
      meals: [],
      // Most days you do both, so they default to Yes — toggle off on the odd day
      // you skip. Gym: an evening hour, a break (not draining). Walk: an hour
      // before work, also a break.
      gym: { on: true, when: 18 * 60, dur: 60, drain: 'none' },
      walk: { on: true, when: 'prework', dur: 60, drain: 'none' },
      other: { name: '', when: 16 * 60, dur: 60, drain: 'none' },
      intensity: 'normal',
      focusArea: null,
    };
  }

  // ---------- the planning wizard (grouped steps · Next / Back) ----------
  function wizardCard(settings) {
    const step = pl.step;
    let collect = () => {};

    const sel = (options, current) => el('select', { class: 'wz-select' }, options.map((o) => el('option', { value: String(o.val), text: o.label, selected: String(o.val) === String(current) })));
    const group = (label, ...nodes) => el('div', { class: 'wz-group' }, [el('div', { class: 'wz-glabel', text: label }), ...nodes]);
    const rows = (pairs) => pairs.map(([label, node]) => el('div', { class: 'wz-row' }, [el('span', { class: 'wz-rl', text: label }), node]));
    const chipRow = (options, get, set) => {
      const els = [];
      return el('div', { class: 'wz-chips' }, options.map((o) => {
        const c = el('button', { class: 'wz-chip' + (get() === o.val ? ' on' : ''), text: o.label, onclick: () => { set(o.val); els.forEach((x) => x.classList.remove('on')); c.classList.add('on'); } });
        els.push(c); return c;
      }));
    };
    const seg = (onLabel, offLabel, current, setter) => {
      const a = el('button', { class: 'wz-seg' + (current ? ' on' : ''), text: onLabel });
      const b = el('button', { class: 'wz-seg' + (!current ? ' on' : ''), text: offLabel });
      a.addEventListener('click', () => { setter(true); a.classList.add('on'); b.classList.remove('on'); });
      b.addEventListener('click', () => { setter(false); b.classList.add('on'); a.classList.remove('on'); });
      return el('div', { class: 'wz-seg-wrap' }, [a, b]);
    };
    const activity = (state) => {
      const whenS = sel(WHEN_ACT, state.when);
      const durS = sel(DUR, state.dur);
      const drainS = sel(DRAIN, state.drain);
      // On office days, "Early — before work" tells the coach to wake you sooner
      // and slot this in before the commute, with time to freshen up after.
      const preNote = el('p', { class: 'wz-note' + (state.when === 'prework' ? '' : ' hidden'), text: '' });
      const refreshPreNote = () => {
        const commuting = pl.office.on && pl.office.place === 'office';
        const anchor = commuting ? pl.office.leave : (pl.office.on ? pl.office.start : null);
        if (anchor == null || state.when !== 'prework') { preNote.classList.add('hidden'); return; }
        const up = anchor - (pl.getReady ?? 30) - state.dur;
        preNote.textContent = commuting
          ? `You’re up by ${fmtTimeOfDay(up)} — ${state.dur} min out, back to freshen up, and out the door at ${fmtTimeOfDay(anchor)}.`
          : `You’re up by ${fmtTimeOfDay(up)} — ${state.dur} min out, then freshen up before work at ${fmtTimeOfDay(anchor)}.`;
        preNote.classList.remove('hidden');
      };
      whenS.addEventListener('change', () => { state.when = whenS.value === 'prework' ? 'prework' : +whenS.value; refreshPreNote(); });
      durS.addEventListener('change', () => { state.dur = +durS.value; refreshPreNote(); });
      refreshPreNote();
      const detail = el('div', { class: 'wz-detail' + (state.on ? '' : ' hidden') }, [...rows([['When', whenS], ['How long', durS], ['Draining?', drainS]]), preNote]);
      return { seg: seg('Yes', 'No', state.on, (on) => { state.on = on; detail.classList.toggle('hidden', !on); }), detail, collect: () => { state.when = whenS.value === 'prework' ? 'prework' : +whenS.value; state.dur = +durS.value; state.drain = drainS.value; } };
    };

    function stepRhythm() {
      const bed = el('input', { type: 'time', class: 'wz-time', value: pl.bedtime || '23:30' });
      collect = () => { pl.bedtime = bed.value || pl.bedtime; };
      const nodes = [];
      if (pl.office.on && pl.office.place === 'office') {
        // Wake is fixed by the commute — up in time to get ready and leave.
        const up = pl.office.leave - (pl.getReady ?? 30);
        pl.wake = up;
        nodes.push(group('Morning', el('p', { class: 'wz-note', text: `You’re up around ${fmtTimeOfDay(up)} to make your ${fmtTimeOfDay(pl.office.leave)} commute — so no pre-work study; the day starts on the train.` })));
      } else {
        nodes.push(group('When are you up?', chipRow(WAKE, () => pl.wake, (v) => { pl.wake = v; })));
      }
      nodes.push(group('Turning in by', el('div', { class: 'wz-inline' }, [bed])));
      return el('div', { class: 'wz-body' }, nodes);
    }
    function stepWork() {
      const leave = sel(OFFICE_LEAVE, pl.office.leave);
      const commute = sel(COMMUTE, pl.office.commute);
      const back = sel(OFFICE_BACK, pl.office.back);
      const startS = sel(WORK_START, pl.office.start);
      const endS = sel(WORK_END, pl.office.end);

      // In-office timing (commute) vs from-home timing (plain work hours).
      const officeRows = el('div', { class: 'wz-detail' + (pl.office.place === 'office' ? '' : ' hidden') },
        rows([['Leave', leave], ['Commute each way', commute], ['Back home', back]]));
      const homeRows = el('div', { class: 'wz-detail' + (pl.office.place === 'home' ? '' : ' hidden') },
        rows([['Start work', startS], ['Finish', endS]]));
      const placeSeg = seg('In office', 'From home', pl.office.place === 'office', (isOffice) => {
        pl.office.place = isOffice ? 'office' : 'home';
        officeRows.classList.toggle('hidden', !isOffice);
        homeRows.classList.toggle('hidden', isOffice);
      });

      const detail = el('div', { class: 'wz-detail' + (pl.office.on ? '' : ' hidden') }, [
        group('Where?', placeSeg),
        officeRows,
        homeRows,
        el('p', { class: 'wz-note', text: 'Your work hours get blocked either way, so study routes around them. In-office, the commute becomes transit study.' }),
      ]);
      collect = () => {
        pl.office.leave = +leave.value; pl.office.commute = +commute.value; pl.office.back = +back.value;
        pl.office.start = +startS.value; pl.office.end = +endS.value;
      };
      return el('div', { class: 'wz-body' }, [
        group(`Working ${dayWord()}?`, seg('Yes', 'No', pl.office.on, (on) => { pl.office.on = on; detail.classList.toggle('hidden', !on); }), detail),
      ]);
    }
    function stepLife() {
      const mealChips = el('div', { class: 'wz-chips' }, MEALS.map((m) =>
        el('button', { class: 'wz-chip' + (pl.meals.includes(m.key) ? ' on' : ''), text: m.label, onclick: (e) => { const i = pl.meals.indexOf(m.key); if (i >= 0) pl.meals.splice(i, 1); else pl.meals.push(m.key); e.currentTarget.classList.toggle('on'); } })));
      const gym = activity(pl.gym);
      const walk = activity(pl.walk);
      const oName = el('input', { type: 'text', class: 'wz-input', placeholder: 'e.g. an errand, a call', value: pl.other.name });
      const oWhen = sel(WHEN, pl.other.when); const oDur = sel(DUR, pl.other.dur); const oDrain = sel(DRAIN, pl.other.drain);
      collect = () => { gym.collect(); walk.collect(); pl.other.name = oName.value.trim(); pl.other.when = +oWhen.value; pl.other.dur = +oDur.value; pl.other.drain = oDrain.value; };
      return el('div', { class: 'wz-body' }, [
        group('Meals to set time aside for', mealChips),
        group('Gym', gym.seg, gym.detail),
        group('Walk', walk.seg, walk.detail),
        group('Anything else', oName, el('div', { class: 'wz-detail' }, rows([['When', oWhen], ['How long', oDur], ['Draining?', oDrain]]))),
      ]);
    }
    function stepFocus() {
      collect = () => {};
      return el('div', { class: 'wz-body' }, [
        group('How heavy is your day?', chipRow(INTENSITY.map((i) => ({ label: i.label, val: i.key })), () => pl.intensity, (v) => { pl.intensity = v; })),
        group('Where’s your head?', chipRow([{ label: 'You take charge', val: null }, ...planAreas.slice(0, 3).map((a) => ({ label: `Lean into ${a}`, val: a }))], () => pl.focusArea, (v) => { pl.focusArea = v; })),
      ]);
    }

    // Weekends have no office/commute, so drop the Work step entirely.
    const steps = pl.weekend ? STEPS.filter((s) => s.key !== 'work') : STEPS;
    const builders = { work: stepWork, rhythm: stepRhythm, life: stepLife, focus: stepFocus };
    const last = steps.length - 1;
    const body = builders[steps[step].key]();

    const dots = el('div', { class: 'wz-dots' }, steps.map((_, i) => el('span', { class: 'wz-dot' + (i === step ? ' on' : i < step ? ' done' : '') })));
    const nav = el('div', { class: 'wz-nav' }, [
      step > 0
        ? el('button', { class: 'q-back', text: '← Back', onclick: async () => { collect(); pl.step -= 1; await paint(); } })
        : el('button', { class: 'q-cancel', text: 'Cancel', onclick: async () => { pl = null; await paint(); } }),
      el('button', { class: 'btn btn-primary wz-next', text: step === last ? 'Plan my day' : 'Next →', onclick: async () => { collect(); if (step === last) await commit(); else { pl.step += 1; await paint(); } } }),
    ]);

    return el('div', { class: 'wizard' }, [
      el('div', { class: 'wz-top' }, [
        el('div', { class: 'wz-step', text: `Step ${step + 1} of ${steps.length}` }),
        el('h2', { class: 'wz-h', text: steps[step].title }),
      ]),
      body, dots, nav,
    ]);

    async function commit() {
      const o = pl.office;
      const commuting = o.on && o.place === 'office'; // work with a commute (transit study)
      // Pre-work activities (a morning walk / gym before work): the coach
      // backward-plans them from when work starts — activity, then freshen up,
      // then work — and wakes you early enough. Anchor is the commute departure
      // if you're going in, your work start if you're home, else your wake time.
      const acts = [
        pl.gym.on ? { label: 'Gym', ...pl.gym } : null,
        pl.walk.on ? { label: 'Walk', ...pl.walk } : null,
      ].filter(Boolean);
      const prework = acts.filter((a) => a.when === 'prework');
      const preTotal = prework.reduce((s, a) => s + a.dur, 0);
      const getReady = pl.getReady ?? 30;
      // Where the pre-work stretch has to begin so you're ready to start.
      const anchor = commuting ? o.leave : (o.on ? o.start : (pl.wake != null ? pl.wake : 8 * 60));
      const preStart = o.on ? Math.max(0, anchor - getReady - preTotal) : anchor;
      if (prework.length && o.on) pl.wake = preStart; // up in time to actually do it

      await setSettings({ bedtime: pl.bedtime || settings.bedtime, ...(pl.wake != null ? { wake: minutesToHHMM(pl.wake) } : {}) });
      await clearBusyForDate(date); // re-plan replaces the day's commitments

      // Lay the pre-work activities back-to-back before the anchor.
      let cur = preStart;
      for (const a of prework) {
        await putBusy({ date, start: cur, minutes: a.dur, label: a.label, drain: a.drain });
        cur += a.dur;
      }
      // The gap from a pre-work activity to when work begins is freshen-up time —
      // a real block so the coach won't book study into that sliver, and you can
      // see exactly what happens when: activity, freshen up, then work. Office day
      // fills up to the door (o.leave); a work-from-home day fills up to work
      // start (o.start). Breakfast, if chosen, already fills the window.
      if (prework.length && o.on && !pl.meals.includes('breakfast')) {
        const workAnchor = commuting ? o.leave : o.start;
        if (workAnchor - cur >= 10) await putBusy({ date, start: cur, minutes: workAnchor - cur, label: 'Freshen up' });
      }

      if (o.on) {
        // Working today — block the workday so study never lands on it. The only
        // difference between office and home is the commute (which becomes transit
        // study); either way the hours themselves are reserved.
        await setSettings({ workPlace: o.place });
        if (o.place === 'office') {
          await setSettings({ officeLeave: o.leave, officeCommute: o.commute, officeBack: o.back });
          await putBusy({ date, start: o.leave, minutes: o.commute, label: 'Commute', transit: true });
          const workStart = o.leave + o.commute;
          const workEnd = Math.max(workStart + 30, o.back - o.commute);
          await putBusy({ date, start: workStart, minutes: workEnd - workStart, label: 'Office', drain: 'high' });
          await putBusy({ date, start: o.back - o.commute, minutes: o.commute, label: 'Commute', transit: true });
        } else {
          // Work from home: no commute, but the 9–5 is still reserved and still
          // draining, so the coach eases study to the evening.
          await setSettings({ workStart: o.start, workEnd: o.end });
          const wEnd = Math.max(o.start + 30, o.end);
          await putBusy({ date, start: o.start, minutes: wEnd - o.start, label: 'Work', drain: 'high' });
        }
      }
      const wakeMin = pl.wake != null ? pl.wake : 8 * 60;
      for (const key of pl.meals) {
        const m = MEALS.find((x) => x.key === key);
        if (!m) continue;
        if (key === 'lunch' && commuting) continue; // eaten at the office (WFH eats at home)
        let start = m.start;
        if (key === 'breakfast') {
          // In-office day: eaten in the freshen-up window, right before leaving.
          // Otherwise (home or off): shortly after you're up, after any activity.
          start = commuting ? o.leave - m.minutes : wakeMin + preTotal + 15;
        }
        await putBusy({ date, start, minutes: m.minutes, label: m.label });
      }
      // Non-pre-work activities keep their chosen time.
      for (const a of acts.filter((x) => x.when !== 'prework')) {
        await putBusy({ date, start: a.when, minutes: a.dur, label: a.label, drain: a.drain });
      }
      if (pl.other.name) await putBusy({ date, start: pl.other.when, minutes: pl.other.dur, label: pl.other.name, drain: pl.other.drain });
      await deconflictBusy(date); // no two commitments at once
      await arrangeCommitments(date); // gym before a walk, off a full stomach, before the physical curfew
      const intensity = INTENSITY.find((i) => i.key === pl.intensity);
      // On a free weekend, aim to get much more study in — a longer total and
      // several sessions per area.
      let maxStudy = intensity ? intensity.max : undefined;
      if (pl.weekend && maxStudy != null) maxStudy = Math.round(maxStudy * 1.6);
      const loadBias = intensity ? (intensity.loadBias || 0) : 0;
      // Remember the day's inputs so "Reassess" can re-fit study around edited
      // commitments later without walking the wizard again.
      await setSettings({ lastPlanIntensity: pl.intensity, lastPlanFocusArea: pl.focusArea || null });
      await autoPlanDay(date, { focusArea: pl.focusArea, maxStudyMinutes: maxStudy, weekend: pl.weekend, loadBias });
      pl = null;
      await paint();
    }
  }

  function blockCard(b, studied = 0, swapOptions = [], concepts = [], item = null, goals = []) {
    const done = b.status === 'done';
    const canSwap = !done && swapOptions.length > 0;
    // This session's own goals — a tap opens the panel to tick what you met
    // (retroactively too), or edit them. Per-session: independent of other blocks.
    const objProg = goalsProgress(goals);
    // How demanding this session is — length + how spent you'll be at its time.
    const badge = sessionBadge(b.minutes, b.load);
    const openGoals = () => openObjectivesEditor({
      goals, title: item ? item.title : b.area, note: tierLine(b.minutes, b.load),
      // Tapping a row logs that you met it in THIS session — persists now.
      onToggle: (text) => toggleBlockGoal(b.id, text),
      onSave: async (list, doneList) => { await setBlockGoals(b.id, list.map((t) => ({ text: t, met: doneList.includes(t) }))); toast('Goals saved'); },
      onClose: async () => { await paint(); },
    });

    // The action row swaps to a "push by" preset picker when you tap Delay, or a
    // "swap for" eligible-focus picker when you tap Swap.
    const acts = el('div', { class: 'blk-acts' });
    const normalActs = () => [
      // A commute/transit block can't do deep work on mobile — it launches the
      // Nuggets deck (relevant bite-sized study) instead of the timer.
      done ? null : el('button', { class: 'blk-start', text: b.onCommute ? 'Nuggets' : 'Start', onclick: () => navigate(b.onCommute ? `/nuggets/${encodeURIComponent(b.area || '')}` : `/prep/${b.itemId}/${b.id}`) }),
      el('button', { class: 'blk-act', text: 'Log', title: 'Studied without the timer? Log the time you put in', onclick: () => fill(clear(acts), logActs()) }),
      b.area === 'DSA' ? el('button', { class: 'blk-act', text: 'Problems', title: 'Log the LeetCode problems you did in this session', onclick: () => openLeetcodeWizard({ onSave: async (e) => { if (e.length) { await logLeetcodeForBlock(b, e); toast(`Logged ${e.length} problem${e.length > 1 ? 's' : ''}`); await paint(); } } }) }) : null,
      (b.area === 'CS Fundamentals' && concepts.length) ? el('button', { class: 'blk-act', text: 'Concepts', title: 'Rate your confidence on this topic’s key concepts', onclick: () => openConceptWizard({ concepts, onSave: async (r) => { if (r.length) { await logConceptsForBlock(b, r); toast(`Rated ${r.length} concept${r.length > 1 ? 's' : ''}`); await paint(); } } }) }) : null,
      canSwap ? el('button', { class: 'blk-act', text: 'Swap', title: 'Not feeling it? Replace with another eligible focus, same time slot', onclick: () => fill(clear(acts), swapActs()) }) : null,
      done ? null : el('button', { class: 'blk-act', text: 'Delay', title: 'Running late — push the rest of the day', onclick: () => fill(clear(acts), delayActs()) }),
      (!done && extendOpts.length) ? el('button', { class: 'blk-act', text: 'Extend', title: 'Got the time and the focus? Make it a longer, deeper session — the goals scale up to match', onclick: () => fill(clear(acts), extendActs()) }) : null,
      el('button', { class: 'blk-act', text: done ? 'Undo' : 'Done', onclick: async () => { await setBlockStatus(b.id, done ? 'planned' : 'done'); await paint(); } }),
      item ? el('button', { class: 'blk-act blk-goals', title: 'View, tick, add or reword this session’s expectations', onclick: openGoals }, [
        'Goals', objProg.total ? el('span', { class: 'blk-goals-n', text: ` ${objProg.done}/${objProg.total}` }) : null,
      ]) : null,
      done ? null : el('button', { class: 'blk-act', text: 'Move', onclick: async () => { await moveBlockToDate(b.id, addDaysISO(b.date, 1)); await paint(); } }),
      el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await deleteBlock(b.id); await paint(); } }),
    ];
    const delayActs = () => [
      el('span', { class: 'blk-delay-k', text: 'Push by' }),
      ...[10, 15, 30].map((n) => el('button', { class: 'blk-act blk-delay', text: `${n}m`, onclick: async () => { await pushBlock(b.id, n); await paint(); } })),
      el('button', { class: 'blk-act', text: 'Cancel', onclick: () => fill(clear(acts), normalActs()) }),
    ];
    // Extend to a longer, deeper sitting — offer the standard lengths beyond the
    // current one. Grows the block, restructures its goals up a tier, and slides
    // the rest of the day to make room.
    const durLabel = (m) => (m % 60 === 0 ? `${m / 60}h` : m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`);
    const extendOpts = [45, 60, 90, 120].filter((m) => m > b.minutes);
    const extendActs = () => [
      el('span', { class: 'blk-delay-k', text: 'Extend to' }),
      ...extendOpts.map((n) => el('button', { class: 'blk-act blk-delay', text: durLabel(n), onclick: async () => { await extendBlock(b.id, n); toast(`Extended to ${durLabel(n)} — goals scaled up`); await paint(); } })),
      el('button', { class: 'blk-act', text: 'Cancel', onclick: () => fill(clear(acts), normalActs()) }),
    ];
    // Manually log off-timer study time against this block. Defaults to what's
    // still unstudied of the reserved time; adds to any minutes already logged.
    const logActs = () => {
      const remain = b.minutes - studied;
      const minInput = el('input', { type: 'number', class: 'blk-log-min', min: '1', step: '5', inputmode: 'numeric', value: String(remain > 0 ? remain : b.minutes) });
      const save = async () => {
        const m = parseInt(minInput.value, 10);
        if (m > 0) { await logManualSession(b, m); toast(`Logged ${m} min`); }
        await paint();
      };
      minInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      return [
        el('span', { class: 'blk-delay-k', text: 'Studied' }),
        minInput,
        el('span', { class: 'blk-log-unit', text: 'min' }),
        el('button', { class: 'blk-act blk-delay', text: 'Save', onclick: save }),
        el('button', { class: 'blk-act', text: 'Cancel', onclick: () => fill(clear(acts), normalActs()) }),
      ];
    };
    // Replace this slot with another eligible focus (keeps the time; just changes
    // what it's for). Each option is the next unlocked topic in that area.
    const swapActs = () => [
      el('span', { class: 'blk-delay-k', text: 'Swap for' }),
      ...swapOptions.map((o) => el('button', {
        class: 'blk-act blk-swap', text: o.area, title: o.item.title,
        onclick: async () => { await swapBlockItem(b.id, o.item.id); toast(`Now: ${o.area}`); await paint(); },
      })),
      el('button', { class: 'blk-act', text: 'Cancel', onclick: () => fill(clear(acts), normalActs()) }),
    ];
    fill(acts, normalActs());

    // Reserved vs actually studied. Once any focus time is attributed to this
    // block, show "25 / 150 min" so a block you only sat with briefly reads
    // honestly instead of implying the whole reservation was studied.
    const durNode = studied > 0
      ? el('div', { class: 'blk-dur has-studied', title: `${studied} min studied of ${b.minutes} reserved` }, [
          el('span', { class: 'blk-studied', text: `${studied}` }),
          ` / ${b.minutes} min`,
        ])
      : el('div', { class: 'blk-dur', text: `${b.minutes} min` });

    return el('div', { class: `blk m-${b.mode || ''}` + (done ? ' done' : ''), dataset: { id: b.id, planned: done ? '0' : '1' } }, [
      el('div', { class: 'blk-body' }, [
        el('div', { class: 'blk-head' }, [
          el('div', { class: 'blk-arearow' }, [
            el('span', { class: 'blk-area', text: b.area }),
            b.onCommute ? el('span', { class: 'blk-commute', text: 'on the commute' }) : null,
            badge ? el('span', { class: `blk-badge b-${badge.cls}`, text: badge.label }) : null,
          ]),
          durNode,
        ]),
        el('div', { class: 'blk-when' }, [
          el('input', {
            type: 'time', class: 'blk-time', value: minutesToHHMM(b.start), disabled: done,
            title: 'Start time',
            // Commit on blur (when the picker is dismissed), not on every wheel
            // tick — iOS fires change mid-scroll, which would save + re-render
            // before you're done. Skip when the value hasn't actually moved.
            onblur: async (e) => { const v = e.target.value; if (!v) return; const m = toMinutes(v); if (m !== b.start) { await retimeBlock(b.id, m); await paint(); } },
          }),
          el('span', { class: 'blk-dash', text: '–' }),
          el('input', {
            type: 'time', class: 'blk-time blk-time-end', value: minutesToHHMM(b.start + b.minutes), disabled: done,
            title: 'End time',
            onblur: async (e) => { const v = e.target.value; if (!v) return; const endM = toMinutes(v); if (endM > b.start && endM !== b.start + b.minutes) { await retimeBlock(b.id, b.start, endM - b.start); await paint(); } },
          }),
        ]),
        acts,
      ]),
    ]);
  }

  function busyCard(b) {
    const done = b.status === 'done';
    return el('div', { class: 'busy' + (done ? ' done' : ''), dataset: { id: b.id } }, [
      el('div', { class: 'busy-times' }, [
        el('input', {
          type: 'time', class: 'busy-time-in', value: minutesToHHMM(b.start), title: 'Start time', disabled: done,
          // Commit on blur, not mid-scroll (see the study-block time inputs).
          onblur: async (e) => { const v = e.target.value; if (!v) return; const m = toMinutes(v); if (m !== b.start) { await retimeBusy(b.id, m, b.minutes); await paint(); } },
        }),
        el('span', { class: 'busy-dash', text: '–' }),
        el('input', {
          type: 'time', class: 'busy-time-in', value: minutesToHHMM(b.start + b.minutes), title: 'End time', disabled: done,
          onblur: async (e) => { const v = e.target.value; if (!v) return; const endM = toMinutes(v); if (endM > b.start && endM !== b.start + b.minutes) { await retimeBusy(b.id, b.start, endM - b.start); await paint(); } },
        }),
      ]),
      el('span', { class: 'busy-label', text: b.label }),
      b.drain && b.drain !== 'none' ? el('span', { class: 'busy-drain', text: 'draining' }) : null,
      el('div', { class: 'busy-acts' }, [
        // Tick off a done commitment — reassessing then reclaims its time.
        el('button', {
          class: 'blk-act busy-done' + (done ? ' on' : ''),
          text: done ? 'Undo' : 'Done',
          title: done ? 'Not done after all' : 'Mark done — frees this time for study when you reassess',
          onclick: async () => { await setBusyStatus(b.id, done ? 'planned' : 'done'); await paint(); },
        }),
        el('button', { class: 'blk-act blk-x busy-x', text: 'Remove', onclick: async () => { await deleteBusy(b.id); await paint(); } }),
      ]),
    ]);
  }

  function addForm(areas) {
    if (!areas.length) return el('p', { class: 'muted day-empty', text: 'Nothing is unlocked to block right now.' });
    const nowMin = date === todayISO() ? Math.ceil((new Date().getHours() * 60 + new Date().getMinutes() + 5) / 15) * 15 : 9 * 60;
    const timeInput = el('input', { type: 'time', class: 'blk-time', value: minutesToHHMM(Math.min(nowMin, 23 * 60 + 45)) });
    return el('div', { class: 'add-form' }, [
      el('div', { class: 'add-label', text: 'Block time for' }),
      el('div', { class: 'areas' }, areas.map(({ area, item }) =>
        el('button', {
          class: 'ctx-chip', text: area,
          onclick: async () => { await blockItem(item.id, date, toMinutes(timeInput.value || '09:00')); adding = false; await paint(); },
        }))),
      el('div', { class: 'add-at' }, [el('span', { class: 'muted', text: 'at' }), timeInput]),
    ]);
  }
}

// "How did I do?" — the day's real activity as one score, with per-part chips and
// the single worst gap flagged. Replaces the plan-intent card on today/past days.
function scoreCard(s) {
  const chips = s.components.filter((c) => c.relevant).map((c) =>
    el('span', { class: 'ds-chip' + (c.ratio >= 0.999 ? ' full' : c.ratio <= 0.15 ? ' empty' : '') }, [
      el('span', { class: 'ds-chip-l', text: c.label }),
      el('span', { class: 'ds-chip-v', text: c.detail + (c.over ? ' ↑' : '') }),
    ]));
  return el('div', { class: `day-score t-${s.tone}` }, [
    el('div', { class: 'day-score-top' }, [
      el('div', { class: 'day-score-num', text: `${s.score}` }),
      el('div', { class: 'day-score-head' }, [
        el('div', { class: 'day-score-verdict', text: s.verdict }),
        el('div', { class: 'day-score-sub', text: s.isToday ? 'how today’s going' : 'how the day went' }),
      ]),
    ]),
    el('div', { class: 'day-score-chips' }, chips),
    s.lowlight ? el('div', { class: 'day-score-low' }, [
      el('span', { class: 'ds-warn', text: '!' }),
      el('span', { text: s.lowlight.msg }),
    ]) : null,
  ]);
}

// Explain the day the coach built — the area mix, the ordering principle, and,
// when one area carries the day or another is missing, why. Answers "what are
// we focusing on / how does the coach work?" without making you dig.
function planWhy(blocks, items) {
  const study = blocks.filter((b) => b.area).slice().sort((a, b) => a.start - b.start);
  if (!study.length) return null;

  const order = [];
  const cnt = new Map();
  for (const b of study) { if (!cnt.has(b.area)) order.push(b.area); cnt.set(b.area, (cnt.get(b.area) || 0) + 1); }
  const total = study.length;
  // Lead with the total study time so the day's commitment is legible at a glance.
  const totalMin = study.reduce((s, b) => s + b.minutes, 0);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const dur = h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  const mix = [`${dur} of study`, ...order.map((a) => `${cnt.get(a)}× ${a}`)].join(' · ');

  // Areas with unfinished work but nothing unlocked yet — gated behind topics
  // you haven't marked done, so the coach can't schedule them.
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const scheduled = new Set(order);
  const todoAreas = new Set();
  const surfAreas = new Set();
  for (const it of items) {
    if (it.status !== 'todo') continue;
    const a = it.area || 'Study';
    todoAreas.add(a);
    if (depsSatisfied(it, statusById)) surfAreas.add(a);
  }
  const locked = [...todoAreas].filter((a) => a !== 'Reading' && !scheduled.has(a) && !surfAreas.has(a));

  const parts = ['Hardest work while you’re freshest, easing off as the day fills.'];
  const top = order[0];
  if (order.length === 1) {
    parts.push(`It’s all ${top} because that’s the only area with topics unlocked right now — mark topics done in Plan to open the next ones.`);
  } else if (cnt.get(top) / total >= 0.5) {
    parts.push(`${top} carries the day — it has the most topics unlocked and ready. Want a different balance? Use “Where’s your head?” when you plan.`);
  }
  if (locked.length) parts.push(`${locked.join(' & ')} is waiting on earlier topics — finish those in Plan to unlock it.`);
  return { mix, note: parts.join(' ') };
}

// One surfaceable next item per area (deps satisfied), in plan order.
function surfaceAreas(items) {
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const out = [];
  const seen = new Set();
  for (const it of items) {
    if (it.status !== 'todo') continue;
    if (!depsSatisfied(it, statusById)) continue;
    const area = it.area || 'Study';
    if (seen.has(area)) continue;
    seen.add(area);
    out.push({ area, item: it });
  }
  return out;
}
