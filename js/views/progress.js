// Progress — the feedback loop. Everything here is derived from what the app
// already records: the session log (real focus time), the schedule (what was
// planned), and item statuses. No new tracking, just a mirror of your effort.
import { el, clear, fmtDur } from '../util.js';
import { computeStats } from '../store.js';

export async function renderProgress(mount, { navigate }) {
  const s = await computeStats();
  const wrap = el('div', { class: 'progress-wrap' });
  mount.append(wrap);

  if (s.sessions === 0 && !s.plannedDays) {
    wrap.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Progress' }),
      el('h1', { text: 'No effort logged yet.' }),
      el('p', { class: 'muted', text: 'Start a study session from Now — your hours, streak and plan follow-through show up here.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  wrap.append(el('div', { class: 'prog-top' }, [
    el('p', { class: 'eyebrow', text: 'Your effort' }),
    el('div', { class: 'prog-total' }, [
      el('span', { class: 'prog-total-num', text: fmtDur(s.totalMinutes) }),
      el('span', { class: 'prog-total-lbl', text: 'studied · all time' }),
    ]),
  ]));

  const tile = (num, lbl) => el('div', { class: 'stat-tile' }, [
    el('div', { class: 'stat-num', text: num }),
    el('div', { class: 'stat-lbl', text: lbl }),
  ]);
  wrap.append(el('div', { class: 'stat-row' }, [
    tile(fmtDur(s.weekMinutes), 'last 7 days'),
    tile(`${s.streak}`, s.streak === 1 ? 'day streak' : 'day streak'),
    tile(`${s.sessions}`, s.sessions === 1 ? 'session' : 'sessions'),
    tile(`${s.topicsDone}/${s.topicsTotal}`, 'topics done'),
  ]));

  // Last 14 days — minutes studied per day.
  const max = Math.max(1, ...s.last14.map((d) => d.minutes));
  wrap.append(el('div', { class: 'prog-section' }, [
    el('div', { class: 'prog-h', text: 'Last 14 days' }),
    el('div', { class: 'prog-chart' }, s.last14.map((d) => {
      const h = d.minutes ? Math.max(6, Math.round((d.minutes / max) * 78)) : 2;
      const dow = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
      return el('div', { class: 'bar-col', title: `${d.date} · ${fmtDur(d.minutes)}` }, [
        el('div', { class: 'bar' + (d.minutes ? '' : ' empty'), style: `height:${h}px` }),
        el('span', { class: 'bar-lbl', text: dow }),
      ]);
    })),
  ]));

  // Plan adherence — did planned days actually happen?
  if (s.adherencePct != null) {
    wrap.append(el('div', { class: 'prog-section' }, [
      el('div', { class: 'prog-h', text: 'Plan follow-through' }),
      el('div', { class: 'adhere-track' }, [el('div', { class: 'adhere-fill', style: `width:${s.adherencePct}%` })]),
      el('div', { class: 'adhere-txt', text: `You followed through on ${s.followedThrough} of ${s.plannedDays} planned ${s.plannedDays === 1 ? 'day' : 'days'} · ${s.adherencePct}%` }),
    ]));
  }

  // Where the time went — minutes by area.
  if (s.byArea.length) {
    const amax = Math.max(1, ...s.byArea.map((a) => a.minutes));
    wrap.append(el('div', { class: 'prog-section' }, [
      el('div', { class: 'prog-h', text: 'Where the time went' }),
      el('div', { class: 'area-bars' }, s.byArea.map((a) => el('div', { class: 'area-bar' }, [
        el('div', { class: 'area-bar-top' }, [
          el('span', { class: 'area-name', text: a.area }),
          el('span', { class: 'area-min', text: fmtDur(a.minutes) }),
        ]),
        el('div', { class: 'area-track' }, [el('div', { class: 'area-fill', style: `width:${Math.round((a.minutes / amax) * 100)}%` })]),
      ]))),
    ]));
  }

  // Recent sessions — every logged focus block, so the total is auditable.
  if (s.recentSessions.length) {
    const rel = (iso) => {
      const t = new Date();
      const todayISO = t.toISOString().slice(0, 10);
      const y = new Date(t.getTime() - 864e5).toISOString().slice(0, 10);
      if (iso === todayISO) return 'Today';
      if (iso === y) return 'Yesterday';
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    wrap.append(el('div', { class: 'prog-section' }, [
      el('div', { class: 'prog-h', text: 'Recent sessions' }),
      el('div', { class: 'sess-list' }, s.recentSessions.map((r) => el('div', { class: 'sess-row' }, [
        el('div', { class: 'sess-left' }, [
          el('span', { class: `sess-dot ${r.result === 'done' ? 'done' : r.result === 'skipped' ? 'skip' : ''}` }),
          el('span', { class: 'sess-area', text: r.area }),
          r.title ? el('span', { class: 'sess-title', text: r.title }) : null,
        ]),
        el('div', { class: 'sess-right' }, [
          el('span', { class: 'sess-min', text: fmtDur(r.minutes) }),
          el('span', { class: 'sess-date', text: rel(r.date) }),
        ]),
      ]))),
    ]));
  }

  wrap.append(el('button', { class: 'btn-link', style: 'margin-top:8px', text: '‹ Back to Now', onclick: () => navigate('/now') }));
}
