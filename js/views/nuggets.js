// Nuggets — passive study between the cracks of your day. A swipeable deck of
// small, self-contained pieces of knowledge: DSA gotchas, database and system-
// design insights, CS-fundamentals facts, behavioral cues. Unlike the drills or a
// focus session, there's nothing to solve — you just swipe through and absorb.
//
// It's concept-gated, exactly like Drills: nuggets only surface for the concepts
// you've marked as studied in the catalog — so you reinforce what you've actually
// covered, not operating-systems trivia you haven't touched. Swipe right on the
// ones you've got (they fade back), left to keep one coming around.
import { el, clear, todayISO } from '../util.js';
import { getNuggetState, setNuggetState, computeDeck, getStudiedConcepts } from '../store.js';

// Which catalog concept each nugget belongs to — the Nuggets deck gates on the
// same "studied concepts" list as Drills, so you only get bite-sized knowledge for
// what you've actually marked as covered. DSA/CS nuggets map by id; System-Design
// and Behavioral nuggets fall back to their area's concept.
const NUGGET_CONCEPT = {
  'dsa-tp-vs-sw': 'two-pointers', 'dsa-bsearch-mid': 'binary-search', 'dsa-hash-twosum': 'arrays-hashing',
  'dsa-kadane': 'dynamic-programming', 'dsa-prefix-k': 'prefix-sum', 'dsa-fast-slow': 'linked-list',
  'dsa-mono-stack': 'stack', 'dsa-sort-first': 'greedy', 'dsa-dfs-bfs': 'trees', 'dsa-heap-topk': 'heap', 'dsa-dp-ladder': 'dynamic-programming',
  'cs-index-btree': 'databases', 'cs-n-plus-1': 'databases', 'cs-acid': 'databases', 'cs-isolation': 'databases', 'cs-mvcc': 'databases', 'cs-denormalize': 'databases', 'cs-explain': 'databases',
  'cs-idempotent': 'networking', 'cs-status-codes': 'networking', 'cs-tls': 'networking',
  'cs-proc-thread': 'concurrency', 'cs-deadlock': 'concurrency', 'cs-mutex-sema': 'concurrency', 'cs-async-io': 'concurrency',
  'cs-password': 'security', 'cs-jwt-session': 'security', 'cs-csrf-xss': 'security',
};
export const conceptOfNugget = (n) => NUGGET_CONCEPT[n.id]
  || (n.area === 'System Design' ? 'system-design' : n.area === 'Behavioral' ? 'behavioral' : null);
export const NUGGET_BANK = () => NUGGETS;

// Authored refreshers reused as nuggets for the material you've personally studied
// (concepts you've rated, patterns you've practiced) — repetition of your own work,
// woven in alongside the fresh nuggets below.
const PATTERN_REFRESHER = {
  'Two pointers': 'Two indices on sorted/paired data — converging, or same-direction. Turns O(n²) into O(n).',
  'Sliding window': 'A window over a contiguous run: expand right, shrink left when a constraint breaks. Substrings/subarrays in O(n).',
  'Prefix sum': 'Precompute cumulative sums; any range sum is prefix[j] − prefix[i] in O(1). Pair with a hashmap for subarray-sum-equals-k.',
  'Hashing': 'Trade space for O(1) lookups — seen-set, frequency map, complement lookup (Two Sum).',
  'Stack / Monotonic stack': 'LIFO for matching/undo. A monotonic stack finds the next greater/smaller element in O(n).',
  'Binary search': 'Halve a sorted/monotonic space each step — O(log n). Also “binary search on the answer”.',
  'Trees (DFS/BFS)': 'DFS for paths & subtree state; BFS for level-order & shortest unweighted.',
  'Graphs': 'BFS/DFS for reachability, topological sort for ordering, union-find for connectivity.',
  'Heap / Top-K': 'A heap keeps the k best in O(n log k). Min-heap of size k for the top-K largest.',
  'Dynamic programming': 'Overlapping subproblems + optimal substructure. Nail the state, the transition, the base case.',
  'Greedy': 'Take the locally-best choice and prove it stays globally optimal. Usually sort first.',
  'Intervals': 'Sort by start; merge/insert by comparing to the last kept interval.',
};

// The nugget bank. Each: { id, area, topics, front (the hook), body (the insight) }.
// `topics` are lowercase keywords matched against the week's focus to gate the
// broad CS-fundamentals area to its current sub-domain.
const NUGGETS = [
  // ---------- DSA ----------
  { id: 'dsa-tp-vs-sw', area: 'DSA', topics: ['two pointer', 'sliding window', 'array'], front: 'Two pointers vs sliding window', body: 'Two pointers = two indices you move deliberately (often from both ends of sorted data). Sliding window = a contiguous range you grow on the right and shrink on the left when a constraint breaks. If the answer is a *subarray/substring*, reach for the window.' },
  { id: 'dsa-bsearch-mid', area: 'DSA', topics: ['binary search', 'sorted'], front: 'The binary-search overflow trap', body: 'Write mid = lo + (hi − lo) // 2, never (lo + hi) // 2 — in a fixed-width language the sum overflows. And move lo = mid + 1 (not mid) or you can loop forever when lo == hi.' },
  { id: 'dsa-hash-twosum', area: 'DSA', topics: ['hashing', 'hash', 'array', 'two sum'], front: 'Why Two Sum is O(n)', body: 'A hash map trades space for O(1) lookups: as you scan, you ask “have I already seen target − n?”. That turns the brute-force O(n²) pair search into one pass. Store value → index so you can return the index.' },
  { id: 'dsa-kadane', area: 'DSA', topics: ['dynamic programming', 'kadane', 'subarray', 'array'], front: 'Kadane in one line', body: 'Max subarray: cur = max(n, cur + n). At each element you either extend the running sum or start fresh — whichever is bigger — and track the best seen. It drops a negative prefix the instant it hurts.' },
  { id: 'dsa-prefix-k', area: 'DSA', topics: ['prefix sum', 'subarray', 'hash'], front: 'Prefix sums + a hashmap', body: 'A subarray sums to k when two running prefixes differ by k. Keep prefix sums in a map with a seed {0:1}; at each step add how many times you’ve seen (prefix − k). O(n), no nested loop.' },
  { id: 'dsa-fast-slow', area: 'DSA', topics: ['linked list', 'cycle', 'two pointer'], front: 'Fast & slow pointers', body: 'Advance one pointer 1 step and another 2. They meet iff there’s a cycle (Floyd’s). The same trick finds the list’s middle in one pass, and the start of a cycle if you reset one pointer to the head.' },
  { id: 'dsa-mono-stack', area: 'DSA', topics: ['stack', 'monotonic', 'next greater'], front: 'Monotonic stack = “next greater”', body: 'Keep a stack of indices whose answer is still pending, in decreasing value. When a bigger element arrives, pop everything smaller and resolve them to it. Every element is pushed and popped once → O(n).' },
  { id: 'dsa-sort-first', area: 'DSA', topics: ['greedy', 'interval', 'sort'], front: 'When in doubt, sort first', body: 'Most interval and greedy problems crack open once sorted — by start time to merge intervals, by end time for “max non-overlapping”. Sorting is O(n log n) and usually cheaper than the cleverness it replaces.' },
  { id: 'dsa-dfs-bfs', area: 'DSA', topics: ['graph', 'tree', 'dfs', 'bfs'], front: 'DFS or BFS?', body: 'BFS explores level by level → shortest path in an *unweighted* graph, and anything “minimum steps”. DFS goes deep → path existence, cycle detection, topological order, subtree aggregates. Weighted shortest path? Neither — that’s Dijkstra.' },
  { id: 'dsa-heap-topk', area: 'DSA', topics: ['heap', 'top-k', 'priority'], front: 'Top-K without sorting everything', body: 'For the K largest, keep a *min-heap of size K*: push each element, pop when it exceeds K. O(n log K) beats sorting’s O(n log n) when K ≪ n, and you never hold more than K items.' },
  { id: 'dsa-dp-ladder', area: 'DSA', topics: ['dynamic programming', 'recursion', 'memo'], front: 'The DP ladder', body: 'Solve it recursively first (define the subproblem), add memoization to kill repeated work (top-down), then flip to a table if you want to drop the recursion (bottom-up). Same recurrence — you’re just choosing how to cache.' },

  // ---------- CS Fundamentals: databases ----------
  { id: 'cs-index-btree', area: 'CS Fundamentals', topics: ['database', 'sql', 'index', 'query'], front: 'What an index actually is', body: 'A B-tree index is a sorted lookup structure on a column, so the DB seeks instead of scanning every row — O(log n) vs O(n). The cost: every write must update it too. Index what you filter/join/sort on, not everything.' },
  { id: 'cs-n-plus-1', area: 'CS Fundamentals', topics: ['database', 'orm', 'query', 'sql'], front: 'The N+1 query problem', body: 'You fetch N parents, then fire one more query per parent for its children — N+1 round trips, each with network latency. Fix it by loading the children in one query (a JOIN or WHERE id IN (...)). ORMs cause this silently; watch the SQL they emit.' },
  { id: 'cs-acid', area: 'CS Fundamentals', topics: ['database', 'transaction', 'acid', 'sql'], front: 'ACID in a breath', body: 'A transaction is Atomic (all or nothing), Consistent (constraints hold), Isolated (concurrent txns don’t corrupt each other), Durable (a commit survives a crash). It’s the guarantee that “transfer money” can’t half-happen.' },
  { id: 'cs-isolation', area: 'CS Fundamentals', topics: ['database', 'transaction', 'isolation', 'sql'], front: 'Isolation levels buy safety with concurrency', body: 'Read Uncommitted → Committed → Repeatable Read → Serializable. Each rung prevents one more anomaly (dirty → non-repeatable → phantom reads) but costs throughput. Most databases default to Read Committed — know your default.' },
  { id: 'cs-mvcc', area: 'CS Fundamentals', topics: ['database', 'lock', 'mvcc', 'concurren'], front: 'MVCC: readers don’t block writers', body: 'Instead of locking rows, MVCC (Postgres) keeps multiple versions so each transaction reads a consistent snapshot. Readers never wait on writers and vice-versa. The price is version bloat — hence VACUUM.' },
  { id: 'cs-denormalize', area: 'CS Fundamentals', topics: ['database', 'normal', 'sql'], front: 'Normalize, then denormalize on purpose', body: 'Normalize so every fact lives in exactly one place (no update anomalies). Denormalize — duplicate data to skip a join — only when reads dominate and the join is a *proven* bottleneck, accepting you must now keep the copies in sync.' },
  { id: 'cs-explain', area: 'CS Fundamentals', topics: ['database', 'query', 'explain', 'sql', 'index'], front: 'EXPLAIN before you optimize', body: 'EXPLAIN shows the query plan — is it seeking an index or scanning the whole table? A “slow query” is almost always a missing index or a plan the optimizer got wrong. Measure the plan before you touch the query.' },

  // ---------- CS Fundamentals: networking / HTTP ----------
  { id: 'cs-idempotent', area: 'CS Fundamentals', topics: ['http', 'rest', 'api', 'network'], front: 'Safe vs idempotent', body: 'Safe = no side effects (GET). Idempotent = doing it twice equals doing it once (GET, PUT, DELETE). POST is neither — which is why a retried POST can double-charge, and why you need idempotency keys.' },
  { id: 'cs-status-codes', area: 'CS Fundamentals', topics: ['http', 'rest', 'api', 'status'], front: 'Status codes tell you whose fault it is', body: '2xx success, 3xx redirect, 4xx you sent a bad request (400/401/403/404/429), 5xx the server broke (500/503). 401 = “who are you?”, 403 = “I know you, no.”, 404 = “not here”, 429 = “slow down”.' },
  { id: 'cs-tls', area: 'CS Fundamentals', topics: ['http', 'tls', 'https', 'network', 'security'], front: 'What HTTPS actually gives you', body: 'TLS does three things: encrypts the connection, verifies the server’s identity via a CA-signed certificate, and detects tampering. The handshake uses asymmetric keys just long enough to agree on a fast symmetric session key.' },

  // ---------- CS Fundamentals: OS / concurrency ----------
  { id: 'cs-proc-thread', area: 'CS Fundamentals', topics: ['operating system', 'process', 'thread', 'os', 'concurren'], front: 'Process vs thread', body: 'A process owns its memory; threads share the process’s memory. Threads are cheaper to spawn and to communicate — but shared memory means you must synchronize, or you get races. Crash isolation goes the other way: one thread can take down the whole process.' },
  { id: 'cs-deadlock', area: 'CS Fundamentals', topics: ['concurren', 'deadlock', 'lock', 'thread', 'operating system'], front: 'Deadlock needs all four', body: 'Mutual exclusion, hold-and-wait, no preemption, and circular wait — break any one and deadlock is impossible. The usual fix is a global lock ordering (kills circular wait); the lazy fix is a timeout.' },
  { id: 'cs-mutex-sema', area: 'CS Fundamentals', topics: ['concurren', 'lock', 'mutex', 'semaphore', 'thread'], front: 'Mutex vs semaphore', body: 'A mutex allows exactly one holder (mutual exclusion around a critical section). A semaphore is a counter allowing up to N — for pools and rate limits. Hold locks briefly, and always acquire them in a consistent order.' },
  { id: 'cs-async-io', area: 'CS Fundamentals', topics: ['concurren', 'async', 'thread', 'operating system', 'parallel'], front: 'Async vs threads', body: 'I/O-bound work (network, disk) → async/event loop: one thread cheaply juggles thousands of waits. CPU-bound work → real threads/processes across cores. Async doesn’t speed up computation — it just stops you blocking on waits.' },

  // ---------- CS Fundamentals: security ----------
  { id: 'cs-password', area: 'CS Fundamentals', topics: ['security', 'password', 'auth', 'hash'], front: 'Never store passwords', body: 'Store a slow, salted hash — bcrypt/scrypt/Argon2, never plain or reversible encryption. A unique salt per user defeats rainbow tables; the deliberate slowness defeats brute force. If a breach leaks hashes, the passwords stay hard to crack.' },
  { id: 'cs-jwt-session', area: 'CS Fundamentals', topics: ['security', 'auth', 'jwt', 'session', 'token'], front: 'Session vs JWT', body: 'Session: the server holds state, the client holds an opaque id — trivial to revoke, needs a store. JWT: a self-contained signed token — stateless and scalable, but you can’t easily revoke it before it expires. Choose by revocation needs vs scale.' },
  { id: 'cs-csrf-xss', area: 'CS Fundamentals', topics: ['security', 'csrf', 'xss', 'auth', 'web'], front: 'CSRF vs XSS', body: 'XSS = attacker runs *their script* in your page (fix: escape output, set a CSP). CSRF = attacker makes *your browser* send an authenticated request (fix: CSRF tokens or SameSite cookies). One is untrusted content, the other is unwanted requests.' },

  // ---------- System Design ----------
  { id: 'sd-cache-invalidate', area: 'System Design', topics: ['cache', 'caching', 'system design', 'scale'], front: 'Cache invalidation is the hard part', body: 'Caching is easy; keeping it *correct* is not. Pick a policy up front: TTL (expire after N seconds — simple, briefly stale), or write-through/invalidate-on-write (fresh, more coupling). Name the staleness you can tolerate.' },
  { id: 'sd-lb-l4-l7', area: 'System Design', topics: ['load balancer', 'system design', 'scale', 'network'], front: 'L4 vs L7 load balancing', body: 'L4 balances on IP/port — fast, protocol-agnostic, dumb. L7 reads the HTTP request, so it can route by path/header, terminate TLS, and do sticky sessions — smarter, slightly slower. Most web systems want L7 at the edge.' },
  { id: 'sd-cap', area: 'System Design', topics: ['cap', 'consistency', 'system design', 'distributed'], front: 'CAP, practically', body: 'When the network partitions (and it will), you choose: stay Consistent (reject or wait — banking) or stay Available (serve possibly-stale — a social feed). You never “pick two”; you decide what to sacrifice *during a partition*.' },
  { id: 'sd-sql-nosql', area: 'System Design', topics: ['sql', 'nosql', 'database', 'system design'], front: 'SQL or NoSQL?', body: 'Default to SQL: transactions, joins, and a schema that catches bugs. Reach for NoSQL when you need massive horizontal scale, a flexible/denormalized shape, or a specific access pattern (key-value, wide-column, document). Scale is a reason; “it’s newer” isn’t.' },
  { id: 'sd-shard-replica', area: 'System Design', topics: ['shard', 'replica', 'database', 'scale', 'system design'], front: 'Replication vs sharding', body: 'Replication = copies of the *same* data → scales reads and adds redundancy (read replicas). Sharding = splitting *different* data across nodes → scales writes and storage, at the cost of cross-shard queries. Replicate first; shard when one box can’t hold the writes.' },
  { id: 'sd-idempotency-key', area: 'System Design', topics: ['idempotency', 'system design', 'api', 'payment'], front: 'Idempotency keys', body: 'A network timeout doesn’t tell you if the request landed, so clients retry — and a naive POST double-charges. The client sends a unique key; the server records the first result under it and returns that same result for any retry with the same key.' },
  { id: 'sd-queue', area: 'System Design', topics: ['queue', 'message', 'async', 'system design', 'decouple'], front: 'Reach for a queue to decouple', body: 'A message queue lets a slow or spiky consumer lag behind a fast producer without dropping work or coupling their uptime. It buys you async processing, buffering against bursts, and retries — at the cost of eventual (not immediate) consistency.' },
  { id: 'sd-rate-limit', area: 'System Design', topics: ['rate limit', 'token bucket', 'system design', 'api'], front: 'Rate limiting with a token bucket', body: 'A bucket refills at a steady rate up to a cap; each request spends a token, and an empty bucket means 429. It allows short bursts (the cap) while bounding the sustained rate (the refill) — simpler and friendlier than a hard fixed window.' },
  { id: 'sd-consistent-hash', area: 'System Design', topics: ['consistent hashing', 'shard', 'cache', 'system design', 'distributed'], front: 'Consistent hashing', body: 'Plain hash(key) % N remaps almost everything when N changes — a cache stampede on every scaling event. Consistent hashing places nodes on a ring so adding/removing one only moves the keys near it. It’s how distributed caches and shards stay stable.' },
  { id: 'sd-estimate', area: 'System Design', topics: ['estimate', 'qps', 'capacity', 'system design', 'scale'], front: 'Do the napkin math out loud', body: 'Interviewers want to see estimation: users × actions/day ÷ 86,400 ≈ QPS (then ×2–10 for peak). Bytes/record × records ≈ storage. It anchors every later choice — “that’s 50k QPS, so one DB won’t cut it” — and shows you reason about scale, not vibes.' },

  // ---------- Behavioral ----------
  { id: 'beh-star', area: 'Behavioral', topics: ['behavioral', 'star', 'story'], front: 'STAR keeps you from rambling', body: 'Situation (brief context), Task (your responsibility), Action (what *you* did — “I”, not “we”), Result (the outcome, with a number). Most of your airtime should be Action and Result; two sentences of setup is plenty.' },
  { id: 'beh-lead-result', area: 'Behavioral', topics: ['behavioral', 'story', 'result', 'impact'], front: 'Lead with the result', body: 'Open with the outcome — “I cut deploy time from 40 minutes to 4” — then rewind to how. The interviewer knows where it’s going, so the details land as evidence instead of suspense. Bury the result and you sound like you’re still looking for it.' },
  { id: 'beh-quantify', area: 'Behavioral', topics: ['behavioral', 'impact', 'metric', 'number'], front: 'Put a number on it', body: 'A metric turns a claim into a fact. Latency, %, dollars, users, hours saved, incidents avoided — even a rough one (“~30% fewer support tickets”) beats “it helped a lot”. If you can’t quantify impact, pick a different story.' },
  { id: 'beh-conflict', area: 'Behavioral', topics: ['behavioral', 'conflict', 'disagree', 'story'], front: 'The conflict question', body: 'They’re testing whether you disagree *professionally*, not whether you avoid conflict. Show the other view fairly, the data or user need you argued from, and how it resolved — ideally with you sometimes being the one who changed their mind.' },
  { id: 'beh-failure', area: 'Behavioral', topics: ['behavioral', 'failure', 'mistake', 'learn'], front: 'The failure story', body: 'Pick a real failure with real consequences (not “I work too hard”). Own your part plainly, then spend most of the answer on what you changed afterward. The lesson and the behavior change are the whole point — that’s what they’re buying.' },
];

const AREA_CLASS = (a) => 'a-' + String(a || '').replace(/[^a-z0-9]+/gi, '-');

export async function renderNuggets(mount, { arg, navigate }) {
  const scope = arg ? decodeURIComponent(arg) : null; // optional area filter (commute)
  const [stateRaw, deck, studied] = await Promise.all([
    getNuggetState(), computeDeck().catch(() => ({ concepts: [], patterns: [] })), getStudiedConcepts(),
  ]);
  const state = { ...(stateRaw || {}) };

  const wrap = el('div', { class: 'revise-wrap nuggets-wrap' });
  mount.append(wrap);
  const exit = () => navigate(scope ? '/day' : '/now');

  // Gate on the same "studied concepts" catalog as Drills — a nugget only shows
  // once you've marked its concept as covered. A scoped commute deck
  // (/nuggets/:area) ignores the gate for that one area, since you opened it.
  const inScope = (n) => scope ? n.area === scope : !!studied[conceptOfNugget(n)];
  const cards = NUGGETS.filter(inScope).map((n) => ({ id: n.id, area: n.area, front: n.front, body: n.body }));
  // Your own studied material rides along as repetition — you only logged what you
  // actually studied, so it's always fair game.
  for (const c of (deck.concepts || [])) {
    const body = CONCEPT_REFRESHER[c.concept];
    if (body) cards.push({ id: 'concept:' + c.concept, area: 'CS Fundamentals', front: c.concept, body, mine: true });
  }
  for (const p of (deck.patterns || [])) {
    const body = PATTERN_REFRESHER[p.pattern];
    if (body) cards.push({ id: 'pattern:' + p.pattern, area: 'DSA', front: p.pattern, body, mine: true });
  }
  // De-dupe by id (a studied concept could echo an authored one).
  const seenIds = new Set();
  let deckCards = cards.filter((c) => (seenIds.has(c.id) ? false : (seenIds.add(c.id), true)));

  // Nothing unlocked → point at the concept catalog (same gate as Drills).
  if (!deckCards.length) {
    wrap.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Nuggets' }),
      el('h1', { text: 'Mark what you’ve studied.' }),
      el('p', { class: 'muted', text: 'Nuggets show for the concepts you’ve marked as covered — tick them off and the bite-sized cards for those topics appear here.' }),
      el('button', { class: 'btn btn-primary', style: 'margin-top:16px', text: 'Choose concepts', onclick: () => navigate('/concepts') }),
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Back', onclick: exit }),
    ]));
    return;
  }

  // Order: ones you asked to keep seeing ('again') first, then never-seen, then the
  // ones you've got. Ties break by least-recently-seen so nothing goes stale.
  const pri = (c) => {
    const s = state[c.id];
    if (!s) return 1;
    return s.conf === 'again' ? 0 : 2;
  };
  deckCards.sort((a, b) => pri(a) - pri(b) || (String(state[a.id]?.at || '') < String(state[b.id]?.at || '') ? -1 : 1));

  // ---- session state ----
  let idx = 0;
  let got = 0; let again = 0;

  const focusLabel = scope || [...new Set(deckCards.map((c) => c.area))].join(', ');
  const head = el('div', { class: 'revise-head' });
  const stack = el('div', { class: 'revise-stack' });
  const acts = el('div', { class: 'revise-acts' });
  wrap.append(head, stack, acts, el('p', { class: 'revise-hint', text: 'Swipe right on the ones you’ve got, left to keep one coming back — or use the buttons.' }));

  function paintHead() {
    clear(head);
    head.append(
      el('div', { class: 'revise-top' }, [
        el('p', { class: 'eyebrow', text: focusLabel ? `Nuggets · ${focusLabel}` : 'Nuggets' }),
        el('button', { class: 'revise-close', 'aria-label': 'Close', text: '✕', onclick: exit }),
      ]),
      el('div', { class: 'revise-progress' }, [el('div', { class: 'revise-progress-fill', style: `width:${Math.round((idx / deckCards.length) * 100)}%` })]),
      el('div', { class: 'revise-count', text: `${Math.min(idx + 1, deckCards.length)} / ${deckCards.length}` }),
    );
  }

  function cardNode(card) {
    const node = el('div', { class: `revise-card nug-card ${AREA_CLASS(card.area)}` }, [
      el('div', { class: 'revise-card-inner' }, [
        el('div', { class: 'revise-kind', text: card.area + (card.mine ? ' · your rep' : '') }),
        el('div', { class: 'nug-front', text: card.front }),
        el('div', { class: 'nug-body', text: card.body }),
      ]),
    ]);
    attachDrag(node);
    return node;
  }

  function attachDrag(node) {
    let startX = 0; let dx = 0; let dragging = false;
    node.addEventListener('pointerdown', (e) => { dragging = true; startX = e.clientX; node.setPointerCapture?.(e.pointerId); node.style.transition = 'none'; });
    node.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dx = e.clientX - startX;
      node.style.transform = `translateX(${dx}px) rotate(${dx / 28}deg)`;
      node.classList.toggle('hint-yes', dx > 40);
      node.classList.toggle('hint-no', dx < -40);
    });
    const end = () => {
      if (!dragging) return; dragging = false;
      node.style.transition = '';
      if (dx > 90) rate('got');
      else if (dx < -90) rate('again');
      else { node.style.transform = ''; node.classList.remove('hint-yes', 'hint-no'); }
      dx = 0;
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }

  function rate(conf) {
    const card = deckCards[idx];
    if (!card) return;
    if (conf === 'got') got++; else again++;
    state[card.id] = { conf, at: todayISO(), seen: (state[card.id]?.seen || 0) + 1 };
    const top = stack.querySelector('.revise-card');
    if (top) { top.style.transition = 'transform .25s ease, opacity .25s ease'; top.style.transform = `translateX(${conf === 'got' ? 420 : -420}px) rotate(${conf === 'got' ? 16 : -16}deg)`; top.style.opacity = '0'; }
    idx++;
    setTimeout(paint, 180);
  }

  function paintDeck() {
    clear(stack);
    if (idx >= deckCards.length) return finish();
    if (idx + 1 < deckCards.length) { const peek = cardNode(deckCards[idx + 1]); peek.classList.add('revise-peek'); stack.append(peek); }
    stack.append(cardNode(deckCards[idx]));
  }

  function paintActs() {
    clear(acts);
    if (idx >= deckCards.length) return;
    acts.append(
      el('button', { class: 'revise-btn no', type: 'button', onclick: () => rate('again') }, [el('span', { text: '↺' }), el('span', { text: 'Again' })]),
      el('button', { class: 'revise-btn yes', type: 'button', onclick: () => rate('got') }, [el('span', { text: '✓' }), el('span', { text: 'Got it' })]),
    );
  }

  function paint() { paintHead(); paintDeck(); paintActs(); }

  async function finish() {
    clear(stack); clear(acts);
    await setNuggetState(state);
    head.querySelector('.revise-count')?.remove();
    stack.append(el('div', { class: 'revise-done' }, [
      el('div', { class: 'revise-done-mark', text: '✓' }),
      el('h2', { text: `${deckCards.length} nugget${deckCards.length === 1 ? '' : 's'} — done.` }),
      el('p', { class: 'muted', text: `${got} you’ve got · ${again} to keep seeing.` }),
      again > 0 ? el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:16px;max-width:320px', text: `Run the ${again} again`, onclick: () => { deckCards = deckCards.filter((c) => state[c.id]?.conf === 'again'); idx = 0; got = 0; again = 0; paint(); } }) : null,
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Done', onclick: exit }),
    ]));
  }

  paint();
}

// Authored, interview-ready refreshers for the CS Fundamentals concepts you rate in
// a deep session — reused here so your own studied material recycles as nuggets.
const CONCEPT_REFRESHER = {
  'The relational model (PK/FK, referential integrity)': 'Data lives in tables of typed rows. A primary key uniquely identifies a row; a foreign key points at another table’s primary key, and the database enforces that you can’t reference a row that doesn’t exist.',
  'Normalization & when to denormalize': 'Normalize so every fact lives in one place (no duplication to drift). Denormalize deliberately — duplicate to skip a join — only when reads dominate and the join is a proven bottleneck.',
  'JOINs + GROUP BY / HAVING': 'INNER keeps matches; LEFT keeps all left rows with NULLs for misses. WHERE filters rows before grouping, HAVING filters groups after.',
  'Transactions & ACID': 'All-or-nothing. Atomic, Consistent, Isolated, Durable — a commit survives a crash and concurrent txns don’t corrupt each other.',
  'The three anomalies (dirty / non-repeatable / phantom)': 'Dirty: you read an uncommitted change. Non-repeatable: a row you re-read changed. Phantom: a re-run query returns new rows. Higher isolation prevents more of them.',
  'Locking vs MVCC': 'Locking blocks conflicting access (readers can block writers). MVCC gives each txn a snapshot so readers never block writers — Postgres’s model — at the cost of version cleanup.',
  'The N+1 query problem': 'N parents then one query per parent = N+1 round trips. Fix by loading children in one query (JOIN or IN).',
  'HTTP methods + safe / idempotent': 'GET read, POST create, PUT replace, PATCH partial, DELETE. Safe = no side effects; idempotent = repeating changes nothing further (POST is neither).',
  'Idempotency keys (retry-safe POST)': 'POST isn’t idempotent, so a retry can double-charge. The client sends a unique key; the server returns the first result for any retry carrying it.',
  'Authn vs authz': 'Authentication = who you are (login). Authorization = what you’re allowed to do. Authenticate first, then authorize.',
  'Password storage (salted slow hash)': 'Never store or reversibly encrypt passwords — store a slow salted hash (bcrypt/scrypt/Argon2). Salt defeats rainbow tables; slowness defeats brute force.',
  'Sessions vs JWT tradeoff': 'Session: server holds state, easy to revoke. JWT: self-contained and stateless, but hard to revoke before expiry. Choose by revocation needs vs scale.',
  'Process vs thread': 'A process has its own memory; threads share it. Threads are cheaper but must synchronize on shared state.',
  'Concurrency vs parallelism': 'Concurrency = structuring many things in progress at once. Parallelism = actually running them at once on multiple cores. You can be concurrent on one core.',
  'Deadlock (4 conditions) + lock ordering': 'Needs mutual exclusion, hold-and-wait, no preemption, circular wait — break one to prevent it. Usual fix: a global lock ordering.',
};
