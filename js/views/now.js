// Now — the dashboard. High level: it suggests a study *area* (never the topic),
// nudged by recent history, and separately keeps a persistent reading-habit
// strip going by streak/recency. The actual "what/how" is revealed in prep.
import { el, clear, habitStats, todayISO } from '../util.js';
import { hasPlan, getItems, getLog, depsSatisfied } from '../store.js';

const AREA_LINE = {
  'DSA': 'Patterns only stick with reps. Get one in.',
  'System Design': 'Think in tradeoffs — one system at a time.',
  'Behavioral': 'Your stories win the room. Shape one.',
  'Applications': 'Momentum matters. Push this forward.',
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

  // Study areas come from non-recurring items; recurring items (reading) are habits.
  const studyItems = surfaceable.filter((i) => !i.recurring);
  const studyAreas = [];
  for (const it of studyItems) { const a = it.area || 'Study'; if (!studyAreas.includes(a)) studyAreas.push(a); }
  const nextForArea = (a) => studyItems.find((i) => (it2area(i)) === a) || null;

  const readingItem = surfaceable.find((i) => i.recurring) || null;

  const log = await getLog();
  const readingStrip = readingItem ? buildReadingStrip(readingItem, log, navigate) : null;

  // Nothing to study and nothing to read → caught up / blocked.
  if (studyAreas.length === 0 && !readingItem) {
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

  // Caught up on study, but the reading habit lives on.
  if (studyAreas.length === 0) {
    mount.append(el('div', { class: 'now-wrap' }, [
      el('div', { class: 'coach', text: 'Caught up on study. Keep the habit going.' }),
      readingStrip,
    ]));
    return;
  }

  const suggestion = suggest(studyAreas, log);
  let selectedArea = suggestion.area;

  const wrap = el('div', { class: 'now-wrap' });
  mount.append(wrap);
  render();

  function render() {
    const item = nextForArea(selectedArea);
    const coachText = selectedArea === suggestion.area
      ? suggestion.nudge
      : (AREA_LINE[selectedArea] || AREA_LINE.Study);

    const areaChips = el('div', { class: 'areas' }, studyAreas.map((a) =>
      el('button', {
        class: 'ctx-chip' + (a === selectedArea ? ' on' : ''),
        text: a,
        onclick: () => { selectedArea = a; render(); },
      })));

    clear(wrap).append(
      item && item.week != null && item.week > 0 ? el('p', { class: 'eyebrow', text: `Week ${item.week}` }) : null,
      el('div', { class: 'coach', text: coachText }),
      el('div', { class: 'dur-label', text: 'What are you studying?' }),
      areaChips,
      el('button', {
        class: 'btn btn-primary btn-lg btn-block',
        text: 'Start studying',
        onclick: () => item && navigate(`/prep/${item.id}`),
      }),
      readingStrip,
    );
  }
}

function it2area(i) { return i.area || 'Study'; }

// ----- reading habit strip -----
function buildReadingStrip(readingItem, log, navigate) {
  const dates = log.filter((e) => e.area === 'Reading' && e.result === 'done').map((e) => e.date);
  const s = habitStats(dates, todayISO());
  let line;
  if (!s.ever) line = 'New habit — even 10 minutes tonight counts.';
  else if (s.daysSince === 0) line = `Read today · ${s.streak}-day streak`;
  else if (s.daysSince === 1) line = `${s.streak}-day streak — read tonight to keep it`;
  else line = `Last read ${s.daysSince} days ago — pick it back up`;

  return el('button', {
    class: 'habit',
    onclick: () => navigate(`/prep/${readingItem.id}`),
  }, [
    el('span', { class: 'habit-ic', text: '📖' }),
    el('span', { class: 'habit-text' }, [
      el('div', { class: 'habit-title', text: 'Reading habit' }),
      el('div', { class: 'habit-sub', text: line }),
    ]),
    el('span', { class: 'habit-go', text: 'Read →' }),
  ]);
}

// ----- study-area suggestion from recent history -----
function suggest(areas, log) {
  const recent = [...log].reverse().map((e) => e.area).filter(Boolean);
  if (areas.length === 1) return { area: areas[0], nudge: `Let’s get into ${areas[0]}.` };

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
    nudge = `You’ve been deep in ${streakArea} — ${streak} in a row. Ease into ${best} today.`;
  } else if (recent.length === 0) {
    nudge = 'Fresh start. Let’s get the first rep in.';
  } else {
    nudge = `Good momentum. ${best} is up next.`;
  }
  return { area: best, nudge };
}
