// Day — the adaptive schedule. "Plan my day" runs a short conversation (are you
// going to the gym? when, roughly? will it drain you?) and the coach infers a
// realistic window for each thing, then lays study into the free time around
// them — hard work when it predicts you'll be fresh, gentler work after a
// draining task. Retime/bump any block and the rest re-allocate.
import { el, clear, fill, minutesToHHMM, toMinutes, fmtTimeOfDay, todayISO, addDaysISO, DAYS } from '../util.js';
import {
  hasPlan, getItems, getBlocksForDate, getBusyForDate, autoPlanDay, deleteBlock, setBlockStatus,
  retimeBlock, moveBlockToDate, blockItem, putBusy, deleteBusy, getSettings, setSettings, depsSatisfied,
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
      el('button', { class: 'btn btn-primary btn-block', text: blocks.length ? 'Re-plan the day' : 'Plan my day', onclick: async () => { pl = { bedtime: settings.bedtime, wake: null, stage: 'wake-ask', cur: null, activities: [] }; adding = false; await paint(); } }),
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
        ...WAKE.map((w) => opt(w.label, () => { pl.wake = w.wake; go('gym-ask'); })),
        opt(futureDay ? 'Not sure yet' : 'Been up a while', () => { pl.wake = null; go('gym-ask'); }),
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
      return card(`Anything else taking your time ${when}?`, summary || 'Office work, errands, an appointment…', [
        opt('Add something', () => go('else-label')),
        opt('No, that’s everything', () => go('bedtime')),
      ]);
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
        cont, foot('else-ask'),
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
      for (const a of pl.activities) {
        await putBusy({ date, start: a.when.start, minutes: a.dur.minutes, label: a.name, drain: a.drain });
      }
      await autoPlanDay(date);
      pl = null;
      await paint();
    }
  }

  function backFor(stage) {
    return { when: pl && pl.cur && pl.cur.key === 'gym' ? 'gym-ask' : pl && pl.cur && pl.cur.key === 'walk' ? 'walk-ask' : 'else-label', dur: 'when', drain: 'dur', 'gym-ask': 'wake-ask', 'walk-ask': 'gym-ask', 'else-ask': 'walk-ask' }[stage] || null;
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
