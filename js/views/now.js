// Now — the dashboard. The study areas are always shown (a stable switcher),
// nudged by recent history. Reading is a first-class peer that tracks a streak.
// The topic + how is revealed later, in prep.
import { el, clear, fill, habitStats, todayISO, addDaysISO, daysBetween, nowMinutes, toMinutes, fmtTimeOfDay, fmtDur, estimateCognitiveLoad, loadStatus, withinCapacity, CONTEXTS } from '../util.js';
import { hasPlan, getItems, getLog, depsSatisfied, getContext, setContext, getSettings, getReading } from '../store.js';

const AREA_LINE = {
  'DSA': 'Patterns only stick with reps. Get one in.',
  'System Design': 'Think in tradeoffs — one system at a time.',
  'Behavioral': 'Your stories win the room. Shape one.',
  'Applications': 'Momentum matters. Push this forward.',
  'Reading': 'Feed your head. Open the book.',
  'Study': 'One thing. Let’s go.',
};

export async function renderNow(mount, { navigate }) {
  if (!(await hasPlan())) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h1', { text: 'Ready when you are.' }),
      el('p', { class: 'muted', text: 'Add your plan once from Data, top-right — then Guruji just hands you one thing at a time. Nothing else to set up.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', text: 'Import a plan', onclick: () => navigate('/data') }),
    ]));
    return;
  }

  const items = await getItems();
  const statusById = new Map(items.map((i) => [i.id, i.status]));
  const surfaceable = items.filter((i) => i.status === 'todo' && depsSatisfied(i, statusById));

  // Every area in the plan is always a chip (stable), in plan order.
  const allAreas = [];
  for (const it of items) { const a = it.area || 'Study'; if (!allAreas.includes(a)) allAreas.push(a); }
  // Areas that have something to start right now (for the smart default).
  const availAreas = [];
  for (const it of surfaceable) { const a = it.area || 'Study'; if (!availAreas.includes(a)) availAreas.push(a); }
  const nextForArea = (a) => surfaceable.find((i) => (i.area || 'Study') === a) || null;

  const log = await getLog();
  const context = await getContext();
  const load = estimateCognitiveLoad(log, context);
  const status = loadStatus(load);

  // Routine context: how long until bedtime, and the nonchalant goal countdown.
  const today = todayISO();
  const settings = await getSettings();
  let bedMin = settings.bedtime ? toMinutes(settings.bedtime) : null;
  if (bedMin != null && bedMin < 5 * 60) bedMin += 24 * 60; // a past-midnight bedtime is late tonight, not early today
  const toBed = bedMin != null ? bedMin - nowMinutes() : Infinity;
  const daysToGoal = settings.goalDate ? daysBetween(today, settings.goalDate) : null;
  const habitDoneToday = (area) => log.some((e) => e.area === area && e.result === 'done' && e.date === today);

  // A quiet effort line — the feedback loop at a glance, tappable for the full
  // Progress view. Computed from the session log's real focus minutes.
  const minByDate = new Map();
  for (const e of log) minByDate.set(e.date, (minByDate.get(e.date) || 0) + Math.max(0, Math.round(e.focusMinutes || 0)));
  let weekMin = 0;
  for (let k = 0; k < 7; k++) weekMin += (minByDate.get(addDaysISO(today, -k)) || 0);
  let studyStreak = 0;
  let sc = (minByDate.get(today) || 0) > 0 ? today : addDaysISO(today, -1);
  while ((minByDate.get(sc) || 0) > 0) { studyStreak += 1; sc = addDaysISO(sc, -1); }
  const effortEl = log.length ? el('button', { class: 'effort-strip', onclick: () => navigate('/progress') }, [
    el('span', { class: 'effort-b', text: fmtDur(weekMin) }), el('span', { class: 'effort-t', text: ' this week' }),
    el('span', { class: 'effort-sep', text: '·' }),
    el('span', { class: 'effort-b', text: String(studyStreak) }), el('span', { class: 'effort-t', text: ' day streak' }),
    el('span', { class: 'effort-arrow', text: '›' }),
  ]) : null;

  const reading = await getReading();
  const bookTitle = reading.current ? reading.current.title : null;

  // The coach's call: one area, with the reasoning behind it. It weighs what's
  // surfaceable, your recent history, your reading streak, and — crucially —
  // your cognitive load, so it steers you off deep work when you're loaded.
  const rec = recommend();
  let selectedArea = rec.area;

  const wrap = el('div', { class: 'now-wrap' });
  mount.append(wrap);
  render();

  function isHabit(area) { const i = nextForArea(area); return !!(i && i.recurring); }
  function modeWord(mode) { return mode === 'DESK' ? 'deep work' : mode === 'TRANSIT' ? 'concept work' : 'this'; }

  function coachFor(area) {
    if (isHabit(area)) return habitLine(area, log, bookTitle);
    const item = nextForArea(area);
    if (!item) {
      const hasTodo = items.some((i) => (i.area || 'Study') === area && i.status === 'todo');
      return hasTodo ? `${area} is locked for now — clear its prerequisites first.` : `You’ve cleared everything in ${area}.`;
    }
    return AREA_LINE[area] || AREA_LINE.Study;
  }

  // Decide what to do, and say why with conviction.
  function recommend() {
    if (!availAreas.length) {
      return { area: allAreas[0], headline: 'You’re clear for now.', reason: 'Everything ready is done. Take a look at the map for what’s next — or call it and rest.' };
    }

    // Near bedtime, protect the daily habit: if reading isn't done today and
    // it's available, that's the one thing left — even ten minutes counts.
    if (toBed > 0 && toBed <= 90) {
      const habitArea = availAreas.find((a) => isHabit(a) && !habitDoneToday(a));
      if (habitArea) {
        return { area: habitArea, headline: `Ten minutes, then bed — ${habitArea}.`, reason: `It’s the one thing left today. A short read keeps the streak and the routine — the hard stuff can wait for tomorrow.` };
      }
    }

    const within = availAreas.filter((a) => { const it = nextForArea(a); return it && withinCapacity(it.mode, load); });

    // Loaded past capacity for everything available → steer to the lightest thing.
    if (!within.length) {
      const MW = { WIND_DOWN: 0, TRANSIT: 1, DESK: 2 };
      const area = [...availAreas].sort((a, b) => (MW[nextForArea(a).mode] ?? 2) - (MW[nextForArea(b).mode] ?? 2))[0];
      return { area, headline: `Go light — ${area}.`, reason: `You’re at ${load}%. The hard stuff won’t stick right now; keep it gentle and protect the quality.` };
    }

    const pick = suggest(within, log);
    const area = pick.area;

    // How long have you been on one area?
    const recent = [...log].reverse().map((e) => e.area).filter(Boolean);
    const streakArea = recent[0] || null;
    let streak = 0;
    for (const a of recent) { if (a === streakArea) streak++; else break; }

    if (isHabit(area)) return { area, headline: `Read tonight — ${area}.`, reason: habitLine(area, log, bookTitle) };
    if (streakArea && streak >= 2 && streakArea !== area) {
      return { area, headline: `Switch to ${area}.`, reason: `${streak} days straight on ${streakArea}. Stretch a different muscle today.` };
    }
    if (load < 35) return { area, headline: `Take on ${area}.`, reason: `You’re fresh — spend it on the hard reps while the focus is there.` };
    return { area, headline: `${area} — go.`, reason: pick.nudge || (AREA_LINE[area] || AREA_LINE.Study) };
  }

  function render() {
    // Build the shell once; only the per-area bits (eyebrow, verdict, reason,
    // CTA) swap, so switching areas animates smoothly instead of rebuilding.
    const eyebrowEl = el('p', { class: 'eyebrow swap' });
    const verdictEl = el('h1', { class: 'verdict swap' });
    const reasonEl = el('div', { class: 'coach swap' });
    const ctaWrap = el('div', { class: 'cta-wrap swap' });

    // The switcher is demoted: hidden behind a quiet toggle. The default path
    // is "the coach told me → I start", not "I pick from a menu".
    const chipEls = new Map();
    const areasEl = el('div', { class: 'areas', hidden: true }, allAreas.map((a) => {
      const btn = el('button', { class: 'ctx-chip' + (a === selectedArea ? ' on' : ''), text: a, onclick: () => selectArea(a) });
      chipEls.set(a, btn);
      return btn;
    }));
    const toggle = el('button', { class: 'secondary-link', text: 'Something else', onclick: () => {
      const hidden = areasEl.hasAttribute('hidden');
      if (hidden) areasEl.removeAttribute('hidden'); else areasEl.setAttribute('hidden', '');
      toggle.textContent = hidden ? 'Never mind' : 'Something else';
    } });
    // Two quiet secondary actions — the schedule lives on its own tab, not here.
    const secondary = el('div', { class: 'now-secondary' }, [
      toggle,
      el('span', { class: 'now-sep', text: '·' }),
      el('button', { class: 'secondary-link', text: 'Schedule', onclick: () => navigate('/day') }),
      el('span', { class: 'now-sep', text: '·' }),
      el('button', { class: 'secondary-link', text: 'Revise', onclick: () => navigate('/revise') }),
      el('span', { class: 'now-sep', text: '·' }),
      el('button', { class: 'secondary-link', text: 'Progress', onclick: () => navigate('/progress') }),
    ]);

    // Cognitive load: a compact gauge. The life-context picker collapses to a
    // single line so it isn't shouting for attention every visit.
    const ctxKey = (context && context.key) ? context.key : 'fresh';
    const ctxNow = ctxKey === 'fresh' ? 'Fresh' : CONTEXTS[ctxKey].label;
    const ctxChips = el('div', { class: 'ctxchips', hidden: true }, ['fresh', ...Object.keys(CONTEXTS)].map((key) =>
      el('button', {
        class: 'ctxchip' + (key === ctxKey ? ' on' : ''),
        text: key === 'fresh' ? 'Fresh' : CONTEXTS[key].label,
        onclick: async () => {
          await setContext(key === 'fresh' ? null : { key, setAt: new Date().toISOString() });
          navigate('/now');
        },
      })));
    const ctxLine = el('button', { class: 'ctx-summary', onclick: () => {
      const hidden = ctxChips.hasAttribute('hidden');
      if (hidden) ctxChips.removeAttribute('hidden'); else ctxChips.setAttribute('hidden', '');
    } }, [
      el('span', { text: `Right now · ${ctxNow}` }),
      el('span', { class: 'ctx-caret', text: '›' }),
    ]);

    const cog = el('div', { class: `cog tone-${status.tone}` }, [
      el('div', { class: 'cog-row' }, [
        el('span', { class: 'cog-label', text: 'Cognitive load' }),
        el('span', { class: 'cog-pct', text: `${load}%` }),
      ]),
      el('div', { class: 'cog-track' }, [el('div', { class: 'cog-fill', style: `width:${load}%` })]),
      ctxLine, ctxChips,
    ]);

    // A quiet bedtime nudge — the routine's north star, escalating as it nears,
    // and pointing at a wake time that gives tomorrow the fullest run.
    let sleepEl = null;
    if (bedMin != null) {
      const soon = toBed > 0 && toBed <= 90;
      const past = toBed <= 0;
      const idealWake = (bedMin + 8 * 60) % (24 * 60); // ~8h of sleep
      const goalBit = settings.goalLabel ? ` toward ${settings.goalLabel}` : '';
      if (past) {
        sleepEl = el('div', { class: 'sleep-nudge soon' }, [
          el('div', { class: 'sleep-main', text: 'Past bedtime — time to sleep.' }),
          el('div', { class: 'sleep-sub', text: `Rest now; up by ${fmtTimeOfDay(idealWake)} sets up the fullest day${goalBit}.` }),
        ]);
      } else if (soon) {
        sleepEl = el('div', { class: 'sleep-nudge soon' }, [
          el('div', { class: 'sleep-main', text: 'Time to wind down.' }),
          el('div', { class: 'sleep-sub', text: `Bed by ${fmtTimeOfDay(bedMin)} · aim to be up by ${fmtTimeOfDay(idealWake)} for the most focus tomorrow.` }),
        ]);
      } else {
        sleepEl = el('div', { class: 'sleep-nudge', text: `Ideal lights-out · ${fmtTimeOfDay(bedMin)}` });
      }
    }

    // Nonchalant goal countdown, tucked in the corner — never bold.
    let countdown = null;
    if (daysToGoal != null) {
      const label = settings.goalLabel || 'goal';
      const txt = daysToGoal > 0 ? `${daysToGoal} days to ${label}`
        : daysToGoal === 0 ? `${label} — today`
        : `${label} — passed`;
      countdown = el('div', { class: 'goal-countdown', text: txt });
    }

    fill(clear(wrap), [
      countdown, eyebrowEl, verdictEl, reasonEl, ctaWrap, secondary, areasEl, cog, effortEl, sleepEl,
    ]);

    applyArea();

    function selectArea(a) {
      if (a === selectedArea) return;
      selectedArea = a;
      chipEls.forEach((btn, area) => btn.classList.toggle('on', area === selectedArea));
      applyArea(true);
    }

    function applyArea(animate) {
      const item = nextForArea(selectedArea);
      const isRec = selectedArea === rec.area;
      const isReadingHabit = isHabit(selectedArea);

      const wk = item && item.week != null && item.week > 0 ? `Week ${item.week}` : '';
      eyebrowEl.textContent = wk;
      eyebrowEl.style.display = wk ? '' : 'none';

      if (isRec) {
        verdictEl.textContent = rec.headline;
        reasonEl.textContent = rec.reason;
      } else if (item) {
        verdictEl.textContent = `${selectedArea} it is.`;
        reasonEl.textContent = 'Your call — I’ve got you. ' + coachFor(selectedArea);
      } else {
        verdictEl.textContent = selectedArea;
        reasonEl.textContent = coachFor(selectedArea);
      }

      let children;
      if (!item) {
        children = [el('button', { class: 'btn btn-ghost btn-lg btn-block', text: 'See the map', onclick: () => navigate('/plan') })];
      } else if (withinCapacity(item.mode, load)) {
        children = [
          el('button', { class: 'btn btn-primary btn-lg btn-block', text: isReadingHabit ? 'Start reading' : 'Start studying', onclick: () => navigate(`/prep/${item.id}`) }),
          isReadingHabit ? el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px', text: 'Your reading', onclick: () => navigate('/reading') }) : null,
        ];
      } else {
        children = [
          el('div', { class: 'gate-note', text: `You're at ${load}% — ${modeWord(item.mode)} will be a grind right now.` }),
          el('button', { class: 'btn btn-ghost btn-lg btn-block', text: 'Start anyway', onclick: () => navigate(`/prep/${item.id}`) }),
        ];
      }
      fill(clear(ctaWrap), children);

      if (animate) {
        for (const e of [eyebrowEl, verdictEl, reasonEl, ctaWrap]) { e.classList.remove('swap'); void e.offsetWidth; e.classList.add('swap'); }
      }
    }
  }
}

// ----- reading / habit coaching line from the log -----
// Leans on retention: it's not "keep the streak", it's "come away with a line".
function habitLine(area, log, book) {
  const b = book ? `“${book}”` : 'your book';
  const dates = log.filter((e) => e.area === area && e.result === 'done').map((e) => e.date);
  const s = habitStats(dates, todayISO());
  if (!s.ever) return `Start ${b} — even ten minutes, and come away with one line.`;
  if (s.daysSince === 0) return `Read today · ${s.streak}-day streak. Hold onto a line from ${b}.`;
  if (s.daysSince === 1) return `${s.streak}-day streak — pick ${b} back up tonight.`;
  return `You haven’t read in ${s.daysSince} days. Back to ${b}.`;
}

// ----- area suggestion from recent history -----
function suggest(areas, log) {
  const recent = [...log].reverse().map((e) => e.area).filter(Boolean);
  if (areas.length === 1) return { area: areas[0], nudge: AREA_LINE[areas[0]] || AREA_LINE.Study };

  const streakArea = recent[0] || null;
  let streak = 0;
  for (const a of recent) { if (a === streakArea) streak++; else break; }

  let best = areas[0];
  let bestScore = -1;
  for (const a of areas) {
    const idx = recent.indexOf(a);
    const score = idx === -1 ? Infinity : idx;
    if (score > bestScore) { bestScore = score; best = a; }
  }

  let nudge;
  if (streakArea && streak >= 2 && areas.includes(streakArea) && best !== streakArea) {
    nudge = `You’ve been deep in ${streakArea} — ${streak} in a row. Switch to ${best} today.`;
  } else if (recent.length === 0) {
    nudge = 'Fresh start. Let’s get the first rep in.';
  } else {
    nudge = `Good momentum. ${best} is up next.`;
  }
  return { area: best, nudge };
}
