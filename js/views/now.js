// Now — the dashboard. High level: pick an area (DSA / System Design /
// Reading / …), all peers, nudged by recent history. Reading is a first-class
// area that tracks a streak. The topic + how is revealed later, in prep.
import { el, clear, fill, habitStats, todayISO } from '../util.js';
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

  // Every surfaceable area is a peer — including recurring habits like Reading.
  const areas = [];
  for (const it of surfaceable) { const a = it.area || 'Study'; if (!areas.includes(a)) areas.push(a); }
  const nextForArea = (a) => surfaceable.find((i) => (i.area || 'Study') === a) || null;

  if (areas.length === 0) {
    const anyLeft = items.some((i) => i.status === 'todo');
    mount.append(el('div', { class: 'center-state' }, [
      el('h1', { text: anyLeft ? 'Nothing unlocked' : 'All clear' }),
      el('p', { class: 'muted', text: anyLeft
        ? 'The next items are waiting on their dependencies. Finish what unlocks them, or review the plan.'
        : 'Everything in the plan is done or skipped. Time to update the plan.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:12px', text: 'Review plan', onclick: () => navigate('/plan') }),
    ]));
    return;
  }

  const log = await getLog();
  const suggestion = suggest(areas, log);
  let selectedArea = suggestion.area;

  const wrap = el('div', { class: 'now-wrap' });
  mount.append(wrap);
  render();

  function isHabit(area) { const i = nextForArea(area); return !!(i && i.recurring); }

  function coachFor(area) {
    if (isHabit(area)) return habitLine(area, log);
    if (area === suggestion.area) return suggestion.nudge;
    return AREA_LINE[area] || AREA_LINE.Study;
  }

  function render() {
    const item = nextForArea(selectedArea);
    const reading = isHabit(selectedArea);

    const areaChips = el('div', { class: 'areas' }, areas.map((a) =>
      el('button', {
        class: 'ctx-chip' + (a === selectedArea ? ' on' : ''),
        text: a,
        onclick: () => { selectedArea = a; render(); },
      })));

    fill(clear(wrap), [
      item && item.week != null && item.week > 0 ? el('p', { class: 'eyebrow', text: `Week ${item.week}` }) : null,
      el('div', { class: 'coach', text: coachFor(selectedArea) }),
      el('div', { class: 'dur-label', text: 'What are you focusing on?' }),
      areaChips,
      el('button', {
        class: 'btn btn-primary btn-lg btn-block',
        text: reading ? 'Start reading' : 'Start studying',
        onclick: () => item && navigate(`/prep/${item.id}`),
      }),
    ]);
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
  if (areas.length === 1) return { area: areas[0], nudge: AREA_LINE_default(areas[0]) };

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

function AREA_LINE_default(area) { return AREA_LINE[area] || AREA_LINE.Study; }
