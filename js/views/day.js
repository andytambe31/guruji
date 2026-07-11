// Day — the adaptive schedule. "Plan my day" opens a short wizard (a few
// grouped steps, Next / Back) covering your rhythm, work + commute, life +
// meals, and focus. The coach then lays study into the free time around it —
// deep work when it predicts you're fresh, gentler work after a draining task,
// the commute turned into transit study. Retime / drag / push any block.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, putBusy, deleteBusy, getSettings, setSettings,
  resequenceBlocks, resequenceMixed, isMovableBusy, clearBusyForDate, pushBlock, depsSatisfied,
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
    const [blocks, busy, items, settings] = await Promise.all([
      getBlocksForDate(date), getBusyForDate(date), getItems(), getSettings(),
    ]);
    planAreas = [...new Set(items.map((i) => i.area).filter(Boolean).filter((a) => a !== 'Reading'))];

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
      ...blocks.map((b) => ({ t: b.start, end: b.start + b.minutes, kind: 'block', b, node: blockCard(b) })),
      ...busyShown.map((b) => ({ t: b.start, end: b.start + b.minutes, kind: 'busy', b, node: busyCard(b) })),
    ].sort((a, b) => a.t - b.t || (a.kind === 'busy' ? -1 : 1));
    if (!entries.length) {
      timeline.append(el('p', { class: 'muted day-empty', text: `Nothing booked for ${relLabel(date).toLowerCase()}. Let the coach plan it around your day.` }));
    } else {
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

    const surfaceableAreas = surfaceAreas(items);
    const footer = el('div', { class: 'day-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { pl = freshPlan(settings); adding = false; await paint(); } }),
      el('div', { class: 'day-sub' }, [
        el('button', { class: 'btn-link day-inline', text: adding ? 'Never mind' : '+ Add a block', onclick: async () => { adding = !adding; await paint(); } }),
        (blocks.length || busy.length) ? el('button', { class: 'btn-link day-inline', text: 'Export to Calendar', onclick: () => downloadICS(blocks, `guruji-${date}.ics`, { calName: 'Guruji study' }) }) : null,
      ]),
      adding ? addForm(surfaceableAreas) : null,
    ]);

    fill(clear(wrap), [head, timeline, footer]);
  }

  function freshPlan(settings) {
    // Recurring routine: pre-fill office for your usual office weekdays, with
    // your usual timing. You can still flip it either way in the wizard.
    const dow = new Date(date + 'T00:00:00').getDay();
    const isOffice = (settings.officeDays || [2, 3, 4]).includes(dow);
    const office = { on: isOffice, leave: settings.officeLeave ?? 510, commute: settings.officeCommute ?? 60, back: settings.officeBack ?? 1080 };
    return {
      step: 0,
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
      const whenS = sel(WHEN, state.when);
      const durS = sel(DUR, state.dur);
      const drainS = sel(DRAIN, state.drain);
      const detail = el('div', { class: 'wz-detail' + (state.on ? '' : ' hidden') }, rows([['When', whenS], ['How long', durS], ['Draining?', drainS]]));
      return { seg: seg('Yes', 'No', state.on, (on) => { state.on = on; detail.classList.toggle('hidden', !on); }), detail, collect: () => { state.when = +whenS.value; state.dur = +durS.value; state.drain = drainS.value; } };
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

    const body = [stepWork, stepRhythm, stepLife, stepFocus][step]();

    const dots = el('div', { class: 'wz-dots' }, STEPS.map((_, i) => el('span', { class: 'wz-dot' + (i === step ? ' on' : i < step ? ' done' : '') })));
    const nav = el('div', { class: 'wz-nav' }, [
      step > 0
        ? el('button', { class: 'q-back', text: '← Back', onclick: async () => { collect(); pl.step -= 1; await paint(); } })
        : el('button', { class: 'q-cancel', text: 'Cancel', onclick: async () => { pl = null; await paint(); } }),
      el('button', { class: 'btn btn-primary wz-next', text: step === STEPS.length - 1 ? 'Plan my day' : 'Next →', onclick: async () => { collect(); if (step === STEPS.length - 1) await commit(); else { pl.step += 1; await paint(); } } }),
    ]);

    return el('div', { class: 'wizard' }, [
      el('div', { class: 'wz-top' }, [
        el('div', { class: 'wz-step', text: `Step ${step + 1} of ${STEPS.length}` }),
        el('h2', { class: 'wz-h', text: STEPS[step].title }),
      ]),
      body, dots, nav,
    ]);

    async function commit() {
      await setSettings({ bedtime: pl.bedtime || settings.bedtime, ...(pl.wake != null ? { wake: minutesToHHMM(pl.wake) } : {}) });
      await clearBusyForDate(date); // re-plan replaces the day's commitments
      const o = pl.office;
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
        const start = key === 'breakfast' ? wakeMin + 35 : m.start;
        await putBusy({ date, start, minutes: m.minutes, label: m.label });
      }
      if (pl.gym.on) await putBusy({ date, start: pl.gym.when, minutes: pl.gym.dur, label: 'Gym', drain: pl.gym.drain });
      if (pl.walk.on) await putBusy({ date, start: pl.walk.when, minutes: pl.walk.dur, label: 'Walk', drain: pl.walk.drain });
      if (pl.other.name) await putBusy({ date, start: pl.other.when, minutes: pl.other.dur, label: pl.other.name, drain: pl.other.drain });
      const intensity = INTENSITY.find((i) => i.key === pl.intensity);
      await autoPlanDay(date, { focusArea: pl.focusArea, maxStudyMinutes: intensity ? intensity.max : undefined });
      pl = null;
      await paint();
    }
  }

  function blockCard(b) {
    const endLabel = fmtTimeOfDay(b.start + b.minutes);
    const done = b.status === 'done';
    return el('div', { class: `blk m-${b.mode || ''}` + (done ? ' done' : ''), dataset: { id: b.id, planned: done ? '0' : '1', drag: done ? '0' : '1' } }, [
      done ? null : el('button', { class: 'blk-grip', 'aria-label': 'Drag to reorder', title: 'Drag to reorder', onpointerdown: (e) => startDrag(e, b.id) }, ['⠿']),
      el('div', { class: 'blk-body' }, [
        el('div', { class: 'blk-head' }, [
          el('div', { class: 'blk-arearow' }, [
            el('span', { class: 'blk-area', text: b.area }),
            b.onCommute ? el('span', { class: 'blk-commute', text: 'on the commute' }) : null,
          ]),
          el('div', { class: 'blk-dur', text: `${b.minutes} min` }),
        ]),
        el('div', { class: 'blk-when' }, [
          el('input', {
            type: 'time', class: 'blk-time', value: minutesToHHMM(b.start), disabled: done,
            onchange: async (e) => { const v = e.target.value; if (v) { await retimeBlock(b.id, toMinutes(v)); await paint(); } },
          }),
          el('span', { class: 'blk-end', text: `– ${endLabel}` }),
        ]),
        el('div', { class: 'blk-acts' }, [
          done ? null : el('button', { class: 'blk-start', text: 'Start', onclick: () => navigate(`/prep/${b.itemId}`) }),
          done ? null : el('button', { class: 'blk-act', text: '+15m', title: 'Running late — push the rest of the day', onclick: async () => { await pushBlock(b.id, 15); await paint(); } }),
          el('button', { class: 'blk-act', text: done ? 'Undo' : 'Done', onclick: async () => { await setBlockStatus(b.id, done ? 'planned' : 'done'); await paint(); } }),
          done ? null : el('button', { class: 'blk-act', text: 'Move', onclick: async () => { await moveBlockToDate(b.id, addDaysISO(b.date, 1)); await paint(); } }),
          el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await deleteBlock(b.id); await paint(); } }),
        ]),
      ]),
    ]);
  }

  // Pointer-based drag to reorder planned sessions; on drop, the day resequences.
  function startDrag(e, id) {
    if (e.button && e.button !== 0) return;
    const timeline = wrap.querySelector('.timeline');
    if (!timeline) return;
    const cards = [...timeline.querySelectorAll('[data-drag="1"]')];
    const dragCard = cards.find((c) => c.dataset.id === id);
    if (!dragCard || cards.length < 2) return;
    e.preventDefault();
    const startY = e.clientY;
    const mids = cards.map((c) => { const r = c.getBoundingClientRect(); return { id: c.dataset.id, mid: r.top + r.height / 2 }; });
    const others = mids.filter((m) => m.id !== id);
    const otherEls = cards.filter((c) => c.dataset.id !== id);
    let targetIndex = mids.findIndex((m) => m.id === id);
    const placeholder = el('div', { class: 'drop-line' });
    dragCard.classList.add('dragging');
    place(targetIndex);

    function place(idx) {
      if (!otherEls.length) return;
      if (idx >= otherEls.length) otherEls[otherEls.length - 1].after(placeholder);
      else otherEls[idx].before(placeholder);
    }
    function move(ev) {
      dragCard.style.transform = `translateY(${ev.clientY - startY}px)`;
      targetIndex = others.filter((m) => m.mid < ev.clientY).length;
      place(targetIndex);
    }
    async function up() {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      placeholder.remove();
      dragCard.classList.remove('dragging');
      dragCard.style.transform = '';
      const order = mids.map((m) => m.id).filter((x) => x !== id);
      order.splice(targetIndex, 0, id);
      await resequenceMixed(date, order);
      await paint();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function busyCard(b) {
    const movable = isMovableBusy(b);
    return el('div', { class: 'busy' + (movable ? ' movable' : ''), dataset: movable ? { id: b.id, drag: '1' } : {} }, [
      movable ? el('button', { class: 'busy-grip', 'aria-label': 'Drag to move', onpointerdown: (e) => startDrag(e, b.id) }, ['⠿']) : null,
      el('span', { class: 'busy-time', text: `${fmtTimeOfDay(b.start)} – ${fmtTimeOfDay(b.start + b.minutes)}` }),
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
