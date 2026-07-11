// Now — the dashboard. The study areas are always shown (a stable switcher),
// nudged by recent history. Reading is a first-class peer that tracks a streak.
// The topic + how is revealed later, in prep.
import { el, clear, fill, habitStats, todayISO, estimateCognitiveLoad, loadStatus } from '../util.js';
import { hasPlan, getItems, getLog, depsSatisfied } from '../store.js';

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
  const load = estimateCognitiveLoad(log);
  const status = loadStatus(load);
  const suggestion = availAreas.length ? suggest(availAreas, log) : { area: allAreas[0], nudge: '' };
  let selectedArea = suggestion.area;

  const wrap = el('div', { class: 'now-wrap' });
  mount.append(wrap);
  render();

  function isHabit(area) { const i = nextForArea(area); return !!(i && i.recurring); }

  function coachFor(area) {
    if (isHabit(area)) return habitLine(area, log);
    const item = nextForArea(area);
    if (!item) {
      const hasTodo = items.some((i) => (i.area || 'Study') === area && i.status === 'todo');
      return hasTodo ? `${area} is locked for now — clear its prerequisites first.` : `You’ve cleared everything in ${area}.`;
    }
    if (area === suggestion.area) return suggestion.nudge || (AREA_LINE[area] || AREA_LINE.Study);
    return AREA_LINE[area] || AREA_LINE.Study;
  }

  function render() {
    // Build the shell once; only the per-area bits (eyebrow, coach, CTA) swap,
    // so switching areas animates smoothly instead of rebuilding everything.
    const eyebrowEl = el('p', { class: 'eyebrow swap' });
    const coachEl = el('div', { class: 'coach swap' });
    const ctaWrap = el('div', { class: 'cta-wrap swap' });

    const chipEls = new Map();
    const areasEl = el('div', { class: 'areas' }, allAreas.map((a) => {
      const btn = el('button', { class: 'ctx-chip' + (a === selectedArea ? ' on' : ''), text: a, onclick: () => selectArea(a) });
      chipEls.set(a, btn);
      return btn;
    }));

    const cog = el('div', { class: `cog tone-${status.tone}` }, [
      el('div', { class: 'cog-row' }, [
        el('span', { class: 'cog-label', text: 'Cognitive load' }),
        el('span', { class: 'cog-pct', text: `${load}%` }),
      ]),
      el('div', { class: 'cog-track' }, [el('div', { class: 'cog-fill', style: `width:${load}%` })]),
      el('div', { class: 'cog-note', text: status.note }),
    ]);

    fill(clear(wrap), [
      eyebrowEl, coachEl,
      el('div', { class: 'dur-label', text: 'What are you focusing on?' }),
      areasEl, ctaWrap, cog,
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
      const reading = isHabit(selectedArea);

      const wk = item && item.week != null && item.week > 0 ? `Week ${item.week}` : '';
      eyebrowEl.textContent = wk;
      eyebrowEl.style.display = wk ? '' : 'none';
      coachEl.textContent = coachFor(selectedArea);

      const cta = item
        ? el('button', { class: 'btn btn-primary btn-lg btn-block', text: reading ? 'Start reading' : 'Start studying', onclick: () => navigate(`/prep/${item.id}`) })
        : el('button', { class: 'btn btn-ghost btn-lg btn-block', text: 'See the map', onclick: () => navigate('/plan') });
      clear(ctaWrap).append(cta);

      if (animate) {
        for (const e of [eyebrowEl, coachEl, ctaWrap]) { e.classList.remove('swap'); void e.offsetWidth; e.classList.add('swap'); }
      }
    }
  }
}

// ----- reading / habit coaching line from the log -----
function habitLine(area, log) {
  const dates = log.filter((e) => e.area === area && e.result === 'done').map((e) => e.date);
  const s = habitStats(dates, todayISO());
  if (!s.ever) return 'New reading habit — even 10 minutes tonight counts.';
  if (s.daysSince === 0) return `Read today · ${s.streak}-day streak. Keep it alive.`;
  if (s.daysSince === 1) return `${s.streak}-day reading streak — read tonight to keep it.`;
  return `You haven’t read in ${s.daysSince} days. Pick the book back up.`;
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
