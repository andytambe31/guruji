// Focus session — you said how long you're sitting; this counts it down.
// One quiet block. Only Pause + End. On End (or when time's up) you mark the
// item done / not-finished / skipped and it's logged.
import { el, clear, fmtClock, toast } from '../util.js';
import { getItem, setItemStatus, addLogEntry } from '../store.js';

const RITUAL = 'Phone on Focus mode. One thing on screen.';
const NUDGES = [
  'One thing. Stay here.',
  'You only owe it this block.',
  'Depth, not speed.',
];

export async function renderFocus(mount, { arg, navigate }) {
  // arg is "<itemId>/<minutes>"
  const slash = arg.lastIndexOf('/');
  const itemId = slash >= 0 ? arg.slice(0, slash) : arg;
  const minutes = Math.max(1, parseInt(slash >= 0 ? arg.slice(slash + 1) : '25', 10) || 25);

  const item = await getItem(itemId);
  if (!item) {
    mount.append(el('div', { class: 'center-state' }, [
      el('h2', { text: 'That item is gone.' }),
      el('button', { class: 'btn btn-primary', text: 'Back to Now', onclick: () => navigate('/now') }),
    ]));
    return;
  }

  const started = new Date();
  const total = minutes * 60;
  let remaining = total;
  let paused = false;
  let finished = false;
  let ticker = null;
  let wakeLock = null;

  const phaseLabel = el('div', { class: 'phase-label', text: `${minutes} minutes` });
  const title = el('div', { class: 'focus-title', text: item.title });
  const clock = el('div', { class: 'clock', text: fmtClock(remaining) });
  const ritual = el('div', { class: 'ritual', text: RITUAL });
  const pauseBtn = el('button', { class: 'btn btn-ghost btn-lg', text: 'Pause', onclick: togglePause });
  const endBtn = el('button', { class: 'btn btn-primary btn-lg', text: 'End', onclick: () => showResolve(false) });
  const controls = el('div', { class: 'focus-controls' }, [pauseBtn, endBtn]);

  const screen = el('div', { class: 'focus' }, [phaseLabel, title, clock, ritual, controls]);
  mount.append(screen);

  requestWakeLock();
  start();

  function start() { stopTicker(); ticker = setInterval(tick, 1000); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function tick() {
    if (paused || finished) return;
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      clock.textContent = fmtClock(0);
      timeUp();
      return;
    }
    clock.textContent = fmtClock(remaining);
    // a sparse nudge around the midpoint
    if (remaining === Math.floor(total / 2)) ritual.textContent = NUDGES[1];
  }

  function timeUp() {
    finished = true;
    stopTicker();
    buzz();
    clock.classList.add('done');
    phaseLabel.textContent = "Time's up";
    ritual.textContent = 'Nicely done. Log it below.';
    showResolve(true);
  }

  function togglePause() {
    if (finished) return;
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    phaseLabel.textContent = paused ? 'Paused' : `${minutes} minutes`;
  }

  function elapsedMin() { return Math.max(0, Math.round((total - remaining) / 60)); }

  function showResolve(timedOut) {
    stopTicker();
    const summary = timedOut
      ? `${minutes} min complete`
      : `${elapsedMin()} of ${minutes} min`;

    const box = el('div', { class: 'focus' }, [
      el('div', { class: 'phase-label', text: timedOut ? "Time's up" : 'Session ended' }),
      el('div', { class: 'focus-title', text: item.title }),
      el('div', { class: 'muted', style: 'margin-bottom:30px', text: summary }),
      el('div', { class: 'stack', style: 'width:100%;max-width:300px' }, [
        el('button', { class: 'btn btn-primary btn-lg btn-block', text: 'Mark done', onclick: () => resolve('done') }),
        el('button', { class: 'btn btn-ghost btn-block', text: 'Not finished — keep it', onclick: () => resolve('todo') }),
        el('button', { class: 'btn btn-danger btn-block', text: 'Skip this', onclick: () => resolve('skipped') }),
      ]),
    ]);
    clear(mount).append(box);
  }

  async function resolve(result) {
    if (result !== 'todo') await setItemStatus(item.id, result);
    await addLogEntry({
      itemId: item.id,
      itemTitle: item.title,
      mode: item.mode,
      phase: item.phase,
      week: item.week,
      date: started.toISOString().slice(0, 10),
      startedAt: started.toISOString(),
      endedAt: new Date().toISOString(),
      plannedMinutes: minutes,
      focusMinutes: elapsedMin(),
      result,
    });
    releaseWakeLock();
    toast(result === 'done' ? 'Done — logged.' : result === 'skipped' ? 'Skipped — logged.' : 'Session logged.');
    navigate('/now');
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ok */ }
  }
  function releaseWakeLock() { try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch { /* ok */ } }
  function buzz() { try { if ('vibrate' in navigator) navigator.vibrate(80); } catch { /* ok */ } }

  const onVis = () => { if (document.visibilityState === 'visible' && !wakeLock && !finished) requestWakeLock(); };
  document.addEventListener('visibilitychange', onVis);

  return function cleanup() {
    stopTicker();
    releaseWakeLock();
    document.removeEventListener('visibilitychange', onVis);
  };
}
