// Plan list — browse all items grouped by phase, mark done / skipped manually.
import { el, clear, MODE_LABEL, toast } from '../util.js';
import { getPhases, getItems, setItemStatus, depsSatisfied } from '../store.js';

export async function renderPlan(mount, { navigate }) {
  async function paint() {
    const [phases, items] = await Promise.all([getPhases(), getItems()]);

    clear(mount);

    if (!items.length) {
      mount.append(el('div', { class: 'center-state' }, [
        el('p', { class: 'eyebrow', text: 'Plan' }),
        el('h1', { text: 'No plan loaded' }),
        el('button', { class: 'btn btn-primary', text: 'Import plan', onclick: () => navigate('/data') }),
      ]));
      return;
    }

    const statusById = new Map(items.map((i) => [i.id, i.status]));
    const titleById = new Map(items.map((i) => [i.id, i.title]));
    const doneCount = items.filter((i) => i.status === 'done').length;

    const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;
    mount.append(
      el('p', { class: 'eyebrow', text: `${doneCount} of ${items.length} done` }),
      el('h1', { text: 'Plan' }),
      el('div', { class: 'progress-track' }, [el('div', { class: 'progress-fill', style: `width:${pct}%` })]),
      el('p', { class: 'muted', style: 'margin-top:14px', text: 'Everything in the current plan. Mark items done or skipped by hand if you need to.' }),
    );

    const itemsByPhase = new Map();
    for (const it of items) {
      if (!itemsByPhase.has(it.phase)) itemsByPhase.set(it.phase, []);
      itemsByPhase.get(it.phase).push(it);
    }

    for (const ph of phases) {
      const list = itemsByPhase.get(ph.id) || [];
      if (!list.length) continue;
      const block = el('div', { class: 'phase-block' }, [
        el('h2', { text: ph.name + (ph.dateRange ? '' : '') }),
        ph.dateRange ? el('p', { class: 'muted', style: 'margin-top:-6px;font-size:13px', text: ph.dateRange }) : null,
      ]);
      for (const it of list) {
        block.append(itemRow(it, statusById, titleById));
      }
      mount.append(block);
    }

    function itemRow(it, statusById, titleById) {
      const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
      const sub = [];
      if (it.week != null) sub.push(el('span', { text: `Week ${it.week}` }));
      if (it.estMinutes) sub.push(el('span', { text: `~${it.estMinutes} min` }));
      if (locked) {
        const need = (it.dependsOn || []).filter((d) => statusById.get(d) !== 'done')
          .map((d) => titleById.get(d) || d);
        sub.push(el('span', { text: `Waiting on: ${need.join(', ')}` }));
      }

      const doneBtn = el('button', {
        class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''),
        text: it.status === 'done' ? 'Done' : 'Mark done',
        onclick: async () => { await toggle(it, 'done'); },
      });
      const skipBtn = el('button', {
        class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''),
        text: it.status === 'skipped' ? 'Skipped' : 'Skip',
        onclick: async () => { await toggle(it, 'skipped'); },
      });

      return el('div', { class: `plan-item ${it.status}` }, [
        el('div', { class: 'body' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('span', { class: `mdot ${locked ? 'locked' : ''}` }, [
              el('span', { class: `d ${it.mode}` }),
              locked ? '🔒 ' + MODE_LABEL[it.mode] : MODE_LABEL[it.mode],
            ]),
            el('span', { class: 't', text: it.title }),
          ]),
          sub.length ? el('div', { class: 'sub' }, sub) : null,
        ]),
        el('div', { class: 'row-actions' }, [doneBtn, skipBtn]),
      ]);
    }

    async function toggle(it, target) {
      const nextStatus = it.status === target ? 'todo' : target;
      await setItemStatus(it.id, nextStatus);
      toast(nextStatus === 'todo' ? 'Reset to todo' : nextStatus === 'done' ? 'Marked done' : 'Skipped');
      await paint();
    }
  }

  await paint();
}
