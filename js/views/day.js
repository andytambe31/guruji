// Day — the adaptive schedule. "Plan my day" runs a short conversation (are you
// going to the gym? when, roughly? will it drain you?) and the coach infers a
// realistic window for each thing, then lays study into the free time around
// them — hard work when it predicts you'll be fresh, gentler work after a
// draining task. Retime/bump any block and the rest re-allocate.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, putBusy, deleteBusy, getSettings, setSettings,
  resequenceBlocks, pushBlock, depsSatisfied,
} from '../store.js';
import { downloadICS } from '../ics.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Rough answers the coach turns into concrete windows — you never set a time.
const WHEN = [
  { key: 'morning', label: 'This morning', start: 10 * 60 },
  { key: 'midday', label: 'Around midday', start: 13 * 60 },
  { key: 'afternoon', label: 'This afternoon', start: 15 * 60 },
  { key: 'evening', label: 'This evening', start: 18 * 60 },
  { key: 'late', label: 'Later tonight', start: 20 * 60 },
];
const DUR = [
  { key: 'quick', label: 'Quick — under 30 min', minutes: 30 },
  { key: 'hour', label: 'About an hour', minutes: 60 },
  { key: 'long', label: 'A couple of hours', minutes: 120 },
];
const DRAIN = [
  { key: 'none', label: 'No — it’s a break', drain: 'none' },
  { key: 'low', label: 'A little', drain: 'low' },
  { key: 'high', label: 'Yeah — I’ll be wiped', drain: 'high' },
];
const WAKE = [
  { key: 'early', label: 'Early — around 7', wake: 7 * 60 },
  { key: 'mid', label: 'Around 8:30', wake: 8 * 60 + 30 },
  { key: 'late', label: 'Around 9:30', wake: 9 * 60 + 30 },
  { key: 'verylate', label: 'Late — around 11', wake: 11 * 60 },
];
const OFFICE_LEAVE = [
  { label: 'Around 7:30', min: 7 * 60 + 30 },
  { label: 'Around 8', min: 8 * 60 },
  { label: 'Around 8:30', min: 8 * 60 + 30 },
  { label: 'Around 9', min: 9 * 60 },
];
const COMMUTE = [
  { label: '~30 minutes', min: 30 },
  { label: '~45 minutes', min: 45 },
  { label: 'About an hour', min: 60 },
  { label: 'An hour and a half', min: 90 },
];
const OFFICE_BACK = [
  { label: 'Around 5pm', min: 17 * 60 },
  { label: 'Around 6pm', min: 18 * 60 },
  { label: 'Around 7pm', min: 19 * 60 },
  { label: 'Around 8pm', min: 20 * 60 },
];
const MEALS = [
  { key: 'breakfast', label: 'Breakfast', minutes: 20 },
  { key: 'lunch', label: 'Lunch', start: 13 * 60, minutes: 45 },
  { key: 'dinner', label: 'Dinner', start: 20 * 60, minutes: 60 },
];
const INTENSITY = [
  { key: 'light', label: 'Light — lots of room', max: 360 },
  { key: 'normal', label: 'Normal', max: 300 },
  { key: 'packed', label: 'Packed & draining', max: 150 },
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
  let pl = null; // the planning conversation state, when active
  let planAreas = []; // study areas available (for the focus question)
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

    // In the planning conversation, focus on the question — nothing else.
    if (pl) {
      fill(clear(wrap), [journeyCard(settings)]);
      return;
    }

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
        // A visible breather between two back-to-back study sessions.
        if (nxt && cur.kind === 'block' && nxt.kind === 'block') {
          const gap = nxt.t - cur.end;
          if (gap >= 8) timeline.append(el('div', { class: 'break-row', text: `· ${gap} min break ·` }));
        }
      }
    }

    const surfaceableAreas = surfaceAreas(items);
    const footer = el('div', { class: 'day-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { pl = { bedtime: settings.bedtime, wake: null, office: null, meals: [], intensity: null, focusArea: null, stage: 'wake-ask', cur: null, activities: [] }; adding = false; await paint(); } }),
      el('div', { class: 'day-sub' }, [
        el('button', { class: 'btn-link day-inline', text: adding ? 'Never mind' : '+ Add a block', onclick: async () => { adding = !adding; await paint(); } }),
        (blocks.length || busy.length) ? el('button', { class: 'btn-link day-inline', text: 'Export to Calendar', onclick: () => downloadICS(blocks, `guruji-${date}.ics`, { calName: 'Guruji study' }) }) : null,
      ]),
      adding ? addForm(surfaceableAreas) : null,
    ]);

    fill(clear(wrap), [head, timeline, footer]);
  }

  // ---------- the planning conversation ----------
  function journeyCard(settings) {
    const s = pl.stage;
    // Speak in the right tense for the day being planned.
    const t = todayISO();
    const when = date === t ? 'today' : date === addDaysISO(t, 1) ? 'tomorrow' : `on ${relLabel(date)}`;
    const futureDay = date !== t;
    const opt = (label, onClick, sub) => el('button', { class: 'q-opt', onclick: onClick }, sub ? [el('span', { text: label }), el('span', { class: 'q-opt-sub', text: sub })] : [label]);
    const foot = (backTo) => el('div', { class: 'q-foot' }, [
      backTo ? el('button', { class: 'q-back', text: '← Back', onclick: async () => { pl.stage = backTo; await paint(); } }) : el('span'),
      el('button', { class: 'q-cancel', text: 'Cancel', onclick: async () => { pl = null; await paint(); } }),
    ]);
    const card = (title, subtitle, opts, extra) => el('div', { class: 'journey' }, [
      el('h2', { class: 'q-title', text: title }),
      subtitle ? el('p', { class: 'q-sub', text: subtitle }) : null,
      el('div', { class: 'q-opts' }, opts),
      extra || null,
      extra && extra.__foot ? null : foot(backFor(s)),
    ]);

    if (s === 'wake-ask') {
      return card(futureDay ? 'What time are you getting up?' : 'What time are you up?', 'I’ll leave you ~30 minutes to freshen up before anything starts.', [
        ...WAKE.map((w) => opt(w.label, () => { pl.wake = w.wake; go('office-ask'); })),
        opt(futureDay ? 'Not sure yet' : 'Been up a while', () => { pl.wake = null; go('office-ask'); }),
      ]);
    }
    if (s === 'office-ask') {
      return card(`Going into the office ${when}?`, 'I’ll block your work hours, and turn the commute into transit study.', [
        opt('Yes, in-office', () => { pl.office = {}; go('office-leave'); }),
        opt(futureDay ? 'No — home that day' : 'No — home today', () => { pl.office = null; go('meals'); }),
      ]);
    }
    if (s === 'office-leave') {
      return card('When do you leave?', 'Roughly is fine.', OFFICE_LEAVE.map((o) => opt(o.label, () => { pl.office.leave = o.min; go('office-commute'); })));
    }
    if (s === 'office-commute') {
      return card('How long’s the commute — each way?', 'That hour on the train is prime transit-study time.', COMMUTE.map((c) => opt(c.label, () => { pl.office.commute = c.min; go('office-back'); })));
    }
    if (s === 'office-back') {
      return card('Back home around?', null, OFFICE_BACK.map((o) => opt(o.label, () => { pl.office.back = o.min; go('meals'); })));
    }
    if (s === 'meals') {
      const sel = new Set(pl.meals || []);
      const chips = el('div', { class: 'q-opts' }, MEALS.map((m) => {
        const c = el('button', { class: 'q-opt' + (sel.has(m.key) ? ' on' : ''), onclick: () => { if (sel.has(m.key)) { sel.delete(m.key); c.classList.remove('on'); } else { sel.add(m.key); c.classList.add('on'); } } }, [m.label]);
        return c;
      }));
      return el('div', { class: 'journey' }, [
        el('h2', { class: 'q-title', text: 'Meals to set time aside for?' }),
        el('p', { class: 'q-sub', text: 'I’ll block time to make or grab each one. Tap all that apply.' }),
        chips,
        el('div', { class: 'q-opts' }, [el('button', { class: 'btn btn-primary btn-block', onclick: () => { pl.meals = [...sel]; go('gym-ask'); } }, ['Continue'])]),
        foot(pl.office ? 'office-back' : 'office-ask'),
      ]);
    }
    if (s === 'gym-ask') {
      return card(`Hitting the gym ${when}?`, 'The coach will keep study clear of it.', [
        opt('Yes', () => beginActivity('gym', 'Gym')),
        opt('Not ' + (futureDay ? 'then' : 'today'), () => go('walk-ask')),
      ]);
    }
    if (s === 'walk-ask') {
      return card(`Going for a walk ${when}?`, null, [
        opt('Yes', () => beginActivity('walk', 'Walk')),
        opt('Not ' + (futureDay ? 'then' : 'today'), () => go('else-ask')),
      ]);
    }
    if (s === 'when') {
      return card('When are you going?', pl.cur.name + ' — roughly is fine.', WHEN.map((w) => opt(w.label, () => { pl.cur.when = w; go('dur'); })));
    }
    if (s === 'dur') {
      return card('Roughly how long?', pl.cur.name, DUR.map((d) => opt(d.label, () => { pl.cur.dur = d; go('drain'); })));
    }
    if (s === 'drain') {
      return card('Will it drain you mentally?', `${pl.cur.name} — so I don’t line up hard studying right after.`, DRAIN.map((d) => opt(d.label, () => finishActivity(d.drain))));
    }
    if (s === 'else-ask') {
      const summary = pl.activities.length ? `So far: ${pl.activities.map((a) => a.name).join(', ')}.` : null;
      return card(`Anything else taking your time ${when}?`, summary || 'Errands, an appointment, a call…', [
        opt('Add something', () => go('else-label')),
        opt('No, that’s everything', () => go('intensity')),
      ]);
    }
    if (s === 'intensity') {
      return card('How heavy is your day?', 'Meetings, life, energy — how much is going on outside study.', INTENSITY.map((i) => opt(i.label, () => { pl.intensity = i; go('focus'); })));
    }
    if (s === 'focus') {
      const opts = [opt('You take charge', () => { pl.focusArea = null; go('bedtime'); }, 'I’ll balance it')];
      for (const a of planAreas.slice(0, 3)) opts.push(opt(`Lean into ${a}`, () => { pl.focusArea = a; go('bedtime'); }));
      return card('Where’s your head today?', null, opts);
    }
    if (s === 'else-label') {
      const input = el('input', { type: 'text', class: 'q-input', placeholder: 'e.g. Office work', autofocus: true });
      const cont = el('div', { class: 'q-opts' }, [
        el('button', { class: 'q-opt', onclick: () => { const v = input.value.trim(); if (v) beginActivity('else', v); } }, ['Continue']),
      ]);
      return el('div', { class: 'journey' }, [
        el('h2', { class: 'q-title', text: 'What is it?' }),
        input, cont, foot('else-ask'),
      ]);
    }
    if (s === 'bedtime') {
      const bedInput = el('input', { type: 'time', class: 'blk-time q-time', value: pl.bedtime || '23:30' });
      const cont = el('div', { class: 'q-opts' }, [
        el('button', { class: 'q-opt', onclick: () => { pl.bedtime = bedInput.value || pl.bedtime; go('go'); } }, ['That’s my night']),
      ]);
      return el('div', { class: 'journey' }, [
        el('h2', { class: 'q-title', text: 'When are you turning in?' }),
        el('p', { class: 'q-sub', text: 'I’ll keep the last of the day gentle and stop pushing deep work near this.' }),
        el('div', { class: 'q-bedrow' }, [el('span', { class: 'muted', text: 'Bed by' }), bedInput]),
        cont, foot('focus'),
      ]);
    }
    // s === 'go' — recap + commit
    const lines = pl.activities.map((a) => `${a.name} · ${a.when.label.toLowerCase()} · ~${a.dur.minutes}m${a.drain !== 'none' ? ' · draining' : ''}`);
    return el('div', { class: 'journey' }, [
      el('h2', { class: 'q-title', text: 'Here’s your day' }),
      lines.length
        ? el('ul', { class: 'q-recap' }, lines.map((l) => el('li', { text: l })))
        : el('p', { class: 'q-sub', text: 'No commitments — I’ll lay study across the open day.' }),
      el('p', { class: 'q-sub', text: `Bed by ${fmtTimeOfDay(toMinutes(pl.bedtime || '23:30'))}. I’ll fit study into the gaps, hardest work when you’re freshest.` }),
      el('div', { class: 'q-opts' }, [
        el('button', { class: 'btn btn-primary btn-block', onclick: () => commit() }, ['Plan my day around this']),
      ]),
      foot('bedtime'),
    ]);

    async function go(stage) { pl.stage = stage; await paint(); }
    async function beginActivity(key, name) { pl.cur = { key, name }; pl.stage = 'when'; await paint(); }
    async function finishActivity(drain) {
      pl.cur.drain = drain;
      pl.activities.push(pl.cur);
      const from = pl.cur.key;
      pl.cur = null;
      pl.stage = from === 'gym' ? 'walk-ask' : 'else-ask';
      await paint();
    }
    async function commit() {
      await setSettings({
        bedtime: pl.bedtime || settings.bedtime,
        ...(pl.wake != null ? { wake: minutesToHHMM(pl.wake) } : {}),
      });
      // Office: commute out (transit study) + work hours (draining) + commute back.
      const o = pl.office;
      if (o && o.leave != null && o.commute != null && o.back != null) {
        await putBusy({ date, start: o.leave, minutes: o.commute, label: 'Commute', transit: true });
        const workStart = o.leave + o.commute;
        const workEnd = Math.max(workStart + 30, o.back - o.commute);
        await putBusy({ date, start: workStart, minutes: workEnd - workStart, label: 'Office', drain: 'high' });
        await putBusy({ date, start: o.back - o.commute, minutes: o.commute, label: 'Commute', transit: true });
      }
      // Meals — prep/order time baked into the duration.
      const wakeMin = pl.wake != null ? pl.wake : 8 * 60;
      for (const key of (pl.meals || [])) {
        const m = MEALS.find((x) => x.key === key);
        if (!m) continue;
        if (key === 'lunch' && o) continue; // lunch is eaten at the office
        const start = key === 'breakfast' ? wakeMin + 35 : m.start;
        await putBusy({ date, start, minutes: m.minutes, label: m.label });
      }
      for (const a of pl.activities) {
        await putBusy({ date, start: a.when.start, minutes: a.dur.minutes, label: a.name, drain: a.drain });
      }
      await autoPlanDay(date, { focusArea: pl.focusArea, maxStudyMinutes: pl.intensity ? pl.intensity.max : undefined });
      pl = null;
      await paint();
    }
  }

  function backFor(stage) {
    return {
      'office-ask': 'wake-ask', 'office-leave': 'office-ask', 'office-commute': 'office-leave', 'office-back': 'office-commute',
      'gym-ask': 'meals', 'walk-ask': 'gym-ask', 'else-ask': 'walk-ask', intensity: 'else-ask', focus: 'intensity',
      when: pl && pl.cur && pl.cur.key === 'gym' ? 'gym-ask' : pl && pl.cur && pl.cur.key === 'walk' ? 'walk-ask' : 'else-label',
      dur: 'when', drain: 'dur',
    }[stage] || null;
  }

  function blockCard(b) {
    const endLabel = fmtTimeOfDay(b.start + b.minutes);
    const done = b.status === 'done';
    return el('div', { class: `blk m-${b.mode || ''}` + (done ? ' done' : ''), dataset: { id: b.id, planned: done ? '0' : '1' } }, [
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
    const cards = [...timeline.querySelectorAll('.blk[data-planned="1"]')];
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
      await resequenceBlocks(date, order);
      await paint();
    }
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  function busyCard(b) {
    return el('div', { class: 'busy' }, [
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
