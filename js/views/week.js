// Read-only week grid: pockets as blocks colored by mode, non-study time muted.
import { el, DAYS, DAY_LABEL, MODE_LABEL, toMinutes, todayCode, nowMinutes, fmtTimeOfDay } from '../util.js';
import { getSchedule } from '../store.js';

export async function renderWeek(mount, { navigate }) {
  const rows = await getSchedule();

  if (!rows.length) {
    mount.append(
      el('p', { class: 'eyebrow', text: 'Your week' }),
      el('h1', { text: 'Week' }),
      el('div', { class: 'center-state' }, [
        el('p', { class: 'muted', text: 'No schedule yet.' }),
        el('button', { class: 'btn btn-primary', text: 'Set up schedule', onclick: () => navigate('/schedule') }),
      ]),
    );
    return;
  }

  // Visible hour window derived from the schedule, padded and clamped.
  let minH = 24, maxH = 0;
  for (const r of rows) {
    minH = Math.min(minH, Math.floor(toMinutes(r.start) / 60));
    maxH = Math.max(maxH, Math.ceil(toMinutes(r.end) / 60));
  }
  minH = Math.max(0, Math.min(minH, 23));
  maxH = Math.min(24, Math.max(maxH, minH + 1));

  const today = todayCode();
  const nowMin = nowMinutes();
  const nowHour = Math.floor(nowMin / 60);

  // For each (day, hour) find the pocket overlapping that hour, if any.
  function pocketAt(day, hour) {
    const hStart = hour * 60;
    const hEnd = hStart + 60;
    return rows.find((r) => r.day === day && toMinutes(r.start) < hEnd && toMinutes(r.end) > hStart) || null;
  }

  const grid = el('div', { class: 'week-grid' });
  grid.append(el('div', { class: 'corner' }));
  for (const d of DAYS) {
    grid.append(el('div', { class: 'col-head' + (d === today ? '' : ''), text: DAY_LABEL[d] }));
  }

  for (let h = minH; h < maxH; h++) {
    grid.append(el('div', { class: 'row-head', text: fmtTimeOfDay(h * 60) }));
    for (const d of DAYS) {
      const p = pocketAt(d, h);
      const isNow = d === today && h === nowHour;
      const cls = ['cell'];
      if (p) cls.push(p.mode);
      if (isNow) cls.push('now');
      grid.append(el('div', {
        class: cls.join(' '),
        title: p ? `${DAY_LABEL[d]} ${p.start}–${p.end} · ${MODE_LABEL[p.mode]}` : '',
      }));
    }
  }

  const legend = el('div', { class: 'legend' }, [
    legendItem('DESK'), legendItem('TRANSIT'), legendItem('WIND_DOWN'),
  ]);

  mount.append(
    el('p', { class: 'eyebrow', text: 'Your week at a glance' }),
    el('h1', { text: 'Week' }),
    el('div', { class: 'card', style: 'overflow-x:auto' }, [grid]),
    legend,
    el('div', { style: 'margin-top:18px' }, [
      el('button', { class: 'btn btn-ghost', text: 'Edit schedule', onclick: () => navigate('/schedule') }),
    ]),
  );
}

function legendItem(mode) {
  const cls = { DESK: 'var(--desk)', TRANSIT: 'var(--transit)', WIND_DOWN: 'var(--wind)' }[mode];
  return el('span', {}, [
    el('i', { style: `background:${cls}` }),
    el('span', { text: MODE_LABEL[mode] }),
  ]);
}
