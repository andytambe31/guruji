// Guruji bootstrap: service worker registration, hash router, view mounting.
import { clear } from './util.js';
import { renderNow } from './views/now.js';
import { renderPrep } from './views/prep.js';
import { renderFocus } from './views/focus.js';
import { renderPlan } from './views/plan.js';
import { renderData } from './views/data.js';

const viewEl = () => document.getElementById('view');
const navEl = () => document.getElementById('nav');
const topbarEl = () => document.getElementById('topbar');

const ROUTES = {
  now: renderNow,
  prep: renderPrep,
  plan: renderPlan,
  data: renderData,
  focus: renderFocus,
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

  try {
    const cleanup = await render(mount, { arg, navigate });
    if (typeof cleanup === 'function') currentCleanup = cleanup;
  } catch (err) {
    console.error('view error', err);
    mount.innerHTML = `<div class="center-state"><h2>Something went wrong</h2><p class="muted">${String(err.message || err)}</p></div>`;
  }
  // Scroll to top on navigation.
  window.scrollTo(0, 0);
}

export function navigate(path) {
  if (location.hash === `#${path}`) router();
  else location.hash = path;
}

async function boot() {
  window.addEventListener('hashchange', router);
  await router();

  // Register the service worker (offline shell). Non-fatal if it fails.
  // Register directly — this module is deferred, so the window 'load' event may
  // have already fired by now and a listener would never run.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw failed', e));
  }
}

boot();
