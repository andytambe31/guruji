// Revise — the commute deck. A swipeable card interface for *revision only*,
// built entirely from what you've already studied deeply: concepts you've rated,
// DSA patterns you've practiced, problems you've solved (with your own notes).
// Never new material — on a train you refresh, you don't learn cold. Swipe right
// = got it, left = still shaky; shaky cards resurface first, and concept ratings
// feed your CS Fundamentals confidence just like a focus session would.
import { el, clear, todayISO } from '../util.js';
import { computeDeck, getReviseState, setReviseState, addLogEntry } from '../store.js';

// One-line refreshers for the DSA patterns — the "back" of a pattern card.
const PATTERN_REFRESHER = {
  'Two pointers': 'Two indices on sorted/paired data — converging, or same-direction. Turns O(n²) into O(n).',
  'Sliding window': 'A window over a contiguous run: expand right, shrink left when a constraint breaks. Substrings/subarrays in O(n).',
  'Prefix sum': 'Precompute cumulative sums; any range sum is prefix[j] − prefix[i] in O(1). Pair with a hashmap for subarray-sum-equals-k.',
  'Hashing': 'Trade space for O(1) lookups — seen-set, frequency map, complement lookup (Two Sum).',
  'Stack / Monotonic stack': 'LIFO for matching/undo. A monotonic stack finds the next greater/smaller element in O(n).',
  'Linked list': 'Pointer surgery: dummy head, fast/slow for cycle & middle, reverse by re-pointing.',
  'Binary search': 'Halve a sorted/monotonic space each step — O(log n). Also “binary search on the answer”.',
  'Trees (DFS/BFS)': 'DFS (recursion/stack) for paths & subtree state; BFS (queue) for level-order & shortest unweighted.',
  'Graphs': 'Nodes + edges: BFS/DFS for reachability, topological sort for ordering, union-find for connectivity.',
  'Heap / Top-K': 'A heap keeps the k best in O(n log k). Min-heap of size k for the top-K largest.',
  'Backtracking': 'Build a candidate incrementally, undo on dead ends. Subsets/permutations/combinations — prune early.',
  'Dynamic programming': 'Overlapping subproblems + optimal substructure. Nail the state, the transition, the base case; memoize or tabulate.',
  'Greedy': 'Take the locally-best choice and prove it stays globally optimal (exchange argument). Usually sort first.',
  'Intervals': 'Sort by start; merge/insert by comparing to the last kept interval. Sweep line for overlaps.',
  'Bit manipulation': 'XOR cancels pairs; & isolates bits; n & (n−1) clears the lowest set bit.',
  'Math': 'Look for patterns, modular arithmetic, GCD, counting. Watch overflow and the edge values.',
  'Other': 'Recall the core idea and the trick that made it click.',
};
const CONF_LABEL = { solid: 'was solid', shaky: 'was shaky', noyet: 'not yet' };

export async function renderRevise(mount, { arg, navigate }) {
  const area = arg ? decodeURIComponent(arg) : null;
  const [deck, stateRaw] = await Promise.all([computeDeck(), getReviseState()]);
  const state = { ...(stateRaw || {}) };

  const build = (scoped) => {
    const cards = [];
    const wantConcepts = !scoped || scoped === 'CS Fundamentals';
    const wantDSA = !scoped || scoped === 'DSA';
    if (wantConcepts) for (const c of deck.concepts) cards.push({ kind: 'concept', key: 'concept:' + c.concept, front: c.concept, sub: c.topic, conf: c.confidence, prompt: 'Explain it in your own words — out loud.', back: null });
    if (wantDSA) {
      for (const p of deck.patterns) cards.push({ kind: 'pattern', key: 'pattern:' + p.pattern, front: p.pattern, sub: 'DSA pattern', prompt: 'When do you reach for it? What’s the template?', back: PATTERN_REFRESHER[p.pattern] || 'Recall the core idea.' });
      for (const pr of deck.problems) cards.push({ kind: 'problem', key: 'lc:' + (pr.slug || pr.front), front: pr.title || pr.slug || 'problem', sub: [pr.difficulty, pr.pattern].filter(Boolean).join(' · '), prompt: 'What was the key insight?', back: pr.note ? '“' + pr.note + '”' : (pr.pattern ? 'Pattern: ' + pr.pattern : 'Recall your approach.') });
    }
    return cards;
  };
  let cards = build(area);
  if (!cards.length && area) cards = build(null); // scoped deck empty → fall back to everything

  // Order: what you're weakest on leads. A card marked shaky last time (spaced-rep
  // memory) comes first; with no memory yet, a concept you rated shaky/not-yet in
  // a deep session leads. Ties break by least-recently-reviewed.
  const pri = (c) => {
    const s = state[c.key];
    if (s) return s.conf === 'shaky' ? 0 : 2;
    if (c.kind === 'concept' && (c.conf === 'shaky' || c.conf === 'noyet')) return 0;
    return 1;
  };
  cards.sort((a, b) => pri(a) - pri(b) || (String(state[a.key]?.at || '') < String(state[b.key]?.at || '') ? -1 : 1));

  const wrap = el('div', { class: 'revise-wrap' });
  mount.append(wrap);

  const exit = () => navigate(area ? '/day' : '/now');

  if (!cards.length) {
    wrap.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Revise' }),
      el('h1', { text: 'Nothing to revise yet.' }),
      el('p', { class: 'muted', text: 'Revision cards are built from your deep sessions — rate some concepts, log a few LeetCode problems, and they’ll show up here to refresh on the go.' }),
      el('button', { class: 'btn btn-ghost', style: 'margin-top:14px', text: 'Back', onclick: exit }),
    ]));
    return;
  }

  // ---- session state ----
  let idx = 0;
  const conceptRatings = []; // {concept, confidence} fed back to CS confidence
  let solid = 0; let shaky = 0;

  const head = el('div', { class: 'revise-head' });
  const stack = el('div', { class: 'revise-stack' });
  const acts = el('div', { class: 'revise-acts' });
  wrap.append(head, stack, acts, el('p', { class: 'revise-hint', text: 'Swipe right if you’ve got it, left if it’s still shaky — or use the buttons. Tap a card to flip.' }));

  function paintHead() {
    clear(head);
    head.append(
      el('div', { class: 'revise-top' }, [
        el('p', { class: 'eyebrow', text: area ? `Revise · ${area}` : 'Revise' }),
        el('button', { class: 'revise-close', 'aria-label': 'Close', text: '✕', onclick: exit }),
      ]),
      el('div', { class: 'revise-progress' }, [el('div', { class: 'revise-progress-fill', style: `width:${Math.round((idx / cards.length) * 100)}%` })]),
      el('div', { class: 'revise-count', text: `${Math.min(idx + 1, cards.length)} / ${cards.length}` }),
    );
  }

  function cardNode(card) {
    const KIND = { concept: 'Concept', pattern: 'Pattern', problem: 'Problem' };
    const node = el('div', { class: `revise-card k-${card.kind}` }, [
      el('div', { class: 'revise-card-inner' }, [
        el('div', { class: 'revise-kind', text: KIND[card.kind] + (card.kind === 'concept' && card.conf ? ` · ${CONF_LABEL[card.conf] || ''}` : '') }),
        el('div', { class: 'revise-front', text: card.front }),
        card.sub ? el('div', { class: 'revise-sub', text: card.sub }) : null,
        el('div', { class: 'revise-prompt', text: card.prompt }),
        el('div', { class: 'revise-back' }, [
          el('div', { class: 'revise-back-lbl', text: card.back ? 'Refresher' : 'Rate yourself' }),
          el('div', { class: 'revise-back-text', text: card.back || 'How close were you? Right = got it, left = revisit.' }),
        ]),
      ]),
    ]);
    // Tap to flip (unless it was a drag).
    let flipped = false;
    node.addEventListener('click', () => { if (node.dataset.dragged === '1') return; flipped = !flipped; node.classList.toggle('flipped', flipped); });
    attachDrag(node);
    return node;
  }

  // Pointer-drag: follow the finger, and on release past a threshold swipe out.
  function attachDrag(node) {
    let startX = 0; let dx = 0; let dragging = false;
    node.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; node.dataset.dragged = '0'; node.setPointerCapture?.(e.pointerId); node.style.transition = 'none'; });
    node.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (Math.abs(dx) > 6) node.dataset.dragged = '1';
      node.style.transform = `translateX(${dx}px) rotate(${dx / 28}deg)`;
      node.classList.toggle('hint-yes', dx > 40);
      node.classList.toggle('hint-no', dx < -40);
    });
    const end = () => {
      if (!dragging) return; dragging = false;
      node.style.transition = '';
      if (dx > 90) rate('solid');
      else if (dx < -90) rate('shaky');
      else { node.style.transform = ''; node.classList.remove('hint-yes', 'hint-no'); }
      dx = 0;
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  function rate(conf) {
    const card = cards[idx];
    if (!card) return;
    if (conf === 'solid') solid++; else shaky++;
    state[card.key] = { conf, at: todayISO(), seen: (state[card.key]?.seen || 0) + 1 };
    if (card.kind === 'concept') conceptRatings.push({ concept: card.front, confidence: conf === 'solid' ? 'solid' : 'shaky' });
    // fling the top card out, then advance
    const top = stack.querySelector('.revise-card');
    if (top) { top.style.transition = 'transform .25s ease, opacity .25s ease'; top.style.transform = `translateX(${conf === 'solid' ? 420 : -420}px) rotate(${conf === 'solid' ? 16 : -16}deg)`; top.style.opacity = '0'; }
    idx++;
    setTimeout(paint, 180);
  }

  function paintDeck() {
    clear(stack);
    if (idx >= cards.length) { return finish(); }
    // a peek of the next card behind, for depth
    if (idx + 1 < cards.length) { const peek = cardNode(cards[idx + 1]); peek.classList.add('revise-peek'); stack.append(peek); }
    stack.append(cardNode(cards[idx]));
  }

  function paintActs() {
    clear(acts);
    if (idx >= cards.length) return;
    acts.append(
      el('button', { class: 'revise-btn no', type: 'button', onclick: () => rate('shaky') }, [el('span', { text: '↺' }), el('span', { text: 'Revisit' })]),
      el('button', { class: 'revise-btn yes', type: 'button', onclick: () => rate('solid') }, [el('span', { text: '✓' }), el('span', { text: 'Got it' })]),
    );
  }

  function paint() { paintHead(); paintDeck(); paintActs(); }

  async function finish() {
    clear(stack); clear(acts);
    // Persist spaced-rep memory, and feed concept ratings into CS confidence.
    await setReviseState(state);
    if (conceptRatings.length) {
      const now = new Date().toISOString();
      await addLogEntry({ date: todayISO(), area: 'CS Fundamentals', itemTitle: 'Commute revision', mode: 'TRANSIT', startedAt: now, endedAt: now, focusMinutes: 0, result: 'review', concepts: conceptRatings });
    }
    head.querySelector('.revise-count')?.remove();
    stack.append(el('div', { class: 'revise-done' }, [
      el('div', { class: 'revise-done-mark', text: '✓' }),
      el('h2', { text: `Revised ${cards.length} ${cards.length === 1 ? 'card' : 'cards'}.` }),
      el('p', { class: 'muted', text: `${solid} solid · ${shaky} to revisit${conceptRatings.length ? ' · concept confidence updated' : ''}.` }),
      shaky > 0 ? el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px;max-width:320px', text: `Run the ${shaky} shaky again`, onclick: () => { cards = cards.filter((c) => state[c.key]?.conf === 'shaky'); idx = 0; solid = 0; shaky = 0; conceptRatings.length = 0; paint(); } }) : null,
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Done', onclick: exit }),
    ]));
  }

  paint();
}
