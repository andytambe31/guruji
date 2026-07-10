// Now — the coach home screen. One directive item for the current pocket.
import { el, MODE_LABEL, toast } from '../util.js';
import { hasPlan, nextItemForMode, getPhases } from '../store.js';
import { getSchedule } from '../store.js';
import { activePocket, nextPocket, whenLabel } from '../schedule.js';

export async function renderNow(mount, { navigate }) {
  const planLoaded = await hasPlan();

  if (!planLoaded) {
    mount.append(
      el('div', { class: 'center-state' }, [
        el('p', { class: 'eyebrow', text: 'Guruji' }),
        el('h1', { text: 'Nothing loaded yet' }),
        el('p', { class: 'muted', text: 'Import your plan.json to begin. Your plan stays on this device — nothing is uploaded.' }),
        el('button', { class: 'btn btn-primary btn-lg', text: 'Import plan', style: 'margin-top:12px', onclick: () => navigate('/data') }),
      ]),
    );
    return;
  }

  const schedule = await getSchedule();
  const now = new Date();
  const pocket = activePocket(schedule, now);

  const phases = await getPhases();
  const phaseName = (id) => (phases.find((p) => p.id === id) || {}).name || '';

  const wrap = el('div', { class: 'now-wrap' });

  if (pocket) {
    const item = await nextItemForMode(pocket.mode);
    if (item) {
      wrap.append(heroForItem(item, pocket, phaseName(item.phase), navigate));
    } else {
      wrap.append(heroEmptyPocket(pocket, navigate));
    }
  } else {
    wrap.append(await heroNoPocket(schedule, now, navigate, phaseName));
  }

  mount.append(wrap);
}

function modeTag(mode) {
  return el('div', { class: 'mode-tag' }, [
    el('span', { class: `dot ${mode}` }),
    el('span', { text: MODE_LABEL[mode] + ' pocket' }),
  ]);
}

function heroForItem(item, pocket, phaseName, navigate) {
  const bits = [];
  if (phaseName) bits.push(phaseName);
  if (item.week != null) bits.push(`Week ${item.week}`);
  if (item.estMinutes) bits.push(`~${item.estMinutes} min`);

  const hero = el('div', { class: `hero mode-${item.mode}` }, [
    modeTag(item.mode),
    el('div', { class: 'title', text: item.title }),
    el('div', { class: 'meta', text: bits.join('  ·  ') }),
    el('div', { class: 'actions' }, [
      el('button', {
        class: 'btn btn-primary btn-lg', text: 'Start',
        onclick: () => navigate(`/focus/${item.id}`),
      }),
    ]),
  ]);

  return el('div', {}, [
    hero,
    el('p', { class: 'now-foot muted', text: 'One thing. That is the whole job right now.' }),
  ]);
}

function heroEmptyPocket(pocket, navigate) {
  const hero = el('div', { class: `hero mode-${pocket.mode}` }, [
    modeTag(pocket.mode),
    el('div', { class: 'title', text: `Nothing left in ${MODE_LABEL[pocket.mode]} for now.` }),
    el('div', { class: 'meta', text: 'Either everything here is done, or the next items are still waiting on their dependencies.' }),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn btn-ghost', text: 'Review plan', onclick: () => navigate('/plan') }),
    ]),
  ]);
  return el('div', {}, [
    hero,
    el('p', { class: 'now-foot muted', text: 'A clear pocket is allowed. Rest counts.' }),
  ]);
}

async function heroNoPocket(schedule, now, navigate, phaseName) {
  const next = nextPocket(schedule, now);
  if (!next) {
    return el('div', {}, [
      el('div', { class: 'hero' }, [
        el('div', { class: 'title', text: 'No pockets scheduled.' }),
        el('div', { class: 'meta', text: 'Add a study pocket so Guruji knows when to coach you.' }),
        el('div', { class: 'actions' }, [
          el('button', { class: 'btn btn-primary', text: 'Set up schedule', onclick: () => navigate('/schedule') }),
        ]),
      ]),
    ]);
  }

  // Peek at what the next pocket will hold.
  const peek = await nextItemForMode(next.mode);
  const when = whenLabel(next, now);

  const lines = [
    el('div', { class: 'meta', style: 'margin-bottom:6px', text: `Next up · ${when}` }),
    el('div', { class: 'title', text: peek ? peek.title : `${MODE_LABEL[next.mode]} time` }),
  ];
  if (peek) {
    const bits = [];
    const pn = phaseName(peek.phase);
    if (pn) bits.push(pn);
    if (peek.estMinutes) bits.push(`~${peek.estMinutes} min`);
    lines.push(el('div', { class: 'meta', text: bits.join('  ·  ') }));
  }

  const hero = el('div', { class: `hero mode-${next.mode}` }, [
    modeTag(next.mode),
    ...lines,
  ]);

  return el('div', {}, [
    hero,
    el('p', { class: 'now-foot muted', text: 'Not a study pocket right now. Come back when it opens.' }),
  ]);
}
