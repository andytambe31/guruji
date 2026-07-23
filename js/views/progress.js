// Progress — the feedback loop. Everything here is derived from what the app
// already records: the session log (real focus time), the schedule (what was
// planned), and item statuses. No new tracking, just a mirror of your effort.
import { el, clear, fmtDur, todayISO, addDaysISO } from '../util.js';
import { computeStats } from '../store.js';
import { isReadySolve, normalizeOutcome } from '../outcomes.js';

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

  // LeetCode — the problems you logged, and where you stand across them.
  if (s.lcTotal) {
    const rel = (iso) => {
      const t = todayISO();
      if (iso === t) return 'Today';
      if (iso === addDaysISO(t, -1)) return 'Yesterday';
      return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    // Dot colour by outcome tier: ready (green), a non-independent solve (amber),
    // attempted (red). Works across the new ladder and legacy keys.
    const dotClass = (o) => { const k = normalizeOutcome(o); if (!k) return ''; if (isReadySolve(k)) return 'o-solved'; return k === 'attempted' ? 'o-stuck' : 'o-hint'; };
    const lc = el('div', { class: 'prog-section' });
    lc.append(el('div', { class: 'prog-top' }, [
      el('p', { class: 'eyebrow', text: 'LeetCode' }),
      el('div', { class: 'prog-total' }, [
        el('span', { class: 'prog-total-num', text: `${s.lcUnique}` }),
        el('span', { class: 'prog-total-lbl', text: `distinct solved · ${s.lcWeek} this week` }),
      ]),
    ]));
    // The goal — an aggressive, FAANG-ready bar. A revisited problem stays in the
    // log but doesn't move this; only a new distinct problem does, so it's an
    // honest read on how much of the interview surface you've actually covered.
    {
      const pct = Math.min(100, Math.round((s.lcUnique / s.lcGoal) * 100));
      const left = Math.max(0, s.lcGoal - s.lcUnique);
      lc.append(el('div', { class: 'lc-goal' }, [
        el('div', { class: 'lc-goal-top' }, [
          el('span', { class: 'lc-goal-lbl', text: `Goal · ${s.lcGoal}` }),
          el('span', { class: 'lc-goal-num', text: `${s.lcUnique} / ${s.lcGoal} · ${pct}%` }),
        ]),
        el('div', { class: 'adhere-track' }, [el('div', { class: 'adhere-fill', style: `width:${pct}%` })]),
        el('div', { class: 'lc-goal-note', text: left
          ? `${left} to go — the aggressive bar: enough to have seen every pattern several times over.`
          : `500 done. You've out-prepped the room.` }),
      ]));
    }
    // Revisits are welcome (they're spaced repetition) — surface them so the gap
    // between attempts logged and distinct solved is visible, not hidden.
    if (s.lcTotal > s.lcUnique) {
      lc.append(el('div', { class: 'lc-goal-sub', text: `${s.lcTotal} attempts logged · ${s.lcTotal - s.lcUnique} ${s.lcTotal - s.lcUnique === 1 ? 'revisit' : 'revisits'} (counted once)` }));
    }
    // by difficulty
    if (s.lcByDifficulty.length) {
      lc.append(el('div', { class: 'lc-diff-row' }, s.lcByDifficulty.map((d) =>
        el('span', { class: `lc-diff d-${d.difficulty.toLowerCase()}`, text: `${d.difficulty} · ${d.count}` }))));
    }
    // problems per day (last 14) — how many on which day
    const max = Math.max(1, ...s.lcLast14.map((d) => d.count));
    lc.append(el('div', { class: 'prog-sub' }, [
      el('div', { class: 'prog-subh', text: 'Per day' }),
      el('div', { class: 'prog-chart' }, s.lcLast14.map((d) => {
        const h = d.count ? Math.max(6, Math.round((d.count / max) * 70)) : 2;
        const dow = new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'narrow' });
        return el('div', { class: 'bar-col', title: `${d.date} · ${d.count}` }, [
          d.count ? el('span', { class: 'bar-val', text: `${d.count}` }) : null,
          el('div', { class: 'bar' + (d.count ? '' : ' empty'), style: `height:${h}px` }),
          el('span', { class: 'bar-lbl', text: dow }),
        ]);
      })),
    ]));
    // by pattern
    if (s.lcByPattern.length) {
      const pmax = Math.max(1, ...s.lcByPattern.map((p) => p.count));
      lc.append(el('div', { class: 'prog-sub' }, [
        el('div', { class: 'prog-subh', text: 'By pattern' }),
        el('div', { class: 'area-bars' }, s.lcByPattern.map((p) => el('div', { class: 'area-bar' }, [
          el('div', { class: 'area-bar-top' }, [
            el('span', { class: 'area-name', text: p.pattern }),
            el('span', { class: 'area-min', text: `${p.count}` }),
          ]),
          el('div', { class: 'area-track' }, [el('div', { class: 'area-fill', style: `width:${Math.round((p.count / pmax) * 100)}%` })]),
        ]))),
      ]));
    }
    // recent problems
    lc.append(el('div', { class: 'prog-sub' }, [
      el('div', { class: 'prog-subh', text: 'Recent' }),
      el('div', { class: 'lc-plist' }, s.lcRecent.map((p) => el('div', { class: 'lc-prow' }, [
        el('div', { class: 'lc-pmain' }, [
          el('span', { class: `lc-dot ${dotClass(p.outcome)}` }),
          el('span', { class: 'lc-pname', text: p.title || p.slug || '(problem)' }),
        ]),
        el('span', { class: 'lc-pmeta', text: [p.difficulty, p.pattern, rel(p.date)].filter(Boolean).join(' · ') }),
      ]))),
    ]));
    wrap.append(lc);
  }

  // CS Fundamentals — concept confidence: where you're solid vs need review.
  if (s.conceptsTotal) {
    const rel = (iso) => {
      const t = todayISO();
      if (iso === t) return 'Today';
      if (iso === addDaysISO(t, -1)) return 'Yesterday';
      return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    };
    const cc = s.conceptConfidence;
    const CLABEL = { solid: 'Solid', shaky: 'Shaky', noyet: 'Not yet' };
    const cs = el('div', { class: 'prog-section' });
    cs.append(el('div', { class: 'prog-top' }, [
      el('p', { class: 'eyebrow', text: 'CS Fundamentals' }),
      el('div', { class: 'prog-total' }, [
        el('span', { class: 'prog-total-num', text: `${cc.solid}/${s.conceptsTotal}` }),
        el('span', { class: 'prog-total-lbl', text: 'concepts solid' }),
      ]),
    ]));
    cs.append(el('div', { class: 'cw-diff-row' }, [
      cc.solid ? el('span', { class: 'cw-tag c-solid', text: `Solid · ${cc.solid}` }) : null,
      cc.shaky ? el('span', { class: 'cw-tag c-shaky', text: `Shaky · ${cc.shaky}` }) : null,
      cc.noyet ? el('span', { class: 'cw-tag c-noyet', text: `Not yet · ${cc.noyet}` }) : null,
    ]));
    if (s.conceptsReview.length) {
      cs.append(el('div', { class: 'prog-sub' }, [
        el('div', { class: 'prog-subh', text: 'To review' }),
        el('div', { class: 'lc-plist' }, s.conceptsReview.map((c) => el('div', { class: 'lc-prow' }, [
          el('div', { class: 'lc-pmain' }, [
            el('span', { class: `lc-dot c-${c.confidence}` }),
            el('span', { class: 'lc-pname', text: c.concept }),
          ]),
          el('span', { class: 'lc-pmeta', text: [CLABEL[c.confidence], rel(c.date)].filter(Boolean).join(' · ') }),
        ]))),
      ]));
    }
    wrap.append(cs);
  }

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
    const today = todayISO();
    const rel = (iso) => {
      if (iso === today) return 'Today';
      if (iso === addDaysISO(today, -1)) return 'Yesterday';
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
