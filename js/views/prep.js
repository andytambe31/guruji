// Prep — the drill-in from "Start studying". This is where the specific topic
// is finally revealed, along with a short ritual and how to approach it. Then
// you pick a length and begin the timer.
import { el, clear, fill, toMinutes, nowMinutes } from '../util.js';
import { getItem, getPhases, getSettings, getReading, getBlock } from '../store.js';
import { renderPreview } from '../objectives.js';

const DURATIONS = [25, 50, 90];

// As bedtime nears, the choices shrink. Deep work needs to finish before bed;
// a gentle read gets a little grace so you can still get the habit in.
function windowDurations(mode, toBed) {
  const base = mode === 'WIND_DOWN' ? [10, 25, 50] : [25, 50, 90];
  let opts = base.filter((d) => d <= toBed);
  if (mode === 'WIND_DOWN' && !opts.length && toBed > 0) opts = [10];
  return opts;
}

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
  // arg is "itemId" or "itemId/blockId" when started from a planned block, so
  // the block travels through to the focus session.
  const parts = String(arg).split('/');
  const itemId = parts[0];
  const blockId = parts[1] || null;
  const item = await getItem(itemId);
  if (!item) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h2', { text: 'That item is gone.' }),
      el('button', { class: 'btn btn-primary', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  const phases = await getPhases();
  const phaseName = (phases.find((p) => p.id === item.phase) || {}).name || '';
  // The planned block (if any) carries the predicted load, so the expectations
  // preview is sized to how spent you'll be — light after work, deep when fresh.
  const block = blockId ? await getBlock(blockId) : null;
  const blockLoad = block ? block.load : null;

  // Reading reveals the actual book + your intent, not the generic habit title.
  const reading = item.area === 'Reading' ? await getReading() : null;
  const book = reading && reading.current;

  const settings = await getSettings();
  let bedMin = settings.bedtime ? toMinutes(settings.bedtime) : null;
  if (bedMin != null && bedMin < 5 * 60) bedMin += 24 * 60; // a past-midnight bedtime is late tonight, not early today
  const toBed = bedMin != null ? bedMin - nowMinutes() : Infinity;
  const opts = windowDurations(item.mode, toBed);
  const blocked = opts.length === 0; // too late for this kind of work
  let minutes = opts.includes(defaultMinutesFor(item)) ? defaultMinutesFor(item) : (opts[opts.length - 1] || 25);

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

    // When it's too late, we don't offer a session at all — routine over reps.
    let tail;
    if (blocked) {
      const past = toBed <= 0;
      const line = item.mode === 'WIND_DOWN'
        ? (past ? 'You’re past bedtime. Rest — tomorrow’s rep matters more.' : 'Almost bedtime. Wind down and sleep — the streak survives one quiet night.')
        : 'It’s wind-down time. Deep work resets tomorrow — protect your sleep and keep the routine.';
      tail = el('div', { class: 'bedtime-block' }, [
        el('p', { class: 'bedtime-note', text: line }),
        el('button', { class: 'btn btn-ghost btn-lg btn-block', text: 'Back to Now', onclick: () => navigate('/now') }),
      ]);
    } else {
      const nearBed = Number.isFinite(toBed) && toBed <= 90;
      const dur = el('div', { class: 'dur' }, opts.map((d) =>
        el('button', {
          class: 'dur-chip' + (d === minutes ? ' on' : ''),
          text: `${d} min`,
          onclick: () => { minutes = d; render(); },
        })));
      tail = el('div', {}, [
        el('div', { class: 'dur-label', text: nearBed ? 'Keep it short — bed soon' : 'How long are you sitting?' }),
        dur,
        el('button', {
          class: 'btn btn-primary btn-lg btn-block',
          text: `Begin — ${minutes} min`,
          onclick: () => navigate(`/focus/${item.id}/${minutes}${blockId ? `/${blockId}` : ''}`),
        }),
      ]);
    }

    fill(clear(wrap), [
      el('button', { class: 'prep-back', text: '← Not now', onclick: () => navigate('/now') }),

      ctxBits.length ? el('p', { class: 'eyebrow', text: ctxBits.join(' · ') }) : null,
      el('p', { class: 'prep-lead', text: book ? 'Pick it back up' : 'Focus on this' }),
      el('h1', { class: 'prep-title', text: book ? book.title : item.title }),
      book && book.author ? el('p', { class: 'prep-how-meta', text: book.author }) : null,

      book && book.intent ? el('p', { class: 'prep-how', text: `Why: ${book.intent}` }) : null,
      book ? el('button', { class: 'btn-link', style: 'text-align:left;width:auto;padding:6px 0', text: 'Your reading & reflections →', onclick: () => navigate('/reading') }) : null,

      !book && howBits.length ? el('p', { class: 'prep-how-meta', text: howBits.join('  ·  ') }) : null,
      !book && item.mode && HOW[item.mode] ? el('p', { class: 'prep-how', text: HOW[item.mode] }) : null,

      // What "done" looks like for this session — disclosed up front so you begin
      // with the target in mind, not just a timer.
      renderPreview(item, minutes, blockLoad),

      el('div', { class: 'prep-ritual' }, [
        el('p', { class: 'prep-ritual-head', text: 'Before you start' }),
        el('ul', {}, RITUAL.map((r) => el('li', { text: r }))),
      ]),

      tail,
    ]);
  }
}

function defaultMinutesFor(item) {
  if (!item.estMinutes) return DURATIONS[0];
  return DURATIONS.reduce((best, d) =>
    Math.abs(d - item.estMinutes) < Math.abs(best - item.estMinutes) ? d : best, DURATIONS[0]);
}
