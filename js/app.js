// Guruji bootstrap: service worker registration, hash router, view mounting.
import { clear, el, toast } from './util.js';
import { getActiveSession, clearActiveSession, runStartupMigrations } from './store.js';
import { exportCanonical } from './importexport.js';
import { renderNow } from './views/now.js';
import { renderPrep } from './views/prep.js';
import { renderFocus } from './views/focus.js';
import { renderPlan } from './views/plan.js';
import { renderDay } from './views/day.js';
import { renderReading } from './views/reading.js';
import { renderData } from './views/data.js';
import { renderProgress } from './views/progress.js';
import { renderRoadmap } from './views/roadmap.js';
import { renderNuggets } from './views/nuggets.js';
import { renderDrills } from './views/drills.js';
import { renderConcepts } from './views/concepts.js';

const viewEl = () => document.getElementById('view');
const navEl = () => document.getElementById('nav');
const topbarEl = () => document.getElementById('topbar');

const ROUTES = {
  now: renderNow,
  prep: renderPrep,
  plan: renderPlan,
  day: renderDay,
  reading: renderReading,
  data: renderData,
  focus: renderFocus,
  progress: renderProgress,
  roadmap: renderRoadmap,
  nuggets: renderNuggets,
  revise: renderNuggets, // legacy alias — Revise became Nuggets
  drills: renderDrills,
  concepts: renderConcepts,
};

// Full-screen, distraction-free views hide the app chrome (nav + top bar).
const CHROMELESS = new Set(['focus', 'prep']);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  return { name: name || 'now', arg: rest.join('/') || '' };
}

let currentCleanup = null;

async function router() {
  const { name, arg } = parseHash();
  const render = ROUTES[name] || renderNow;

  // Let a view tear down timers/listeners before we replace it.
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch { /* ignore */ }
    currentCleanup = null;
  }

  const mount = clear(viewEl());

  // Focus + prep are full-screen distraction-free views: hide the chrome.
  const chromeless = CHROMELESS.has(name);
  navEl().hidden = chromeless;
  topbarEl().hidden = chromeless;

  // Highlight active nav + top-bar items.
  document.querySelectorAll('.nav-item, .topbar-action').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  // Expose the route so desktop CSS can widen the chrome for the study view.
  document.getElementById('app').dataset.route = name;

  try {
    const cleanup = await render(mount, { arg, navigate });
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (err) {
    console.error('view error', err);
    mount.innerHTML = `<div class="center-state"><h2>Something went wrong</h2><p class="muted">${String(err.message || err)}</p></div>`;
  }

  // Gentle entrance for each view.
  const v = viewEl();
  v.classList.remove('v-enter');
  void v.offsetWidth;
  v.classList.add('v-enter');

  // Scroll to top on navigation.
  window.scrollTo(0, 0);
}

export function navigate(path) {
  if (location.hash === `#${path}`) router();
  else location.hash = path;
}

// Fade out the boot splash once the first view is painted, keeping it up for a
// brief minimum so it reads as intentional rather than a flash.
function hideSplash(startedAt) {
  const splash = document.getElementById('splash');
  if (!splash) return;
  const wait = Math.max(0, 360 - (Date.now() - startedAt));
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 500);
  }, wait);
}

// If a focus session was left running, point the app at it before the first
// render. Ignore a session abandoned long ago so we don't resurrect stale ones.
async function maybeResumeSession() {
  try {
    // Desktop doesn't hijack into the full-screen timer — it surfaces the live
    // session inside the study view (content + timer together) instead.
    if (window.matchMedia('(min-width: 900px)').matches) return;
    const s = await getActiveSession();
    if (!s || !s.itemId) return;
    const ageMs = Date.now() - new Date(s.startedAt).getTime();
    if (!(ageMs >= 0) || ageMs > 12 * 3600 * 1000) { await clearActiveSession(); return; }
    const focusHash = `#/focus/${s.itemId}/${s.minutes || 25}${s.blockId ? `/${s.blockId}` : ''}`;
    if (location.hash !== focusHash) location.hash = focusHash;
  } catch { /* non-fatal */ }
}

// A floating "snapshot to iCloud" control, reachable from anywhere — including
// mid-session — so you can push the current state and pick it up on the desktop.
function mountSyncFab() {
  const fab = el('button', {
    class: 'sync-fab', 'aria-label': 'Save a snapshot to iCloud', title: 'Snapshot to iCloud (guruji.json)',
  }, ['⤒']);
  fab.addEventListener('click', async () => {
    if (fab.classList.contains('busy')) return;
    fab.classList.add('busy');
    try { await exportCanonical(); toast('Snapshot saved — keep guruji.json in iCloud'); }
    catch { toast('Snapshot failed', true); }
    setTimeout(() => fab.classList.remove('busy'), 600);
  });
  document.body.appendChild(fab);
}

async function boot() {
  const bootStart = Date.now();
  // Failsafe: never leave the splash stuck if boot stalls for any reason.
  const splashFailsafe = setTimeout(() => hideSplash(bootStart), 6000);
  // Ask the browser to keep our IndexedDB data durable (iOS/Safari may evict
  // "best-effort" storage for home-screen PWAs). Non-blocking, best effort.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Run any one-time data migrations before the first render so views paint
  // against the cleaned-up state (e.g. the fresh-start purge of pre-launch
  // tracking data). Non-fatal — swallows its own errors.
  await runStartupMigrations();

  // Resume an in-progress focus session so an accidental close drops you right
  // back into it (the timer is wall-clock accurate). Set the hash before the
  // listener + first render so there's no flash of another view.
  await maybeResumeSession();

  window.addEventListener('hashchange', router);
  await router();
  clearTimeout(splashFailsafe);
  hideSplash(bootStart);
  mountSyncFab();

  // Register the service worker (offline shell). Non-fatal if it fails.
  // Register directly — this module is deferred, so the window 'load' event may
  // have already fired by now and a listener would never run.
  if ('serviceWorker' in navigator) {
    // When a freshly-deployed worker takes control, reload once so the app
    // runs the new code immediately instead of the previously-cached modules —
    // otherwise a fix ships but an open PWA keeps serving the old version.
    // Skip the reload on a first-ever install (no prior controller to replace).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update().catch(() => {}); // check for a newer worker on every launch
    }).catch((e) => console.warn('sw failed', e));
  }
}

boot();
