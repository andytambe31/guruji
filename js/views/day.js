// Day — the adaptive schedule. The coach blocks study time across the day
// (hard work while you're fresh); you can retime or bump any block and the rest
// re-allocate around it. Export a snapshot to Apple Calendar as .ics.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, depsSatisfied,
} from '../store.js';
import { downloadICS } from '../ics.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
  const wrap = el('div', { class: 'day-wrap' });
  mount.append(wrap);
  await paint();

  function relLabel(d) {
    const t = todayISO();
    if (d === t) return 'Today';
    if (d === addDaysISO(t, 1)) return 'Tomorrow';
    if (d === addDaysISO(t, -1)) return 'Yesterday';
    return DAYS[new Date(d + 'T00:00:00').getDay()].charAt(0) + DAYS[new Date(d + 'T00:00:00').getDay()].slice(1).toLowerCase();
  }
  function dateLabel(d) {
    const x = new Date(d + 'T00:00:00');
    return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
  }

  async function paint() {
    const [blocks, items] = await Promise.all([getBlocksForDate(date), getItems()]);
    blocks.sort((a, b) => a.start - b.start);

    const head = el('div', { class: 'day-head' }, [
      el('button', { class: 'day-nav', text: '‹', 'aria-label': 'Previous day', onclick: async () => { date = addDaysISO(date, -1); adding = false; await paint(); } }),
      el('div', { class: 'day-title' }, [
        el('div', { class: 'day-rel', text: relLabel(date) }),
        el('div', { class: 'day-date', text: dateLabel(date) }),
      ]),
      el('button', { class: 'day-nav', text: '›', 'aria-label': 'Next day', onclick: async () => { date = addDaysISO(date, 1); adding = false; await paint(); } }),
    ]);

    const list = el('div', { class: 'timeline' });
    if (!blocks.length) {
      list.append(el('p', { class: 'muted day-empty', text: `Nothing booked for ${relLabel(date).toLowerCase()}. Let the coach plan it, or add a block.` }));
    } else {
      for (const b of blocks) list.append(blockCard(b));
    }

    const surfaceableAreas = surfaceAreas(items);
    const footer = el('div', { class: 'day-actions' }, [
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { await autoPlanDay(date); adding = false; await paint(); } }),
      el('div', { class: 'day-sub' }, [
        el('button', { class: 'btn-link day-inline', text: adding ? 'Never mind' : '+ Add a block', onclick: async () => { adding = !adding; await paint(); } }),
        blocks.length ? el('button', { class: 'btn-link day-inline', text: 'Export to Calendar', onclick: () => downloadICS(blocks, `guruji-${date}.ics`, { calName: 'Guruji study' }) }) : null,
      ]),
      adding ? addForm(surfaceableAreas) : null,
    ]);

    fill(clear(wrap), [head, list, footer]);
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

  function addForm(areas) {
    if (!areas.length) return el('p', { class: 'muted day-empty', text: 'Nothing is unlocked to block right now.' });
    // default time: round current time up to the next quarter hour
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
