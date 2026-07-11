// Plan tab — a List view (grouped by plan → phase) and a Map view: a layered
// DAG of every item wired by its dependsOn, so you can see what unlocks what.
import { el, clear, toast } from '../util.js';
import { getPlans, getPhases, getItems, setItemStatus, depsSatisfied } from '../store.js';

const AREA_COLOR = {
  'DSA': '#3b5bd9',
  'System Design': '#0f9d6b',
  'Reading': '#c98a2e',
  'Behavioral': '#b5527e',
  'Applications': '#2f8f8a',
  'Study': '#9aa0a8',
};
const areaColor = (a) => AREA_COLOR[a] || AREA_COLOR.Study;
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c) n.appendChild(c);
  return n;
}

export async function renderPlan(mount, { navigate }) {
  let view = 'list';   // 'list' | 'map'
  let selected = null; // selected node id in map view

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
    const itemsByPhase = groupBy(items, (i) => i.phase);
    const phasesByTrack = groupBy(phases, (p) => p.track);
    const planList = plans.length ? plans : [...phasesByTrack.keys()].map((id) => ({ id, name: id }));

    const seg = el('div', { class: 'seg' }, [
      el('button', { class: 'seg-btn' + (view === 'list' ? ' on' : ''), text: 'List', onclick: () => { view = 'list'; paint(); } }),
      el('button', { class: 'seg-btn' + (view === 'map' ? ' on' : ''), text: 'Map', onclick: () => { view = 'map'; paint(); } }),
    ]);
    mount.append(el('div', { class: 'plan-top' }, [el('h1', { text: 'Plans' }), seg]));

    if (view === 'list') paintList(planList, phasesByTrack, itemsByPhase, statusById);
    else paintMap(planList, phasesByTrack, itemsByPhase, statusById);
  }

  // ---------------- List ----------------
  function paintList(planList, phasesByTrack, itemsByPhase, statusById) {
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
        for (const it of list) section.append(listRow(it, statusById));
      }
      mount.append(section);
    }
  }

  function listRow(it, statusById) {
    const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
    return el('div', { class: `plan-item ${it.status}${locked ? ' locked' : ''}` }, [
      el('span', { class: `pdot ${it.mode || ''}` }),
      el('div', { class: 'body' }, [
        el('div', { class: 't', text: it.title }),
        it.estMinutes ? el('div', { class: 'sub', text: `~${it.estMinutes} min` }) : null,
      ]),
      el('div', { class: 'row-actions' }, [
        el('button', { class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''), text: 'Done', onclick: () => toggle(it, 'done') }),
        el('button', { class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''), text: 'Skip', onclick: () => toggle(it, 'skipped') }),
      ]),
    ]);
  }

  // ---------------- Map (DAG) ----------------
  function paintMap(planList, phasesByTrack, itemsByPhase, statusById) {
    mount.append(el('p', { class: 'muted', style: 'margin:-4px 0 6px;font-size:13px', text: 'What unlocks what. Tap a node for details.' }));

    // detail bar for the selected node
    const detail = el('div', { class: 'dag-detail' });
    mount.append(detail);
    renderDetail(detail, statusById);

    for (const pl of planList) {
      const planPhases = phasesByTrack.get(pl.id) || [];
      const planItems = planPhases.flatMap((ph) => itemsByPhase.get(ph.id) || []);
      if (!planItems.length) continue;
      mount.append(el('h2', { class: 'plan-name', style: 'margin-top:18px', text: pl.name }));
      mount.append(buildDag(planItems, statusById));
    }
  }

  function renderDetail(detail, statusById) {
    clear(detail);
    if (!selected) { detail.append(el('span', { class: 'muted', text: 'Nothing selected.' })); detail.classList.remove('active'); return; }
    getItems().then((items) => {
      const it = items.find((x) => x.id === selected);
      if (!it) return;
      const locked = it.status === 'todo' && !depsSatisfied(it, new Map(items.map((i) => [i.id, i.status])));
      clear(detail);
      detail.classList.add('active');
      detail.append(
        el('div', { class: 'dag-detail-body' }, [
          el('div', { class: 'dag-detail-title', text: it.title }),
          el('div', { class: 'dag-detail-sub', text: [it.area, it.estMinutes ? `~${it.estMinutes} min` : null, locked ? 'locked' : it.status].filter(Boolean).join(' · ') }),
        ]),
        el('div', { class: 'row-actions' }, [
          el('button', { class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''), text: 'Done', onclick: () => toggle(it, 'done') }),
          el('button', { class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''), text: 'Skip', onclick: () => toggle(it, 'skipped') }),
        ]),
      );
    });
  }

  function buildDag(planItems, statusById) {
    const NW = 132, NH = 32, HGAP = 16, VGAP = 46, PAD = 8;
    const idset = new Set(planItems.map((i) => i.id));
    const deps = new Map(planItems.map((i) => [i.id, (i.dependsOn || []).filter((d) => idset.has(d))]));

    // longest-path layering
    const layerOf = new Map();
    const compute = (id, seen) => {
      if (layerOf.has(id)) return layerOf.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      let L = 0;
      for (const d of deps.get(id) || []) L = Math.max(L, compute(d, seen) + 1);
      layerOf.set(id, L);
      return L;
    };
    planItems.forEach((i) => compute(i.id, new Set()));

    const layers = [];
    for (const i of planItems) { const L = layerOf.get(i.id); (layers[L] || (layers[L] = [])).push(i); }

    // barycenter ordering to reduce edge crossings
    const pos = new Map();
    layers.forEach((layer, Li) => {
      if (!layer) return;
      if (Li === 0) { layer.forEach((n, idx) => pos.set(n.id, idx)); return; }
      const scored = layer.map((n, idx) => {
        const px = (deps.get(n.id) || []).map((d) => pos.get(d)).filter((v) => v != null);
        return { n, idx, bary: px.length ? px.reduce((a, b) => a + b, 0) / px.length : idx };
      });
      scored.sort((a, b) => a.bary - b.bary || a.idx - b.idx);
      scored.forEach((s, idx) => pos.set(s.n.id, idx));
      layers[Li] = scored.map((s) => s.n);
    });

    const maxCols = Math.max(...layers.map((l) => (l ? l.length : 0)));
    const totalW = maxCols * (NW + HGAP) - HGAP;
    const W = totalW + PAD * 2;
    const H = layers.length * (NH + VGAP) + PAD * 2;

    const nodeXY = new Map();
    layers.forEach((layer, Li) => {
      if (!layer) return;
      const layerW = layer.length * (NW + HGAP) - HGAP;
      const offset = PAD + (totalW - layerW) / 2;
      layer.forEach((n, idx) => {
        nodeXY.set(n.id, { x: offset + idx * (NW + HGAP), y: PAD + Li * (NH + VGAP) });
      });
    });

    const edgeG = svg('g', { class: 'dag-edges' });
    const nodeG = svg('g', {});
    for (const it of planItems) {
      const c = nodeXY.get(it.id);
      for (const d of deps.get(it.id) || []) {
        const p = nodeXY.get(d);
        if (!p) continue;
        const x1 = p.x + NW / 2, y1 = p.y + NH;      // parent bottom
        const x2 = c.x + NW / 2, y2 = c.y;            // child top
        const my = (y1 + y2) / 2;
        const hot = selected && (selected === it.id || selected === d);
        edgeG.appendChild(svg('path', {
          d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`,
          class: 'dag-edge' + (hot ? ' hot' : ''),
        }));
      }
    }

    for (const it of planItems) {
      const { x, y } = nodeXY.get(it.id);
      const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
      const state = [it.status, locked ? 'locked' : '', selected === it.id ? 'sel' : ''].filter(Boolean).join(' ');
      const cls = 'dag-rect ' + state;
      const g = svg('g', { class: 'dag-node ' + state, transform: `translate(${x},${y})`, style: 'cursor:pointer' });
      g.appendChild(svg('rect', { x: 0, y: 0, width: NW, height: NH, rx: 8, class: cls }));
      g.appendChild(svg('circle', { cx: 13, cy: NH / 2, r: 4, fill: areaColor(it.area) }));
      const t = svg('text', { x: 24, y: NH / 2 + 4, class: 'dag-text' });
      t.textContent = truncate(it.title, 17);
      g.appendChild(t);
      g.addEventListener('click', () => { selected = (selected === it.id ? null : it.id); paint(); });
      nodeG.appendChild(g);
    }

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'dag-svg' }, [edgeG, nodeG]);
    return el('div', { class: 'dag-scroll' }, [root]);
  }

  async function toggle(it, target) {
    const next = it.status === target ? 'todo' : target;
    await setItemStatus(it.id, next);
    toast(next === 'todo' ? 'Back to todo' : next === 'done' ? 'Done' : 'Skipped');
    await paint();
  }

  await paint();
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
