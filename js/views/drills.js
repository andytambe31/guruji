// Drills — fill-in-the-blank for LeetCode-style problems. You're given the
// question and the full solution with ONE line blanked out; you pick, from four
// choices, the exact piece of logic that makes the code run. Every answer flips
// to a "why it fits" so you learn the reasoning, not the keystroke. Card-based
// like Revise, but multiple-choice — no swiping. Missed cards resurface first
// (spaced-rep memory), so the ones you don't understand come back around.
import { el, clear, todayISO } from '../util.js';
import { getDrillState, setDrillState } from '../store.js';

// The blank marker embedded in each snippet — replaced by the chosen fragment.
const BLANK = '▢';

// Authored bank: arrays, two pointers, frequency maps. Each drill hides the one
// line that carries the key insight; the distractors are the plausible-but-wrong
// moves (off-by-one pointer, swapped key/value, wrong comparison). `why` is the
// interview-ready reason the right line works.
const DRILLS = [
  // ---------- Frequency maps ----------
  {
    id: 'two-sum', title: 'Two Sum', pattern: 'Frequency map', difficulty: 'Easy',
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
    id: 'contains-duplicate', title: 'Contains Duplicate', pattern: 'Frequency map', difficulty: 'Easy',
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
    id: 'valid-anagram', title: 'Valid Anagram', pattern: 'Frequency map', difficulty: 'Easy',
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
    id: 'first-unique-char', title: 'First Unique Character', pattern: 'Frequency map', difficulty: 'Easy',
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
    id: 'majority-element', title: 'Majority Element', pattern: 'Frequency map', difficulty: 'Easy',
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
  // ---------- Arrays ----------
  {
    id: 'max-subarray', title: 'Maximum Subarray (Kadane)', pattern: 'Arrays', difficulty: 'Medium',
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
    id: 'best-time-stock', title: 'Best Time to Buy and Sell Stock', pattern: 'Arrays', difficulty: 'Easy',
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
    id: 'product-except-self', title: 'Product of Array Except Self', pattern: 'Arrays', difficulty: 'Medium',
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
];

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

export async function renderDrills(mount, { navigate }) {
  const stateRaw = await getDrillState();
  const state = { ...(stateRaw || {}) };

  // Order: missed cards first (spaced-rep), then never-seen, then mastered.
  // Ties break by least-recently-seen so nothing gets stale.
  const pri = (d) => {
    const s = state[d.id];
    if (!s) return 1;               // unseen
    return s.conf === 'missed' ? 0 : 2;
  };
  let cards = DRILLS.slice().sort((a, b) =>
    pri(a) - pri(b) || (String(state[a.id]?.at || '') < String(state[b.id]?.at || '') ? -1 : 1));

  const wrap = el('div', { class: 'revise-wrap drills-wrap' });
  mount.append(wrap);
  const exit = () => navigate('/now');

  // ---- session state ----
  let idx = 0;
  let got = 0; let missed = 0;
  let seedBase = 7;

  const head = el('div', { class: 'revise-head' });
  const stack = el('div', { class: 'revise-stack drill-stack' });
  wrap.append(head, stack, el('p', { class: 'revise-hint', text: 'Pick the line that makes the code run. You get the question and the full solution — just the one insight is missing. Every answer explains why.' }));

  function paintHead() {
    clear(head);
    head.append(
      el('div', { class: 'revise-top' }, [
        el('p', { class: 'eyebrow', text: 'Drills · fill in the blank' }),
        el('button', { class: 'revise-close', 'aria-label': 'Close', text: '✕', onclick: exit }),
      ]),
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

  function cardNode(card) {
    const slotRef = {};
    const codeEl = codeNode(card, slotRef);
    const feedback = el('div', { class: 'drill-feedback' });
    const choicesEl = el('div', { class: 'drill-choices' });

    // Shuffle choices so the answer isn't always first; track the correct text.
    const correctText = card.choices[card.answer];
    const order = shuffle(card.choices.map((text, i) => ({ text, correct: i === card.answer })), seedBase + idx * 13 + card.id.length);

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
      if (opt.correct) got++; else missed++;
      // Persist spaced-rep memory: a miss marks the card to resurface first.
      const prev = state[card.id];
      state[card.id] = { conf: opt.correct ? 'got' : 'missed', at: todayISO(), seen: (prev?.seen || 0) + 1 };

      // Reveal the "why", the whole point of the drill.
      clear(feedback);
      feedback.append(
        el('div', { class: 'drill-verdict ' + (opt.correct ? 'ok' : 'bad'), text: opt.correct ? 'Right.' : `Not quite — it’s ${correctText}` }),
        el('div', { class: 'drill-why-lbl', text: 'Why it fits' }),
        el('div', { class: 'drill-why', text: card.why }),
        el('button', {
          class: 'btn btn-primary btn-block drill-next', style: 'margin-top:16px',
          text: idx + 1 >= cards.length ? 'Finish' : 'Next',
          onclick: () => { idx++; paint(); },
        }),
      );
      feedback.classList.add('show');
    }

    return el('div', { class: `revise-card drill-card p-${card.pattern.replace(/\s+/g, '-')}` }, [
      el('div', { class: 'revise-card-inner' }, [
        el('div', { class: 'revise-kind', text: `${card.pattern} · ${card.difficulty}` }),
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
        onclick: () => { cards = DRILLS.filter((d) => state[d.id]?.conf === 'missed'); idx = 0; got = 0; missed = 0; seedBase += 5; paint(); },
      }) : null,
      el('button', { class: 'btn btn-ghost btn-block', style: 'margin-top:10px;max-width:320px', text: 'Done', onclick: exit }),
    ]));
  }

  paint();
}
