// Roadmap — the strategic view: are we on track for the offer, and what does each
// week / month / quarter demand? One page that ties the plan's phase trajectory,
// the countdown, and everything captured (LeetCode, concepts, topics, effort)
// into "here's the plan to land a FAANG offer in N days."
import { el, clear, fmtDur, todayISO } from '../util.js';
import { computeRoadmap } from '../store.js';

const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const AREA_DOT = { DSA: '#3b5bd9', 'System Design': '#0f9d6b', 'CS Fundamentals': '#7d5bd6', Behavioral: '#d05b7d', Applications: '#c98a2e', Reading: '#d98324' };

export async function renderRoadmap(mount, { navigate }) {
  const r = await computeRoadmap();
  const wrap = el('div', { class: 'road-wrap' });
  mount.append(wrap);

  if (!r.goalDate) {
    wrap.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'The plan' }),
      el('h1', { text: 'No goal set yet.' }),
      el('p', { class: 'muted', text: 'Import a plan with a target date from Data, and your road to it shows up here.' }),
    ]));
    return;
  }

  // ---- Header: the countdown + the on-track verdict ----
  const head = el('div', { class: 'road-head' }, [
    el('p', { class: 'eyebrow', text: 'The plan' }),
    el('div', { class: 'road-count' }, [
      el('span', { class: 'road-days', text: `${r.daysLeft}` }),
      el('span', { class: 'road-days-lbl', text: `days to ${r.goalLabel}` }),
    ]),
    r.target ? el('p', { class: 'road-target', text: r.target }) : null,
    el('div', { class: 'road-timebar' }, [el('div', { class: 'road-timefill', style: `width:${r.pctTime || 0}%` })]),
    el('div', { class: 'road-timemeta' }, [
      el('span', { text: `Week ${r.currentWeek}` }),
      el('span', { text: `${r.pctTime || 0}% of the runway used` }),
      el('span', { text: `by ${fmtDate(r.goalDate)}` }),
    ]),
    el('div', { class: 'road-verdict ' + (r.onTrack ? 'ok' : 'behind') }, [
      el('span', { class: 'road-verdict-dot' }),
      el('span', { text: r.onTrack ? 'On track — keep the pace.' : 'Behind pace — tighten up this week.' }),
    ]),
  ]);
  wrap.append(head);

  // ---- Pacing: what the remaining work demands, and how you're doing ----
  const p = r.pacing;
  const paceTile = (lbl, big, sub, tone) => el('div', { class: 'road-tile' + (tone ? ` t-${tone}` : '') }, [
    el('div', { class: 'road-tile-lbl', text: lbl }),
    el('div', { class: 'road-tile-big', text: big }),
    el('div', { class: 'road-tile-sub', text: sub }),
  ]);
  wrap.append(el('div', { class: 'road-section' }, [
    el('div', { class: 'road-h', text: 'The pace to hold' }),
    el('div', { class: 'road-tiles' }, [
      paceTile('LeetCode', `${p.lc.done}/${p.lc.goal}`,
        `need ~${p.lc.perWeek}/wk · doing ${p.lc.actualPerWeek}`, p.lc.onTrack ? 'ok' : 'warn'),
      paceTile('Topics', `${p.topics.done}/${p.topics.total}`,
        `${p.topics.remaining} left · ~${p.topics.perWeek}/wk`, p.topics.onTrack ? 'ok' : 'warn'),
      paceTile('Study / week', `~${p.hours.needed ?? '—'}h`,
        `you did ${p.hours.actual}h last 7 days`, (p.hours.needed != null && p.hours.actual >= p.hours.needed) ? 'ok' : 'warn'),
      paceTile('Concepts solid', `${p.concepts.solid}/${p.concepts.total || 0}`,
        p.concepts.total ? `${p.concepts.shaky} shaky · ${p.concepts.noyet} not yet` : 'none rated yet'),
    ]),
  ]));

  // ---- This week / month / quarter — same plan at three zooms ----
  const H = r.horizons;
  const horizonCard = (title, h, milestone) => el('div', { class: 'road-hz' }, [
    el('div', { class: 'road-hz-top' }, [
      el('span', { class: 'road-hz-title', text: title }),
      el('span', { class: 'road-hz-window', text: `through ${fmtDate(h.endDate)}` }),
    ]),
    milestone ? el('div', { class: 'road-hz-goal', text: milestone }) : null,
    el('div', { class: 'road-hz-targets' }, [
      el('span', { class: 'road-hz-t' }, [el('b', { text: `${h.lc}` }), ' LeetCode']),
      el('span', { class: 'road-hz-t' }, [el('b', { text: `${h.topics}` }), h.topics === 1 ? ' topic' : ' topics']),
      h.hours != null ? el('span', { class: 'road-hz-t' }, [el('b', { text: `~${h.hours}h` }), ' study']) : null,
    ]),
  ]);
  // Which phases should be wrapped up within a window → a plain-language milestone.
  const milestoneFor = (endISO) => {
    const due = r.phases.filter((ph) => ph.status !== 'done' && ph.endDate && ph.endDate <= endISO);
    if (!due.length) return r.currentPhase ? `Push through ${r.currentPhase.name}` : '';
    return `Finish ${due.map((ph) => ph.name).join(' + ')}`;
  };
  wrap.append(el('div', { class: 'road-section' }, [
    el('div', { class: 'road-h', text: 'Your horizons' }),
    el('div', { class: 'road-hzs' }, [
      horizonCard('This week', H.week, r.currentPhase ? `Focus: ${r.currentPhase.name}` : ''),
      horizonCard('This month', H.month, milestoneFor(H.month.endDate)),
      horizonCard('This quarter', H.quarter, milestoneFor(H.quarter.endDate)),
    ]),
  ]));

  // ---- The arc: the phase trajectory to the offer ----
  const STLABEL = { done: 'Done', current: 'Now', behind: 'Behind', upcoming: 'Ahead' };
  const arc = el('div', { class: 'road-arc' });
  r.phases.forEach((ph) => {
    arc.append(el('div', { class: `road-phase s-${ph.status}` }, [
      el('div', { class: 'road-phase-rail' }, [el('span', { class: 'road-phase-node' })]),
      el('div', { class: 'road-phase-body' }, [
        el('div', { class: 'road-phase-top' }, [
          el('span', { class: 'road-phase-name', text: ph.name }),
          el('span', { class: `road-phase-tag st-${ph.status}`, text: STLABEL[ph.status] || '' }),
        ]),
        el('div', { class: 'road-phase-meta', text: [
          ph.weekStart ? (ph.weekEnd ? `Weeks ${ph.weekStart}–${ph.weekEnd}` : `Week ${ph.weekStart}+`) : '',
          `${fmtDate(ph.startDate)} – ${fmtDate(ph.endDate)}`,
          `${ph.done}/${ph.total} topics`,
        ].filter(Boolean).join('  ·  ') }),
        el('div', { class: 'road-phase-track' }, [el('div', { class: 'road-phase-fill', style: `width:${ph.pct}%` })]),
      ]),
    ]));
  });
  wrap.append(el('div', { class: 'road-section' }, [
    el('div', { class: 'road-h', text: 'The arc to the offer' }),
    arc,
  ]));

  // ---- Up next: the unlocked topics to pick up now ----
  if (r.nextTopics.length) {
    wrap.append(el('div', { class: 'road-section' }, [
      el('div', { class: 'road-h', text: 'Up next' }),
      el('div', { class: 'road-next' }, r.nextTopics.map((t) => el('button', {
        class: 'road-next-row', onclick: () => navigate('/plan'),
      }, [
        el('span', { class: 'road-next-dot', style: `background:${AREA_DOT[t.area] || '#a9acb2'}` }),
        el('span', { class: 'road-next-t', text: t.title }),
        el('span', { class: 'road-next-meta', text: [t.area, t.est ? `~${t.est}m` : ''].filter(Boolean).join(' · ') }),
      ]))),
    ]));
  }

  // ---- Where the effort has gone + jump to detail ----
  if (r.byArea.length) {
    const amax = Math.max(1, ...r.byArea.map((a) => a.minutes));
    wrap.append(el('div', { class: 'road-section' }, [
      el('div', { class: 'road-h', text: 'Effort so far, by area' }),
      el('div', { class: 'area-bars' }, r.byArea.map((a) => el('div', { class: 'area-bar' }, [
        el('div', { class: 'area-bar-top' }, [
          el('span', { class: 'area-name', text: a.area }),
          el('span', { class: 'area-min', text: fmtDur(a.minutes) }),
        ]),
        el('div', { class: 'area-track' }, [el('div', { class: 'area-fill', style: `width:${Math.round((a.minutes / amax) * 100)}%` })]),
      ]))),
    ]));
  }

  wrap.append(el('div', { class: 'road-links' }, [
    el('button', { class: 'btn-link', text: 'Full progress →', onclick: () => navigate('/progress') }),
    el('button', { class: 'btn-link', text: 'The topic list →', onclick: () => navigate('/plan') }),
  ]));
}
