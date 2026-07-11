// Plan tab — a List view (grouped by plan → phase) and a Map view. The Map is
// two-level: a high-level graph of areas (few nodes), and tapping an area zooms
// into that area's item DAG (with +/- zoom). Edges come from items' dependsOn.
import { el, clear, toast } from '../util.js';
import { getPlans, getPhases, getItems, setItemStatus, depsSatisfied } from '../store.js';

const AREA_COLOR = {
  'DSA': '#3b5bd9', 'System Design': '#0f9d6b', 'Reading': '#c98a2e',
  'Behavioral': '#b5527e', 'Applications': '#2f8f8a', 'Study': '#9aa0a8',
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
  let view = 'list';    // 'list' | 'map'
  let zoomArea = null;  // null = area overview; else drill into this area
  let selected = null;  // selected item id (zoomed)
  let scale = 1;

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
    else if (zoomArea) paintAreaZoom(items, statusById);
    else paintOverview(planList, phasesByTrack, itemsByPhase, statusById);
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

  // ---------------- Map: area overview ----------------
  function paintOverview(planList, phasesByTrack, itemsByPhase, statusById) {
    mount.append(el('p', { class: 'muted', style: 'margin:-4px 0 4px;font-size:13px', text: 'Your tracks at a glance. Tap an area to open it.' }));
    for (const pl of planList) {
      const planPhases = phasesByTrack.get(pl.id) || [];
      const planItems = planPhases.flatMap((ph) => itemsByPhase.get(ph.id) || []);
      if (!planItems.length) continue;
      mount.append(el('h2', { class: 'plan-name', style: 'margin-top:18px', text: pl.name }));
      mount.append(buildAreaGraph(planItems, statusById));
    }
  }

  function buildAreaGraph(planItems, statusById) {
    const areas = [];
    for (const it of planItems) { const a = it.area || 'Study'; if (!areas.includes(a)) areas.push(a); }
    const areaOfId = (id) => { const it = planItems.find((x) => x.id === id); return it ? (it.area || 'Study') : null; };
    const byArea = groupBy(planItems, (i) => i.area || 'Study');
    const adep = new Map(areas.map((a) => [a, new Set()]));
    for (const it of planItems) {
      const A = it.area || 'Study';
      for (const d of it.dependsOn || []) { const B = areaOfId(d); if (B && B !== A && areas.includes(B)) adep.get(A).add(B); }
    }

    const dim = { NW: 156, NH: 58, HGAP: 18, VGAP: 54, PAD: 10 };
    const { xy, W, H } = layeredLayout(areas, (a) => [...(adep.get(a) || [])], dim);

    const edgeG = svg('g', { class: 'dag-edges' });
    for (const a of areas) {
      const c = xy.get(a);
      for (const b of adep.get(a) || []) {
        const p = xy.get(b); if (!p) continue;
        const x1 = p.x + dim.NW / 2, y1 = p.y + dim.NH, x2 = c.x + dim.NW / 2, y2 = c.y, my = (y1 + y2) / 2;
        edgeG.appendChild(svg('path', { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, class: 'dag-edge' }));
      }
    }
    const nodeG = svg('g', {});
    for (const a of areas) {
      const { x, y } = xy.get(a);
      const list = byArea.get(a) || [];
      const done = list.filter((i) => i.status === 'done').length;
      const col = areaColor(a);
      const g = svg('g', { transform: `translate(${x},${y})`, style: 'cursor:pointer' });
      g.appendChild(svg('rect', { x: 0, y: 0, width: dim.NW, height: dim.NH, rx: 12, class: 'area-rect', stroke: col }));
      g.appendChild(svg('circle', { cx: 18, cy: 24, r: 5, fill: col }));
      const name = svg('text', { x: 32, y: 28, class: 'area-name' }); name.textContent = a;
      const sub = svg('text', { x: 18, y: 46, class: 'area-sub' }); sub.textContent = `${done}/${list.length} done`;
      g.appendChild(name); g.appendChild(sub);
      g.addEventListener('click', () => { zoomArea = a; scale = 1; selected = null; paint(); });
      nodeG.appendChild(g);
    }
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'dag-svg' }, [edgeG, nodeG]);
    return el('div', { class: 'dag-scroll' }, [root]);
  }

  // ---------------- Map: zoomed item DAG ----------------
  function paintAreaZoom(allItems, statusById) {
    const areaItems = allItems.filter((i) => (i.area || 'Study') === zoomArea);
    mount.append(el('div', { class: 'dag-head' }, [
      el('button', { class: 'seg-btn back', text: '← Areas', onclick: () => { zoomArea = null; selected = null; paint(); } }),
      el('span', { class: 'dag-head-title', text: zoomArea }),
      el('div', { class: 'zoom-ctl' }, [
        el('button', { class: 'zoom-btn', text: '−', onclick: () => { scale = Math.max(0.5, +(scale - 0.2).toFixed(2)); paint(); } }),
        el('button', { class: 'zoom-btn', text: '+', onclick: () => { scale = Math.min(2, +(scale + 0.2).toFixed(2)); paint(); } }),
      ]),
    ]));
    const detail = el('div', { class: 'dag-detail' });
    mount.append(detail);
    renderDetail(detail, statusById);
    mount.append(buildItemDag(areaItems, statusById, scale));
  }

  function renderDetail(detail, statusById) {
    clear(detail);
    if (!selected) { detail.append(el('span', { class: 'muted', text: 'Tap a node for details.' })); detail.classList.remove('active'); return; }
    getItems().then((items) => {
      const it = items.find((x) => x.id === selected);
      if (!it) return;
      const locked = it.status === 'todo' && !depsSatisfied(it, new Map(items.map((i) => [i.id, i.status])));
      clear(detail);
      detail.classList.add('active');
      detail.append(
        el('div', { class: 'dag-detail-body' }, [
          el('div', { class: 'dag-detail-title', text: it.title }),
          el('div', { class: 'dag-detail-sub', text: [it.estMinutes ? `~${it.estMinutes} min` : null, locked ? 'locked' : it.status].filter(Boolean).join(' · ') }),
        ]),
        el('div', { class: 'row-actions' }, [
          el('button', { class: 'mini-btn' + (it.status === 'done' ? ' active-done' : ''), text: 'Done', onclick: () => toggle(it, 'done') }),
          el('button', { class: 'mini-btn' + (it.status === 'skipped' ? ' active-skip' : ''), text: 'Skip', onclick: () => toggle(it, 'skipped') }),
        ]),
      );
    });
  }

  function buildItemDag(planItems, statusById, sc) {
    const dim = { NW: 132, NH: 32, HGAP: 16, VGAP: 46, PAD: 8 };
    const { xy, W, H, deps } = layeredLayout(planItems.map((i) => i.id), (id) => {
      const it = planItems.find((x) => x.id === id);
      return it ? (it.dependsOn || []) : [];
    }, dim);

    const edgeG = svg('g', { class: 'dag-edges' });
    for (const it of planItems) {
      const c = xy.get(it.id);
      for (const d of deps.get(it.id) || []) {
        const p = xy.get(d); if (!p) continue;
        const x1 = p.x + dim.NW / 2, y1 = p.y + dim.NH, x2 = c.x + dim.NW / 2, y2 = c.y, my = (y1 + y2) / 2;
        const hot = selected && (selected === it.id || selected === d);
        edgeG.appendChild(svg('path', { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, class: 'dag-edge' + (hot ? ' hot' : '') }));
      }
    }
    const nodeG = svg('g', {});
    for (const it of planItems) {
      const { x, y } = xy.get(it.id);
      const locked = it.status === 'todo' && !depsSatisfied(it, statusById);
      const state = [it.status, locked ? 'locked' : '', selected === it.id ? 'sel' : ''].filter(Boolean).join(' ');
      const g = svg('g', { class: 'dag-node ' + state, transform: `translate(${x},${y})`, style: 'cursor:pointer' });
      g.appendChild(svg('rect', { x: 0, y: 0, width: dim.NW, height: dim.NH, rx: 8, class: 'dag-rect ' + state }));
      g.appendChild(svg('circle', { cx: 13, cy: dim.NH / 2, r: 4, fill: areaColor(it.area) }));
      const t = svg('text', { x: 24, y: dim.NH / 2 + 4, class: 'dag-text' }); t.textContent = truncate(it.title, 17);
      g.appendChild(t);
      g.addEventListener('click', () => { selected = (selected === it.id ? null : it.id); paint(); });
      nodeG.appendChild(g);
    }
    const root = svg('svg', { width: W * sc, height: H * sc, viewBox: `0 0 ${W} ${H}`, class: 'dag-svg' }, [edgeG, nodeG]);
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

// Generic longest-path layered layout. depsOf(id) -> array of prerequisite ids.
function layeredLayout(ids, depsOf, dim) {
  const { NW, NH, HGAP, VGAP, PAD } = dim;
  const idset = new Set(ids);
  const deps = new Map(ids.map((id) => [id, (depsOf(id) || []).filter((d) => idset.has(d))]));
  const layerOf = new Map();
  const comp = (id, seen) => {
    if (layerOf.has(id)) return layerOf.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    let L = 0;
    for (const d of deps.get(id) || []) L = Math.max(L, comp(d, seen) + 1);
    layerOf.set(id, L);
    return L;
  };
  ids.forEach((id) => comp(id, new Set()));
  const layers = [];
  for (const id of ids) { const L = layerOf.get(id); (layers[L] || (layers[L] = [])).push(id); }
  const pos = new Map();
  layers.forEach((layer, Li) => {
    if (!layer) return;
    if (Li === 0) { layer.forEach((id, i) => pos.set(id, i)); return; }
    const sc = layer.map((id, i) => {
      const px = (deps.get(id) || []).map((d) => pos.get(d)).filter((v) => v != null);
      return { id, i, b: px.length ? px.reduce((a, c) => a + c, 0) / px.length : i };
    });
    sc.sort((a, b) => a.b - b.b || a.i - b.i);
    sc.forEach((s, i) => pos.set(s.id, i));
    layers[Li] = sc.map((s) => s.id);
  });
  const maxCols = Math.max(...layers.map((l) => (l ? l.length : 0)));
  const totalW = maxCols * (NW + HGAP) - HGAP;
  const W = totalW + PAD * 2, H = layers.length * (NH + VGAP) + PAD * 2;
  const xy = new Map();
  layers.forEach((layer, Li) => {
    if (!layer) return;
    const lw = layer.length * (NW + HGAP) - HGAP;
    const off = PAD + (totalW - lw) / 2;
    layer.forEach((id, i) => xy.set(id, { x: off + i * (NW + HGAP), y: PAD + Li * (NH + VGAP) }));
  });
  return { xy, W, H, deps };
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
