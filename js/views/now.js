// Now — the dashboard. High level on purpose: it suggests an *area* to study
// (never the specific topic), nudged by your recent history. The actual "what"
// and "how" is revealed only once you commit, in the prep flow.
import { el, clear } from '../util.js';
import { hasPlan, getItems, getLog, availableAreas, nextItemForArea } from '../store.js';

// A directive line per area, used when you pick an area yourself.
const AREA_LINE = {
  'DSA': 'Patterns only stick with reps. Get one in.',
  'System Design': 'Think in tradeoffs — one system at a time.',
  'Behavioral': 'Your stories win the room. Shape one.',
  'Reading': 'Wind down with the book. Small and steady.',
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

  const areas = await availableAreas();
  if (areas.length === 0) {
    const items = await getItems();
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

  async function render() {
    const item = await nextItemForArea(selectedArea);
    const coachText = selectedArea === suggestion.area
      ? suggestion.nudge
      : (AREA_LINE[selectedArea] || AREA_LINE.Study);

    const areaChips = el('div', { class: 'areas' }, areas.map((a) =>
      el('button', {
        class: 'ctx-chip' + (a === selectedArea ? ' on' : ''),
        text: a,
        onclick: () => { selectedArea = a; render(); },
      })));

    clear(wrap).append(
      item && item.phase ? el('p', { class: 'eyebrow', text: phaseEyebrow(item) }) : null,
      el('div', { class: 'coach', text: coachText }),
      el('div', { class: 'dur-label', text: 'What are you studying?' }),
      areaChips,
      el('button', {
        class: 'btn btn-primary btn-lg btn-block',
        text: 'Start studying',
        onclick: () => item && navigate(`/prep/${item.id}`),
      }),
      el('p', { class: 'now-foot muted', text: 'High level for now — the what and how come when you sit down.' }),
    );
  }
}

function phaseEyebrow(item) {
  const bits = [];
  // We surface phase/week only (never the topic) to keep the dashboard high level.
  if (item.week != null && item.week > 0) bits.push(`Week ${item.week}`);
  return bits.join(' · ');
}

// Choose an area to suggest and a coaching nudge, from recent history.
function suggest(areas, log) {
  const recent = [...log].reverse().map((e) => e.area).filter(Boolean); // most recent first
  if (areas.length === 1) {
    return { area: areas[0], nudge: `Let’s get into ${areas[0]}.` };
  }

  // streak of the most-recent area
  const streakArea = recent[0] || null;
  let streak = 0;
  for (const a of recent) { if (a === streakArea) streak++; else break; }

  // prefer the available area you've touched least recently
  let best = areas[0];
  let bestScore = -1;
  for (const a of areas) {
    const idx = recent.indexOf(a);
    const score = idx === -1 ? Infinity : idx; // not seen recently => most neglected
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
