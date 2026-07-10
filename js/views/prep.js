// Prep — the drill-in from "Start studying". This is where the specific topic
// is finally revealed, along with a short ritual and how to approach it. Then
// you pick a length and begin the timer.
import { el, clear, fill } from '../util.js';
import { getItem, getPhases } from '../store.js';

const DURATIONS = [25, 50, 90];

const HOW = {
  DESK: 'At your desk. Screen open — implement it for real, don’t just read.',
  TRANSIT: 'Concept-level. No coding — read it, picture it, let it sink in.',
  WIND_DOWN: 'Low effort. Read or recall gently; this is your wind-down.',
};
const MODE_NICE = { DESK: 'Deep work', TRANSIT: 'On the go', WIND_DOWN: 'Wind-down' };

const RITUAL = [
  'Phone on Focus, face down or aside',
  'Close every other tab and app',
  'Water within reach — one thing on screen',
];

export async function renderPrep(mount, { arg, navigate }) {
  const item = await getItem(arg);
  if (!item) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h2', { text: 'That item is gone.' }),
      el('button', { class: 'btn btn-primary', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  const phases = await getPhases();
  const phaseName = (phases.find((p) => p.id === item.phase) || {}).name || '';
  let minutes = defaultMinutesFor(item);

  const wrap = el('div', { class: 'prep' });
  mount.append(wrap);
  render();

  function render() {
    const ctxBits = [];
    if (item.area) ctxBits.push(item.area);
    if (phaseName) ctxBits.push(phaseName);
    if (item.week != null && item.week > 0) ctxBits.push(`Week ${item.week}`);

    const howBits = [];
    if (item.mode && MODE_NICE[item.mode]) howBits.push(MODE_NICE[item.mode]);
    if (item.estMinutes) howBits.push(`~${item.estMinutes} min`);

    const dur = el('div', { class: 'dur' }, DURATIONS.map((d) =>
      el('button', {
        class: 'dur-chip' + (d === minutes ? ' on' : ''),
        text: `${d} min`,
        onclick: () => { minutes = d; render(); },
      })));

    fill(clear(wrap), [
      el('button', { class: 'prep-back', text: '← Not now', onclick: () => navigate('/now') }),

      ctxBits.length ? el('p', { class: 'eyebrow', text: ctxBits.join(' · ') }) : null,
      el('p', { class: 'prep-lead', text: 'Focus on this' }),
      el('h1', { class: 'prep-title', text: item.title }),

      howBits.length ? el('p', { class: 'prep-how-meta', text: howBits.join('  ·  ') }) : null,
      item.mode && HOW[item.mode] ? el('p', { class: 'prep-how', text: HOW[item.mode] }) : null,

      el('div', { class: 'prep-ritual' }, [
        el('p', { class: 'prep-ritual-head', text: 'Before you start' }),
        el('ul', {}, RITUAL.map((r) => el('li', { text: r }))),
      ]),

      el('div', { class: 'dur-label', text: 'How long are you sitting?' }),
      dur,
      el('button', {
        class: 'btn btn-primary btn-lg btn-block',
        text: `Begin — ${minutes} min`,
        onclick: () => navigate(`/focus/${item.id}/${minutes}`),
      }),
    ]);
  }
}

function defaultMinutesFor(item) {
  if (!item.estMinutes) return DURATIONS[0];
  return DURATIONS.reduce((best, d) =>
    Math.abs(d - item.estMinutes) < Math.abs(best - item.estMinutes) ? d : best, DURATIONS[0]);
}
