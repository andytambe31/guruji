// DSA Patterns — "Heaps & Top-K on LeetCode". A pattern-first, LeetCode-specific
// revision sheet: when a heap is the answer, the universal priority-queue
// template, the comparator cheat sheet (Java + Python), a per-problem playbook,
// the simulation and two-heap patterns, and the traps. Rendered in the app's
// Markdown dialect; backticks are escaped (\`) because the whole guide is a
// template literal.
export const DSA_HEAPS_GUIDE = `# Heaps & Top-K on LeetCode

A heap is the tool for *"the k best,"* *"the next thing by priority,"* and *"repeatedly pull the extreme."* It gives you the min (or max) in O(1) and insert/pop in O(log n) — without paying to keep everything sorted. On LeetCode the tell is **K of something**, a **streaming** statistic, or **smash/merge the largest (or smallest) again and again**. Skim in ~15 minutes; the *Traps* are where interview solutions fall apart.

## 1. When should I think "heap"?

If the problem says any of these, think **heap** immediately:

- K largest / K smallest / **Kth** largest / smallest
- Top K / K most frequent / K closest / best K
- "repeatedly take the largest / smallest and put something back"
- a **running median** (→ two heaps, §9)

Brute force sorts everything: **O(n log n)**. A size-K heap keeps only the K best: **O(n log K)**. That log n → log K is exactly the optimization interviewers are fishing for.

## 2. What a heap actually is

A **binary heap** is a complete tree in a flat array with the heap property: in a **min-heap** every parent ≤ its children (min at the root); a **max-heap** is the mirror. It is *not* fully sorted — only "the extreme is on top."

| operation | cost | note |
|---|---|---|
| peek min/max | O(1) | the root |
| push / pop | O(log n) | sift up / down |
| build from n items | **O(n)** | heapify — not O(n log n) |
| find arbitrary | O(n) | a heap is not a search tree |

Two facts interviewers probe: **heapify is O(n)**, and a heap **can't** answer "is x in here?" or "k-th sorted element" cheaply.

## 3. The Golden Rule + the Top-K template

**Don't store everything — store only the K best seen so far.** Whenever the heap size hits **k + 1**, remove the *worst* one.

\`\`\`java
PriorityQueue<T> heap = /* min-heap by the problem's criteria */;
for (T x : input) {
    heap.offer(x);
    if (heap.size() > k) heap.poll();   // evict the worst
}
// heap now holds the k best; heap.peek() is the k-th best
\`\`\`

- Cost **O(n log K)**, space **O(K)** — beats sorting when K ≪ n, and works on an infinite stream.
- Return \`heap.peek()\` for "**Kth** X", or drain the whole heap for "**top K** X".

## 4. The decision framework (which heap?)

This is the question interviewers actually test. Answer four things:

1. **What makes an element *good*?** (larger value / smaller value / higher frequency / smaller distance)
2. **Who is the *worst*?** That element must sit at the **root**, so a \`poll()\` evicts it.
3. **Choose the heap so the root = the worst:**

| Goal | Heap | Root (evicted) is… |
|---|---|---|
| K **largest** | **min-heap** | the smallest of the k largest |
| K **smallest** | **max-heap** | the largest of the k smallest |
| K **closest** | **max-heap** (by distance) | the farthest |
| Top K **frequent** | **min-heap** (by frequency) | the least frequent |
| **Kth largest** (incl. stream) | **min-heap** | the smallest of the top k |

4. **Order by the *criterion*, not the raw value** — that's what the comparator is for.

Counterintuitive but correct: to keep the K *largest*, you use a **min**-heap (so the smallest — the one most likely to fall out of the top-K — is on top ready to be evicted).

## 5. Comparator cheat sheet

**Java** (\`PriorityQueue\` is a **min-heap** by default):
\`\`\`java
new PriorityQueue<>((a, b) -> a - b);                       // min-heap (default)
new PriorityQueue<>((a, b) -> b - a);                       // max-heap
new PriorityQueue<>((a, b) -> map.get(a) - map.get(b));     // min by frequency
new PriorityQueue<>((a, b) -> map.get(b) - map.get(a));     // max by frequency
new PriorityQueue<>((a, b) -> Math.abs(a-x) - Math.abs(b-x)); // min by distance to x
new PriorityQueue<>((a, b) -> Math.abs(b-x) - Math.abs(a-x)); // max by distance to x
// Prefer Integer.compare(x, y) over x - y when values can overflow int.
\`\`\`

**Python** (\`heapq\` is **min-only**): push \`-x\` for a max-heap, or push a tuple \`(key, tiebreak, item)\` to order by \`key\`. Include a tiebreak (a counter) so it never compares the raw objects.

## 6. Language notes (so it compiles)

- **Java** — \`PriorityQueue\`; \`offer/poll/peek\`; pass a comparator for max/criteria.
- **Python** — \`heapq.heappush/heappop\`, \`heapify(list)\` in O(n); max-heap via negation.
- **C++** — \`priority_queue\` is a **max**-heap by default; \`greater<>\` for min.
- **JavaScript** — **no built-in heap**; write a short binary-heap class or explain the O(n log n) fallback.

## 7. Problem playbook (heap + comparator per problem)

| Problem | Heap | Key + insight |
|---|---|---|
| **Kth Largest in an Array** (215) | min-heap, size k | \`peek()\` is the answer. Mention **Quickselect** avg O(n). |
| **Kth Largest in a Stream** (703) | min-heap, size k | keep it alive across \`add()\`; each add O(log k) → \`peek()\`. |
| **Top K Frequent** (347) | min-heap, size k, by \`map.get\` | count first; or **bucket sort** by frequency for O(n). |
| **K Closest Elements** (658) | **max-heap**, size k, by \`|num-x|\` | evict the farthest; **tie → the larger number is worse** (\`b - a\`). |
| **K Closest Points** (973) | **max-heap**, size k, by \`x²+y²\` | compare squared distance — **never take the sqrt**. |
| **Last Stone Weight** (1046) | max-heap | pop two, smash, push the diff back (§8). |
| **Halve Array Sum** (2208) | max-heap | pop max, push \`x/2\`, count until sum halved (§8). |
| **Remove Stones / minStoneSum** (1962) | max-heap | k times: pop \`x\`, push \`x - x/2\`; sum what remains (§8). |
| **Connect Sticks** (1167) | **min-heap** | pop two smallest, cost += their sum, push the sum back (§8). |
| **Find Median from Data Stream** (295) | **two heaps** | max-heap low half + min-heap high half (§9). |

**Kth Largest in a Stream — the full class** (the size-k min-heap, kept alive):
\`\`\`java
class KthLargest {
    private PriorityQueue<Integer> heap = new PriorityQueue<>(); // min-heap
    private int k;
    public KthLargest(int k, int[] nums) {
        this.k = k;
        for (int num : nums) {
            heap.offer(num);
            if (heap.size() > k) heap.poll();
        }
    }
    public int add(int val) {
        heap.offer(val);
        if (heap.size() > k) heap.poll();
        return heap.peek();   // kth largest so far
    }
}
\`\`\`

## 8. The simulation pattern — repeatedly pull the extreme

When each step needs the current max (or min), *does something*, and **pushes a result back**, a heap beats re-sorting because the new value re-enters in O(log n). This is a distinct use from Top-K — here the heap can hold **all n** elements.

\`\`\`java
// Last Stone Weight (max-heap): smash the two heaviest
PriorityQueue<Integer> h = new PriorityQueue<>((a, b) -> b - a);
for (int s : stones) h.offer(s);
while (h.size() > 1) {
    int y = h.poll(), x = h.poll();   // two heaviest
    if (x != y) h.offer(y - x);        // survivor goes back
}
return h.isEmpty() ? 0 : h.peek();
\`\`\`

Same skeleton, different rule per problem:
- **minStoneSum (1962)** — max-heap; do k times: \`x = poll(); offer(x - x/2);\` then sum the heap. (Removing \`floor(x/2)\` leaves \`ceil(x/2)\`.)
- **Halve Array Sum (2208)** — max-heap; \`target = sum/2\`; while \`target > 0\`: \`x = poll(); target -= x/2; offer(x/2); ops++\`.
- **Connect Sticks (1167)** — **min**-heap (greedy/Huffman); while \`size > 1\`: \`a = poll(); b = poll(); cost += a + b; offer(a + b);\`. Always merging the two smallest minimizes total cost.

## 9. The two-heap pattern (running median)

Keep a **max-heap for the lower half** and a **min-heap for the upper half**, sizes balanced within 1. Median = top of the larger heap (odd count) or the average of both tops (even). Add O(log n), median O(1). The clean balancing trick (from *Find Median from Data Stream*):

\`\`\`
addNum(num):
    low.offer(num)                 // low = max-heap
    high.offer(low.poll())         // shuttle low's top into high (min-heap)
    if high.size() > low.size():   // keep low >= high in size
        low.offer(high.poll())
findMedian():
    low.size() > high.size() ? low.peek()
                             : (low.peek() + high.peek()) / 2.0
\`\`\`

Push-to-low → move-to-high → rebalance keeps both the ordering (every low ≤ every high) and the size invariant. This is the pattern most likely to separate a strong candidate; *Sliding Window Median* (480) is the hard sequel.

## 10. Heap vs the alternatives (say this out loud)

- **Sort** — simpler, O(n log n), needs all data. Prefer when K ≈ n or you need full order.
- **Quickselect** — average **O(n)** for a *single* k-th element, in place; can't stream, worst case O(n²).
- **Bucket / counting sort** — O(n) for top-K by frequency when values are bounded (Top K Frequent).
- **Balanced BST / ordered set** — when you also need membership, arbitrary deletion, or ordered ranges.

Naming Quickselect and bucket sort — and why you'd still pick the heap for streaming — turns a correct answer into a strong one.

## 11. Traps — the review checklist

- **Wrong heap direction.** K *largest* → *min*-heap; K *smallest*/closest → *max*-heap. The classic bug.
- **\`size >= k\` instead of \`size > k\`.** Off-by-one evicts one too many — you end up with k-1.
- **\`while (k > 0)\` that never changes k.** k is fixed; loop over the input, not over k.
- **Mutating during a \`for (i < heap.size())\` loop.** \`poll()\` shrinks \`size()\` under you — use \`while (!heap.isEmpty())\` or \`for (i < k)\`.
- **Comparing raw values, not the criterion.** Frequency/distance problems need \`(a,b) -> map.get(a) - map.get(b)\`, not \`a - b\`.
- **Forgetting the size cap.** Pushing all n without popping down to K = O(n log n), O(n) space — the whole point lost.
- **Python max-heap.** \`heapq\` is min-only; negate or you compute the wrong extreme.
- **Uncomparable tuples.** \`(priority, obj)\` throws on a tie when \`obj\` isn't comparable — add a counter tiebreak.
- **\`a - b\` int overflow.** Use \`Integer.compare(a, b)\` when values span the int range.
- **Sqrt in K-Closest.** Compare squared distances; the root is wasted work and a precision risk.
- **Median two-heap imbalance.** Skip the rebalance and the tops drift — push, shuffle, *then* rebalance.

## 12. Interview mental checklist

1. Is this a **Top-K** (or repeatedly-pull-the-extreme) problem?
2. What defines the **best** element? Who is the **worst**?
3. Should the **root** be smallest or largest by that criterion?
4. Can I keep the heap size fixed at **k**? (Top-K) — or does it hold all n? (simulation)
5. Whenever the heap grows past k, **poll the root**.
6. Return **\`peek()\`** (Kth) or **drain** (Top-K).

## 13. The one-paragraph version

"A heap gives O(1) access to the min or max and O(log n) insert/pop — the tool for Top-K, streaming stats, and priority merges/simulations. Memorize the size-K template: for the K largest keep a **min-heap of size K** and evict the smallest — O(n log K), stream-friendly. Pick the heap so the **root is the worst** element by the problem's criterion, and order by that criterion in the comparator (frequency, distance), not the raw value. The simulation variant (Last Stone Weight, Connect Sticks, minStoneSum) holds all n and repeatedly pulls the extreme, doing work and pushing a result back. The hard one is the **two-heap** running median. Watch the heap *direction*, use \`size > k\` (not \`>=\`), never loop on a changing \`size()\`, and be ready to say why Quickselect or bucket sort might beat it."
`;
