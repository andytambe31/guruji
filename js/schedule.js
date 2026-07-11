// Adaptive day scheduling — pure functions, no DB. The coach lays out a day's
// study blocks (hard work first, while you're freshest) and re-packs the
// "floating" blocks around any you've pinned to a specific time, so moving one
// thing around cleanly re-allocates the rest.

export const DAY_START = 9 * 60;   // 9:00am — earliest the coach will book
export const DAY_END = 22 * 60;    // 10:00pm — latest a block may end
export const GAP = 10;             // minutes of breathing room between blocks

const DIFF_ORDER = { DESK: 0, TRANSIT: 1, WIND_DOWN: 2 };

export function clampDur(m) {
  const v = Number(m) || 45;
  return Math.max(15, Math.min(90, Math.round(v)));
}

// Lay out fresh blocks for `items` (already the "one next thing per area" set),
// hardest work first so it lands earlier when you have the most focus.
export function planDay(date, items, { startMin } = {}) {
  const ordered = [...items].sort(
    (a, b) => (DIFF_ORDER[a.mode] ?? 1) - (DIFF_ORDER[b.mode] ?? 1)
  );
  let cursor = startMin != null ? Math.max(DAY_START, startMin) : DAY_START;
  const blocks = [];
  for (const it of ordered) {
    const minutes = clampDur(it.estMinutes);
    if (cursor + minutes > DAY_END) break; // out of daylight — leave the rest
    blocks.push({
      itemId: it.id,
      area: it.area || 'Study',
      title: it.title || '',
      mode: it.mode,
      date,
      start: cursor,
      minutes,
      status: 'planned',
      pinned: false,
    });
    cursor += minutes + GAP;
  }
  return blocks;
}

// Re-pack a day: pinned/done blocks keep their exact time; floating blocks
// flow into the earliest free slots around them, in their current order.
export function reflow(blocks) {
  const fixed = blocks.filter((b) => b.pinned).sort((a, b) => a.start - b.start);
  const floating = blocks.filter((b) => !b.pinned).sort((a, b) => a.start - b.start);

  let cursor = DAY_START;
  for (const b of floating) {
    let start = Math.max(cursor, DAY_START);
    start = pushPastFixed(start, b.minutes, fixed);
    b.start = start;
    cursor = start + b.minutes + GAP;
  }
  return [...fixed, ...floating].sort((a, b) => a.start - b.start);
}

// Slide `start` forward until [start, start+minutes] clears every fixed block.
function pushPastFixed(start, minutes, fixed) {
  let s = start;
  let moved = true;
  while (moved) {
    moved = false;
    for (const p of fixed) {
      const pEnd = p.start + p.minutes + GAP;
      if (s < pEnd && s + minutes + GAP > p.start) { s = pEnd; moved = true; }
    }
  }
  return s;
}
