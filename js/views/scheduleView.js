// Schedule editor: add / edit / remove weekly pockets. Seeded from the plan
// schema on first run; fully editable. This is how Now knows the active pocket.
import { el, toast, DAYS, DAY_LABEL, MODES, MODE_LABEL } from '../util.js';
import { getSchedule, saveScheduleRows } from '../store.js';
import { SEED_SCHEDULE } from '../schedule.js';

export async function renderSchedule(mount, { navigate }) {
  let rows = (await getSchedule()).map((r) => ({ ...r }));

  const list = el('div', { class: 'sched-list' });

  function rowEditor(row, idx) {
    const daySel = el('select', { class: 'fld fld-day', onchange: (e) => { row.day = e.target.value; } },
      DAYS.map((d) => el('option', { value: d, selected: d === row.day, text: DAY_LABEL[d] })));

    const modeSel = el('select', { class: `fld fld-mode ${row.mode}`, onchange: (e) => { row.mode = e.target.value; e.target.className = `fld fld-mode ${row.mode}`; } },
      MODES.map((m) => el('option', { value: m, selected: m === row.mode, text: MODE_LABEL[m] })));

    const startInput = el('input', { class: 'fld fld-time', type: 'time', value: row.start, onchange: (e) => { row.start = e.target.value; } });
    const endInput = el('input', { class: 'fld fld-time', type: 'time', value: row.end, onchange: (e) => { row.end = e.target.value; } });

    const removeBtn = el('button', {
      class: 'sched-x', title: 'Remove pocket', text: '✕',
      onclick: () => { rows.splice(idx, 1); repaint(); },
    });

    return el('div', { class: 'sched-pocket' }, [
      el('div', { class: 'sched-top' }, [
        daySel,
        el('span', { class: 'sched-spacer' }),
        modeSel,
        removeBtn,
      ]),
      el('div', { class: 'sched-times' }, [
        startInput, el('span', { class: 'sched-dash', text: '–' }), endInput,
      ]),
    ]);
  }

  function repaint() {
    list.replaceChildren(...rows.map((r, i) => rowEditor(r, i)));
  }
  repaint();

  const addBtn = el('button', {
    class: 'btn btn-ghost', text: '+ Add pocket',
    onclick: () => { rows.push({ day: 'MON', start: '18:00', end: '19:00', mode: 'DESK' }); repaint(); },
  });

  const saveBtn = el('button', {
    class: 'btn btn-primary', text: 'Save schedule',
    onclick: async () => {
      // validate
      for (const r of rows) {
        if (r.start >= r.end) { toast(`${DAY_LABEL[r.day]} pocket ends before it starts`, true); return; }
      }
      await saveScheduleRows(rows);
      toast('Schedule saved');
      navigate('/week');
    },
  });

  const resetBtn = el('button', {
    class: 'btn btn-ghost', text: 'Reset to seed',
    onclick: () => {
      if (!confirm('Replace the current schedule with the default seed?')) return;
      rows = SEED_SCHEDULE.map((r) => ({ ...r }));
      repaint();
      toast('Reset — remember to Save');
    },
  });

  mount.append(
    el('p', { class: 'eyebrow', text: 'Your weekly pockets' }),
    el('h1', { text: 'Schedule' }),
    el('p', { class: 'muted', style: 'margin-bottom:20px', text: 'Define when you study and in what mode. Now uses this to know what pocket you are in.' }),
    list,
    el('div', { class: 'row', style: 'margin-top:16px' }, [addBtn]),
    el('hr', { class: 'sep' }),
    el('div', { class: 'row' }, [saveBtn, resetBtn]),
  );
}
