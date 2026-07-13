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
// Authored, interview-ready refreshers for the CS Fundamentals concepts — the
// "right words" to recall on the back of a concept card. You quiz yourself on the
// front, flip, and check your phrasing against this. Keys match the concept names
// exactly (as rated in the coach's concept wizard).
const CONCEPT_REFRESHER = {
  'The relational model (PK/FK, referential integrity)': 'Data lives in tables of typed rows. A primary key uniquely identifies a row; a foreign key points at another table’s primary key. The database enforces referential integrity — you can’t reference a row that doesn’t exist.',
  'Normalization & when to denormalize': 'Normalize so every fact lives in exactly one place — no duplication to drift out of sync (1NF atomic, 2NF/3NF no partial/transitive dependencies). Denormalize deliberately — duplicate data to skip expensive joins — when reads dominate and the join is the proven bottleneck, accepting you must keep the copies in sync.',
  'JOINs + GROUP BY / HAVING': 'INNER keeps matches; LEFT keeps all left rows with NULLs for misses (find “no match” with LEFT JOIN … WHERE right IS NULL). GROUP BY collapses rows into groups; WHERE filters rows before grouping, HAVING filters groups after.',
  'SQL logical clause order': 'FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT. That’s why a SELECT alias can’t be used in WHERE (it runs first) but can in ORDER BY.',
  'CTEs, window functions & EXPLAIN': 'CTEs (WITH) name intermediate results for readable multi-step queries. Window functions (ROW_NUMBER/RANK/SUM OVER PARTITION BY) rank or run totals without collapsing rows — top-N-per-group, running totals. EXPLAIN shows the plan: index seek vs full scan.',
  'Transactions & ACID': 'A transaction is all-or-nothing. Atomic (all or none), Consistent (constraints hold), Isolated (concurrent txns don’t corrupt each other), Durable (a commit survives a crash).',
  'The three anomalies (dirty / non-repeatable / phantom)': 'Dirty read: you read another txn’s uncommitted change. Non-repeatable read: you re-read a row and its value changed. Phantom: you re-run a query and new rows appear. Higher isolation prevents more of these.',
  'The four isolation levels & the tradeoff': 'Read Uncommitted → Read Committed → Repeatable Read → Serializable. Each prevents more anomalies (dirty → non-repeatable → phantom) but costs concurrency. Most databases default to Read Committed.',
  'Locking vs MVCC': 'Locking blocks conflicting access, so readers can block writers. MVCC (multi-version) gives each txn a consistent snapshot so readers never block writers — Postgres’s model — trading version storage/vacuum for concurrency.',
  'Why distributed transactions (2PC) are avoided': 'Two-phase commit (prepare, then commit) blocks every participant on the coordinator — one slow or dead node stalls all of them, and it doesn’t scale. Prefer sagas / idempotent steps / eventual consistency.',
  'What an ORM is & why': 'An ORM maps rows to objects so you write app code, not SQL — less boilerplate, parameterized (safer), portable. The cost: it hides the queries it generates, so you must watch what it actually runs.',
  'The N+1 query problem': 'You fetch N parents, then fire one query per parent for its children — N+1 round trips. Fix by loading the children in one query (a JOIN or an IN).',
  'Eager vs lazy loading (the fix)': 'Lazy loads a relation only when accessed (convenient, causes N+1). Eager loads it upfront in one query (JOIN/IN). Reach for eager when you know you’ll need the children.',
  'Connection pooling & migrations': 'A connection pool reuses a fixed set of DB connections instead of opening one per request — opening is costly and connections are limited. Migrations are versioned, ordered schema changes in source control, applied in sequence.',
  'When to drop to raw SQL': 'When the ORM can’t express it or generates a bad plan — complex reporting, window functions, bulk operations, or a hot path you must hand-tune. Measure with EXPLAIN, then drop down.',
  'HTTP methods + safe / idempotent': 'GET read, POST create, PUT replace, PATCH partial, DELETE. Safe = no side effects (GET). Idempotent = repeating gives the same result (GET/PUT/DELETE yes, POST no).',
  'Status-code families (2xx/3xx/4xx/5xx)': '2xx success, 3xx redirect, 4xx client error (your request is wrong — 400/401/403/404/429), 5xx server error (the server failed — 500/503). It’s the server telling you whose fault it is.',
  'Idempotency keys (retry-safe POST)': 'POST isn’t idempotent, so a retry can double-charge. The client sends a unique idempotency key; the server records it and returns the first result for any retry carrying that key.',
  'REST conventions': 'Resources as nouns (/users/123), HTTP verbs for actions, statelessness (each request self-contained), status codes for outcome. Plural nouns, nesting for relationships.',
  'HTTPS / TLS': 'TLS encrypts the connection and authenticates the server via a CA-signed certificate. The handshake uses asymmetric keys to agree a symmetric session key — giving confidentiality, integrity, and server identity.',
  'Authn vs authz': 'Authentication = who you are (login). Authorization = what you’re allowed to do (permissions). Authenticate first, then authorize.',
  'Password storage (salted slow hash)': 'Never store or reversibly encrypt passwords. Store a slow, salted hash — bcrypt/scrypt/Argon2. A unique salt per user defeats rainbow tables; the slowness defeats brute force.',
  'Sessions vs JWT tradeoff': 'Session: server holds state, client holds an opaque id — easy to revoke, needs a store. JWT: self-contained signed token — stateless and scalable, but hard to revoke before expiry. Choose by revocation needs vs scale.',
  'OAuth2 / OIDC (delegated auth)': 'OAuth2 delegates scoped access — you grant an app a token without sharing your password. OIDC adds an identity layer (an ID token) for “log in with Google”. Use the authorization-code flow for web apps.',
  'CSRF & XSS mitigations': 'XSS: attacker runs script in your page — escape output, use a CSP. CSRF: attacker rides your logged-in cookie — use CSRF tokens or SameSite cookies. XSS is untrusted content; CSRF is unwanted requests.',
  'Process vs thread': 'A process has its own memory; threads share the process’s memory. Threads are cheaper to spawn and to communicate, but shared memory means you must synchronize.',
  'Concurrency vs parallelism': 'Concurrency = dealing with many things at once (structure/interleaving). Parallelism = doing many at once (multiple cores). You can be concurrent on a single core.',
  'Race conditions & critical sections': 'A race condition: the outcome depends on unlucky timing of threads touching shared state. The critical section is the code that must run atomically — guard it so only one thread is inside at a time.',
  'Locks / mutexes / semaphores': 'A mutex allows one holder at a time (mutual exclusion). A semaphore allows up to N (a counter) — for pools/rate limits. Hold locks briefly and acquire them in a consistent order.',
  'Deadlock (4 conditions) + lock ordering': 'Deadlock needs all four: mutual exclusion, hold-and-wait, no preemption, circular wait. Break any one — the usual fix is a global lock ordering to kill circular wait (or timeouts).',
  'Async vs threads (I/O- vs CPU-bound)': 'I/O-bound work (network, disk) → async/event loop: one thread cheaply juggles many waits. CPU-bound work → real threads/processes across cores. Async doesn’t speed up CPU-bound work.',
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
    if (wantConcepts) for (const c of deck.concepts) cards.push({ kind: 'concept', key: 'concept:' + c.concept, front: c.concept, sub: c.topic, conf: c.confidence, prompt: 'Say it out loud — then flip to check your phrasing.', back: CONCEPT_REFRESHER[c.concept] || null });
    if (wantDSA) {
      for (const p of deck.patterns) cards.push({ kind: 'pattern', key: 'pattern:' + p.pattern, front: p.pattern, sub: 'DSA pattern', prompt: 'When do you reach for it? What’s the template?', back: PATTERN_REFRESHER[p.pattern] || 'Recall the core idea.' });
      for (const pr of deck.problems) {
        const patternHint = pr.pattern ? `Pattern: ${pr.pattern}. ${PATTERN_REFRESHER[pr.pattern] || ''}`.trim() : 'Recall the approach and its Big-O.';
        const back = pr.note ? `Your note: “${pr.note}”\n${patternHint}` : patternHint;
        cards.push({ kind: 'problem', key: 'lc:' + (pr.slug || pr.front), front: pr.title || pr.slug || 'problem', sub: [pr.difficulty, pr.pattern].filter(Boolean).join(' · '), prompt: 'What was the key insight?', back });
      }
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
