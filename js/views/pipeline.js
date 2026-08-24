// Recruiting pipeline — the goal is an offer, not a finished syllabus. A light
// board of company/role rows with a stage, independent of curriculum progress.
import { el, clear, fill, toast, todayISO } from '../util.js';
import { getPipeline, upsertPipelineEntry, deletePipelineEntry, pipelineSummary, PIPELINE_STATUSES } from '../store.js';

const STAGE_LABEL = {
  target: 'Target', referral: 'Referral', applied: 'Applied', recruiter: 'Recruiter screen',
  oa: 'Online assessment', technical: 'Technical', onsite: 'Onsite', offer: 'Offer',
  rejected: 'Rejected', withdrawn: 'Withdrawn',
};
const ACTIVE = ['target', 'referral', 'applied', 'recruiter', 'oa', 'technical', 'onsite'];

export async function renderPipeline(mount, { navigate }) {
  const wrap = el('div', { class: 'pipe-wrap' });
  mount.append(wrap);
  await paint();

  async function paint() {
    const [rows, sum] = await Promise.all([getPipeline(), pipelineSummary()]);
    clear(wrap);
    wrap.append(
      el('p', { class: 'eyebrow', text: 'Recruiting' }),
      el('h1', { text: 'Pipeline' }),
      el('p', { class: 'muted', text: 'Your path to an offer, tracked separately from the curriculum. Start early — applications don’t wait for the syllabus.' }),
    );

    // Rollup counts.
    wrap.append(el('div', { class: 'pipe-rollup' }, [
      tile('Active', sum.active), tile('Applications', sum.applications),
      tile('Interviewing', sum.interviewing), tile('Offers', sum.offers),
    ]));

    // Add form.
    const company = el('input', { type: 'text', class: 'pipe-in', placeholder: 'Company', spellcheck: false });
    const role = el('input', { type: 'text', class: 'pipe-in', placeholder: 'Role (optional)', spellcheck: false });
    const src = el('input', { type: 'text', class: 'pipe-in', placeholder: 'Source / referral contact (optional)', spellcheck: false });
    const add = el('button', { class: 'btn btn-primary', text: 'Add', onclick: async () => {
      if (!company.value.trim()) { toast('Company?', true); return; }
      await upsertPipelineEntry({ company: company.value.trim(), role: role.value.trim(), source: src.value.trim(), referral: /refer/i.test(src.value), status: 'target' });
      toast('Added'); await paint();
    } });
    wrap.append(el('div', { class: 'pipe-add' }, [company, role, src, add]));

    if (!rows.length) { wrap.append(el('p', { class: 'muted', style: 'margin-top:16px', text: 'No companies yet — add your first target above.' })); return; }

    const list = el('div', { class: 'pipe-list' });
    for (const r of rows) list.append(rowNode(r, paint));
    wrap.append(list);
  }

  function tile(label, n) {
    return el('div', { class: 'pipe-tile' }, [el('div', { class: 'pipe-tile-n', text: String(n) }), el('div', { class: 'pipe-tile-l', text: label })]);
  }

  function rowNode(r, repaint) {
    const stageSel = el('select', { class: 'pipe-stage st-' + r.status, onchange: async () => {
      const patch = { ...r, status: stageSel.value };
      if (stageSel.value === 'applied' && !r.appliedAt) patch.appliedAt = todayISO();
      await upsertPipelineEntry(patch); await repaint();
    } }, PIPELINE_STATUSES.map((s) => el('option', { value: s, text: STAGE_LABEL[s] || s, selected: s === r.status })));

    const next = el('input', { type: 'date', class: 'pipe-date', value: r.nextStepAt || '', onchange: async () => { await upsertPipelineEntry({ ...r, nextStepAt: next.value || null }); toast('Saved'); } });
    const notes = el('input', { type: 'text', class: 'pipe-notes', placeholder: 'Notes', value: r.notes || '', onchange: async () => { await upsertPipelineEntry({ ...r, notes: notes.value }); } });
    const del = el('button', { class: 'pipe-x', 'aria-label': 'Remove', text: '×', onclick: async () => { if (confirm(`Remove ${r.company}?`)) { await deletePipelineEntry(r.id); await repaint(); } } });

    return el('div', { class: 'pipe-row' + (ACTIVE.includes(r.status) ? '' : ' inactive') }, [
      el('div', { class: 'pipe-row-top' }, [
        el('span', { class: 'pipe-co', text: r.company }),
        r.role ? el('span', { class: 'pipe-role', text: r.role }) : null,
        del,
      ]),
      el('div', { class: 'pipe-row-ctl' }, [stageSel, el('label', { class: 'pipe-datel' }, [el('span', { text: 'Next' }), next])]),
      notes,
    ]);
  }
}
