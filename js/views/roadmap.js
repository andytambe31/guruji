// Roadmap — the strategic view: are we on track for the offer, and what does each
// week / month / quarter demand? One page that ties the plan's phase trajectory,
// the countdown, and everything captured (LeetCode, concepts, topics, effort)
// into "here's the plan to land a FAANG offer in N days."
import { el, clear, fmtDur, todayISO, addDaysISO } from '../util.js';
import { computeRoadmap, getDrillState, getNuggetState, getItems, getStudiedConcepts, getWeekSolved, toggleWeekSolved } from '../store.js';
import { PROBLEM_BANK, conceptsForTitles, ALL_CONCEPT_KEYS } from '../problems.js';

const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const AREA_DOT = { DSA: '#3b5bd9', 'System Design': '#0f9d6b', 'CS Fundamentals': '#7d5bd6', Behavioral: '#d05b7d', Applications: '#c98a2e', Reading: '#d98324' };

// Remembered across navigations within the session — the phone's default is the
// focused weekly view; the full roadmap is a tap away.
let mode = 'week';

export async function renderRoadmap(mount, { navigate }) {
  const [r, drillState, nuggetState, items, studied] = await Promise.all([
    computeRoadmap(), getDrillState(), getNuggetState(), getItems(), getStudiedConcepts(),
  ]);
  let weekSolved = r.goalDate ? await getWeekSolved(r.currentWeek) : {};
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

  // Repetition achieved this week: drill + nugget cards reviewed in the last 7 days.
  const weekAgo = addDaysISO(todayISO(), -6);
  const repsIn = (st) => Object.values(st || {}).filter((s) => s && s.at && String(s.at) >= weekAgo).length;
  const repsThisWeek = repsIn(drillState) + repsIn(nuggetState);

  // ---- Mode toggle: focused week vs full roadmap ----
  wrap.append(el('div', { class: 'seg road-seg' }, [
    el('button', { class: 'seg-btn' + (mode === 'week' ? ' on' : ''), text: 'This week', onclick: () => { mode = 'week'; clear(wrap); build(); } }),
    el('button', { class: 'seg-btn' + (mode === 'full' ? ' on' : ''), text: 'Roadmap', onclick: () => { mode = 'full'; clear(wrap); build(); } }),
  ]));

  build();

  function build() {
    // re-add the toggle after a clear()
    if (!wrap.querySelector('.road-seg')) {
      wrap.append(el('div', { class: 'seg road-seg' }, [
        el('button', { class: 'seg-btn' + (mode === 'week' ? ' on' : ''), text: 'This week', onclick: () => { mode = 'week'; clear(wrap); build(); } }),
        el('button', { class: 'seg-btn' + (mode === 'full' ? ' on' : ''), text: 'Roadmap', onclick: () => { mode = 'full'; clear(wrap); build(); } }),
      ]));
    }
    if (mode === 'week') renderThisWeek();
    else renderFull();
  }

  // =================== THIS WEEK — concrete, named work ===================
  function renderThisWeek() {
    const ph = r.currentPhase;

    // This week's concepts: patterns the current phase's DSA topics cover. If the
    // phase has no pattern-topics (e.g. an interview-mode phase), fall back to the
    // whole bank so there's always concrete work to keep sharp.
    const phaseTitles = items
      .filter((i) => i.area === 'DSA' && (!ph || i.phase === ph.id))
      .map((i) => i.title);
    let conceptKeys = conceptsForTitles(phaseTitles);
    if (!conceptKeys.length) conceptKeys = conceptsForTitles(items.filter((i) => i.area === 'DSA' && i.status === 'todo').map((i) => i.title));
    if (!conceptKeys.length) conceptKeys = ALL_CONCEPT_KEYS;

    const allProblems = conceptKeys.flatMap((k) => PROBLEM_BANK[k].problems);
    const solvedCount = () => allProblems.filter((pr) => weekSolved[pr.t]).length;

    // Minimal header — just the week + focus.
    wrap.append(el('div', { class: 'tw-head' }, [
      el('div', { class: 'tw-week' }, [
        el('span', { class: 'tw-week-n', text: `Week ${r.currentWeek}` }),
        el('span', { class: 'tw-week-win', text: ph ? ph.name : `${r.daysLeft} days to ${r.goalLabel}` }),
      ]),
    ]));

    // ---- Concepts + the exact problems to solve for each ----
    const counter = el('span', { class: 'tw-count', text: `${solvedCount()} / ${allProblems.length} solved` });
    wrap.append(el('div', { class: 'road-h tw-h' }, [el('span', { text: 'Solve these — this week' }), counter]));

    for (const key of conceptKeys) {
      const c = PROBLEM_BANK[key];
      const isStudied = !!studied[key];
      const block = el('div', { class: 'tw-concept' });
      block.append(el('div', { class: 'tw-concept-top' }, [
        el('span', { class: 'tw-concept-name', text: c.name }),
        el('span', { class: 'tw-concept-tag' + (isStudied ? ' studied' : ''), text: isStudied ? 'studied' : 'to study' }),
      ]));
      for (const pr of c.problems) {
        const row = el('button', { class: 'tw-prob' + (weekSolved[pr.t] ? ' done' : ''), onclick: async () => {
          weekSolved = await toggleWeekSolved(r.currentWeek, pr.t);
          row.classList.toggle('done', !!weekSolved[pr.t]);
          row.querySelector('.tw-box').textContent = weekSolved[pr.t] ? '☑' : '☐';
          counter.textContent = `${solvedCount()} / ${allProblems.length} solved`;
        } }, [
          el('span', { class: 'tw-box', text: weekSolved[pr.t] ? '☑' : '☐' }),
          el('span', { class: 'tw-prob-t', text: pr.t }),
          el('span', { class: 'lc-diff ' + (pr.d === 'Hard' ? 'd-hard' : 'd-medium'), text: pr.d }),
        ]);
        block.append(row);
      }
      wrap.append(block);
    }

    // ---- Repetition — measured by drills + nuggets reviewed this week ----
    const dReps = repsIn(drillState), nReps = repsIn(nuggetState);
    wrap.append(el('div', { class: 'road-h tw-h', style: 'margin-top:26px' }, [el('span', { text: 'Repetition — this week' })]));
    wrap.append(el('div', { class: 'tw-reps' }, [
      el('button', { class: 'tw-rep', onclick: () => navigate('/drills') }, [
        el('span', { class: 'tw-rep-n', text: `${dReps}` }), el('span', { class: 'tw-rep-l', text: 'drills reviewed' }),
      ]),
      el('button', { class: 'tw-rep', onclick: () => navigate('/nuggets') }, [
        el('span', { class: 'tw-rep-n', text: `${nReps}` }), el('span', { class: 'tw-rep-l', text: 'nuggets reviewed' }),
      ]),
    ]));

    wrap.append(el('div', { class: 'road-links' }, [
      el('button', { class: 'btn-link', text: 'Full roadmap →', onclick: () => { mode = 'full'; clear(wrap); build(); } }),
    ]));
  }

  // =================== FULL ROADMAP (the original strategic view) =============
  function renderFull() {
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
  } // end renderFull
}
