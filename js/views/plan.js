// Plan tab — List, and a three-level Map: Areas → Groups → Items. Each level is
// a small DAG (edges from items' dependsOn), so you drill from "DSA" into
// "Trees" into the actual tasks. Node text wraps to two lines instead of
// ellipsing.
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
  let view = 'list';
  let zoomArea = null;
  let zoomGroup = null;
  let selected = null;
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

    if (view === 'list') { paintList(planList, phasesByTrack, itemsByPhase, statusById); return; }
    if (zoomArea && zoomGroup) paintItemLevel(items, statusById);
    else if (zoomArea) paintGroupLevel(items, statusById);
    else paintAreaLevel(planList, phasesByTrack, itemsByPhase, statusById);
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
        it.status !== 'todo' ? el('button', { class: 'mini-btn mini-undo', text: 'To‑do', title: 'Mark as not started', onclick: () => setTodo(it) }) : null,
      ]),
    ]);
  }

  // ---------------- breadcrumb ----------------
  function crumbBar(right) {
    const parts = [crumb('Areas', () => { zoomArea = null; zoomGroup = null; selected = null; paint(); }, !zoomArea)];
    if (zoomArea) { parts.push(sep()); parts.push(crumb(zoomArea, () => { zoomGroup = null; selected = null; paint(); }, zoomArea && !zoomGroup)); }
    if (zoomGroup) { parts.push(sep()); parts.push(crumb(zoomGroup, null, true)); }
    return el('div', { class: 'dag-head' }, [el('div', { class: 'crumbs' }, parts), right || el('span')]);
  }
  function crumb(label, go, cur) {
    return el('button', { class: 'crumb' + (cur ? ' cur' : ''), text: label, disabled: !go, onclick: go || (() => {}) });
  }
  function sep() { return el('span', { class: 'crumb-sep', text: '›' }); }

  // ---------------- Map level 1: areas ----------------
  function paintAreaLevel(planList, phasesByTrack, itemsByPhase, statusById) {
    mount.append(el('p', { class: 'muted', style: 'margin:-4px 0 4px;font-size:13px', text: 'Your tracks at a glance. Tap an area to open it.' }));
    for (const pl of planList) {
      const planPhases = phasesByTrack.get(pl.id) || [];
      const planItems = planPhases.flatMap((ph) => itemsByPhase.get(ph.id) || []);
      if (!planItems.length) continue;
      const { keys, dep } = clusterDeps(planItems, (i) => i.area || 'Study');
      const byKey = groupBy(planItems, (i) => i.area || 'Study');
      mount.append(el('h2', { class: 'plan-name', style: 'margin-top:16px', text: pl.name }));
      mount.append(clusterGraph(keys, byKey, dep, (a) => areaColor(a), (a) => { zoomArea = a; zoomGroup = null; selected = null; paint(); }));
    }
  }

  // ---------------- Map level 2: groups within an area ----------------
  function paintGroupLevel(items, statusById) {
    const areaItems = items.filter((i) => (i.area || 'Study') === zoomArea);
    mount.append(crumbBar());
    const { keys, dep } = clusterDeps(areaItems, (i) => i.group || 'Other');
    const byKey = groupBy(areaItems, (i) => i.group || 'Other');
    mount.append(clusterGraph(keys, byKey, dep, () => areaColor(zoomArea), (g) => { zoomGroup = g; selected = null; scale = 1; paint(); }));
  }

  // ---------------- Map level 3: items within a group ----------------
  function paintItemLevel(items, statusById) {
    const groupItems = items.filter((i) => (i.area || 'Study') === zoomArea && (i.group || 'Other') === zoomGroup);
    const zoomCtl = el('div', { class: 'zoom-ctl' }, [
      el('button', { class: 'zoom-btn', text: '−', onclick: () => { scale = Math.max(0.6, +(scale - 0.2).toFixed(2)); paint(); } }),
      el('button', { class: 'zoom-btn', text: '+', onclick: () => { scale = Math.min(1.8, +(scale + 0.2).toFixed(2)); paint(); } }),
    ]);
    mount.append(crumbBar(zoomCtl));
    const detail = el('div', { class: 'dag-detail' });
    mount.append(detail);
    renderDetail(detail);
    mount.append(itemDag(groupItems, statusById, scale));
  }

  function renderDetail(detail) {
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
          it.status !== 'todo' ? el('button', { class: 'mini-btn mini-undo', text: 'To‑do', title: 'Mark as not started', onclick: () => setTodo(it) }) : null,
        ]),
      );
    });
  }

  // ---------------- graph builders ----------------
  // Super-node graph for areas / groups (name + progress).
  function clusterGraph(keys, byKey, dep, colorFn, onPick) {
    const dim = { NW: 156, NH: 58, HGAP: 18, VGAP: 54, PAD: 10 };
    const { xy, W, H } = layeredLayout(keys, (k) => [...(dep.get(k) || [])], dim);
    const edgeG = svg('g', { class: 'dag-edges' });
    for (const k of keys) {
      const c = xy.get(k);
      for (const b of dep.get(k) || []) {
        const p = xy.get(b); if (!p) continue;
        const x1 = p.x + dim.NW / 2, y1 = p.y + dim.NH, x2 = c.x + dim.NW / 2, y2 = c.y, my = (y1 + y2) / 2;
        edgeG.appendChild(svg('path', { d: `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`, class: 'dag-edge' }));
      }
    }
    const nodeG = svg('g', {});
    for (const k of keys) {
      const { x, y } = xy.get(k);
      const list = byKey.get(k) || [];
      const done = list.filter((i) => i.status === 'done').length;
      const col = colorFn(k);
      const g = svg('g', { transform: `translate(${x},${y})`, style: 'cursor:pointer' });
      g.appendChild(svg('rect', { x: 0, y: 0, width: dim.NW, height: dim.NH, rx: 12, class: 'area-rect', stroke: col }));
      g.appendChild(svg('circle', { cx: 18, cy: 24, r: 5, fill: col }));
      const name = svg('text', { x: 32, y: 28, class: 'area-name' }); name.textContent = k;
      const sub = svg('text', { x: 18, y: 46, class: 'area-sub' }); sub.textContent = `${done}/${list.length} done`;
      g.appendChild(name); g.appendChild(sub);
      g.addEventListener('click', () => onPick(k));
      nodeG.appendChild(g);
    }
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'dag-svg' }, [edgeG, nodeG]);
    return el('div', { class: 'dag-scroll' }, [root]);
  }

  // Item DAG with two-line wrapped labels.
  function itemDag(planItems, statusById, sc) {
    const dim = { NW: 150, NH: 48, HGAP: 16, VGAP: 46, PAD: 8 };
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
      g.appendChild(svg('rect', { x: 0, y: 0, width: dim.NW, height: dim.NH, rx: 9, class: 'dag-rect ' + state }));
      g.appendChild(svg('circle', { cx: 14, cy: dim.NH / 2, r: 4, fill: areaColor(it.area) }));
      const lines = wrapText(it.title, 19, 2);
      const startY = dim.NH / 2 - (lines.length - 1) * 7 + 4;
      const t = svg('text', { x: 26, y: startY, class: 'dag-text' });
      lines.forEach((ln, i) => { const ts = svg('tspan', { x: 26, dy: i === 0 ? 0 : 14 }); ts.textContent = ln; t.appendChild(ts); });
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

  // Explicit un-mark — put an accidentally done/skipped topic back to not-started.
  async function setTodo(it) {
    await setItemStatus(it.id, 'todo');
    toast('Back to to‑do');
    await paint();
  }

  await paint();
}

// prerequisite edges between cluster keys (areas or groups), from item deps
function clusterDeps(subset, keyOf) {
  const idToKey = new Map(subset.map((i) => [i.id, keyOf(i)]));
  const keys = [];
  for (const i of subset) { const k = keyOf(i); if (!keys.includes(k)) keys.push(k); }
  const dep = new Map(keys.map((k) => [k, new Set()]));
  for (const it of subset) {
    const A = keyOf(it);
    for (const d of it.dependsOn || []) { const B = idToKey.get(d); if (B && B !== A) dep.get(A).add(B); }
  }
  return { keys, dep };
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

// wrap into up to maxLines lines of ~maxChars, ellipsis if it overflows
function wrapText(s, maxChars, maxLines) {
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (t.length <= maxChars) { cur = t; continue; }
    if (cur) lines.push(cur);
    cur = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
    if (lines.length === maxLines) { cur = ''; break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines) {
    // if we truncated mid-way, hint with an ellipsis on the last line
    const joined = lines.join(' ');
    if (joined.length < String(s).length && !lines[maxLines - 1].endsWith('…')) {
      lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 1) + '…';
    }
  }
  return lines.length ? lines : [String(s)];
}
