// Curated named problem bank per DSA concept — a mix of medium & hard LeetCode
// problems for each pattern. Powers the Path "This week" view so the guidance is
// concrete ("solve these"), not abstract targets. Concept ids align with the
// drills.js CONCEPTS catalog where they exist, so "studied" state lines up.

const M = 'Medium', H = 'Hard';

export const PROBLEM_BANK = {
  'arrays-hashing': { name: 'Arrays & Hashing', problems: [
    { t: 'Group Anagrams', d: M }, { t: 'Top K Frequent Elements', d: M },
    { t: 'Product of Array Except Self', d: M }, { t: 'Longest Consecutive Sequence', d: M },
    { t: 'First Missing Positive', d: H } ] },
  'two-pointers': { name: 'Two Pointers', problems: [
    { t: '3Sum', d: M }, { t: 'Container With Most Water', d: M },
    { t: '3Sum Closest', d: M }, { t: 'Trapping Rain Water', d: H } ] },
  'sliding-window': { name: 'Sliding Window', problems: [
    { t: 'Longest Substring Without Repeating Characters', d: M },
    { t: 'Longest Repeating Character Replacement', d: M }, { t: 'Permutation in String', d: M },
    { t: 'Minimum Window Substring', d: H }, { t: 'Sliding Window Maximum', d: H } ] },
  'stack': { name: 'Stack & Monotonic Stack', problems: [
    { t: 'Daily Temperatures', d: M }, { t: 'Evaluate Reverse Polish Notation', d: M },
    { t: 'Generate Parentheses', d: M }, { t: 'Car Fleet', d: M },
    { t: 'Largest Rectangle in Histogram', d: H } ] },
  'binary-search': { name: 'Binary Search', problems: [
    { t: 'Search in Rotated Sorted Array', d: M }, { t: 'Find Minimum in Rotated Sorted Array', d: M },
    { t: 'Koko Eating Bananas', d: M }, { t: 'Time Based Key-Value Store', d: M },
    { t: 'Median of Two Sorted Arrays', d: H } ] },
  'prefix-sum': { name: 'Prefix Sum', problems: [
    { t: 'Subarray Sum Equals K', d: M }, { t: 'Contiguous Array', d: M },
    { t: 'Range Sum Query 2D - Immutable', d: M } ] },
  'linked-list': { name: 'Linked List', problems: [
    { t: 'Reorder List', d: M }, { t: 'Remove Nth Node From End of List', d: M },
    { t: 'Copy List with Random Pointer', d: M }, { t: 'LRU Cache', d: M },
    { t: 'Merge k Sorted Lists', d: H }, { t: 'Reverse Nodes in k-Group', d: H } ] },
  'trees': { name: 'Trees & Traversals', problems: [
    { t: 'Binary Tree Level Order Traversal', d: M }, { t: 'Validate Binary Search Tree', d: M },
    { t: 'Kth Smallest Element in a BST', d: M }, { t: 'Lowest Common Ancestor of a BST', d: M },
    { t: 'Construct Binary Tree from Preorder and Inorder', d: M },
    { t: 'Binary Tree Maximum Path Sum', d: H }, { t: 'Serialize and Deserialize Binary Tree', d: H } ] },
  'graphs': { name: 'Graphs', problems: [
    { t: 'Number of Islands', d: M }, { t: 'Clone Graph', d: M },
    { t: 'Pacific Atlantic Water Flow', d: M }, { t: 'Course Schedule', d: M },
    { t: 'Rotting Oranges', d: M }, { t: 'Word Ladder', d: H }, { t: 'Alien Dictionary', d: H } ] },
  'heap': { name: 'Heap / Top-K', problems: [
    { t: 'Kth Largest Element in an Array', d: M }, { t: 'Task Scheduler', d: M },
    { t: 'K Closest Points to Origin', d: M }, { t: 'Design Twitter', d: M },
    { t: 'Find Median from Data Stream', d: H } ] },
  'backtracking': { name: 'Backtracking', problems: [
    { t: 'Subsets', d: M }, { t: 'Combination Sum', d: M }, { t: 'Permutations', d: M },
    { t: 'Word Search', d: M }, { t: 'Palindrome Partitioning', d: M }, { t: 'N-Queens', d: H } ] },
  'tries': { name: 'Tries', problems: [
    { t: 'Implement Trie (Prefix Tree)', d: M }, { t: 'Design Add and Search Words Data Structure', d: M },
    { t: 'Word Search II', d: H } ] },
  'dynamic-programming': { name: 'Dynamic Programming', problems: [
    { t: 'House Robber', d: M }, { t: 'Coin Change', d: M }, { t: 'Longest Increasing Subsequence', d: M },
    { t: 'Longest Common Subsequence', d: M }, { t: 'Word Break', d: M }, { t: 'Decode Ways', d: M },
    { t: 'Edit Distance', d: H }, { t: 'Burst Balloons', d: H } ] },
  'greedy': { name: 'Greedy & Intervals', problems: [
    { t: 'Jump Game', d: M }, { t: 'Merge Intervals', d: M }, { t: 'Insert Interval', d: M },
    { t: 'Non-overlapping Intervals', d: M }, { t: 'Gas Station', d: M },
    { t: 'Minimum Interval to Include Each Query', d: H } ] },
};

// Which patterns a topic title touches — a topic may cover more than one
// (e.g. "Two pointers & sliding window", "Tries & advanced graphs").
const KEYWORDS = [
  ['arrays-hashing', /array|hashing|hash\s*map|frequency/i],
  ['two-pointers', /two[\s-]?pointer/i],
  ['sliding-window', /sliding\s*window/i],
  ['stack', /stack/i],
  ['binary-search', /binary\s*search/i],
  ['prefix-sum', /prefix\s*sum/i],
  ['linked-list', /linked\s*list/i],
  ['trees', /\btree|\bbst\b|traversal/i],
  ['graphs', /graph|topolog|dijkstra|union[\s-]?find/i],
  ['heap', /heap|priority\s*queue/i],
  ['backtracking', /backtrack|subset|permutation|combination/i],
  ['tries', /\btrie/i],
  ['dynamic-programming', /dynamic\s*programming|\bdp\b/i],
  ['greedy', /greedy|interval/i],
];
const ORDER = Object.keys(PROBLEM_BANK);

// Given topic titles (this week's focus), return the concept keys they cover,
// in bank order, deduped. Empty → caller decides a fallback.
export function conceptsForTitles(titles) {
  const hit = new Set();
  for (const title of titles) {
    for (const [key, re] of KEYWORDS) if (PROBLEM_BANK[key] && re.test(title || '')) hit.add(key);
  }
  return ORDER.filter((k) => hit.has(k));
}
export const ALL_CONCEPT_KEYS = ORDER;
