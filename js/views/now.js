// Now — the dashboard. No schedule: it shows the one next thing and lets you
// say "I'm sitting down for N minutes" right here. Modes are just a lightweight
// "what are you doing right now" switch so it hands you an appropriate task.
import { el, clear, MODES, MODE_LABEL } from '../util.js';
import { hasPlan, getItems, getPhases, nextItemForMode } from '../store.js';

const DURATIONS = [25, 50, 90];

export async function renderNow(mount, { navigate }) {
  if (!(await hasPlan())) {
    mount.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Guruji' }),
      el('h1', { text: 'Nothing loaded yet' }),
      el('p', { class: 'muted', text: 'Import your plan to begin. It stays on this device — nothing is uploaded.' }),
      el('button', { class: 'btn btn-primary btn-lg', style: 'margin-top:12px', text: 'Import plan', onclick: () => navigate('/data') }),
    ]));
    return;
  }

  const phases = await getPhases();
  const phaseName = (id) => (phases.find((p) => p.id === id) || {}).name || '';

  // Which modes have a surfaceable next item right now?
  const nextByMode = {};
  for (const m of MODES) nextByMode[m] = await nextItemForMode(m);
  const availableModes = MODES.filter((m) => nextByMode[m]);

  if (availableModes.length === 0) {
    const items = await getItems();
    const anyLeft = items.some((i) => i.status === 'todo');
    mount.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Guruji' }),
      el('h1', { text: anyLeft ? 'Nothing unlocked' : 'All clear' }),
      el('p', { class: 'muted', text: anyLeft
        ? 'The next items are still waiting on their dependencies. Finish what unlocks them, or review the plan.'
        : 'Everything in the plan is done or skipped. Time to update the plan.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:12px', text: 'Review plan', onclick: () => navigate('/plan') }),
    ]));
    return;
  }

  // Default context: the mode of the earliest available item in plan order.
  let selectedMode = availableModes.reduce((best, m) =>
    (nextByMode[m].order < nextByMode[best].order ? m : best), availableModes[0]);
  let selectedMinutes = null; // null => derive a default from the item's estimate

  const wrap = el('div', { class: 'now-wrap' });
  mount.append(wrap);
  render();

  function defaultMinutesFor(item) {
    if (!item.estMinutes) return DURATIONS[0];
    // nearest offered duration to the estimate
    return DURATIONS.reduce((best, d) =>
      Math.abs(d - item.estMinutes) < Math.abs(best - item.estMinutes) ? d : best, DURATIONS[0]);
  }

  function render() {
    const item = nextByMode[selectedMode];
    const minutes = selectedMinutes ?? defaultMinutesFor(item);

    const bits = [];
    const pn = phaseName(item.phase);
    if (pn) bits.push(pn);
    if (item.week != null && item.week > 0) bits.push(`Week ${item.week}`);
    if (item.estMinutes) bits.push(`~${item.estMinutes} min`);

    const ctx = el('div', { class: 'ctx' }, availableModes.map((m) =>
      el('button', {
        class: 'ctx-chip' + (m === selectedMode ? ' on' : ''),
        onclick: () => { selectedMode = m; selectedMinutes = null; render(); },
      }, [el('span', { class: `d ${m}` }), MODE_LABEL[m]])));

    const hero = el('div', { class: 'hero' }, [
      el('div', { class: 'title', text: item.title }),
      el('div', { class: 'meta', text: bits.join('  ·  ') }),
    ]);

    const dur = el('div', { class: 'dur' }, DURATIONS.map((d) =>
      el('button', {
        class: 'dur-chip' + (d === minutes ? ' on' : ''),
        text: `${d} min`,
        onclick: () => { selectedMinutes = d; render(); },
      })));

    const start = el('button', {
      class: 'btn btn-primary btn-lg btn-block',
      text: `Sit down for ${minutes} min`,
      onclick: () => navigate(`/focus/${item.id}/${minutes}`),
    });

    clear(wrap).append(
      ctx,
      hero,
      el('div', { class: 'dur-label', text: 'How long are you sitting?' }),
      dur,
      start,
      el('p', { class: 'now-foot muted', text: 'One thing. That is the whole job right now.' }),
    );
  }
}
