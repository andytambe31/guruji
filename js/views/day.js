// Day — the adaptive schedule. The coach asks what's taking your time (gym,
// walk, bedtime), then lays study into the free windows around it, ordering by
// the cognitive load it predicts at each hour. You can retime/bump any block
// and the rest re-allocate. Export a snapshot to Apple Calendar as .ics.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, putBusy, deleteBusy, getSettings, setSettings, depsSatisfied,
} from '../store.js';
import { downloadICS } from '../ics.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const COMMON = [
  { key: 'gym', label: 'Gym', start: 18 * 60, minutes: 60 },
  { key: 'walk', label: 'Walk', start: 17 * 60, minutes: 30 },
  { key: 'dinner', label: 'Dinner', start: 20 * 60, minutes: 45 },
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
  let wizard = false;
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

    const head = el('div', { class: 'day-head' }, [
      el('button', { class: 'day-nav', text: '‹', 'aria-label': 'Previous day', onclick: async () => { date = addDaysISO(date, -1); adding = wizard = false; await paint(); } }),
      el('div', { class: 'day-title' }, [
        el('div', { class: 'day-rel', text: relLabel(date) }),
        el('div', { class: 'day-date', text: dateLabel(date) }),
      ]),
      el('button', { class: 'day-nav', text: '›', 'aria-label': 'Next day', onclick: async () => { date = addDaysISO(date, 1); adding = wizard = false; await paint(); } }),
    ]);

    const timeline = el('div', { class: 'timeline' });
    const rows = [
      ...blocks.map((b) => ({ t: b.start, node: blockCard(b) })),
      ...busy.map((b) => ({ t: b.start, node: busyCard(b) })),
    ].sort((a, b) => a.t - b.t);
    if (!rows.length) {
      timeline.append(el('p', { class: 'muted day-empty', text: `Nothing booked for ${relLabel(date).toLowerCase()}. Let the coach plan it around your day.` }));
    } else {
      for (const r of rows) timeline.append(r.node);
    }

    const surfaceableAreas = surfaceAreas(items);
    const footer = el('div', { class: 'day-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { wizard = !wizard; adding = false; await paint(); } }),
      el('div', { class: 'day-sub' }, [
        el('button', { class: 'btn-link day-inline', text: adding ? 'Never mind' : '+ Add a block', onclick: async () => { adding = !adding; wizard = false; await paint(); } }),
        (blocks.length || busy.length) ? el('button', { class: 'btn-link day-inline', text: 'Export to Calendar', onclick: () => downloadICS(blocks, `guruji-${date}.ics`, { calName: 'Guruji study' }) }) : null,
      ]),
      wizard ? wizardPanel(settings) : null,
      adding ? addForm(surfaceableAreas) : null,
    ]);

    fill(clear(wrap), [head, timeline, footer]);
  }

  function blockCard(b) {
    const endLabel = fmtTimeOfDay(b.start + b.minutes);
    const done = b.status === 'done';
    return el('div', { class: 'blk' + (done ? ' done' : '') }, [
      el('div', { class: 'blk-when' }, [
        el('input', {
          type: 'time', class: 'blk-time', value: minutesToHHMM(b.start), disabled: done,
          onchange: async (e) => { const v = e.target.value; if (v) { await retimeBlock(b.id, toMinutes(v)); await paint(); } },
        }),
        el('span', { class: 'blk-end', text: `– ${endLabel}` }),
      ]),
      el('div', { class: 'blk-main' }, [
        el('span', { class: `blk-dot ${b.mode || ''}` }),
        el('span', { class: 'blk-area', text: b.area }),
        el('span', { class: 'blk-dur', text: `${b.minutes}m` }),
      ]),
      el('div', { class: 'blk-acts' }, [
        done ? null : el('button', { class: 'blk-start', text: 'Start', onclick: () => navigate(`/prep/${b.itemId}`) }),
        el('button', { class: 'blk-act', text: done ? 'Undo' : 'Done', onclick: async () => { await setBlockStatus(b.id, done ? 'planned' : 'done'); await paint(); } }),
        done ? null : el('button', { class: 'blk-act', text: '→ next day', onclick: async () => { await moveBlockToDate(b.id, addDaysISO(b.date, 1)); await paint(); } }),
        el('button', { class: 'blk-act blk-x', text: 'Remove', onclick: async () => { await deleteBlock(b.id); await paint(); } }),
      ]),
    ]);
  }

  function busyCard(b) {
    return el('div', { class: 'busy' }, [
      el('span', { class: 'busy-time', text: `${fmtTimeOfDay(b.start)} – ${fmtTimeOfDay(b.start + b.minutes)}` }),
      el('span', { class: 'busy-label', text: b.label }),
      el('button', { class: 'blk-act blk-x busy-x', text: 'Remove', onclick: async () => { await deleteBusy(b.id); await paint(); } }),
    ]);
  }

  function wizardPanel(settings) {
    const bedInput = el('input', { type: 'time', class: 'blk-time', value: settings.bedtime || '23:30' });
    const rows = COMMON.map((c) => {
      const on = el('input', { type: 'checkbox', class: 'wz-on' });
      const t = el('input', { type: 'time', class: 'blk-time', value: minutesToHHMM(c.start) });
      const dur = el('select', { class: 'wz-dur' }, [30, 45, 60, 90].map((m) => el('option', { value: String(m), text: `${m}m`, selected: m === c.minutes })));
      return { c, on, t, dur, node: el('label', { class: 'wz-row' }, [on, el('span', { class: 'wz-label', text: c.label }), t, dur]) };
    });
    const otherLabel = el('input', { type: 'text', class: 'wz-text', placeholder: 'Anything else…' });
    const otherTime = el('input', { type: 'time', class: 'blk-time', value: '16:00' });
    const otherDur = el('select', { class: 'wz-dur' }, [30, 45, 60, 90].map((m) => el('option', { value: String(m), text: `${m}m`, selected: m === 60 })));

    const arrange = el('button', {
      class: 'btn btn-primary btn-block', text: 'Arrange my day',
      onclick: async () => {
        await setSettings({ bedtime: bedInput.value || settings.bedtime });
        for (const r of rows) if (r.on.checked) await putBusy({ date, start: toMinutes(r.t.value || minutesToHHMM(r.c.start)), minutes: Number(r.dur.value), label: r.c.label });
        if (otherLabel.value.trim()) await putBusy({ date, start: toMinutes(otherTime.value || '16:00'), minutes: Number(otherDur.value), label: otherLabel.value.trim() });
        await autoPlanDay(date);
        wizard = false;
        await paint();
      },
    });

    return el('div', { class: 'wizard' }, [
      el('div', { class: 'add-label', text: 'What’s taking your time today?' }),
      ...rows.map((r) => r.node),
      el('label', { class: 'wz-row' }, [el('span', { class: 'wz-on-spacer' }), el('span', { class: 'wz-label', text: 'Other' }), otherLabel, otherTime, otherDur]),
      el('div', { class: 'wz-bed' }, [el('span', { class: 'wz-label', text: 'Bed by' }), bedInput]),
      arrange,
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
