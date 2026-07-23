// DSA Patterns — "Linked Lists on LeetCode". Pattern-first and LeetCode-specific,
// centred on the moves that actually get tested: fast/slow pointers (cycle
// detection, cycle start, midpoint), the traversal/reversal toolkit, and the
// hard problems. Rendered in the app's Markdown dialect; backticks are escaped
// (\`) because the whole guide is a template literal.
export const DSA_LINKEDLIST_GUIDE = `# Linked Lists on LeetCode

Linked-list problems reward a small, fixed toolkit executed cleanly: **two pointers moving at different speeds**, a **dummy head** so the front is never a special case, and **in-place pointer surgery** you can do without losing the rest of the list. Almost every problem — including the hard ones — is a recombination of those three. Skim in ~15 minutes; the *Traps* are the pointer bugs that fail one hidden test.

## 1. The two moves everything is built from

- **Dummy head** — allocate a throwaway node in front of \`head\` and return \`dummy.next\`. It removes the "what if I delete/insert at the front?" special case that causes half of all linked-list bugs.
- **prev / curr walk** — carry a \`prev\` alongside \`curr\` so you can splice: to delete \`curr\`, \`prev.next = curr.next\`. Advance both each step.

\`\`\`
dummy = Node(0); dummy.next = head
prev, curr = dummy, head
while curr:
    if <remove curr>: prev.next = curr.next     # unlink; prev stays
    else:             prev = curr                # keep; prev advances
    curr = curr.next
return dummy.next
\`\`\`

## 2. Fast & slow pointers (Floyd's) — the core pattern

One pointer moves 1 step, another moves 2. Their relative speed is what unlocks cycles and the midpoint in a single pass, O(1) space.

**Cycle detection** — if \`fast\` ever equals \`slow\`, there's a cycle; if \`fast\` reaches \`None\`, there isn't. (*Linked List Cycle*.)
\`\`\`
slow = fast = head
while fast and fast.next:
    slow = slow.next
    fast = fast.next.next
    if slow is fast: return True     # they meet inside the loop
return False
\`\`\`

**Cycle start** — the elegant part (*Linked List Cycle II*). After they meet, reset one pointer to \`head\` and advance **both one step at a time**; they meet again exactly at the cycle's entry. Why: let \`L\` = distance to the entry, \`C\` = cycle length. When they first meet, the fast pointer has travelled twice the slow's, and the math collapses to "the distance from head to entry equals the distance from the meeting point to entry (mod C)." You don't need to re-derive it live — state the result and that it's O(1) space.

**Midpoint** — start both at \`head\`; when \`fast\` runs off the end, \`slow\` is at the middle. For an even-length list, whether \`slow\` lands on the first or second middle depends on your loop condition (\`while fast and fast.next\` vs \`while fast.next and fast.next.next\`) — pick deliberately, because *Reorder List* and *Palindrome Linked List* care which middle you get.

\`\`\`
slow = fast = head
while fast and fast.next:
    slow = slow.next
    fast = fast.next.next
# slow is the middle (second-of-two on even length with this condition)
\`\`\`

## 3. Reversal — iterative and in k-groups

**Iterative reverse** is the single most reused subroutine. Memorize it cold:
\`\`\`
prev = None
while curr:
    nxt = curr.next     # save
    curr.next = prev    # flip
    prev = curr         # advance
    curr = nxt
return prev             # new head
\`\`\`
- **Reverse a sublist** (*Reverse Linked List II*) — walk to the node before position \`left\`, reverse \`right-left+1\` nodes, then reconnect the three boundary pointers. A dummy head makes the "left = 1" case sane.
- **Reverse Nodes in k-Group** (Hard) — reverse each block of \`k\` only if a full \`k\` remain; otherwise leave the tail as-is. The trick is bookkeeping the group's boundary nodes so you can stitch reversed blocks back together — do it iteratively (recursion is cleaner but O(n/k) stack). This is *the* problem that tests whether your reversal is truly solid.

## 4. Traversal recipes worth having ready

- **Nth from the end** (*Remove Nth Node From End*) — a **gap of n** between two pointers: advance the lead pointer n steps, then move both until it hits the end; the trailing pointer sits just before the target. One pass, dummy head to handle removing the head.
- **Merge two sorted lists** — dummy head + a \`tail\` you keep appending the smaller node to. The building block for the hard merge below.
- **Palindrome Linked List** — find the midpoint (§2), reverse the second half (§3), compare the halves. O(n) time, O(1) space — the "can you do it without a array copy?" follow-up.
- **Reorder List** — midpoint → reverse second half → merge the two halves alternately. A three-subroutine problem: it's really §2 + §3 + merge stitched together, which is why it's a great rehearsal.

## 5. The hard problems (and what each really tests)

- **Merge k Sorted Lists** (Hard) — a **min-heap** of the k current heads: pop the smallest, push its \`next\`. O(N log k). (Or divide-and-conquer pairwise merges, same complexity.) This is a heap problem wearing a linked-list coat — see the Heaps guide.
- **Reverse Nodes in k-Group** (Hard) — §3 with careful boundary stitching; the reversal-mastery gate.
- **Copy List with Random Pointer** (Medium/Hard) — clone a list where each node also points to a random node. Two clean approaches: a **hashmap** old→new (two passes, O(n) space), or the **interleave trick** — weave copies between originals so \`copy.random = original.random.next\`, then unzip — O(1) extra space. Knowing the O(1)-space version is the differentiator.
- **LRU Cache** (Medium, but hard to get clean) — a **hashmap + doubly-linked list**: the map gives O(1) lookup, the list gives O(1) move-to-front and evict-from-back. Use a dummy head *and* dummy tail so \`add\`/\`remove\` never branch on null. The pointer discipline here is the whole point.

## 6. Traps — the pointer-bug checklist

- **Losing the rest of the list.** Always save \`curr.next\` **before** you overwrite it. The reversal loop's \`nxt = curr.next\` exists for exactly this.
- **\`fast.next\` null check.** \`fast = fast.next.next\` crashes if \`fast.next\` is null — the loop guard must be \`while fast and fast.next\`.
- **Even vs odd midpoint.** Your loop condition decides which middle \`slow\` lands on; the wrong one breaks *Reorder List* / palindrome checks on even lengths.
- **Not using a dummy head.** Deleting or reversing near the front without one turns into a nest of null special-cases and off-by-one bugs.
- **Forgetting to null-terminate.** After reversing a half or splitting a list, set the old tail's \`next = None\`, or you create an accidental cycle (and then your own cycle check loops forever).
- **k-Group partial tail.** Reverse a block only when a full \`k\` nodes remain; reversing a short final block is the classic wrong answer.
- **LRU without dummy tail.** Evicting from the back with only a dummy head forces null branches — use both sentinels.
- **Assuming O(1) space isn't wanted.** For Copy-with-Random and Palindrome, interviewers often push for the O(1)-space version after the hashmap one — have it ready.

## 7. The one-paragraph version

"Linked-list problems are three tools recombined: a **dummy head** to kill front-of-list special cases, a **prev/curr walk** for splicing, and **fast/slow pointers** for anything about cycles or the middle. Floyd's finds a cycle when fast meets slow, and the cycle's start by resetting one pointer to head and stepping both by one — all O(1) space. The reusable subroutine is iterative reversal (save-next, flip, advance). The hard problems are compositions: Reorder List = midpoint + reverse + merge; Reverse-in-k-Group = careful block reversal; Merge k Lists = a heap of heads; LRU Cache = hashmap + doubly-linked list with head *and* tail sentinels. Always save the next pointer before rewiring, guard \`fast.next\`, and null-terminate after a split."
`;
