// Plan list — grouped by top-level plan (Job Switch, Literature…), then phase.
// Minimal: a dot, the title, quiet done/skip; locked items dim.
import { el, clear, toast } from '../util.js';
import { getPlans, getPhases, getItems, setItemStatus, depsSatisfied } from '../store.js';

export async function renderPlan(mount, { navigate }) {
  async function paint() {
    const [plans, phases, items] = await Promise.all([getPlans(), getPhases(), getItems()]);
    clear(mount);

    if (!items.length) {
      mount.append(el('div', { class: 'center-state' }, [
        el('p', { class: 'eyebrow', text: 'Plans' }),
        el('h1', { text: 'No plan loaded' }),
        el('button', { class: 'btn btn-ghost', text: 'Import a plan', onclick: () => navigate('/data') }),
      ]));
      return;
    }

    const statusById = new Map(items.map((i) => [i.id, i.status]));
    const itemsByPhase = new Map();
    for (const it of items) {
      if (!itemsByPhase.has(it.phase)) itemsByPhase.set(it.phase, []);
      itemsByPhase.get(it.phase).push(it);
    }
    const phasesByTrack = new Map();
    for (const ph of phases) {
      if (!phasesByTrack.has(ph.track)) phasesByTrack.set(ph.track, []);
      phasesByTrack.get(ph.track).push(ph);
    }

    mount.append(el('p', { class: 'eyebrow', text: 'Your plans' }), el('h1', { text: 'Plans' }));

    // Fallback: any phases without a known plan get grouped under a synthetic one.
    const planList = plans.length ? plans : [...phasesByTrack.keys()].map((id) => ({ id, name: id }));

    for (const pl of planList) {
      const planPhases = phasesByTrack.get(pl.id) || [];
      const planItems = planPhases.flatMap((ph) => itemsByPhase.get(ph.id) || []);
      if (!planItems.length) continue;
      const done = planItems.filter((i) => i.status === 'done').length;
      const pct = Math.round((done / planItems.length) * 100);

      const section = el('div', { class: 'plan-section' }, [
        el('div', { class: 'plan-name-row' }, [
          el('h2', { class: 'plan-name', text: pl.name }),
          el('span', { class: 'plan-count', text: `${done}/${planItems.length}` }),
        ]),
        el('div', { class: 'progress-track' }, [el('div', { class: 'progress-fill', style: `width:${pct}%` })]),
      ]);

      for (const ph of planPhases) {
        const list = itemsByPhase.get(ph.id) || [];
        if (!list.length) continue;
        section.append(el('p', { class: 'phase-label', text: ph.name }));
        for (const it of list) section.append(row(it));
      }
      mount.append(section);
    }

    function row(it) {
      const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
      const doneBtn = el('button', {
        class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''),
        text: 'Done', onclick: () => toggle(it, 'done'),
      });
      const skipBtn = el('button', {
        class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''),
        text: 'Skip', onclick: () => toggle(it, 'skipped'),
      });
      return el('div', { class: `plan-item ${it.status}${locked ? ' locked' : ''}` }, [
        el('span', { class: `pdot ${it.mode || ''}` }),
        el('div', { class: 'body' }, [
          el('div', { class: 't', text: it.title }),
          it.estMinutes ? el('div', { class: 'sub', text: `~${it.estMinutes} min` }) : null,
        ]),
        el('div', { class: 'row-actions' }, [doneBtn, skipBtn]),
      ]);
    }

    async function toggle(it, target) {
      const next = it.status === target ? 'todo' : target;
      await setItemStatus(it.id, next);
      toast(next === 'todo' ? 'Back to todo' : next === 'done' ? 'Done' : 'Skipped');
      await paint();
    }
  }

  await paint();
}
