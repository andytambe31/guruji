// Concepts — the Drills catalog. You tell the app which concepts you've actually
// studied; a concept's fill-in-the-blank drills only unlock once it's ticked here
// (or you've solved a matching LeetCode problem, which unlocks it automatically).
// This closes the gap where Drills used to presume you'd studied everything.
import { el, clear } from '../util.js';
import { CONCEPTS, drillsForConcept } from './drills.js';
import { NUGGET_BANK, conceptOfNugget } from './nuggets.js';
import { getStudiedConcepts, toggleStudiedConcept, computeDeck } from '../store.js';

const nuggetsForConcept = (id) => NUGGET_BANK().filter((n) => conceptOfNugget(n) === id).length;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function renderConcepts(mount, { navigate }) {
  const [studiedRaw, deck] = await Promise.all([getStudiedConcepts(), computeDeck().catch(() => ({ problems: [] }))]);
  const studied = { ...(studiedRaw || {}) };

  // LeetCode problems you've logged — these auto-unlock the matching drills.
  const solvedKeys = new Set();
  for (const p of (deck.problems || [])) { if (p.slug) solvedKeys.add(norm(p.slug)); if (p.title) solvedKeys.add(norm(p.title)); }
  const solvedInConcept = (id) => drillsForConcept(id).filter((d) => solvedKeys.has(d.id) || solvedKeys.has(norm(d.title))).length;

  const wrap = el('div', { class: 'concepts-wrap' });
  mount.append(wrap);

  // What's unlocked right now (studied concepts + LeetCode-solved drills).
  const unlockedCounts = () => CONCEPTS.reduce((acc, c) => {
    acc.drills += studied[c.id] ? drillsForConcept(c.id).length : solvedInConcept(c.id);
    acc.nuggets += studied[c.id] ? nuggetsForConcept(c.id) : 0;
    return acc;
  }, { drills: 0, nuggets: 0 });

  const byArea = new Map();
  for (const c of CONCEPTS) { if (!byArea.has(c.area)) byArea.set(c.area, []); byArea.get(c.area).push(c); }

  const footer = el('div', { class: 'con-footer' });
  function paintFooter() {
    clear(footer);
    const { drills, nuggets } = unlockedCounts();
    footer.append(
      el('p', { class: 'con-summary', text: `${drills} drill${drills === 1 ? '' : 's'} · ${nuggets} nugget${nuggets === 1 ? '' : 's'} unlocked` }),
      el('button', { class: 'btn btn-primary btn-block', text: 'Start drilling', onclick: () => navigate('/drills') }),
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px', text: 'Browse nuggets', onclick: () => navigate('/nuggets') }),
    );
  }

  function conRow(c) {
    const drills = drillsForConcept(c.id);
    const solved = solvedInConcept(c.id);
    const on = () => !!studied[c.id];
    const check = el('button', { class: 'con-check' + (on() ? ' on' : ''), type: 'button', 'aria-label': 'Mark studied', text: on() ? '✓' : '' });
    const meta = el('div', { class: 'con-meta' });
    const nuggets = nuggetsForConcept(c.id);
    const paintMeta = () => {
      clear(meta);
      const bits = [];
      if (drills.length) bits.push(`${drills.length} drill${drills.length === 1 ? '' : 's'}`);
      if (nuggets) bits.push(`${nuggets} nugget${nuggets === 1 ? '' : 's'}`);
      if (!bits.length) bits.push('coming soon');
      if (!on() && solved) bits.push(`${solved} unlocked from LeetCode`);
      meta.append(el('span', { text: bits.join(' · ') }));
    };
    paintMeta();
    const row = el('button', { class: 'con-row' + (on() ? ' studied' : ''), type: 'button', onclick: async () => {
      const next = await toggleStudiedConcept(c.id);   // persists; returns the new full set
      for (const k of Object.keys(studied)) delete studied[k];
      Object.assign(studied, next);
      check.classList.toggle('on', on()); check.textContent = on() ? '✓' : '';
      row.classList.toggle('studied', on());
      paintMeta(); paintFooter();
    } }, [
      check,
      el('div', { class: 'con-body' }, [
        el('div', { class: 'con-name', text: c.name }),
        meta,
      ]),
    ]);
    return row;
  }

  const list = el('div', { class: 'con-list' });
  for (const [area, cs] of byArea) {
    list.append(el('div', { class: 'con-group-label', text: area }));
    for (const c of cs) list.append(conRow(c));
  }

  wrap.append(
    el('div', { class: 'revise-top' }, [
      el('p', { class: 'eyebrow', text: 'Drills · concepts' }),
      el('button', { class: 'revise-close', 'aria-label': 'Close', text: '✕', onclick: () => navigate('/now') }),
    ]),
    el('h1', { class: 'con-h', text: 'What have you studied?' }),
    el('p', { class: 'con-sub muted', text: 'Tick a concept once you’ve covered it — its fill-in-the-blank drills unlock here. Anything you’ve logged on LeetCode counts automatically.' }),
    list,
    footer,
  );
  paintFooter();
}
