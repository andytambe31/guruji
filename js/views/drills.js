// Drills — fill-in-the-blank for LeetCode-style problems. You're given the
// question and the full solution with ONE line blanked out; you pick, from four
// choices, the exact piece of logic that makes the code run. Every answer flips
// to a "why it fits" so you learn the reasoning, not the keystroke. Card-based
// like Revise, but multiple-choice — no swiping. Missed cards resurface first
// (spaced-rep memory), so the ones you don't understand come back around.
import { el, clear, todayISO } from '../util.js';
import { getDrillState, setDrillState, computeDeck, getStudiedConcepts } from '../store.js';

// The blank marker embedded in each snippet — replaced by the chosen fragment.
const BLANK = '▢';

// Authored bank: arrays, two pointers, frequency maps. Each drill hides the one
// line that carries the key insight; the distractors are the plausible-but-wrong
// moves (off-by-one pointer, swapped key/value, wrong comparison). `why` is the
// interview-ready reason the right line works.
const DRILLS = [
  // ---------- Hashing / frequency maps ----------
  {
    id: 'two-sum', title: 'Two Sum', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'Return the indices of the two numbers that add up to target. Exactly one answer exists.',
    code: `def two_sum(nums, target):
    seen = {}  # value -> index
    for i, n in enumerate(nums):
        need = target - n
        if need in seen:
            return [seen[need], i]
        ${BLANK}
    return []`,
    choices: ['seen[n] = i', 'seen[need] = i', 'seen[i] = n', 'seen[n] = need'],
    answer: 0,
    why: 'Future elements must look you up by value. Store value → index (seen[n] = i); a later number computes its complement and finds this index via `need in seen`. Keying by the index instead would make the complement lookup impossible.',
  },
  {
    id: 'contains-duplicate', title: 'Contains Duplicate', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'Return True if any value appears at least twice.',
    code: `def contains_duplicate(nums):
    seen = set()
    for n in nums:
        if ${BLANK}:
            return True
        seen.add(n)
    return False`,
    choices: ['n in seen', 'n not in seen', 'seen.add(n)', 'len(seen) == len(nums)'],
    answer: 0,
    why: 'A set gives O(1) membership. If the current value is already in `seen`, you have seen it before → duplicate. The check must come before the add, or every element would trivially match itself.',
  },
  {
    id: 'valid-anagram', title: 'Valid Anagram', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'Return True if t is an anagram of s (same characters, same counts).',
    code: `def is_anagram(s, t):
    if len(s) != len(t):
        return False
    count = {}
    for c in s:
        count[c] = count.get(c, 0) + 1
    for c in t:
        ${BLANK}
        if count[c] < 0:
            return False
    return True`,
    choices: ['count[c] = count.get(c, 0) - 1', 'count[c] = count.get(c, 0) + 1', 'count[c] = 0', 'count.pop(c, None)'],
    answer: 0,
    why: 'The first loop tallies s. The second cancels with t by decrementing each char. If any count dips below zero, t has a character s lacks (or too many of it). Equal length plus never-negative ⇒ identical frequencies.',
  },
  {
    id: 'first-unique-char', title: 'First Unique Character', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'Return the index of the first non-repeating character, or -1.',
    code: `def first_uniq_char(s):
    count = {}
    for c in s:
        count[c] = count.get(c, 0) + 1
    for i, c in enumerate(s):
        if ${BLANK}:
            return i
    return -1`,
    choices: ['count[c] == 1', 'count[c] > 1', 'c in count', 'count[c] == 0'],
    answer: 0,
    why: 'Count everything first, then scan left→right. The first character whose total count is exactly 1 is the first unique one — and scanning in order guarantees it is the earliest such index.',
  },
  {
    id: 'majority-element', title: 'Majority Element', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'One value appears more than n/2 times. Return it in O(1) space.',
    code: `def majority_element(nums):
    count = 0
    candidate = None
    for n in nums:
        if count == 0:
            candidate = n
        ${BLANK}
    return candidate`,
    choices: ['count += 1 if n == candidate else -1', 'count += 1', 'count -= 1', 'count = n'],
    answer: 0,
    why: 'Boyer–Moore voting: +1 for the candidate, −1 against it. A true majority (> n/2) survives every cancellation, so whoever is still standing when the votes settle is the answer — no extra memory.',
  },
  // ---------- Two pointers ----------
  {
    id: 'valid-palindrome', title: 'Valid Palindrome', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Return True if the string reads the same forward and backward (alphanumeric only).',
    code: `def is_palindrome(s):
    s = [c.lower() for c in s if c.isalnum()]
    left, right = 0, len(s) - 1
    while left < right:
        if s[left] != s[right]:
            return False
        ${BLANK}
    return True`,
    choices: ['left, right = left + 1, right - 1', 'left, right = left + 1, right + 1', 'left += 1', 'right -= 1'],
    answer: 0,
    why: 'Two pointers converge from both ends. Once the outer pair matches, step both inward. Advancing only one pointer would compare mismatched positions and break the symmetry check.',
  },
  {
    id: 'two-sum-ii', title: 'Two Sum II (sorted)', pattern: 'Two pointers', difficulty: 'Medium',
    prompt: 'The array is sorted ascending. Return the 1-indexed pair that sums to target.',
    code: `def two_sum_sorted(nums, target):
    left, right = 0, len(nums) - 1
    while left < right:
        s = nums[left] + nums[right]
        if s == target:
            return [left + 1, right + 1]
        elif s < target:
            ${BLANK}
        else:
            right -= 1
    return []`,
    choices: ['left += 1', 'right -= 1', 'left, right = left + 1, right - 1', 'right += 1'],
    answer: 0,
    why: 'The array is sorted, so if the sum is too small only a larger left value can help — move `left` up. Too big → move `right` down. Each step discards exactly the impossible options, giving O(n).',
  },
  {
    id: 'reverse-string', title: 'Reverse String', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Reverse a list of characters in place, O(1) extra space.',
    code: `def reverse_string(s):  # s is a list of chars
    left, right = 0, len(s) - 1
    while left < right:
        ${BLANK}
        left, right = left + 1, right - 1`,
    choices: ['s[left], s[right] = s[right], s[left]', 's[left] = s[right]', 's[right] = s[left]', 's[left], s[right] = s[left], s[right]'],
    answer: 0,
    why: 'Swap the two ends, then move inward. The tuple swap exchanges both at once; assigning one side first (s[left] = s[right]) would overwrite a value before it was saved, losing a character.',
  },
  {
    id: 'container-water', title: 'Container With Most Water', pattern: 'Two pointers', difficulty: 'Medium',
    prompt: 'Each value is a wall height. Find the max water area between two walls.',
    code: `def max_area(height):
    left, right = 0, len(height) - 1
    best = 0
    while left < right:
        h = min(height[left], height[right])
        best = max(best, h * (right - left))
        if height[left] < height[right]:
            left += 1
        else:
            ${BLANK}
    return best`,
    choices: ['right -= 1', 'left += 1', 'right += 1', 'left, right = left + 1, right - 1'],
    answer: 0,
    why: 'Area is capped by the shorter wall. Moving the taller wall only shrinks the width without raising the ceiling, so always move the shorter side. In the else branch height[right] ≤ height[left], so retreat `right`.',
  },
  {
    id: 'move-zeroes', title: 'Move Zeroes', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Move all zeroes to the end in place, keeping the order of non-zeroes.',
    code: `def move_zeroes(nums):
    slow = 0
    for fast in range(len(nums)):
        if nums[fast] != 0:
            nums[slow], nums[fast] = nums[fast], nums[slow]
            ${BLANK}`,
    choices: ['slow += 1', 'fast += 1', 'slow = fast', 'slow -= 1'],
    answer: 0,
    why: '`slow` marks where the next non-zero belongs. Each time `fast` finds a non-zero, swap it down to `slow` and advance `slow` only. Zeroes get pushed to the tail; `slow` never moves on a zero.',
  },
  {
    id: 'remove-duplicates', title: 'Remove Duplicates from Sorted Array', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Array is sorted. Remove duplicates in place and return the new length.',
    code: `def remove_duplicates(nums):
    if not nums:
        return 0
    slow = 0
    for fast in range(1, len(nums)):
        if nums[fast] != nums[slow]:
            slow += 1
            ${BLANK}
    return slow + 1`,
    choices: ['nums[slow] = nums[fast]', 'nums[fast] = nums[slow]', 'slow += 1', 'nums[slow], nums[fast] = nums[fast], nums[slow]'],
    answer: 0,
    why: '`slow` is the last unique slot. On a new value, bump `slow` and copy the new value into it. Because the array is sorted, duplicates are adjacent and simply get overwritten. The kept length is slow + 1.',
  },
  // ---------- Dynamic programming & prefix (array classics) ----------
  {
    id: 'max-subarray', title: 'Maximum Subarray (Kadane)', pattern: 'Dynamic programming', difficulty: 'Medium',
    prompt: 'Return the largest sum of any contiguous subarray.',
    code: `def max_subarray(nums):
    best = cur = nums[0]
    for n in nums[1:]:
        cur = ${BLANK}
        best = max(best, cur)
    return best`,
    choices: ['max(n, cur + n)', 'cur + n', 'max(cur, cur + n)', 'max(n, cur)'],
    answer: 0,
    why: 'At each element, either extend the running sum or start fresh at n — whichever is larger. max(n, cur + n) drops a negative prefix the instant it hurts, and `best` records the strongest window seen so far.',
  },
  {
    id: 'best-time-stock', title: 'Best Time to Buy and Sell Stock', pattern: 'Dynamic programming', difficulty: 'Easy',
    prompt: 'Buy once and sell later. Return the max profit (0 if none).',
    code: `def max_profit(prices):
    min_price = float('inf')
    profit = 0
    for p in prices:
        min_price = min(min_price, p)
        ${BLANK}
    return profit`,
    choices: ['profit = max(profit, p - min_price)', 'profit = max(profit, min_price - p)', 'profit = p - min_price', 'profit += p - min_price'],
    answer: 0,
    why: 'Track the cheapest price seen so far; the best profit ending today is today’s price minus that minimum. Keep the running max. Buy-before-sell is guaranteed because min_price only looks backward.',
  },
  {
    id: 'product-except-self', title: 'Product of Array Except Self', pattern: 'Prefix sum', difficulty: 'Medium',
    prompt: 'Return an array where each element is the product of all others — no division.',
    code: `def product_except_self(nums):
    n = len(nums)
    res = [1] * n
    for i in range(1, n):
        res[i] = res[i-1] * nums[i-1]  # prefix products
    suffix = 1
    for i in range(n - 1, -1, -1):
        ${BLANK}
        suffix *= nums[i]
    return res`,
    choices: ['res[i] *= suffix', 'res[i] = suffix', 'res[i] *= nums[i]', 'suffix *= res[i]'],
    answer: 0,
    why: 'res[i] already holds the product of everything to the left. Multiply in `suffix` — the product of everything to the right — to get all-but-self. Update `suffix` after using it so it still excludes index i.',
  },
  {
    id: 'sorted-squares', title: 'Squares of a Sorted Array', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Given a sorted array (may be negative), return the squares sorted ascending.',
    code: `def sorted_squares(nums):
    n = len(nums)
    res = [0] * n
    left, right = 0, n - 1
    for k in range(n - 1, -1, -1):
        if abs(nums[left]) > abs(nums[right]):
            res[k] = nums[left] ** 2
            left += 1
        else:
            res[k] = nums[right] ** 2
            ${BLANK}
    return res`,
    choices: ['right -= 1', 'left += 1', 'right += 1', 'k -= 1'],
    answer: 0,
    why: 'The largest square comes from the largest absolute value, which sits at one of the two ends. Fill the result from the back; whichever end you consumed, step that pointer inward — here you took `right`, so decrement it.',
  },
  // ---------- Sliding window ----------
  {
    id: 'max-sum-window', title: 'Max Sum Subarray of Size K', pattern: 'Sliding window', difficulty: 'Easy',
    prompt: 'Return the largest sum of any contiguous subarray of length k.',
    code: `def max_sum_k(nums, k):
    window = sum(nums[:k])
    best = window
    for i in range(k, len(nums)):
        window += nums[i]
        ${BLANK}
        best = max(best, window)
    return best`,
    choices: ['window -= nums[i - k]', 'window -= nums[i]', 'window -= nums[i - k + 1]', 'window = nums[i]'],
    answer: 0,
    why: 'A fixed window slides by adding the new right element and dropping the one that fell off the left — index i−k. That keeps exactly k elements in the sum in O(1) per step instead of re-summing the whole window.',
  },
  {
    id: 'longest-no-repeat', title: 'Longest Substring Without Repeating', pattern: 'Sliding window', difficulty: 'Medium',
    prompt: 'Return the length of the longest substring with no repeated character.',
    code: `def length_of_longest(s):
    seen = {}  # char -> last index
    left = 0
    best = 0
    for right, c in enumerate(s):
        if c in seen and seen[c] >= left:
            ${BLANK}
        seen[c] = right
        best = max(best, right - left + 1)
    return best`,
    choices: ['left = seen[c] + 1', 'left += 1', 'left = right', 'left = seen[c]'],
    answer: 0,
    why: 'When the current char repeats inside the window, jump `left` to just past its previous position — every index up to there now carries the duplicate. Jumping straight there (not one step at a time) keeps the scan O(n).',
  },
  {
    id: 'min-subarray-sum', title: 'Minimum Size Subarray Sum', pattern: 'Sliding window', difficulty: 'Medium',
    prompt: 'Return the length of the shortest contiguous subarray with sum ≥ target (0 if none).',
    code: `def min_subarray_len(target, nums):
    left = 0
    total = 0
    best = float('inf')
    for right in range(len(nums)):
        total += nums[right]
        while total >= target:
            best = min(best, right - left + 1)
            ${BLANK}
            left += 1
    return 0 if best == float('inf') else best`,
    choices: ['total -= nums[left]', 'total -= nums[right]', 'total = 0', 'total -= target'],
    answer: 0,
    why: 'Once the window reaches the target, shrink from the left to find the smallest one: record the length, remove the leaving element from the running sum, then advance `left`. Subtracting nums[left] keeps `total` matched to the window.',
  },
  // ---------- Prefix sum ----------
  {
    id: 'range-sum-immutable', title: 'Range Sum Query (build prefix)', pattern: 'Prefix sum', difficulty: 'Easy',
    prompt: 'Precompute so any range sum answers in O(1). Fill the build step.',
    code: `class NumArray:
    def __init__(self, nums):
        self.prefix = [0] * (len(nums) + 1)
        for i in range(len(nums)):
            ${BLANK}
    def sumRange(self, i, j):
        return self.prefix[j + 1] - self.prefix[i]`,
    choices: ['self.prefix[i + 1] = self.prefix[i] + nums[i]', 'self.prefix[i] = self.prefix[i - 1] + nums[i]', 'self.prefix[i + 1] = nums[i]', 'self.prefix[i] = self.prefix[i + 1] + nums[i]'],
    answer: 0,
    why: 'prefix[k] is the sum of the first k elements, with prefix[0] = 0. Building prefix[i+1] = prefix[i] + nums[i] lets any range be prefix[j+1] − prefix[i] in O(1). The +1 offset removes the i = 0 special case.',
  },
  {
    id: 'subarray-sum-k', title: 'Subarray Sum Equals K', pattern: 'Prefix sum', difficulty: 'Medium',
    prompt: 'Count the contiguous subarrays whose sum is exactly k.',
    code: `def subarray_sum(nums, k):
    count = 0
    prefix = 0
    seen = {0: 1}  # prefix sum -> times seen
    for n in nums:
        prefix += n
        ${BLANK}
        seen[prefix] = seen.get(prefix, 0) + 1
    return count`,
    choices: ['count += seen.get(prefix - k, 0)', 'count += seen.get(prefix + k, 0)', 'count += seen.get(k - prefix, 0)', 'count += 1 if prefix == k else 0'],
    answer: 0,
    why: 'A subarray sums to k when two running prefixes differ by k. If an earlier prefix equals prefix − k, the slice between them sums to k — add how many times you have seen it. Seeding {0:1} counts subarrays that start at index 0.',
  },
  {
    id: 'pivot-index', title: 'Find Pivot Index', pattern: 'Prefix sum', difficulty: 'Easy',
    prompt: 'Return the index where the left sum equals the right sum (−1 if none).',
    code: `def pivot_index(nums):
    total = sum(nums)
    left = 0
    for i, n in enumerate(nums):
        if ${BLANK}:
            return i
        left += n
    return -1`,
    choices: ['left == total - left - n', 'left == total - left', 'left == total - n', 'left == total // 2'],
    answer: 0,
    why: 'At index i the right-hand sum is total − left − nums[i]. The pivot is where the left sum equals that. Subtracting the current element excludes it from both sides — the pivot itself belongs to neither.',
  },
  // ---------- Binary search ----------
  {
    id: 'binary-search', title: 'Binary Search', pattern: 'Binary search', difficulty: 'Easy',
    prompt: 'Return the index of target in a sorted array, or −1.',
    code: `def binary_search(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            ${BLANK}
        else:
            hi = mid - 1
    return -1`,
    choices: ['lo = mid + 1', 'lo = mid', 'hi = mid - 1', 'lo = mid - 1'],
    answer: 0,
    why: 'If the midpoint is too small, the target can only be to its right, so move `lo` to mid + 1 — excluding mid, which you just tested. Using `mid` instead of `mid + 1` can loop forever when lo == hi.',
  },
  {
    id: 'search-insert', title: 'Search Insert Position', pattern: 'Binary search', difficulty: 'Easy',
    prompt: 'Return the index where target is, or where it would be inserted to stay sorted.',
    code: `def search_insert(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return ${BLANK}`,
    choices: ['lo', 'hi', 'mid', 'hi + 1'],
    answer: 0,
    why: 'When the loop ends, `lo` is the first index whose value is ≥ target — exactly the insertion point. `hi` has fallen to lo − 1, just left of the gap, so it points one slot too far back.',
  },
  {
    id: 'find-min-rotated', title: 'Find Minimum in Rotated Sorted Array', pattern: 'Binary search', difficulty: 'Medium',
    prompt: 'A sorted array was rotated. Return its minimum in O(log n).',
    code: `def find_min(nums):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] > nums[hi]:
            ${BLANK}
        else:
            hi = mid
    return nums[lo]`,
    choices: ['lo = mid + 1', 'hi = mid', 'lo = mid', 'hi = mid - 1'],
    answer: 0,
    why: 'If nums[mid] > nums[hi], the rotation point (the minimum) is strictly right of mid, so move `lo` to mid + 1. Otherwise the min is at mid or left, kept by hi = mid. Comparing against `hi`, not `lo`, is what makes this correct.',
  },
  // ---------- Stacks / monotonic stack ----------
  {
    id: 'valid-parentheses', title: 'Valid Parentheses', pattern: 'Stack / Monotonic stack', difficulty: 'Easy',
    prompt: 'Return True if every bracket is closed by the matching type in the right order.',
    code: `def is_valid(s):
    pairs = {')': '(', ']': '[', '}': '{'}
    stack = []
    for c in s:
        if c in pairs:
            if not stack or ${BLANK}:
                return False
        else:
            stack.append(c)
    return not stack`,
    choices: ['stack.pop() != pairs[c]', 'stack.pop() == pairs[c]', 'stack[-1] != pairs[c]', 'stack.pop() != c'],
    answer: 0,
    why: 'On a closing bracket the most recent opener must be its partner — pop it and compare. `stack[-1]` never removes it (so the final empty-check fails); comparing to `c` compares two closing brackets.',
  },
  {
    id: 'daily-temperatures', title: 'Daily Temperatures', pattern: 'Stack / Monotonic stack', difficulty: 'Medium',
    prompt: 'For each day, how many days until a warmer one? A monotonic stack of indices.',
    code: `def daily_temperatures(T):
    res = [0] * len(T)
    stack = []  # indices, decreasing temperature
    for i, t in enumerate(T):
        while stack and t > T[stack[-1]]:
            j = stack.pop()
            ${BLANK}
        stack.append(i)
    return res`,
    choices: ['res[j] = i - j', 'res[j] = j - i', 'res[i] = i - j', 'res[j] = i'],
    answer: 0,
    why: 'The stack holds earlier days still waiting for a warmer one. When today (i) beats the day on top (j), that wait ends — the answer for j is the gap i − j. You write to res[j], the waiting day, not res[i].',
  },
  {
    id: 'next-greater', title: 'Next Greater Element', pattern: 'Stack / Monotonic stack', difficulty: 'Medium',
    prompt: 'For each element, find the next element to its right that is larger (−1 if none).',
    code: `def next_greater(nums):
    res = [-1] * len(nums)
    stack = []  # indices with no greater yet
    for i, n in enumerate(nums):
        while stack and n > nums[stack[-1]]:
            ${BLANK}
        stack.append(i)
    return res`,
    choices: ['res[stack.pop()] = n', 'res[i] = nums[stack.pop()]', 'res[stack[-1]] = n', 'stack.pop()'],
    answer: 0,
    why: 'Each stacked index is still hunting for its next-greater value. When n beats the top, n is that value — assign it and pop in one move. Not popping (`stack[-1]`) loops forever; `res[i] = …` fills the wrong slot.',
  },
  // ---------- More Arrays & Hashing ----------
  {
    id: 'group-anagrams', title: 'Group Anagrams', pattern: 'Hashing', difficulty: 'Medium',
    prompt: 'Group the strings that are anagrams of each other.',
    code: `def group_anagrams(strs):
    groups = {}
    for s in strs:
        key = ${BLANK}
        groups.setdefault(key, []).append(s)
    return list(groups.values())`,
    choices: ['tuple(sorted(s))', 'sorted(s)', 's', 'hash(s)'],
    answer: 0,
    why: 'Anagrams share the same letters, so their sorted form is identical — that’s the group key. It must be hashable to index a dict, and a list isn’t; a tuple is.',
  },
  {
    id: 'longest-consecutive', title: 'Longest Consecutive Sequence', pattern: 'Hashing', difficulty: 'Medium',
    prompt: 'Return the length of the longest run of consecutive integers, in O(n).',
    code: `def longest_consecutive(nums):
    num_set = set(nums)
    best = 0
    for n in num_set:
        if ${BLANK}:
            length = 1
            while n + length in num_set:
                length += 1
            best = max(best, length)
    return best`,
    choices: ['n - 1 not in num_set', 'n + 1 in num_set', 'n - 1 in num_set', 'n not in num_set'],
    answer: 0,
    why: 'Only start counting from the start of a run — a number with no predecessor in the set. That walks each sequence exactly once, keeping it O(n) instead of O(n²).',
  },
  {
    id: 'ransom-note', title: 'Ransom Note', pattern: 'Hashing', difficulty: 'Easy',
    prompt: 'Can the note be built from the magazine’s letters (each used once)?',
    code: `def can_construct(note, magazine):
    from collections import Counter
    have = Counter(magazine)
    for c in note:
        if have[c] <= 0:
            return False
        ${BLANK}
    return True`,
    choices: ['have[c] -= 1', 'have[c] += 1', 'del have[c]', 'have[c] = 0'],
    answer: 0,
    why: 'Each magazine letter is usable once. Decrement as you consume it; if a needed letter is already exhausted (≤ 0), the note can’t be built.',
  },
  // ---------- More Two Pointers ----------
  {
    id: 'three-sum', title: '3Sum', pattern: 'Two pointers', difficulty: 'Medium',
    prompt: 'Return all unique triplets that sum to zero.',
    code: `def three_sum(nums):
    nums.sort()
    res = []
    for i in range(len(nums)):
        if i > 0 and nums[i] == nums[i-1]:
            continue
        lo, hi = i + 1, len(nums) - 1
        while lo < hi:
            s = nums[i] + nums[lo] + nums[hi]
            if s < 0:   lo += 1
            elif s > 0: hi -= 1
            else:
                res.append([nums[i], nums[lo], nums[hi]])
                lo += 1
                ${BLANK}
    return res`,
    choices: ['while lo < hi and nums[lo] == nums[lo - 1]: lo += 1', 'hi -= 1', 'lo += 1', 'while lo < hi and nums[lo] != nums[lo - 1]: lo += 1'],
    answer: 0,
    why: 'After recording a triplet, skip past duplicate left values so the same triplet isn’t emitted twice. Sorting first is what makes duplicates adjacent and this skip work.',
  },
  {
    id: 'trapping-rain', title: 'Trapping Rain Water', pattern: 'Two pointers', difficulty: 'Hard',
    prompt: 'Each value is a bar height. How much water is trapped between them?',
    code: `def trap(height):
    left, right = 0, len(height) - 1
    lmax = rmax = water = 0
    while left < right:
        if height[left] < height[right]:
            lmax = max(lmax, height[left])
            water += lmax - height[left]
            left += 1
        else:
            rmax = max(rmax, height[right])
            ${BLANK}
            right -= 1
    return water`,
    choices: ['water += rmax - height[right]', 'water += lmax - height[right]', 'water += height[right] - rmax', 'water += rmax - height[left]'],
    answer: 0,
    why: 'Water above a bar is (the shorter of the tallest walls each side) − its height. Move the side with the smaller wall — that side’s running max is the binding constraint, so the trapped water there is rmax − height[right].',
  },
  {
    id: 'is-subsequence', title: 'Is Subsequence', pattern: 'Two pointers', difficulty: 'Easy',
    prompt: 'Is s a subsequence of t (characters in order, not necessarily contiguous)?',
    code: `def is_subsequence(s, t):
    i = 0
    for c in t:
        if i < len(s) and s[i] == c:
            ${BLANK}
    return i == len(s)`,
    choices: ['i += 1', 'i -= 1', 'return True', 'continue'],
    answer: 0,
    why: 'Walk t with one pointer into s; advance in s on each match. If the pointer reaches the end of s, every character was found in order — s is a subsequence.',
  },
  // ---------- More Sliding Window ----------
  {
    id: 'longest-repeat-replace', title: 'Longest Repeating Char Replacement', pattern: 'Sliding window', difficulty: 'Medium',
    prompt: 'Longest substring of one repeated char after replacing at most k characters.',
    code: `def character_replacement(s, k):
    from collections import Counter
    count = Counter()
    left = maxf = best = 0
    for right in range(len(s)):
        count[s[right]] += 1
        maxf = max(maxf, count[s[right]])
        while ${BLANK}:
            count[s[left]] -= 1
            left += 1
        best = max(best, right - left + 1)
    return best`,
    choices: ['(right - left + 1) - maxf > k', '(right - left + 1) - maxf < k', 'right - left + 1 > k', 'maxf > k'],
    answer: 0,
    why: 'A window is valid if the chars you’d need to replace — its size minus the most frequent char — is at most k. When that exceeds k, shrink from the left until it’s valid again.',
  },
  {
    id: 'max-ones-iii', title: 'Max Consecutive Ones III', pattern: 'Sliding window', difficulty: 'Medium',
    prompt: 'Longest run of 1s if you may flip at most k zeros.',
    code: `def longest_ones(nums, k):
    left = zeros = best = 0
    for right in range(len(nums)):
        if nums[right] == 0:
            zeros += 1
        while zeros > k:
            if nums[left] == 0:
                ${BLANK}
            left += 1
        best = max(best, right - left + 1)
    return best`,
    choices: ['zeros -= 1', 'zeros += 1', 'zeros = 0', 'k -= 1'],
    answer: 0,
    why: 'You may flip up to k zeros. Grow the window; when it holds more than k zeros, shrink from the left, decrementing the zero count as each zero leaves.',
  },
  // ---------- More Binary Search ----------
  {
    id: 'koko-bananas', title: 'Koko Eating Bananas', pattern: 'Binary search', difficulty: 'Medium',
    prompt: 'Smallest eating speed to finish all piles within h hours. Search the answer.',
    code: `def min_eating_speed(piles, h):
    import math
    lo, hi = 1, max(piles)
    while lo < hi:
        mid = (lo + hi) // 2
        hours = sum(math.ceil(p / mid) for p in piles)
        if hours <= h:
            ${BLANK}
        else:
            lo = mid + 1
    return lo`,
    choices: ['hi = mid', 'lo = mid + 1', 'hi = mid - 1', 'lo = mid'],
    answer: 0,
    why: 'Binary-search the answer: if speed mid finishes in time it’s a candidate, but a slower speed might too — keep mid (hi = mid) and search lower. Too slow → speed up (lo = mid + 1).',
  },
  {
    id: 'find-peak', title: 'Find Peak Element', pattern: 'Binary search', difficulty: 'Medium',
    prompt: 'Return the index of any peak (greater than its neighbors), in O(log n).',
    code: `def find_peak(nums):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] < nums[mid + 1]:
            ${BLANK}
        else:
            hi = mid
    return lo`,
    choices: ['lo = mid + 1', 'hi = mid', 'lo = mid', 'hi = mid - 1'],
    answer: 0,
    why: 'If the slope rises at mid (nums[mid] < nums[mid+1]), a peak lies to the right, so move lo past mid. Otherwise it’s at mid or left. You always walk uphill and converge on a peak.',
  },
  {
    id: 'first-bad-version', title: 'First Bad Version', pattern: 'Binary search', difficulty: 'Easy',
    prompt: 'Find the first bad version in a False…True sequence.',
    code: `def first_bad(n, is_bad):
    lo, hi = 1, n
    while lo < hi:
        mid = (lo + hi) // 2
        if is_bad(mid):
            ${BLANK}
        else:
            lo = mid + 1
    return lo`,
    choices: ['hi = mid', 'hi = mid - 1', 'lo = mid + 1', 'lo = mid'],
    answer: 0,
    why: 'If mid is bad it might be the first, so keep it (hi = mid) and look left. If good, the first bad is strictly right (lo = mid + 1). The loop lands on the boundary.',
  },
  // ---------- More Stacks ----------
  {
    id: 'min-stack', title: 'Min Stack', pattern: 'Stack / Monotonic stack', difficulty: 'Medium',
    prompt: 'Support push and O(1) getMin. Fill the push.',
    code: `class MinStack:
    def __init__(self):
        self.stack = []
    def push(self, x):
        m = min(x, self.stack[-1][1] if self.stack else x)
        ${BLANK}
    def getMin(self):
        return self.stack[-1][1]`,
    choices: ['self.stack.append((x, m))', 'self.stack.append(x)', 'self.stack.append((x, x))', 'self.stack.append((m, x))'],
    answer: 0,
    why: 'Store the running minimum alongside each value so getMin is O(1) without scanning. Each frame carries (value, min-so-far); the top’s min is the whole stack’s min.',
  },
  {
    id: 'eval-rpn', title: 'Evaluate Reverse Polish Notation', pattern: 'Stack / Monotonic stack', difficulty: 'Medium',
    prompt: 'Evaluate an RPN expression given as tokens.',
    code: `def eval_rpn(tokens):
    stack = []
    ops = {'+', '-', '*', '/'}
    for t in tokens:
        if t in ops:
            b = stack.pop(); a = stack.pop()
            stack.append(apply(a, b, t))
        else:
            ${BLANK}
    return stack[0]`,
    choices: ['stack.append(int(t))', 'stack.append(t)', 'stack.push(t)', 'stack.append(a)'],
    answer: 0,
    why: 'Push operands; on an operator pop the two most recent, apply, push the result. Operands arrive as strings, so convert to int before pushing.',
  },
  {
    id: 'asteroid-collision', title: 'Asteroid Collision', pattern: 'Stack / Monotonic stack', difficulty: 'Medium',
    prompt: 'Right-movers (positive) and left-movers (negative) collide; the smaller explodes.',
    code: `def asteroid_collision(asteroids):
    stack = []
    for a in asteroids:
        alive = True
        while alive and a < 0 and stack and stack[-1] > 0:
            if stack[-1] < -a:
                stack.pop()
            elif stack[-1] == -a:
                stack.pop(); alive = False
            else:
                ${BLANK}
        if alive:
            stack.append(a)
    return stack`,
    choices: ['alive = False', 'stack.pop()', 'break', 'a = 0'],
    answer: 0,
    why: 'A right-mover on the stack meets left-mover a. If the stacked one is bigger, the incoming one dies — mark it not alive so it isn’t pushed. Equal sizes destroy both; smaller pops and keeps checking.',
  },
  // ---------- More Prefix Sum ----------
  {
    id: 'contiguous-array', title: 'Contiguous Array', pattern: 'Prefix sum', difficulty: 'Medium',
    prompt: 'Longest subarray with equal numbers of 0s and 1s.',
    code: `def find_max_length(nums):
    seen = {0: -1}   # running count -> first index
    count = best = 0
    for i, n in enumerate(nums):
        count += 1 if n == 1 else -1
        if count in seen:
            best = max(best, i - seen[count])
        else:
            ${BLANK}
    return best`,
    choices: ['seen[count] = i', 'seen[count] = best', 'seen[i] = count', 'seen[count] += i'],
    answer: 0,
    why: 'Map 0→−1, 1→+1; the counts of 0s and 1s are equal over any span where the running count returns to a previous value. Store only the first index per count (longest span), so don’t overwrite.',
  },
  // ---------- Dynamic Programming ----------
  {
    id: 'climbing-stairs', title: 'Climbing Stairs', pattern: 'Dynamic programming', difficulty: 'Easy',
    prompt: 'Each move climbs 1 or 2 steps. How many ways to reach step n?',
    code: `def climb_stairs(n):
    a, b = 1, 1
    for _ in range(n):
        ${BLANK}
    return a`,
    choices: ['a, b = b, a + b', 'a, b = a + b, b', 'a = a + b', 'a, b = b, a'],
    answer: 0,
    why: 'Ways(i) = ways(i−1) + ways(i−2) — it’s Fibonacci. Roll two variables forward instead of a whole array, for O(1) space.',
  },
  {
    id: 'house-robber', title: 'House Robber', pattern: 'Dynamic programming', difficulty: 'Medium',
    prompt: 'Max sum with no two adjacent houses robbed.',
    code: `def rob(nums):
    prev, cur = 0, 0
    for n in nums:
        ${BLANK}
    return cur`,
    choices: ['prev, cur = cur, max(cur, prev + n)', 'prev, cur = cur, prev + n', 'cur = max(cur, prev + n)', 'prev, cur = cur, max(prev, cur + n)'],
    answer: 0,
    why: 'At each house, either skip it (keep cur) or rob it (prev + n) — you can’t rob adjacent, so robbing builds on the total from two back. Slide prev/cur forward; cur holds the best so far.',
  },
  {
    id: 'coin-change', title: 'Coin Change', pattern: 'Dynamic programming', difficulty: 'Medium',
    prompt: 'Fewest coins to make the amount (−1 if impossible).',
    code: `def coin_change(coins, amount):
    dp = [0] + [float('inf')] * amount
    for a in range(1, amount + 1):
        for c in coins:
            if c <= a:
                ${BLANK}
    return dp[amount] if dp[amount] != float('inf') else -1`,
    choices: ['dp[a] = min(dp[a], dp[a - c] + 1)', 'dp[a] = min(dp[a], dp[a - c])', 'dp[a] = dp[a - c] + 1', 'dp[a] = min(dp[a], dp[c] + 1)'],
    answer: 0,
    why: 'Fewest coins for a = one coin c plus the fewest for (a − c). Take the best over all coins; the +1 counts the coin just used, and dp[0] = 0 anchors it.',
  },
  {
    id: 'lis', title: 'Longest Increasing Subsequence', pattern: 'Dynamic programming', difficulty: 'Medium',
    prompt: 'Length of the longest strictly increasing subsequence (O(n²) DP).',
    code: `def length_of_lis(nums):
    dp = [1] * len(nums)
    for i in range(len(nums)):
        for j in range(i):
            if nums[j] < nums[i]:
                ${BLANK}
    return max(dp) if dp else 0`,
    choices: ['dp[i] = max(dp[i], dp[j] + 1)', 'dp[i] = dp[j] + 1', 'dp[i] = max(dp[i], dp[j])', 'dp[j] = max(dp[j], dp[i] + 1)'],
    answer: 0,
    why: 'dp[i] = longest increasing subsequence ending at i. For each smaller earlier element j you can extend its subsequence: dp[j] + 1. Keep the best; the answer is the max over all endings.',
  },
  // ---------- Linked List ----------
  {
    id: 'reverse-linked-list', title: 'Reverse Linked List', pattern: 'Linked list', difficulty: 'Easy',
    prompt: 'Reverse a singly linked list in place.',
    code: `def reverse_list(head):
    prev = None
    cur = head
    while cur:
        nxt = cur.next
        ${BLANK}
        prev = cur
        cur = nxt
    return prev`,
    choices: ['cur.next = prev', 'cur.next = nxt', 'prev.next = cur', 'cur.next = cur'],
    answer: 0,
    why: 'Re-point each node backward: save next, flip cur.next to prev, then walk both forward. Saving nxt first is essential — you overwrite cur.next before moving on.',
  },
  {
    id: 'merge-two-lists', title: 'Merge Two Sorted Lists', pattern: 'Linked list', difficulty: 'Easy',
    prompt: 'Merge two sorted lists into one sorted list.',
    code: `def merge_two_lists(a, b):
    dummy = tail = ListNode()
    while a and b:
        if a.val <= b.val:
            tail.next = a; a = a.next
        else:
            tail.next = b; b = b.next
        ${BLANK}
    tail.next = a or b
    return dummy.next`,
    choices: ['tail = tail.next', 'tail = dummy', 'tail.next = tail', 'tail = a'],
    answer: 0,
    why: 'A dummy head avoids special-casing the first node. Attach the smaller node, advance that list, then move the tail forward. Any leftover list is linked wholesale at the end.',
  },
  {
    id: 'linked-list-cycle', title: 'Linked List Cycle', pattern: 'Linked list', difficulty: 'Easy',
    prompt: 'Detect whether the list has a cycle, in O(1) space.',
    code: `def has_cycle(head):
    slow = fast = head
    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next
        if ${BLANK}:
            return True
    return False`,
    choices: ['slow is fast', 'slow == fast.next', 'fast is None', 'slow.next is fast'],
    answer: 0,
    why: 'Floyd’s: advance slow by 1 and fast by 2. In a cycle the fast pointer laps the slow one and they land on the same node; with no cycle, fast runs off the end.',
  },
  // ---------- Trees ----------
  {
    id: 'max-depth-tree', title: 'Maximum Depth of Binary Tree', pattern: 'Trees (DFS/BFS)', difficulty: 'Easy',
    prompt: 'Return the tree’s maximum depth.',
    code: `def max_depth(root):
    if not root:
        return 0
    ${BLANK}`,
    choices: ['return 1 + max(max_depth(root.left), max_depth(root.right))', 'return max(max_depth(root.left), max_depth(root.right))', 'return 1 + max_depth(root.left) + max_depth(root.right)', 'return 1 + min(max_depth(root.left), max_depth(root.right))'],
    answer: 0,
    why: 'Depth is 1 (this node) plus the deeper of its two subtrees. The empty base returns 0, so a leaf returns 1, and recursion carries the count up.',
  },
  {
    id: 'invert-tree', title: 'Invert Binary Tree', pattern: 'Trees (DFS/BFS)', difficulty: 'Easy',
    prompt: 'Mirror the tree — swap every left/right.',
    code: `def invert_tree(root):
    if not root:
        return None
    ${BLANK}
    invert_tree(root.left)
    invert_tree(root.right)
    return root`,
    choices: ['root.left, root.right = root.right, root.left', 'root.left = root.right', 'root.right = root.left', 'root.left, root.right = root.left, root.right'],
    answer: 0,
    why: 'Swap each node’s children, then recurse both sides. The tuple swap exchanges the subtrees in one step; assigning one side first would lose a reference.',
  },
  {
    id: 'level-order', title: 'Binary Tree Level Order', pattern: 'Trees (DFS/BFS)', difficulty: 'Medium',
    prompt: 'Return node values grouped by level (BFS).',
    code: `def level_order(root):
    from collections import deque
    res = []
    q = deque([root] if root else [])
    while q:
        level = []
        for _ in range(len(q)):
            node = q.popleft()
            level.append(node.val)
            if node.left:  q.append(node.left)
            if node.right: q.append(node.right)
        ${BLANK}
    return res`,
    choices: ['res.append(level)', 'res.append(q)', 'res += level', 'res.append(node.val)'],
    answer: 0,
    why: 'Snapshotting len(q) before the inner loop processes exactly one level; collect those values and append the level as a group. That grouping is what makes it level-order, not a flat traversal.',
  },
  // ---------- Greedy & Intervals ----------
  {
    id: 'merge-intervals', title: 'Merge Intervals', pattern: 'Intervals', difficulty: 'Medium',
    prompt: 'Merge all overlapping intervals.',
    code: `def merge(intervals):
    intervals.sort(key=lambda x: x[0])
    res = []
    for s, e in intervals:
        if res and s <= res[-1][1]:
            ${BLANK}
        else:
            res.append([s, e])
    return res`,
    choices: ['res[-1][1] = max(res[-1][1], e)', 'res[-1][1] = e', 'res.append([s, e])', 'res[-1][0] = min(res[-1][0], s)'],
    answer: 0,
    why: 'Sort by start, then walk: if the current interval overlaps the last kept one (start ≤ that end), merge by extending the end to the farther of the two. Otherwise start a new one.',
  },
  {
    id: 'jump-game', title: 'Jump Game', pattern: 'Greedy', difficulty: 'Medium',
    prompt: 'Each value is a max jump length. Can you reach the last index?',
    code: `def can_jump(nums):
    reach = 0
    for i, n in enumerate(nums):
        if i > reach:
            return False
        ${BLANK}
    return True`,
    choices: ['reach = max(reach, i + n)', 'reach = i + n', 'reach += n', 'reach = max(reach, n)'],
    answer: 0,
    why: 'Track the farthest index reachable so far. If you ever stand beyond it, you’re stuck; otherwise extend the reach to i + nums[i]. Greedy — no DP needed.',
  },
  // ---------- Heap / Top-K ----------
  {
    id: 'kth-largest', title: 'Kth Largest Element', pattern: 'Heap / Top-K', difficulty: 'Medium',
    prompt: 'Return the kth largest element using a heap.',
    code: `def find_kth_largest(nums, k):
    import heapq
    heap = []
    for n in nums:
        heapq.heappush(heap, n)
        if len(heap) > k:
            ${BLANK}
    return heap[0]`,
    choices: ['heapq.heappop(heap)', 'heap.pop()', 'heapq.heappush(heap, n)', 'heap.clear()'],
    answer: 0,
    why: 'Keep a min-heap of the k largest. Push each value; when the heap exceeds k, pop the smallest. What remains are the top k, and the root — the smallest of those — is the kth largest.',
  },
  {
    id: 'k-closest-points', title: 'K Closest Points to Origin', pattern: 'Heap / Top-K', difficulty: 'Medium',
    prompt: 'Return the k points nearest the origin using a size-k heap.',
    code: `def k_closest(points, k):
    import heapq
    heap = []
    for x, y in points:
        d = x * x + y * y
        heapq.heappush(heap, (-d, x, y))
        if len(heap) > k:
            ${BLANK}
    return [[x, y] for _, x, y in heap]`,
    choices: ['heapq.heappop(heap)', 'heap.pop()', 'heapq.heappush(heap, (-d, x, y))', 'break'],
    answer: 0,
    why: 'A max-heap of size k (negate the distance, since heapq is a min-heap) keeps the k closest: push, and when it overflows pop the farthest — the largest distance, i.e. the most-negative key.',
  },
];

// ---- Concept catalog ----
// The units you mark as "studied" to unlock their drills. Each concept owns one or
// more drill patterns. The catalog screen lists these; a drill only surfaces once
// its concept is marked studied (or you've solved a matching LeetCode problem).
export const CONCEPTS = [
  { id: 'arrays-hashing', name: 'Arrays & Hashing', area: 'DSA', patterns: ['Hashing'] },
  { id: 'two-pointers', name: 'Two Pointers', area: 'DSA', patterns: ['Two pointers'] },
  { id: 'sliding-window', name: 'Sliding Window', area: 'DSA', patterns: ['Sliding window'] },
  { id: 'stack', name: 'Stack & Monotonic Stack', area: 'DSA', patterns: ['Stack / Monotonic stack'] },
  { id: 'binary-search', name: 'Binary Search', area: 'DSA', patterns: ['Binary search'] },
  { id: 'prefix-sum', name: 'Prefix Sum', area: 'DSA', patterns: ['Prefix sum'] },
  { id: 'linked-list', name: 'Linked List', area: 'DSA', patterns: ['Linked list'] },
  { id: 'trees', name: 'Trees & Traversals', area: 'DSA', patterns: ['Trees (DFS/BFS)'] },
  { id: 'dynamic-programming', name: 'Dynamic Programming', area: 'DSA', patterns: ['Dynamic programming'] },
  { id: 'greedy', name: 'Greedy & Intervals', area: 'DSA', patterns: ['Greedy', 'Intervals'] },
  { id: 'heap', name: 'Heap / Top-K', area: 'DSA', patterns: ['Heap / Top-K'] },
  // No drills yet — these gate the Nuggets deck (mapped from nugget topics).
  { id: 'databases', name: 'Databases & SQL', area: 'CS Fundamentals', patterns: [] },
  { id: 'networking', name: 'Networking & HTTP', area: 'CS Fundamentals', patterns: [] },
  { id: 'concurrency', name: 'OS & Concurrency', area: 'CS Fundamentals', patterns: [] },
  { id: 'security', name: 'Security & Auth', area: 'CS Fundamentals', patterns: [] },
  { id: 'system-design', name: 'System Design', area: 'System Design', patterns: [] },
  { id: 'behavioral', name: 'Behavioral', area: 'Behavioral', patterns: [] },
];
const PATTERN_CONCEPT = new Map();
for (const c of CONCEPTS) for (const p of c.patterns) PATTERN_CONCEPT.set(p, c.id);
export const conceptIdOf = (drill) => PATTERN_CONCEPT.get(drill.pattern) || null;
export const drillsForConcept = (id) => DRILLS.filter((d) => conceptIdOf(d) === id);
export const DRILL_BANK = DRILLS;

// Deterministic-ish shuffle seeded by a number, so choice order varies per card
// but a card's layout is stable within a single render.
function shuffle(arr, seed) {
  const a = arr.slice();
  let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function renderDrills(mount, { arg, navigate }) {
  const scope = arg ? decodeURIComponent(arg) : null; // optional pattern filter
  const [stateRaw, deck, studied] = await Promise.all([getDrillState(), computeDeck(), getStudiedConcepts()]);
  const state = { ...(stateRaw || {}) };

  // Gate: a drill unlocks only once you've marked its concept studied, OR you've
  // solved a matching LeetCode problem (so anything you've actually done shows up).
  const solvedKeys = new Set();
  for (const p of (deck.problems || [])) { if (p.slug) solvedKeys.add(norm(p.slug)); if (p.title) solvedKeys.add(norm(p.title)); }
  const solvedMatch = (d) => solvedKeys.has(d.id) || solvedKeys.has(norm(d.title));
  const unlocked = (d) => !!studied[conceptIdOf(d)] || solvedMatch(d);

  const wrap = el('div', { class: 'revise-wrap drills-wrap' });
  mount.append(wrap);
  const exit = () => navigate('/now');

  // Nothing unlocked yet → point at the concept catalog. (A scoped commute deck
  // ignores the gate — you launched it for that area on purpose.)
  let pool = DRILLS.filter((d) => scope ? d.pattern === scope : unlocked(d));
  if (!pool.length) {
    wrap.append(el('div', { class: 'center-state' }, [
      el('p', { class: 'eyebrow', text: 'Drills' }),
      el('h1', { text: 'Mark what you’ve studied.' }),
      el('p', { class: 'muted', text: 'Drills unlock per concept — tick off the ones you’ve covered and their fill-in-the-blank questions appear here. Anything you’ve logged on LeetCode unlocks automatically.' }),
      el('button', { class: 'btn btn-primary', style: 'margin-top:16px', text: 'Choose concepts', onclick: () => navigate('/concepts') }),
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Back', onclick: exit }),
    ]));
    return;
  }

  // Patterns you've actually logged from real LeetCode practice, with counts —
  // used to lead with what you've been grinding.
  const practiceCount = new Map((deck.patterns || []).map((p) => [p.pattern, p.count]));
  const practiced = new Set(practiceCount.keys());

  // Order: previously-missed first (spaced-rep), then practiced patterns you
  // haven't drilled, then the rest, mastered last. Within a tier, a fresh random
  // shuffle each visit so you don't get the same sequence twice.
  const pri = (d) => {
    const s = state[d.id];
    if (s && s.conf === 'missed') return 0;
    const prac = practiced.has(d.pattern) ? 0 : 1;
    if (!s) return 1 + prac;   // unseen: practiced (1) before unpracticed (2)
    return 3 + prac;           // mastered: practiced (3) before unpracticed (4)
  };
  const rnd = new Map(pool.map((d) => [d.id, Math.random()]));
  let cards = pool.slice().sort((a, b) => pri(a) - pri(b) || (rnd.get(a.id) - rnd.get(b.id)));

  // ---- session state ----
  let idx = 0;
  let got = 0; let missed = 0;
  let seedBase = 7;
  let retrySeed = 0;

  const head = el('div', { class: 'revise-head' });
  const stack = el('div', { class: 'revise-stack drill-stack' });
  wrap.append(head, stack, el('p', { class: 'revise-hint', text: 'Pick the line that makes the code run. You get the question and the full solution — just the one insight is missing. Every answer explains why.' }));

  // Which practiced patterns actually appear in the bank — for the header note.
  const leadPatterns = [...new Set(DRILLS.map((d) => d.pattern))]
    .filter((p) => practiced.has(p))
    .sort((a, b) => (practiceCount.get(b) || 0) - (practiceCount.get(a) || 0));

  function paintHead() {
    clear(head);
    head.append(
      el('div', { class: 'revise-top' }, [
        el('p', { class: 'eyebrow', text: scope ? `Drills · ${scope}` : 'Drills · fill in the blank' }),
        el('div', { class: 'drill-head-actions' }, [
          el('button', { class: 'drill-concepts-link', text: 'Concepts', title: 'Mark which concepts you’ve studied', onclick: () => navigate('/concepts') }),
          el('button', { class: 'revise-close', 'aria-label': 'Close', text: '✕', onclick: exit }),
        ]),
      ]),
      (!scope && leadPatterns.length)
        ? el('p', { class: 'drill-lead', text: `Leading with the patterns you've been practicing — ${leadPatterns.slice(0, 3).join(', ')}.` })
        : null,
      el('div', { class: 'revise-progress' }, [el('div', { class: 'revise-progress-fill', style: `width:${Math.round((idx / cards.length) * 100)}%` })]),
      el('div', { class: 'revise-count', text: `${Math.min(idx + 1, cards.length)} / ${cards.length}` }),
    );
  }

  // Render a code block with the blank as a fillable slot.
  function codeNode(card, slotRef) {
    const parts = card.code.split(BLANK);
    const slot = el('span', { class: 'drill-slot', text: '?' });
    slotRef.slot = slot;
    return el('pre', { class: 'drill-code' }, [parts[0] || '', slot, parts[1] || '']);
  }

  function cardNode(card, { record = true } = {}) {
    const slotRef = {};
    const codeEl = codeNode(card, slotRef);
    const feedback = el('div', { class: 'drill-feedback' });
    const choicesEl = el('div', { class: 'drill-choices' });

    // Shuffle choices so the answer isn't always first; retrySeed reshuffles on a
    // retry so the correct one isn't in the same place.
    const correctText = card.choices[card.answer];
    const order = shuffle(card.choices.map((text, i) => ({ text, correct: i === card.answer })), seedBase + idx * 13 + card.id.length + retrySeed * 131);

    let answered = false;
    const buttons = [];
    for (const opt of order) {
      const btn = el('button', { class: 'drill-choice', type: 'button' }, [
        el('code', { text: opt.text }),
      ]);
      btn.addEventListener('click', () => choose(opt, btn));
      buttons.push(btn);
      choicesEl.append(btn);
    }

    function choose(opt, btn) {
      if (answered) return;
      answered = true;
      // Fill the blank with what they picked.
      slotRef.slot.textContent = opt.text;
      slotRef.slot.classList.add(opt.correct ? 'ok' : 'bad');
      // Mark the buttons: chosen (right/wrong) + always reveal the correct one.
      for (const b of buttons) {
        const t = b.querySelector('code').textContent;
        b.disabled = true;
        if (t === correctText) b.classList.add('correct');
        if (b === btn && !opt.correct) b.classList.add('wrong');
      }
      // Only a card's FIRST genuine attempt scores it and drives spaced-rep; a
      // "Try it again" re-attempt is practice and doesn't re-tally.
      if (record) {
        if (opt.correct) got++; else missed++;
        const prev = state[card.id];
        state[card.id] = { conf: opt.correct ? 'got' : 'missed', at: todayISO(), seen: (prev?.seen || 0) + 1 };
      }

      // Reveal the "why", the whole point of the drill.
      clear(feedback);
      feedback.append(
        el('div', { class: 'drill-verdict ' + (opt.correct ? 'ok' : 'bad'), text: opt.correct ? 'Right.' : `Not quite — it’s ${correctText}` }),
        el('div', { class: 'drill-why-lbl', text: 'Why it fits' }),
        el('div', { class: 'drill-why', text: card.why }),
      );
      // Got it wrong? Retry it right now (reshuffled) before moving on.
      if (!opt.correct) {
        feedback.append(el('button', {
          class: 'btn btn-ghost btn-block drill-retry', style: 'margin-top:14px', text: 'Try it again',
          onclick: () => { retrySeed++; clear(stack); stack.append(cardNode(card, { record: false })); window.scrollTo(0, 0); },
        }));
      }
      feedback.append(el('button', {
        class: 'btn btn-primary btn-block drill-next', style: 'margin-top:10px',
        text: idx + 1 >= cards.length ? 'Finish' : 'Next',
        onclick: () => { idx++; paint(); },
      }));
      feedback.classList.add('show');
    }

    const isPracticed = practiced.has(card.pattern);
    return el('div', { class: `revise-card drill-card p-${card.pattern.replace(/[^a-z0-9]+/gi, '-')}` }, [
      el('div', { class: 'revise-card-inner' }, [
        el('div', { class: 'drill-kindrow' }, [
          el('div', { class: 'revise-kind', text: `${card.pattern} · ${card.difficulty}` }),
          isPracticed ? el('span', { class: 'drill-practiced', text: 'from your practice' }) : null,
        ]),
        el('div', { class: 'drill-title', text: card.title }),
        el('div', { class: 'drill-prompt', text: card.prompt }),
        codeEl,
        choicesEl,
        feedback,
      ]),
    ]);
  }

  function paint() {
    paintHead();
    clear(stack);
    if (idx >= cards.length) return finish();
    stack.append(cardNode(cards[idx]));
    window.scrollTo(0, 0);
  }

  async function finish() {
    clear(stack);
    await setDrillState(state);
    head.querySelector('.revise-count')?.remove();
    const total = got + missed;
    stack.append(el('div', { class: 'revise-done' }, [
      el('div', { class: 'revise-done-mark', text: got === total ? '✓' : '↻' }),
      el('h2', { text: `${got} / ${total} on the logic.` }),
      el('p', { class: 'muted', text: missed === 0 ? 'Clean run — you know why each line is there.' : `${missed} to revisit — they’ll come back first next time.` }),
      missed > 0 ? el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:16px;max-width:320px',
        text: `Retry the ${missed} you missed`,
        onclick: () => { cards = pool.filter((d) => state[d.id]?.conf === 'missed'); idx = 0; got = 0; missed = 0; seedBase += 5; paint(); },
      }) : null,
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Done', onclick: exit }),
    ]));
  }

  paint();
}
