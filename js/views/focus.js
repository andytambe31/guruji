// Focus session — a distinct *environment* per area. Start DSA and you drop
// into a sharp sprint; System Design is a calmer, thinking space; Reading is
// warm and quiet. Same timer underneath, different room. Only Pause + End.
import { el, clear, fmtClock, toast } from '../util.js';
import { getItem, setItemStatus, addLogEntry } from '../store.js';

// Per-area environments. viz: 'bar' (depleting sprint) | 'ring' (breathing)
// | 'calm' (warm, minimal).
const THEMES = {
  'DSA':           { cls: 'env-dsa',  label: 'Deep work',      ritual: 'Head down. Attack the problem.',        nudge: 'Depth, not speed.',           viz: 'bar' },
  'System Design': { cls: 'env-sys',  label: 'Design session', ritual: 'Think out loud. Sketch the tradeoffs.', nudge: 'Zoom out. What breaks first?', viz: 'ring' },
  'Reading':       { cls: 'env-read', label: 'Reading',        ritual: 'Just you and the page.',                nudge: 'No rush. Let it land.',        viz: 'calm' },
  'Behavioral':    { cls: 'env-beh',  label: 'Behavioral',     ritual: 'Tell it like it happened.',             nudge: 'Situation, action, result.',   viz: 'bar' },
  'Applications':  { cls: 'env-app',  label: 'Applications',   ritual: 'One small step forward.',               nudge: 'Send it. Momentum.',           viz: 'bar' },
  'default':       { cls: 'env-default', label: 'Focus',       ritual: 'Stay with it. One thing.',              nudge: 'You only owe it this block.',  viz: 'bar' },
};

export async function renderFocus(mount, { arg, navigate }) {
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

  const theme = THEMES[item.area] || THEMES.default;

  const started = new Date();
  const total = minutes * 60;
  let remaining = total;
  let paused = false;
  let finished = false;
  let ticker = null;
  let wakeLock = null;

  const phaseLabel = el('div', { class: 'phase-label', text: theme.label });
  const title = el('div', { class: 'focus-title', text: item.title });
  const clock = el('div', { class: 'clock', text: fmtClock(remaining) });
  const ritual = el('div', { class: 'ritual', text: theme.ritual });
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

  const screen = el('div', { class: `focus ${theme.cls}` }, [phaseLabel, title, center, ritual, controls]);
  mount.append(screen);

  requestWakeLock();
  paintProgress();
  start();

  function start() { stopTicker(); ticker = setInterval(tick, 1000); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function paintProgress() {
    if (barFill) barFill.style.width = `${(remaining / total) * 100}%`;
  }

  function tick() {
    if (paused || finished) return;
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      clock.textContent = fmtClock(0);
      paintProgress();
      timeUp();
      return;
    }
    clock.textContent = fmtClock(remaining);
    paintProgress();
    if (remaining === Math.floor(total / 2)) ritual.textContent = theme.nudge;
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
    phaseLabel.textContent = paused ? 'Paused' : theme.label;
  }

  function elapsedMin() { return Math.max(0, Math.round((total - remaining) / 60)); }

  function showResolve(timedOut) {
    stopTicker();
    const summary = timedOut ? `${minutes} min complete` : `${elapsedMin()} of ${minutes} min`;
    const box = el('div', { class: `focus ${theme.cls}` }, [
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
    // A recurring habit (e.g. reading) is never consumed — it just gets logged
    // and stays available so the coach can keep pushing the streak.
    if (result !== 'todo' && !item.recurring) await setItemStatus(item.id, result);
    await addLogEntry({
      itemId: item.id,
      itemTitle: item.title,
      mode: item.mode,
      area: item.area || null,
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
