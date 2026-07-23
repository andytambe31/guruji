// DSA Patterns — "Heaps & Top-K on LeetCode". A pattern-first, LeetCode-specific
// guide: when a heap is the answer, the templates, the canonical problems with
// the key insight each tests, and the traps. Rendered in the app's Markdown
// dialect; backticks are escaped (\`) because the whole guide is a template literal.
export const DSA_HEAPS_GUIDE = `# Heaps & Top-K on LeetCode

A heap is the tool for *"the k best,"* *"the next thing by priority,"* and *"the running median."* It gives you the min (or max) in O(1) and insert/pop in O(log n) — without paying to keep everything fully sorted. On LeetCode, the tell is a problem that asks for **K of something**, a **streaming** statistic, or **repeatedly pull the smallest/largest**. Skim in ~15 minutes; the *Traps* are where interview solutions fall apart.

## 1. What a heap actually is

A **binary heap** is a complete binary tree kept in a flat array, satisfying the heap property: in a **min-heap** every parent ≤ its children (the minimum is at the root); a **max-heap** is the mirror. That's it — it is *not* fully sorted, just "smallest (or largest) is always on top."

| operation | cost | note |
|---|---|---|
| peek min/max | O(1) | the root, index 0 |
| push | O(log n) | sift up |
| pop min/max | O(log n) | swap root with last, sift down |
| build from n items | **O(n)** | heapify — not O(n log n) |
| find arbitrary / search | O(n) | a heap is not a search tree |

Two facts interviewers probe: **heapify is O(n)** (not O(n log n)), and a heap **cannot** answer "is x in here?" or "give me the k-th sorted element" cheaply — it only guarantees the extreme.

## 2. When to reach for a heap

- **Top-K / K-th largest or smallest** — the signature use.
- **A streaming statistic** you must maintain as data arrives (running median, k-th largest in a stream).
- **Merge / schedule by priority** — merge k sorted lists, always process the smallest front; task scheduling by soonest deadline.
- **Graph algorithms** — Dijkstra and Prim pull the next-closest node from a min-heap.

If you need the **full sorted order**, just sort (O(n log n)). If you need **membership or ordered range queries**, use a set/BST. The heap wins specifically when you only ever touch the *extreme*.

## 3. The Top-K template (the one to memorize)

For the **K largest**, keep a **min-heap of size K**. Push each element; whenever the heap exceeds K, pop the smallest. What survives is the K largest, and the root is the K-th largest.

\`\`\`
for x in stream:
    heappush(minheap, x)
    if len(minheap) > K:
        heappop(minheap)        # evict the smallest so far
# minheap now holds the K largest; minheap[0] is the Kth largest
\`\`\`

- Cost: **O(n log K)** and only **O(K) space** — beats sorting (O(n log n)) when K ≪ n, and works on an infinite stream.
- For the **K smallest**, use a **max-heap of size K** (mirror it). Counterintuitive but correct: the heap holds candidates and evicts the *worst* of them.

## 4. Language notes (so the template compiles)

- **Python** — \`heapq\` is a **min-heap** on a plain list: \`heappush\`, \`heappop\`, and \`heapify(list)\` in O(n). For a **max-heap**, push negatives (\`-x\`) or wrap tuples. Order by a key with tuples: \`heappush(h, (priority, item))\` — ties fall through to the next tuple element, so include a tiebreak (e.g. an incrementing counter) when items aren't comparable.
- **Java** — \`PriorityQueue\` is a min-heap; pass \`Collections.reverseOrder()\` or a comparator for max/behaviour.
- **C++** — \`std::priority_queue\` is a **max-heap** by default; use \`greater<>\` for a min-heap.
- **JavaScript** — there is **no built-in heap**; you implement one (or use a sorted structure). Interviewers usually accept a short binary-heap class or an explained O(n log n) fallback.

## 5. The canonical LeetCode problems

Each names the insight it tests — that's what to rehearse, not the code.

- **Kth Largest Element in an Array** (Medium) — the template itself: min-heap of size K → root is the answer. Mention **Quickselect** (average O(n)) as the faster alternative; the heap wins for streams.
- **Kth Largest Element in a Stream** (Easy, but the pattern's purest form) — keep the size-K min-heap *alive* across \`add()\` calls; each add is O(log K).
- **Top K Frequent Elements** (Medium) — count with a hashmap, then a size-K heap over (count, value). Even better here: **bucket sort** by frequency for O(n), a great "I can beat my own heap" follow-up.
- **K Closest Points to Origin** (Medium) — size-K **max-heap** keyed on squared distance (don't take the sqrt — monotonic, so skip it). Evict the farthest.
- **Task Scheduler** (Medium) — a **max-heap of remaining counts**: each cooldown cycle, pop the most-frequent tasks, run them, push back what's left. (There's also a closed-form counting formula — know both.)
- **Find Median from Data Stream** (Hard) — the **two-heap** pattern (§6). The staple hard heap problem.
- **Merge k Sorted Lists** (Hard) — a min-heap of the k list heads; pop the smallest, push its \`next\`. O(N log k) vs O(Nk) for naive scanning.
- **Design Twitter** (Medium) — merge each followee's recent tweets with a heap to get the 10 most recent — "merge k sorted lists" wearing a system-design costume.

## 6. The two-heap pattern (running median)

Maintain a **max-heap for the lower half** and a **min-heap for the upper half**, kept balanced in size (differ by ≤ 1). The median is the top of the larger heap (odd count) or the average of both tops (even count). Add is O(log n); median is O(1). This is the heart of *Find Median from Data Stream* and *Sliding Window Median*, and it's the pattern most likely to separate a strong candidate.

\`\`\`
add(x):
    push x onto low (max-heap); move low's top to high (min-heap)
    if high larger than low: move high's top back to low   # rebalance
median(): low and high equal → average of tops; else top of the bigger heap
\`\`\`

## 7. Heap vs the alternatives (say this out loud)

- **Sort** — simpler, but O(n log n) and needs all data in hand. Prefer it when K is close to n or you need everything ordered anyway.
- **Quickselect** — average **O(n)** for a *single* k-th element / unordered top-K, in place. Beats the heap for one-shot "k-th largest," but worst case O(n²) and it can't stream.
- **Bucket / counting sort** — O(n) for top-K by frequency when values are bounded (Top K Frequent).
- **Balanced BST / ordered set** — when you also need membership, deletion of arbitrary elements, or ordered range queries the heap can't do.

Naming Quickselect and bucket sort as alternatives — and why you'd still pick the heap for streaming — is often what turns a correct answer into a strong one.

## 8. Traps — the review checklist

- **Wrong heap direction.** K *largest* → *min*-heap of size K (you evict the smallest); K *smallest* → *max*-heap. Getting this backwards is the classic bug.
- **Forgetting the size cap.** Pushing all n without popping down to K gives O(n log n) and O(n) space — you lost the whole point.
- **Python max-heap.** \`heapq\` is min-only; negate values or you'll silently compute the wrong extreme.
- **Uncomparable tuples.** \`(priority, obj)\` throws when priorities tie and \`obj\` isn't comparable — add a counter/tiebreak.
- **heapify vs n pushes.** Building by \`heapify\` is O(n); n individual pushes is O(n log n). Say heapify when you have the array up front.
- **Median two-heap imbalance.** Skip the rebalance step and the tops drift apart — the median goes wrong. Always push-then-shuffle-then-rebalance.
- **Using a heap when Quickselect/bucket is expected.** For a one-shot k-th largest or bounded-value top-K, the interviewer may be fishing for O(n); mention it even if you code the heap.
- **Sqrt in K-Closest.** Comparing squared distances is enough — taking the square root is wasted work (and a precision risk).

## 9. The one-paragraph version

"A heap gives O(1) access to the min or max and O(log n) insert/pop, so it's the tool for Top-K, streaming statistics, and priority merges. The template to memorize: for the K largest, keep a **min-heap of size K** and evict the smallest — O(n log K), O(K) space, stream-friendly. The hard variant is the **two-heap** running median (a max-heap for the low half, a min-heap for the high half, kept balanced). Canonical problems: Kth Largest, Top K Frequent, K Closest Points, Task Scheduler, Merge k Sorted Lists, Find Median from Data Stream. Always sanity-check the heap *direction*, and be ready to say why Quickselect or bucket sort might beat it."
`;
