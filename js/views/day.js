// Day — the adaptive schedule. "Plan my day" opens a short wizard (a few
// grouped steps, Next / Back) covering your rhythm, work + commute, life +
// meals, and focus. The coach then lays study into the free time around it —
// deep work when it predicts you're fresh, gentler work after a draining task,
// the commute turned into transit study. Retime any block by editing its start
// or end time; push the day when you're running late.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS, toast } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, swapBlockItem, putBusy, deleteBusy, retimeBusy, getSettings, setSettings,
  clearBusyForDate, deconflictBusy, pushBlock, depsSatisfied, studiedMinutesByBlock,
} from '../store.js';
import { downloadICS } from '../ics.js';

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
const MEALS = [
  { key: 'breakfast', label: 'Breakfast', minutes: 20 },
  { key: 'lunch', label: 'Lunch', start: 13 * 60, minutes: 45 },
  { key: 'dinner', label: 'Dinner', start: 20 * 60, minutes: 60 },
];
const INTENSITY = [
  { key: 'light', label: 'Light', max: 360 },
  { key: 'normal', label: 'Normal', max: 300 },
  { key: 'packed', label: 'Packed & draining', max: 150 },
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
  await paint();

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

  async function paint() {
    const [blocks, busy, items, settings, studied] = await Promise.all([
      getBlocksForDate(date), getBusyForDate(date), getItems(), getSettings(), studiedMinutesByBlock(),
    ]);
    planAreas = [...new Set(items.map((i) => i.area).filter(Boolean).filter((a) => a !== 'Reading'))];

    // What a block can be swapped for: the next unlocked to-do in each area that
    // isn't already on today's plan — the eligible things worth focusing on.
    const surfaceable = surfaceAreas(items);
    const bookedIds = new Set(blocks.map((b) => b.itemId));
    const swapOptions = surfaceable.filter((o) => !bookedIds.has(o.item.id));

    const head = el('div', { class: 'day-head' }, [
      el('button', { class: 'day-nav', text: '‹', 'aria-label': 'Previous day', onclick: async () => { date = addDaysISO(date, -1); adding = false; pl = null; await paint(); } }),
      el('div', { class: 'day-title' }, [
        el('div', { class: 'day-rel', text: relLabel(date) }),
        el('div', { class: 'day-date', text: dateLabel(date) }),
      ]),
      el('button', { class: 'day-nav', text: '›', 'aria-label': 'Next day', onclick: async () => { date = addDaysISO(date, 1); adding = false; pl = null; await paint(); } }),
    ]);

    if (pl) { fill(clear(wrap), [wizardCard(settings)]); return; }

    const timeline = el('div', { class: 'timeline' });
    // A commute becomes transit study — hide the raw commute row it's covering.
    const covered = (bb) => bb.transit && blocks.some((bl) => bl.onCommute && bl.start < bb.start + bb.minutes && bl.start + bl.minutes > bb.start);
    const busyShown = busy.filter((bb) => !covered(bb));
    const entries = [
      ...blocks.map((b) => ({ t: b.start, end: b.start + b.minutes, kind: 'block', b, node: blockCard(b, studied.get(b.id) || 0, swapOptions) })),
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

    const why = blocks.length ? planWhy(blocks, items, settings) : null;
    const whyNode = why ? el('div', { class: 'plan-why' }, [
      el('div', { class: 'plan-why-mix', text: why.mix }),
      el('div', { class: 'plan-why-note', text: why.note }),
    ]) : null;

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
    await autoPlanDay(date, { focusArea: settings.lastPlanFocusArea || null, maxStudyMinutes: maxStudy, weekend });
    toast('Re-fit your study around the day');
    await paint();
  }

  function freshPlan(settings) {
    // Recurring routine: pre-fill office for your usual office weekdays, with
    // your usual timing. You can still flip it either way in the wizard.
    const dow = new Date(date + 'T00:00:00').getDay();
    const weekend = dow === 0 || dow === 6; // no work question on Sat / Sun
    const isOffice = !weekend && (settings.officeDays || [2, 3, 4]).includes(dow);
    const office = { on: isOffice, leave: settings.officeLeave ?? 510, commute: settings.officeCommute ?? 60, back: settings.officeBack ?? 1080 };
    return {
      step: 0,
      weekend,
      wake: isOffice ? office.leave - (settings.getReady ?? 30) : (settings.wake ? toMinutes(settings.wake) : null),
      bedtime: settings.bedtime || '23:30',
      getReady: settings.getReady ?? 30,
      office,
      meals: [],
      gym: { on: false, when: 18 * 60, dur: 60, drain: 'none' },
      walk: { on: false, when: 17 * 60, dur: 30, drain: 'none' },
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
        if (!pl.office.on || state.when !== 'prework') { preNote.classList.add('hidden'); return; }
        const up = pl.office.leave - (pl.getReady ?? 30) - state.dur;
        preNote.textContent = `You’re up by ${fmtTimeOfDay(up)} — ${state.dur} min out, back to freshen up, and out the door at ${fmtTimeOfDay(pl.office.leave)}.`;
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
      if (pl.office.on) {
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
      const detail = el('div', { class: 'wz-detail' + (pl.office.on ? '' : ' hidden') }, [
        ...rows([['Leave', leave], ['Commute each way', commute], ['Back home', back]]),
        el('p', { class: 'wz-note', text: 'Work hours get blocked; the commute becomes transit study.' }),
      ]);
      collect = () => { pl.office.leave = +leave.value; pl.office.commute = +commute.value; pl.office.back = +back.value; };
      return el('div', { class: 'wz-body' }, [
        group(`Going into the office ${dayWord()}?`, seg('In-office', 'Home', pl.office.on, (on) => { pl.office.on = on; detail.classList.toggle('hidden', !on); }), detail),
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
      // Pre-work activities (a morning walk / gym before the office): the coach
      // backward-plans them from your departure — activity, then freshen up, then
      // out the door — and wakes you early enough. Anchor point is the commute if
      // you're going in, else your first activity kicks off around your wake.
      const acts = [
        pl.gym.on ? { label: 'Gym', ...pl.gym } : null,
        pl.walk.on ? { label: 'Walk', ...pl.walk } : null,
      ].filter(Boolean);
      const prework = acts.filter((a) => a.when === 'prework');
      const preTotal = prework.reduce((s, a) => s + a.dur, 0);
      const getReady = pl.getReady ?? 30;
      // Where the pre-work stretch has to begin so you're ready to leave / start.
      const anchor = o.on ? o.leave : (pl.wake != null ? pl.wake : 8 * 60);
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
      // On an office day, the gap from the activity to the door is freshen-up
      // time — a real block so the coach won't book study there and you can see
      // exactly what happens when: activity, freshen up, out the door. If you're
      // also eating breakfast it already fills that window, so skip the duplicate.
      if (prework.length && o.on && !pl.meals.includes('breakfast') && o.leave - cur >= 10) {
        await putBusy({ date, start: cur, minutes: o.leave - cur, label: 'Freshen up' });
      }

      if (o.on) {
        // Remember this as the usual office timing for next time.
        await setSettings({ officeLeave: o.leave, officeCommute: o.commute, officeBack: o.back });
        await putBusy({ date, start: o.leave, minutes: o.commute, label: 'Commute', transit: true });
        const workStart = o.leave + o.commute;
        const workEnd = Math.max(workStart + 30, o.back - o.commute);
        await putBusy({ date, start: workStart, minutes: workEnd - workStart, label: 'Office', drain: 'high' });
        await putBusy({ date, start: o.back - o.commute, minutes: o.commute, label: 'Commute', transit: true });
      }
      const wakeMin = pl.wake != null ? pl.wake : 8 * 60;
      for (const key of pl.meals) {
        const m = MEALS.find((x) => x.key === key);
        if (!m) continue;
        if (key === 'lunch' && o.on) continue; // eaten at the office
        let start = m.start;
        if (key === 'breakfast') {
          // Office day: eaten in the freshen-up window, right before leaving.
          // Otherwise: shortly after you're up (and after any morning activity).
          start = o.on ? o.leave - m.minutes : wakeMin + preTotal + 15;
        }
        await putBusy({ date, start, minutes: m.minutes, label: m.label });
      }
      // Non-pre-work activities keep their chosen time.
      for (const a of acts.filter((x) => x.when !== 'prework')) {
        await putBusy({ date, start: a.when, minutes: a.dur, label: a.label, drain: a.drain });
      }
      if (pl.other.name) await putBusy({ date, start: pl.other.when, minutes: pl.other.dur, label: pl.other.name, drain: pl.other.drain });
      await deconflictBusy(date); // no two commitments at once
      const intensity = INTENSITY.find((i) => i.key === pl.intensity);
      // On a free weekend, aim to get much more study in — a longer total and
      // several sessions per area.
      let maxStudy = intensity ? intensity.max : undefined;
      if (pl.weekend && maxStudy != null) maxStudy = Math.round(maxStudy * 1.6);
      // Remember the day's inputs so "Reassess" can re-fit study around edited
      // commitments later without walking the wizard again.
      await setSettings({ lastPlanIntensity: pl.intensity, lastPlanFocusArea: pl.focusArea || null });
      await autoPlanDay(date, { focusArea: pl.focusArea, maxStudyMinutes: maxStudy, weekend: pl.weekend });
      pl = null;
      await paint();
    }
  }

  function blockCard(b, studied = 0, swapOptions = []) {
    const done = b.status === 'done';
    const canSwap = !done && swapOptions.length > 0;

    // The action row swaps to a "push by" preset picker when you tap Delay, or a
    // "swap for" eligible-focus picker when you tap Swap.
    const acts = el('div', { class: 'blk-acts' });
    const normalActs = () => [
      done ? null : el('button', { class: 'blk-start', text: 'Start', onclick: () => navigate(`/prep/${b.itemId}/${b.id}`) }),
      canSwap ? el('button', { class: 'blk-act', text: 'Swap', title: 'Not feeling it? Replace with another eligible focus, same time slot', onclick: () => fill(clear(acts), swapActs()) }) : null,
      done ? null : el('button', { class: 'blk-act', text: 'Delay', title: 'Running late — push the rest of the day', onclick: () => fill(clear(acts), delayActs()) }),
      el('button', { class: 'blk-act', text: done ? 'Undo' : 'Done', onclick: async () => { await setBlockStatus(b.id, done ? 'planned' : 'done'); await paint(); } }),
      done ? null : el('button', { class: 'blk-act', text: 'Move', onclick: async () => { await moveBlockToDate(b.id, addDaysISO(b.date, 1)); await paint(); } }),
      el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await deleteBlock(b.id); await paint(); } }),
    ];
    const delayActs = () => [
      el('span', { class: 'blk-delay-k', text: 'Push by' }),
      ...[10, 15, 30].map((n) => el('button', { class: 'blk-act blk-delay', text: `${n}m`, onclick: async () => { await pushBlock(b.id, n); await paint(); } })),
      el('button', { class: 'blk-act', text: 'Cancel', onclick: () => fill(clear(acts), normalActs()) }),
    ];
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
          ]),
          durNode,
        ]),
        el('div', { class: 'blk-when' }, [
          el('input', {
            type: 'time', class: 'blk-time', value: minutesToHHMM(b.start), disabled: done,
            title: 'Start time',
            onchange: async (e) => { const v = e.target.value; if (v) { await retimeBlock(b.id, toMinutes(v)); await paint(); } },
          }),
          el('span', { class: 'blk-dash', text: '–' }),
          el('input', {
            type: 'time', class: 'blk-time blk-time-end', value: minutesToHHMM(b.start + b.minutes), disabled: done,
            title: 'End time',
            onchange: async (e) => { const v = e.target.value; if (!v) return; const endM = toMinutes(v); if (endM > b.start) { await retimeBlock(b.id, b.start, endM - b.start); await paint(); } },
          }),
        ]),
        acts,
      ]),
    ]);
  }

  function busyCard(b) {
    return el('div', { class: 'busy', dataset: { id: b.id } }, [
      el('div', { class: 'busy-times' }, [
        el('input', {
          type: 'time', class: 'busy-time-in', value: minutesToHHMM(b.start), title: 'Start time',
          onchange: async (e) => { const v = e.target.value; if (v) { await retimeBusy(b.id, toMinutes(v), b.minutes); await paint(); } },
        }),
        el('span', { class: 'busy-dash', text: '–' }),
        el('input', {
          type: 'time', class: 'busy-time-in', value: minutesToHHMM(b.start + b.minutes), title: 'End time',
          onchange: async (e) => { const v = e.target.value; if (!v) return; const endM = toMinutes(v); if (endM > b.start) { await retimeBusy(b.id, b.start, endM - b.start); await paint(); } },
        }),
      ]),
      el('span', { class: 'busy-label', text: b.label }),
      b.drain && b.drain !== 'none' ? el('span', { class: 'busy-drain', text: 'draining' }) : null,
      el('button', { class: 'blk-act blk-x busy-x', text: 'Remove', onclick: async () => { await deleteBusy(b.id); await paint(); } }),
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
