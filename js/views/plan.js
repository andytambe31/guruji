// Plan list — a quiet reference of everything, grouped by phase. Minimal:
// just a dot, the title, and unobtrusive done/skip actions. Locked items dim.
import { el, clear, fill, toast } from '../util.js';
import { getPhases, getItems, setItemStatus, depsSatisfied } from '../store.js';

export async function renderPlan(mount, { navigate }) {
  async function paint() {
    const [phases, items] = await Promise.all([getPhases(), getItems()]);
    clear(mount);

    if (!items.length) {
      mount.append(el('div', { class: 'center-state' }, [
        el('p', { class: 'eyebrow', text: 'Plan' }),
        el('h1', { text: 'No plan loaded' }),
        el('button', { class: 'btn btn-ghost', text: 'Import a plan', onclick: () => navigate('/data') }),
      ]));
      return;
    }

    const statusById = new Map(items.map((i) => [i.id, i.status]));
    const doneCount = items.filter((i) => i.status === 'done').length;
    const pct = Math.round((doneCount / items.length) * 100);

    mount.append(
      el('p', { class: 'eyebrow', text: `${doneCount} of ${items.length} done` }),
      el('h1', { text: 'Plan' }),
      el('div', { class: 'progress-track' }, [el('div', { class: 'progress-fill', style: `width:${pct}%` })]),
    );

    const byPhase = new Map();
    for (const it of items) {
      if (!byPhase.has(it.phase)) byPhase.set(it.phase, []);
      byPhase.get(it.phase).push(it);
    }

    for (const ph of phases) {
      const list = byPhase.get(ph.id) || [];
      if (!list.length) continue;
      const block = el('div', { class: 'phase-block' }, [el('h2', { text: ph.name })]);
      for (const it of list) block.append(row(it));
      mount.append(block);
    }

    function row(it) {
      const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
      const doneBtn = el('button', {
        class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''),
        text: 'Done',
        onclick: () => toggle(it, 'done'),
      });
      const skipBtn = el('button', {
        class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''),
        text: 'Skip',
        onclick: () => toggle(it, 'skipped'),
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
