// Focus session — a distinct *environment* per area. Start DSA and you drop
// into a sharp sprint; System Design is a calmer, thinking space; Reading is
// warm and quiet. Same timer underneath, different room. Only Pause + End.
import { el, clear, fmtClock, toast, todayISO } from '../util.js';
import { getItem, setItemStatus, addLogEntry, getActiveSession, setActiveSession, clearActiveSession, setBlockStatus } from '../store.js';

// Per-area environments. viz: 'bar' (depleting sprint) | 'ring' (breathing)
// | 'calm' (warm, minimal). `mantras` is a slideshow of principles that slowly
// rotate during the session — the room coaching the mindset, not the content.
const THEMES = {
  'DSA': {
    cls: 'env-dsa', label: 'Deep work', viz: 'bar', rotate: 11,
    mantras: [
      'Read the prompt twice. Restate it in your own words.',
      'Pin down constraints and edge cases before you type.',
      'Say the approach out loud, then write it.',
      'Brute force first — then optimize.',
      'Name the pattern before the solution.',
      'Test the ugly cases: empty, one item, duplicates, overflow.',
      'Stuck? Shrink the problem or draw a concrete example.',
    ],
  },
  'System Design': {
    cls: 'env-sys', label: 'Design session', viz: 'ring', rotate: 13,
    mantras: [
      'Start with requirements and scale — who, how many, how fast.',
      'Do the napkin math: QPS, storage, bandwidth.',
      'Draw the boxes before the details.',
      'Every choice is a tradeoff — say the other side.',
      'Find the bottleneck, then remove it.',
      'Ask how it fails before how it scales.',
    ],
  },
  'Reading': {
    cls: 'env-read', label: 'Reading', viz: 'calm', rotate: 18,
    mantras: [
      'Mark the line that stops you — you’ll want it after.',
      'Ask: why did the author make this choice?',
      'Say the thought in your own words. That’s what stays.',
      'What would you tell a friend about this page?',
      'Read for what you carry out, not the pages behind you.',
      'A book you can’t discuss, you haven’t really finished.',
    ],
  },
  'Behavioral': {
    cls: 'env-beh', label: 'Behavioral', viz: 'bar', rotate: 13,
    mantras: [
      'Situation, Task, Action, Result — in order.',
      'Lead with your decision, not the backstory.',
      'Numbers make the impact real.',
      'One story, told well, beats three rushed.',
    ],
  },
  'Applications': {
    cls: 'env-app', label: 'Applications', viz: 'bar', rotate: 13,
    mantras: [
      'One real outreach beats ten open tabs.',
      'Referrals first — ask directly.',
      'Tailor the first line, not the whole thing.',
      'Momentum compounds. Send it.',
    ],
  },
  'CS Fundamentals': {
    cls: 'env-default', label: 'Fundamentals', viz: 'bar', rotate: 13,
    mantras: [
      'Learn the concept, not the syntax — syntax you can look up.',
      'Draw the schema before you write the query.',
      'Ask “what does this actually do under the hood?”',
      'Name the tradeoff — every choice has one.',
      'Could you explain this to an interviewer in two minutes?',
      'Tie it to something you’ve built or seen break.',
    ],
  },
  'default': {
    cls: 'env-default', label: 'Focus', viz: 'bar', rotate: 12,
    mantras: ['Stay with it. One thing.', 'You only owe it this block.', 'Depth, not speed.'],
  },
};

// Per-area coaching: how to actually run this session, and which resources to
// open (on the desktop, where the study content lives). A topic can override the
// steps and add its own resources via its `coach` field; otherwise the whole
// area shares this playbook. This is the coach in the room — the "what do I do
// now and what do I look at" the timer alone can't give you.
const PLAYBOOKS = {
  'DSA': {
    steps: [
      'On your desktop, open this topic’s guide (Plan) and NeetCode side by side.',
      'Learn the pattern first — read the guide, watch NeetCode’s video for it.',
      'Pen first, per problem: restate it, note constraints, brute force + its Big-O, then the pattern.',
      'Code it on LeetCode. Stuck ~30 min? Read the editorial fully, then re-code from scratch.',
      'End each: a one-line note (pattern + key insight); mark it to re-solve in a few days.',
    ],
    resources: [
      'NeetCode (neetcode.io) — pattern videos and clean solutions.',
      'LeetCode — solve here; near interviews, filter by company + frequency.',
      'Pattern catalog — Plan → DSA → Method (on desktop).',
      'Grind 75 (techinterviewhandbook.org) — what to solve next, in order.',
    ],
  },
  'System Design': {
    steps: [
      'On your desktop, open this topic’s guide (Plan) and read it actively.',
      'Take notes on the tradeoffs — for every choice, say the other side out loud.',
      'Draw the boxes and do the napkin math (QPS, storage) as you go.',
      'If it’s a design question, walk all six steps out loud, drawing the diagram.',
    ],
    resources: [
      'This topic’s guide + the storage-internals / design walkthroughs (Plan, desktop).',
      'System Design Primer (github.com/donnemartin/system-design-primer) — reference.',
      'ByteByteGo — diagrams and clear explanations.',
    ],
  },
  'CS Fundamentals': {
    steps: [
      'On your desktop, open the topic guide; read for the concept, not the syntax.',
      'After each section, close it and explain it back in your own words.',
      'Tie it to something you’ve built — or seen break — in real code.',
      'Check yourself: could you explain this to an interviewer in two minutes?',
    ],
    resources: [
      'This topic’s guide — Plan → CS Fundamentals (on desktop).',
      'Official docs for the tech (Postgres, MDN for HTTP, and so on).',
    ],
  },
  'Reading': {
    steps: [
      'Pick up where you left off — read for what you carry out, not the page count.',
      'Mark the one line that stops you.',
      'After the timer, write the single thought in your own words (Reading → reflect).',
    ],
    resources: ['Your current book.', 'Your reflections — the Reading tab.'],
  },
  'Behavioral': {
    steps: [
      'Pick one story and structure it: Situation, Task, Action, Result.',
      'Lead with your decision, not the backstory; put numbers on the impact.',
      'Say it out loud, timed to about two minutes.',
    ],
    resources: ['Your STAR stories — Plan → Behavioral (on desktop).'],
  },
  'default': {
    steps: [
      'On your desktop, open the topic’s guide and work through it actively.',
      'Keep one thing on screen; narrate what you’re doing.',
      'End with a one-line note on what you learned.',
    ],
    resources: [],
  },
};

// The coach panel that sits under the timer: the session's play + resources.
// A topic's own `coach` (plan/resources) overrides/augments its area playbook.
function coachPanel(item) {
  const pb = PLAYBOOKS[item.area] || PLAYBOOKS.default;
  const c = item.coach && typeof item.coach === 'object' ? item.coach : null;
  const steps = (c && Array.isArray(c.plan) && c.plan.length) ? c.plan : pb.steps;
  const resources = [...(pb.resources || []), ...((c && Array.isArray(c.resources)) ? c.resources : [])];
  const kids = [
    el('div', { class: 'fc-head', text: 'How to study this' }),
    el('ol', { class: 'fc-steps' }, steps.map((s) => el('li', { text: s }))),
  ];
  if (resources.length) {
    kids.push(el('div', { class: 'fc-sub', text: 'Resources · open on your desktop' }));
    kids.push(el('ul', { class: 'fc-res' }, resources.map((r) => el('li', { text: r }))));
  }
  return el('div', { class: 'focus-coach' }, kids);
}

export async function renderFocus(mount, { arg, navigate }) {
  // arg is "itemId/minutes" or, when launched from a planned block on the Day,
  // "itemId/minutes/blockId" so the session's real minutes attach back to the
  // block. itemIds carry no slash, so a plain split is unambiguous.
  const parts = String(arg).split('/');
  const itemId = parts[0];
  const minutes = Math.max(1, parseInt(parts[1] || '25', 10) || 25);
  let blockId = parts[2] || null;

  const item = await getItem(itemId);
  if (!item) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h2', { text: 'That item is gone.' }),
      el('button', { class: 'btn btn-primary', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  const theme = THEMES[item.area] || THEMES.default;

  // Resume a session in progress (same item) so an accidental app close doesn't
  // lose it; otherwise start fresh. The timer runs off wall-clock (startedAt +
  // accumulated pause), so it stays accurate across closes and background throttling.
  const existing = await getActiveSession();
  const resuming = !!(existing && existing.itemId === itemId);
  // On resume the route often lacks the blockId — recover it from the session so
  // the minutes still attach to the block that launched it.
  if (resuming && !blockId && existing.blockId) blockId = existing.blockId;
  const started = resuming ? new Date(existing.startedAt) : new Date();
  const total = minutes * 60;
  let pausedAccum = resuming ? (existing.pausedAccum || 0) : 0; // seconds spent paused
  let paused = resuming ? !!existing.paused : false;
  let pausedAt = resuming && existing.paused && existing.pausedAt ? new Date(existing.pausedAt) : null;
  let finished = false;
  let destroyed = false;
  let ticker = null;
  let rotator = null;
  let mIdx = 0;
  let wakeLock = null;
  let solvesInput = null; // the "problems you did" field on the resolve screen

  const persist = () => setActiveSession({
    itemId, minutes, blockId, startedAt: started.toISOString(),
    paused, pausedAt: pausedAt ? pausedAt.toISOString() : null, pausedAccum,
  });
  // Seconds of active (non-paused) work elapsed, from the wall clock.
  const activeElapsed = () => {
    let pausedMs = pausedAccum * 1000;
    if (paused && pausedAt) pausedMs += Date.now() - pausedAt.getTime();
    return Math.max(0, Math.floor((Date.now() - started.getTime() - pausedMs) / 1000));
  };
  const computeRemaining = () => Math.max(0, total - activeElapsed());
  let remaining = computeRemaining();
  await persist();

  const phaseLabel = el('div', { class: 'phase-label', text: theme.label });
  const title = el('div', { class: 'focus-title', text: item.title });
  const clock = el('div', { class: 'clock', text: fmtClock(remaining) });
  const ritual = el('div', { class: 'ritual', text: theme.mantras[0] });
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-lg', text: 'Pause', onclick: togglePause });
  const endBtn = el('button', { class: 'btn btn-primary btn-lg', text: 'End', onclick: () => showResolve(false) });
  const controls = el('div', { class: 'focus-controls' }, [pauseBtn, endBtn]);

  // Central visualization varies by environment.
  let barFill = null;
  let center;
  if (theme.viz === 'ring') {
    center = el('div', { class: 'env-ring' }, [clock]);
  } else if (theme.viz === 'calm') {
    center = el('div', { class: 'env-calm' }, [clock, el('div', { class: 'env-breath' })]);
  } else {
    barFill = el('div', { class: 'env-bar-fill' });
    center = el('div', { class: 'env-barwrap' }, [clock, el('div', { class: 'env-bar' }, [barFill])]);
  }

  // Timer hero fills the first screen (calm); the coach panel sits just under it,
  // scroll to read the play + resources while the clock runs.
  const hero = el('div', { class: 'focus-hero' }, [phaseLabel, title, center, ritual, controls]);
  const screen = el('div', { class: `focus has-coach ${theme.cls}` }, [hero, coachPanel(item)]);
  mount.append(screen);

  requestWakeLock();
  paintProgress();
  if (remaining <= 0) {
    // Resumed after the planned time already elapsed — go straight to wrap-up.
    timeUp();
  } else {
    start();
    startRotator();
  }

  function start() { stopTicker(); ticker = setInterval(tick, 1000); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  // Slowly rotate the mantra slideshow — the room coaching the mindset.
  function startRotator() {
    const list = theme.mantras;
    if (!list || list.length < 2) return;
    rotator = setInterval(() => {
      if (paused || finished || destroyed) return;
      mIdx = (mIdx + 1) % list.length;
      ritual.style.opacity = '0';
      setTimeout(() => { if (!destroyed) { ritual.textContent = list[mIdx]; ritual.style.opacity = '1'; } }, 350);
    }, (theme.rotate || 12) * 1000);
  }
  function stopRotator() { if (rotator) { clearInterval(rotator); rotator = null; } }

  function paintProgress() {
    if (barFill) barFill.style.width = `${(remaining / total) * 100}%`;
  }

  function tick() {
    if (paused || finished) return;
    remaining = computeRemaining();
    if (remaining <= 0) {
      remaining = 0;
      clock.textContent = fmtClock(0);
      paintProgress();
      timeUp();
      return;
    }
    clock.textContent = fmtClock(remaining);
    paintProgress();
  }

  function timeUp() {
    finished = true;
    stopTicker();
    stopRotator();
    buzz();
    clock.classList.add('done');
    phaseLabel.textContent = "Time's up";
    ritual.textContent = 'Nicely done. Log it below.';
    showResolve(true);
  }

  function togglePause() {
    if (finished) return;
    paused = !paused;
    if (paused) {
      pausedAt = new Date();
    } else if (pausedAt) {
      pausedAccum += Math.floor((Date.now() - pausedAt.getTime()) / 1000);
      pausedAt = null;
    }
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    phaseLabel.textContent = paused ? 'Paused' : theme.label;
    persist();
  }

  // Actual focused minutes, straight from the wall clock (excludes paused time),
  // capped at the planned length. Doesn't rely on the ticking `remaining`, which
  // can be stale if the app was backgrounded right before you resolve.
  function elapsedMin() { return Math.max(0, Math.round(Math.min(total, activeElapsed()) / 60)); }

  function showResolve(timedOut) {
    stopTicker();
    stopRotator();
    const summary = timedOut ? `${minutes} min complete` : `${elapsedMin()} of ${minutes} min`;
    // Feed the coach real data: the problems/things you actually did this
    // session. One per line. Optional, but it's what "where do I stand" is built
    // from — it lands in the log and surfaces on Progress.
    const isCoding = item.area === 'DSA' || item.area === 'CS Fundamentals';
    solvesInput = el('textarea', {
      class: 'focus-solves', rows: 3, spellcheck: false,
      placeholder: isCoding ? 'e.g.\nTwo Sum — solved\n3Sum — needed a hint' : 'one per line (optional)',
    });
    const box = el('div', { class: `focus ${theme.cls}` }, [
      el('div', { class: 'phase-label', text: timedOut ? "Time's up" : 'Session ended' }),
      el('div', { class: 'focus-title', text: item.title }),
      el('div', { class: 'muted', style: 'margin-bottom:22px', text: summary }),
      el('div', { class: 'focus-solves-wrap' }, [
        el('div', { class: 'focus-solves-label', text: item.area === 'DSA' ? 'Problems you did' : 'What did you work on?' }),
        solvesInput,
      ]),
      el('div', { class: 'stack', style: 'width:100%;max-width:320px;margin-top:20px' }, [
        el('button', { class: 'btn btn-primary btn-lg btn-block', text: 'Mark done', onclick: () => resolve('done') }),
        el('button', { class: 'btn btn-ghost btn-block', text: 'Not finished — keep it', onclick: () => resolve('todo') }),
        el('button', { class: 'btn btn-danger btn-block', text: 'Skip this', onclick: () => resolve('skipped') }),
      ]),
    ]);
    clear(mount).append(box);
  }

  // Parse the "problems you did" field into a clean list (one per line).
  function collectSolves() {
    if (!solvesInput) return [];
    return solvesInput.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 60);
  }

  async function resolve(result) {
    await clearActiveSession(); // the session is finished — nothing to resume
    // A recurring habit (e.g. reading) is never consumed — it just gets logged
    // and stays available so the coach can keep pushing the streak.
    if (result !== 'todo' && !item.recurring) await setItemStatus(item.id, result);
    // Attribute the real minutes to the planned block that launched this session
    // (if any), and close the loop: finishing the session marks the block done —
    // carrying the *actual* time studied, not the reserved time.
    if (blockId && result === 'done') await setBlockStatus(blockId, 'done');
    await addLogEntry({
      itemId: item.id,
      itemTitle: item.title,
      mode: item.mode,
      area: item.area || null,
      phase: item.phase,
      week: item.week,
      blockId: blockId || null,
      date: todayISO(started), // the local calendar day the session started
      startedAt: started.toISOString(),
      endedAt: new Date().toISOString(),
      plannedMinutes: minutes,
      focusMinutes: elapsedMin(),
      problems: collectSolves(), // what you actually did — the coach's raw data
      result,
    });
    releaseWakeLock();
    toast(result === 'done' ? 'Done — logged.' : result === 'skipped' ? 'Skipped — logged.' : 'Session logged.');
    // After actually reading, go straight to keeping a line & a thought — the
    // retention step is the point of the practice, not an afterthought.
    if (item.area === 'Reading' && result !== 'skipped') navigate('/reading/reflect');
    else navigate('/now');
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ok */ }
  }
  function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { /* ok */ } }
  function buzz() { try { if ('vibrate' in navigator) navigator.vibrate(80); } catch { /* ok */ } }

  const onVis = () => { if (document.visibilityState === 'visible' && !wakeLock && !finished) requestWakeLock(); };
  document.addEventListener('visibilitychange', onVis);

  return function cleanup() {
    destroyed = true;
    stopTicker();
    stopRotator();
    releaseWakeLock();
    document.removeEventListener('visibilitychange', onVis);
  };
}
