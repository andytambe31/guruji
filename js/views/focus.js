// Focus session — distraction-free full-screen Pomodoro.
// 25 on / 5 off, long break (15) after 4 focus rounds. Only Pause + End.
import { el, clear, fmtClock, toast } from '../util.js';
import { getItem, setItemStatus, addLogEntry } from '../store.js';

const FOCUS_MIN = 25;
const SHORT_BREAK_MIN = 5;
const LONG_BREAK_MIN = 15;
const ROUNDS_BEFORE_LONG = 4;

const RITUAL = 'Phone on Focus mode. One thing on screen. 25 minutes.';
const FOCUS_NUDGES = [
  'One thing. Stay here.',
  'You only owe it this block.',
  'Depth, not speed.',
];
const BREAK_NUDGES = [
  'Break. Look far away. Breathe.',
  'Rest the eyes. Stand up.',
  'Let it settle.',
];

export async function renderFocus(mount, { arg, navigate }) {
  const item = await getItem(arg);
  if (!item) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h2', { text: 'That item is gone.' }),
      el('button', { class: 'btn btn-primary', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  // ----- session state -----
  const started = new Date();
  let phase = 'focus';            // 'focus' | 'short' | 'long'
  let remaining = FOCUS_MIN * 60; // seconds
  let paused = false;
  let completedFocus = 0;         // completed 25-min focus rounds
  let focusSeconds = 0;           // total focused seconds this session
  let ticker = null;
  let wakeLock = null;
  let nudgeIdx = 0;

  // ----- DOM -----
  const phaseLabel = el('div', { class: 'phase-label', text: 'Focus' });
  const title = el('div', { class: 'focus-title', text: item.title });
  const clock = el('div', { class: 'clock', text: fmtClock(remaining) });
  const ritual = el('div', { class: 'ritual', text: RITUAL });
  const rounds = el('div', { class: 'rounds' });

  const pauseBtn = el('button', { class: 'btn btn-ghost btn-lg', text: 'Pause', onclick: togglePause });
  const endBtn = el('button', { class: 'btn btn-primary btn-lg', text: 'End', onclick: end });
  const controls = el('div', { class: 'focus-controls' }, [pauseBtn, endBtn]);

  const screen = el('div', { class: 'focus' }, [phaseLabel, title, clock, rounds, ritual, controls]);
  mount.append(screen);

  paintRounds();
  requestWakeLock();
  start();

  // ----- timer -----
  function start() {
    stopTicker();
    ticker = setInterval(tick, 1000);
  }
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }
  function tick() {
    if (paused) return;
    remaining -= 1;
    if (phase === 'focus') focusSeconds += 1;
    if (remaining <= 0) {
      advancePhase();
      return;
    }
    clock.textContent = fmtClock(remaining);
  }

  function advancePhase() {
    if (phase === 'focus') {
      completedFocus += 1;
      paintRounds();
      buzz();
      if (completedFocus % ROUNDS_BEFORE_LONG === 0) {
        setPhase('long', LONG_BREAK_MIN * 60);
      } else {
        setPhase('short', SHORT_BREAK_MIN * 60);
      }
    } else {
      buzz();
      setPhase('focus', FOCUS_MIN * 60);
    }
  }

  function setPhase(next, seconds) {
    phase = next;
    remaining = seconds;
    const isBreak = next !== 'focus';
    clock.classList.toggle('break', isBreak);
    phaseLabel.textContent = next === 'focus' ? 'Focus' : (next === 'long' ? 'Long break' : 'Break');
    ritual.textContent = isBreak
      ? BREAK_NUDGES[nudgeIdx++ % BREAK_NUDGES.length]
      : FOCUS_NUDGES[nudgeIdx++ % FOCUS_NUDGES.length];
    clock.textContent = fmtClock(remaining);
  }

  function togglePause() {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    phaseLabel.textContent = paused ? 'Paused' : (phase === 'focus' ? 'Focus' : (phase === 'long' ? 'Long break' : 'Break'));
  }

  function paintRounds() {
    clear(rounds);
    for (let i = 0; i < ROUNDS_BEFORE_LONG; i++) {
      const filled = (completedFocus % ROUNDS_BEFORE_LONG) > i || (completedFocus > 0 && completedFocus % ROUNDS_BEFORE_LONG === 0);
      rounds.append(el('div', { class: 'round-pip' + (filled ? ' filled' : '') }));
    }
  }

  // ----- end / resolve -----
  function end() {
    stopTicker();
    showResolve();
  }

  function showResolve() {
    const focusMin = Math.round(focusSeconds / 60);
    const summary = `${completedFocus} pomodoro${completedFocus === 1 ? '' : 's'} · ${focusMin} min focused`;

    const box = el('div', { class: 'focus' }, [
      el('div', { class: 'phase-label', text: 'Session complete' }),
      el('div', { class: 'focus-title', text: item.title }),
      el('div', { class: 'meta muted', style: 'margin-bottom:26px', text: summary }),
      el('div', { class: 'stack', style: 'width:100%;max-width:320px' }, [
        el('button', { class: 'btn btn-primary btn-lg btn-block', text: 'Mark done', onclick: () => resolve('done') }),
        el('button', { class: 'btn btn-ghost btn-block', text: 'Not finished — keep it', onclick: () => resolve('todo') }),
        el('button', { class: 'btn btn-danger btn-block', text: 'Skip this', onclick: () => resolve('skipped') }),
      ]),
    ]);
    clear(mount).append(box);
  }

  async function resolve(result) {
    // result: 'done' | 'todo' | 'skipped'
    if (result !== 'todo') {
      await setItemStatus(item.id, result);
    }
    await addLogEntry({
      itemId: item.id,
      itemTitle: item.title,
      mode: item.mode,
      phase: item.phase,
      week: item.week,
      date: started.toISOString().slice(0, 10),
      startedAt: started.toISOString(),
      endedAt: new Date().toISOString(),
      pomodoros: completedFocus,
      focusMinutes: Math.round(focusSeconds / 60),
      result,
    });
    releaseWakeLock();
    const msg = result === 'done' ? 'Done — logged.' : result === 'skipped' ? 'Skipped — logged.' : 'Session logged.';
    toast(msg);
    navigate('/now');
  }

  // ----- wake lock (best-effort; keeps the screen awake during a session) -----
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch { /* not critical */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { /* ignore */ }
  }

  function buzz() {
    try { if ('vibrate' in navigator) navigator.vibrate(60); } catch { /* ignore */ }
  }

  // Re-acquire wake lock if the tab was backgrounded and returns.
  const onVis = () => { if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock(); };
  document.addEventListener('visibilitychange', onVis);

  // Cleanup when the router navigates away.
  return function cleanup() {
    stopTicker();
    releaseWakeLock();
    document.removeEventListener('visibilitychange', onVis);
  };
}
