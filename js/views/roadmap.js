// Roadmap — the strategic view: are we on track for the offer, and what does each
// week / month / quarter demand? One page that ties the plan's phase trajectory,
// the countdown, and everything captured (LeetCode, concepts, topics, effort)
// into "here's the plan to land a FAANG offer in N days."
import { el, clear, fmtDur, todayISO, addDaysISO } from '../util.js';
import { computeRoadmap, getDrillState, getNuggetState, getItems, getStudiedConcepts, getLog, resumeAfterBreak, clearStudyCycle } from '../store.js';
import { PROBLEM_BANK, conceptsForTitles, ALL_CONCEPT_KEYS } from '../problems.js';
import { CONCEPTS } from './drills.js';
import { isReadySolve } from '../outcomes.js';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
const AREA_DOT = { DSA: '#3b5bd9', 'System Design': '#0f9d6b', 'CS Fundamentals': '#7d5bd6', Behavioral: '#d05b7d', Applications: '#c98a2e', Reading: '#d98324' };

// Remembered across navigations within the session — the phone's default is the
// focused weekly view; the full roadmap is a tap away.
let mode = 'week';
// Which DSA concept groups are expanded in the This-week view. Collapsed by
// default so the page reads as a clean pattern list; tap one open to see the
// exact problems. Persisted across re-renders within the session.
const twOpen = new Set();

export async function renderRoadmap(mount, { navigate }) {
  const [r, drillState, nuggetState, items, studied, log] = await Promise.all([
    computeRoadmap(), getDrillState(), getNuggetState(), getItems(), getStudiedConcepts(), getLog(),
  ]);
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

  // Map feasibility/execution statuses onto the shared colour classes.
  // (function declarations so they hoist above the build() call at mount.)
  function rsClass(s) {
    return ({
      comfortable: 'ok', achievable: 'ok', ok: 'ok', on: 'on',
      tight: 'tight', aggressive: 'tight', 'at-risk': 'risk', risk: 'risk',
      rebuilding: 'rebuilding', unrealistic: 'off', off: 'off', unknown: 'unknown',
    })[s] || 'unknown';
  }
  function fmtDay(iso) {
    return iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  }

  // ---- GOAL: the offer deadline + runway (always calendar/real). ----
  function goalBlock() {
    return el('div', { class: 'road-goal' }, [
      el('div', { class: 'road-goal-k', text: 'Offer deadline' }),
      el('div', { class: 'road-goal-v', text: fmtDay(r.goalDate) }),
      el('div', { class: 'road-goal-sub', text: `${r.daysLeft} days remaining · ${r.pctTime || 0}% of runway used` }),
    ]);
  }

  // ---- CURRENT STATE: study vs calendar week, execution, feasibility — kept
  // as SEPARATE reads so a break reads as "rebuilding", not "impossible". ----
  function statusBlock() {
    const f = r.feasibility || {}; const e = r.execution || {};
    const rows = [
      el('div', { class: 'rs-row' }, [
        el('span', { class: 'rs-k', text: 'Study week' }),
        el('span', { class: 'rs-v rs-plain', text: `Week ${r.currentStudyWeek}` }),
      ]),
      el('div', { class: 'rs-row' }, [
        el('span', { class: 'rs-k', text: 'Calendar week' }),
        el('span', { class: 'rs-v rs-plain', text: `Week ${r.currentCalendarWeek}${r.weeksBehindCalendar ? ` (+${r.weeksBehindCalendar} lost to break)` : ''}` }),
      ]),
      el('div', { class: 'rs-row' }, [
        el('span', { class: 'rs-k', text: 'Execution' }),
        el('span', { class: `rs-v rs-${rsClass(e.status)}`, text: e.label || '—' }),
      ]),
      el('div', { class: 'rs-row' }, [
        el('span', { class: 'rs-k', text: 'Feasibility' }),
        el('span', { class: `rs-v rs-${rsClass(f.status)}`, text: f.label || '—' }),
      ]),
    ];
    if (f.reason) rows.push(el('div', { class: 'rs-reason', text: f.reason }));
    return el('div', { class: 'road-status' }, rows);
  }

  // ---- Resume after break: re-anchor the STUDY sequence to today without
  // touching the deadline. Lets the user pick which curriculum week to resume. ----
  function resumeControl() {
    const box = el('div', { class: 'road-resume' });
    const render = () => {
      clear(box);
      if (r.studyCycle && r.studyCycle.anchorDate) {
        box.append(el('div', { class: 'road-resume-on' }, [
          el('span', { text: `Resumed from study week ${r.studyCycle.anchorWeek} · anchored ${fmtDay(r.studyCycle.anchorDate)}` }),
          el('button', { class: 'btn-link', text: 'Re-anchor', onclick: openPicker }),
          el('button', { class: 'btn-link', text: 'Clear', onclick: async () => { await clearStudyCycle(); location.reload(); } }),
        ]));
      } else {
        box.append(el('button', { class: 'btn btn-ghost road-resume-btn', text: 'Resume after break', onclick: openPicker }));
      }
    };
    function openPicker() {
      clear(box);
      const dflt = (r.currentPhase && r.currentPhase.weekStart) || r.currentStudyWeek || 1;
      const wk = el('input', { type: 'number', min: '1', value: String(dflt), class: 'road-resume-wk' });
      box.append(el('div', { class: 'road-resume-pick' }, [
        el('span', { text: 'Resume from curriculum week' }),
        wk,
        el('button', { class: 'btn btn-primary', text: 'Resume', onclick: async () => { await resumeAfterBreak(parseInt(wk.value, 10) || dflt); location.reload(); } }),
        el('button', { class: 'btn-link', text: 'Cancel', onclick: render }),
      ]));
    }
    render();
    return box;
  }

  // ---- THIS WEEK'S COMMITMENTS: what you're committing to (not deadline demand). ----
  function commitmentsBlock() {
    const cp = r.commitmentProgress || {};
    const dd = r.deadlineDemand || {};
    const row = (key, label) => {
      const p = cp[key] || { actual: 0, target: 0, met: false };
      return el('div', { class: 'cm-row' + (p.met ? ' met' : '') }, [
        el('span', { class: 'cm-l', text: label }),
        el('span', { class: 'cm-v' }, [el('b', { text: `${p.actual}` }), el('span', { text: ` / ${p.target}` })]),
        el('div', { class: 'cm-bar' }, [el('div', { class: 'cm-fill', style: `width:${p.pct}%` })]),
      ]);
    };
    return el('div', { class: 'road-section' }, [
      el('div', { class: 'road-h', text: 'This week’s commitments' }),
      row('focusHours', 'Focus hours'),
      row('freshProblems', 'Fresh LeetCode'),
      row('readySolves', 'Independent+ solves'),
      row('coldResolves', 'Cold re-solves'),
      row('systemDesignSessions', 'System Design sessions'),
      el('div', { class: 'cm-demand', text: `Deadline demand (for context, not the prescription): ~${dd.lcPerWeek ?? '?'} unique LC/wk · recent execution ~${r.recentWeeklyHours ?? 0}h/wk` }),
    ]);
  }

  // ---- READINESS: the primary, un-gameable signal. ----
  function readinessBlock() {
    const rd = r.readiness || {};
    const chips = (rd.patterns || []).filter((p) => p.status !== 'untouched').slice(0, 8)
      .map((p) => el('span', { class: `pm-chip pm-${p.status}`, text: `${p.name} · ${p.status}` }));
    const kids = [
      el('div', { class: 'road-h', text: 'Readiness' }),
      el('div', { class: 'rd-tiles' }, [
        el('div', { class: 'rd-tile' }, [el('div', { class: 'rd-n', text: String(rd.ready || 0) }), el('div', { class: 'rd-l', text: 'ready problems (independent+)' })]),
        el('div', { class: 'rd-tile' }, [el('div', { class: 'rd-n', text: `${rd.readyPatterns || 0}/${rd.patternsTotal || 0}` }), el('div', { class: 'rd-l', text: 'patterns interview-ready' })]),
        el('div', { class: 'rd-tile' + ((rd.reviewsDue || 0) > 0 ? ' warn' : '') }, [el('div', { class: 'rd-n', text: String(rd.reviewsDue || 0) }), el('div', { class: 'rd-l', text: 'cold reviews due' })]),
      ]),
    ];
    if (chips.length) kids.push(el('div', { class: 'pm-row' }, chips));
    else kids.push(el('p', { class: 'muted', style: 'font-size:13px', text: 'Log independent solves to build pattern readiness.' }));
    return el('div', { class: 'road-section' }, kids);
  }

  // ---- RECRUITING: independent of curriculum completion. ----
  function recruitingBlock() {
    const p = r.pipeline || {};
    return el('div', { class: 'road-section' }, [
      el('div', { class: 'road-h tw-h' }, [el('span', { text: 'Recruiting' }), el('button', { class: 'btn-link', text: 'Open pipeline →', onclick: () => navigate('/pipeline') })]),
      el('div', { class: 'rd-tiles' }, [
        el('div', { class: 'rd-tile' }, [el('div', { class: 'rd-n', text: String(p.byStatus?.target || 0) }), el('div', { class: 'rd-l', text: 'targets' })]),
        el('div', { class: 'rd-tile' }, [el('div', { class: 'rd-n', text: String(p.applications || 0) }), el('div', { class: 'rd-l', text: 'applications' })]),
        el('div', { class: 'rd-tile' }, [el('div', { class: 'rd-n', text: String(p.interviewing || 0) }), el('div', { class: 'rd-l', text: 'interview loops' })]),
        el('div', { class: 'rd-tile' + ((p.offers || 0) > 0 ? ' ok' : '') }, [el('div', { class: 'rd-n', text: String(p.offers || 0) }), el('div', { class: 'rd-l', text: 'offers' })]),
      ]),
    ]);
  }

  // =================== THIS WEEK — a mirror of the week's effort ===================
  // Nothing here is editable: everything reflects what you actually logged this
  // week. Each item is Completed (logged + confident), Attempted (logged, not
  // confident yet), or not-yet. The point is to see the time going in.
  function renderThisWeek() {
    const ph = r.currentPhase;
    const weekAgo = addDaysISO(todayISO(), -6);
    const weekLog = log.filter((e) => e.date && String(e.date) >= weekAgo);

    // LeetCode problems logged this week → status by normalised title/slug.
    const lcStatus = new Map();
    for (const e of weekLog) for (const pr of (e.leetcode || [])) {
      const key = norm(pr.slug || pr.title); if (!key) continue;
      const st = isReadySolve(pr.outcome) ? 'completed' : 'attempted';
      if (st === 'completed' || !lcStatus.has(key)) lcStatus.set(key, st);
    }
    // The week at a glance: how many distinct problems solved / attempted.
    let weekDone = 0, weekAtt = 0;
    for (const st of lcStatus.values()) { if (st === 'completed') weekDone++; else weekAtt++; }
    const weekTarget = (r.horizons && r.horizons.week && r.horizons.week.lc) || 0;
    // Which plan items you spent time on this week (for milestone "attempted").
    const workedThisWeek = new Set(weekLog.filter((e) => e.itemId).map((e) => e.itemId));

    const statusRow = (label, status, right) => el('div', { class: `tw-item st-${status}` }, [
      el('span', { class: 'tw-mark', text: status === 'completed' ? '✓' : status === 'attempted' ? '◐' : '○' }),
      el('span', { class: 'tw-item-t', text: label }),
      right || null,
    ]);
    const tally = (arr, of) => {
      const c = arr.filter((s) => s === 'completed').length, a = arr.filter((s) => s === 'attempted').length;
      const parts = [`${c} done`]; if (a) parts.push(`${a} attempted`); if (of != null) parts.push(`of ${of}`);
      return parts.join(' · ');
    };

    // Dashboard hierarchy: readiness & commitments over raw volume.
    wrap.append(el('div', { class: 'tw-head' }, [
      el('div', { class: 'tw-week' }, [
        el('span', { class: 'tw-week-n', text: `Study week ${r.currentStudyWeek}` }),
        el('span', { class: 'tw-week-win', text: ph ? ph.name : `${r.daysLeft} days to ${r.goalLabel}` }),
      ]),
    ]));
    wrap.append(goalBlock());
    wrap.append(statusBlock());
    wrap.append(resumeControl());
    wrap.append(commitmentsBlock());
    wrap.append(readinessBlock());
    wrap.append(recruitingBlock());
    // Everything below is the secondary "Volume / curriculum" detail.
    wrap.append(el('div', { class: 'road-h road-vol-h', text: 'Volume · curriculum' }));

    // ---------- DSA — the named problems, status from your logs ----------
    let conceptKeys = conceptsForTitles(items.filter((i) => i.area === 'DSA' && (!ph || i.phase === ph.id)).map((i) => i.title));
    if (!conceptKeys.length) conceptKeys = conceptsForTitles(items.filter((i) => i.area === 'DSA' && i.status === 'todo').map((i) => i.title));
    if (!conceptKeys.length) conceptKeys = ALL_CONCEPT_KEYS;
    const bankStatuses = [];
    const conceptBlocks = [];
    for (const key of conceptKeys) {
      const c = PROBLEM_BANK[key];
      const open = twOpen.has(key);
      const sts = c.problems.map((pr) => lcStatus.get(norm(pr.t)) || 'none');
      sts.forEach((s) => bankStatuses.push(s));
      const done = sts.filter((s) => s === 'completed').length;
      const att = sts.filter((s) => s === 'attempted').length;
      const block = el('div', { class: 'tw-concept' + (open ? ' open' : '') });
      // Collapsed header: pattern name, studied tag, and a compact tally. Tap to
      // reveal the exact problems underneath.
      block.append(el('button', { class: 'tw-concept-top', type: 'button', 'aria-expanded': String(open), onclick: () => { if (twOpen.has(key)) twOpen.delete(key); else twOpen.add(key); clear(wrap); build(); } }, [
        el('span', { class: 'tw-chev', text: '▸' }),
        el('span', { class: 'tw-concept-name', text: c.name }),
        el('span', { class: 'tw-concept-tag' + (studied[key] ? ' studied' : ''), text: studied[key] ? 'studied' : 'to study' }),
        el('span', { class: 'tw-concept-mini', text: `${done}/${c.problems.length}${att ? ` · ${att} att` : ''}` }),
      ]));
      const body = el('div', { class: 'tw-concept-body' });
      c.problems.forEach((pr, i) => body.append(statusRow(pr.t, sts[i], el('span', { class: 'lc-diff ' + (pr.d === 'Hard' ? 'd-hard' : 'd-medium'), text: pr.d }))));
      block.append(body);
      conceptBlocks.push(block);
    }
    // Any solved this week that aren't on the named list — still real effort.
    const bankKeys = new Set(conceptKeys.flatMap((k) => PROBLEM_BANK[k].problems.map((pr) => norm(pr.t))));
    let extraDone = 0, extraAtt = 0;
    for (const [k, st] of lcStatus) if (!bankKeys.has(k)) { if (st === 'completed') extraDone++; else extraAtt++; }
    wrap.append(el('div', { class: 'road-h tw-h' }, [el('span', { text: 'DSA problems' }), el('span', { class: 'tw-count', text: tally(bankStatuses) })]));
    conceptBlocks.forEach((bl) => wrap.append(bl));
    if (extraDone || extraAtt) wrap.append(el('div', { class: 'tw-extra', text: `+ ${extraDone} more solved${extraAtt ? `, ${extraAtt} attempted` : ''} off-list this week` }));

    // ---------- System Design — this phase's milestones ----------
    const sdItems = items.filter((i) => i.area === 'System Design' && ph && i.phase === ph.id);
    if (sdItems.length) {
      const sdSt = sdItems.map((it) => it.status === 'done' ? 'completed' : (workedThisWeek.has(it.id) ? 'attempted' : 'none'));
      wrap.append(el('div', { class: 'road-h tw-h', style: 'margin-top:26px' }, [el('span', { text: 'System Design' }), el('span', { class: 'tw-count', text: tally(sdSt, sdItems.length) })]));
      const box = el('div', { class: 'tw-concept' });
      sdItems.forEach((it, i) => box.append(statusRow(it.title.replace(/^System design read:\s*/i, ''), sdSt[i])));
      wrap.append(box);
    }

    // ---------- CS Fundamentals — concepts covered ----------
    const csf = CONCEPTS.filter((c) => c.area === 'CS Fundamentals');
    if (csf.length) {
      const csfSt = csf.map((c) => studied[c.id] ? 'completed' : 'none');
      wrap.append(el('div', { class: 'road-h tw-h', style: 'margin-top:26px' }, [el('span', { text: 'CS Fundamentals' }), el('span', { class: 'tw-count', text: tally(csfSt, csf.length) })]));
      const box = el('div', { class: 'tw-concept' });
      csf.forEach((c, i) => box.append(statusRow(c.name, csfSt[i], el('button', { class: 'tw-mini-link', text: csfSt[i] === 'completed' ? 'review' : 'study', onclick: () => navigate(csfSt[i] === 'completed' ? '/nuggets' : '/concepts') }))));
      wrap.append(box);
    }

    // ---------- Repetition — drills + nuggets reviewed this week ----------
    wrap.append(el('div', { class: 'road-h tw-h', style: 'margin-top:26px' }, [el('span', { text: 'Repetition' })]));
    wrap.append(el('div', { class: 'tw-reps' }, [
      el('button', { class: 'tw-rep', onclick: () => navigate('/drills') }, [
        el('span', { class: 'tw-rep-n', text: `${repsIn(drillState)}` }), el('span', { class: 'tw-rep-l', text: 'drills reviewed' }),
      ]),
      el('button', { class: 'tw-rep', onclick: () => navigate('/nuggets') }, [
        el('span', { class: 'tw-rep-n', text: `${repsIn(nuggetState)}` }), el('span', { class: 'tw-rep-l', text: 'nuggets reviewed' }),
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
    statusBlock(),
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
