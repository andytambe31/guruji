// Data view: iCloud sync (canonical file), import (file + paste, plan or
// migration patch), dated backup, and a wipe.
import { el, clear, toast, todayISO } from '../util.js';
import { importFromText, readFile, exportCanonical, exportToFile, exportContentPatch, snapshotText } from '../importexport.js';
import { wipeAll, hasPlan, getDeviceRole, setDeviceRole, reseedContentPacks } from '../store.js';
import { APP_BUILD } from '../build.js';
import { fsaSupported, isLinked, linkedName, linkFile, unlink, writeLinked, readLinked, getLastSync, setLastSync, getAutoSync, setAutoSync, shareSnapshot } from '../fsync.js';
import { isGistConfigured, connectGist, disconnectGist, syncGist, getLastCloudSync } from '../gistsync.js';
import { SCHEMA_VERSION } from '../migrations.js';
import { buildLLMReport } from '../llm-report.js';

// "3 hours ago" style relative time for the last-synced nudge.
function agoText(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!(ms >= 0)) return 'just now';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export async function renderData(mount, { navigate }) {
  const planLoaded = await hasPlan();
  const role = await getDeviceRole();
  const supported = fsaSupported();
  const linked = await isLinked();
  const linkName = linked ? await linkedName() : null;
  const autoSync = await getAutoSync();
  const lastSync = await getLastSync();
  const gistOn = await isGistConfigured();
  const lastCloud = await getLastCloudSync();
  let gistTokenInput = null; // assigned when the connect form is built

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await readFile(file);
        await doImport(text);
      } catch (err) {
        toast('Could not read file', true);
      }
    },
  });

  const pasteArea = el('textarea', {
    placeholder: 'Paste plan JSON here…',
    spellcheck: false,
  });

  const importPasteBtn = el('button', {
    class: 'btn btn-primary',
    text: 'Import pasted JSON',
    onclick: () => {
      const text = pasteArea.value.trim();
      if (!text) { toast('Nothing pasted', true); return; }
      doImport(text);
    },
  });

  const pasteFromClipboard = el('button', {
    class: 'btn btn-ghost',
    text: 'Paste from clipboard',
    onclick: async () => {
      try {
        const text = await navigator.clipboard.readText();
        pasteArea.value = text;
        toast('Pasted — review, then import');
      } catch {
        toast('Clipboard blocked — paste manually', true);
      }
    },
  });

  const errorBox = el('div', { class: 'muted', style: 'margin-top:10px;white-space:pre-wrap;font-size:13px;' });

  // Off by default, re-importing keeps your progress (done/skipped topics stay
  // as they are). Tick this to wipe that and start every topic fresh — the way
  // to actually reset when a re-import "doesn't change anything".
  const resetChk = el('input', { type: 'checkbox' });
  const resetRow = el('label', { class: 'reset-row' }, [
    resetChk,
    el('span', { text: 'Start fresh — reset every topic to “to-do”, clearing done/skipped marks. Leave off to keep your progress.' }),
  ]);

  async function doImport(text) {
    errorBox.textContent = '';
    const veil = showImport('Reading your file…');
    const started = Date.now();
    let res;
    try {
      res = await importFromText(text, {
        mergeStatus: !resetChk.checked,
        // Make a real schema upgrade visible — pause on it so it can be read.
        onProgress: async (p) => {
          if (p.phase === 'migrate') {
            setImport(veil, `Upgrading your file · v${p.from} → v${p.to}`, p.applied.map((a) => a.description));
            await delay(1000);
          } else if (p.phase === 'save') {
            setImport(veil, 'Saving to this device…');
          } else if (p.phase === 'patch') {
            setImport(veil, 'Applying migration…');
          }
        },
      });
    } catch (err) {
      hideImport(veil);
      errorBox.textContent = String((err && err.message) || err);
      toast('Load failed', true);
      return;
    }
    if (!res.ok) {
      hideImport(veil);
      errorBox.textContent = res.errors.slice(0, 12).join('\n');
      toast('Load failed — see details', true);
      return;
    }
    await delay(Math.max(0, 480 - (Date.now() - started))); // avoid a flash for tiny files
    hideImport(veil);
    if (res.kind === 'sync') {
      const s = res.summary || {};
      const bits = [];
      if (s.status) bits.push(`${s.status} status`);
      if (s.notes) bits.push(`${s.notes} note${s.notes === 1 ? '' : 's'}`);
      if (s.added) bits.push(`${s.added} new`);
      if (s.scheduleAdopted) bits.push('schedule');
      toast(bits.length ? `Synced · ${bits.join(', ')} updated` : 'Synced — already up to date');
    } else if (res.kind === 'patch') {
      toast(res.already ? 'Migration already applied' : `Migration applied${res.description ? ': ' + res.description : ''}`);
    } else {
      const bumped = res.migrated && res.migrated.length ? ` · upgraded v${res.from}→v${res.to}` : '';
      toast(`Loaded ${res.summary.items} items${bumped}`);
    }
    navigate('/now');
  }

  // --- Linked-file (File System Access) sync handlers ---
  async function doPull() {
    let text = null;
    try { text = await readLinked(); } catch { text = null; }
    if (!text) { toast('Could not read the linked file', true); return; }
    await doImport(text);              // detects a snapshot → merges under the sync rules
    await setLastSync(new Date().toISOString());
  }
  async function doSaveLinked() {
    try {
      const name = await writeLinked(await snapshotText());
      await setLastSync(new Date().toISOString());
      toast(`Saved to ${name}`);
      navigate('/data');
    } catch (e) { toast('Save failed' + (e && e.message ? ` — ${e.message}` : ''), true); }
  }
  async function doLink() {
    try {
      const name = await linkFile();
      if (!name) return;              // cancelled the picker
      try { await writeLinked(await snapshotText()); await setLastSync(new Date().toISOString()); } catch { /* first write optional */ }
      toast(`Linked ${name}`);
      navigate('/data');
    } catch { toast('Could not link the file', true); }
  }
  async function doShareSave() {
    const text = await snapshotText();
    const shared = await shareSnapshot(text);
    if (shared) { await setLastSync(new Date().toISOString()); toast('Shared — choose “Save to Files → iCloud Drive”'); navigate('/data'); }
    else { try { await exportCanonical(); toast('Downloaded guruji.json — move it to iCloud Drive'); } catch { toast('Save failed', true); } }
  }

  // --- Cloud sync (GitHub Gist) handlers ---
  async function doConnect() {
    const token = (gistTokenInput && gistTokenInput.value || '').trim();
    if (!token) { toast('Paste a token first', true); return; }
    const veil = showImport('Connecting to GitHub…');
    try {
      const { created } = await connectGist(token);
      try { await syncGist(); } catch { /* first sync best-effort */ }
      hideImport(veil);
      toast(created ? 'Connected — created your private gist' : 'Connected to your gist');
      navigate('/data');
    } catch (e) { hideImport(veil); toast('Connect failed' + (e && e.message ? ` — ${e.message}` : ''), true); }
  }
  async function doCloudSyncNow() {
    const veil = showImport('Syncing with your gist…');
    try { await syncGist(); hideImport(veil); toast('Synced'); navigate('/data'); }
    catch (e) { hideImport(veil); toast('Sync failed' + (e && e.message ? ` — ${e.message}` : ''), true); }
  }
  async function doDisconnect() {
    if (!confirm('Disconnect cloud sync? Your gist stays in GitHub; only the token is removed from this device.')) return;
    await disconnectGist(); toast('Disconnected'); navigate('/data');
  }

  const cloudNodes = [el('h2', { text: 'Cloud sync' })];
  if (gistOn) {
    cloudNodes.push(
      el('p', { class: 'muted', text: 'Connected to your private GitHub gist. Guruji auto-pulls when you open the app and pushes when you leave — every device stays in step, hands-off, even on Safari.' }),
      el('div', { class: 'sync-status', text: `Last cloud sync · ${agoText(lastCloud)}` }),
      el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:4px' }, [
        el('button', { class: 'btn btn-primary', text: 'Sync now', onclick: doCloudSyncNow }),
        el('button', { class: 'btn btn-ghost', text: 'Disconnect', onclick: doDisconnect }),
      ]),
    );
  } else {
    gistTokenInput = el('input', { type: 'password', placeholder: 'GitHub token (gist scope)', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, class: 'gist-token' });
    cloudNodes.push(
      el('p', { class: 'muted', text: 'Hands-off sync that works in Safari: your data lives in a PRIVATE gist in your own GitHub account, auto-synced on open and on leave. The token is stored only on this device — never exported, never shared.' }),
      el('ol', { class: 'gist-steps' }, [
        el('li', {}, [el('span', { text: 'Create a CLASSIC token at ' }), el('a', { href: 'https://github.com/settings/tokens/new?scopes=gist&description=guruji-sync', target: '_blank', rel: 'noopener', text: 'github.com/settings/tokens' }), el('span', { text: ' → Generate new token (classic) → check ONLY the “gist” scope. (Fine-grained tokens don’t support gists — this must be a classic token.)' })]),
        el('li', { text: 'Copy it (starts with ghp_…), paste below, and Connect — Guruji makes one private gist and keeps guruji.json in it.' }),
        el('li', { text: 'On your other device, connect with a token from the same GitHub account; it finds the same gist.' }),
      ]),
      el('div', { class: 'field', style: 'margin-top:6px' }, [gistTokenInput]),
      el('button', { class: 'btn btn-primary', text: 'Connect', disabled: !planLoaded, onclick: doConnect }),
    );
  }

  // Build the file-sync section, tuned to what this browser can do.
  const syncNodes = [el('h2', { text: 'Sync with a file (iCloud)' })];
  if (supported && linked) {
    syncNodes.push(
      el('p', { class: 'muted', text: `Linked to ${linkName}. “Save” writes straight into it; “Pull” reads the other device’s changes and merges them — no Downloads folder.` }),
      el('div', { class: 'sync-status', text: `Last synced · ${agoText(lastSync)}` }),
      el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:4px' }, [
        el('button', { class: 'btn btn-primary', text: 'Save to iCloud', disabled: !planLoaded, onclick: doSaveLinked }),
        el('button', { class: 'btn btn-ghost', text: 'Pull latest', onclick: doPull }),
      ]),
    );
    const autoChk = el('input', { type: 'checkbox' });
    if (autoSync) autoChk.checked = true;
    autoChk.addEventListener('change', async () => { await setAutoSync(autoChk.checked); toast(autoChk.checked ? 'Auto-pull on open enabled' : 'Auto-pull off'); });
    syncNodes.push(
      el('label', { class: 'reset-row' }, [autoChk, el('span', { text: 'Pull the latest automatically when I open the app.' })]),
      el('button', { class: 'btn-link', style: 'margin-top:4px', text: `Unlink ${linkName}`, onclick: async () => { await unlink(); toast('Unlinked'); navigate('/data'); } }),
    );
  } else if (supported) {
    syncNodes.push(
      el('p', { class: 'muted', text: planLoaded ? 'Link your guruji.json in iCloud Drive once — then Save and Pull read and write that same file directly, no Downloads folder and no re-picking.' : 'Load a plan first, then link your iCloud file.' }),
      el('button', { class: 'btn btn-primary', text: 'Link my iCloud file', disabled: !planLoaded, onclick: doLink }),
    );
  } else {
    // No File System Access API (Safari / installed iOS PWA) — no persistent
    // handle. Save via the share sheet (→ Save to Files → iCloud); Pull opens
    // the file picker straight to iCloud Drive. Both live here so the loop is
    // self-contained, not split across the page.
    syncNodes.push(
      el('p', { class: 'muted', text: planLoaded ? 'Save writes your snapshot to iCloud (via the share sheet → Save to Files); Pull reads the other device’s file and merges it. A couple of taps each way — Safari doesn’t allow in-place file writing.' : 'Load a plan first, then you can save it.' }),
      el('div', { class: 'sync-status', text: `Last synced · ${agoText(lastSync)}` }),
      el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:4px' }, [
        el('button', { class: 'btn btn-primary', text: 'Save to iCloud', disabled: !planLoaded, onclick: doShareSave }),
        el('button', { class: 'btn btn-ghost', text: 'Pull from iCloud', onclick: () => fileInput.click() }),
      ]),
    );
  }

  const backupBtn = el('button', {
    class: 'btn btn-ghost',
    text: 'Download a dated backup',
    disabled: !planLoaded,
    onclick: async () => {
      try {
        const name = await exportToFile();
        toast(`Saved ${name}`);
      } catch (err) {
        toast('Export failed', true);
      }
    },
  });

  const contentBtn = el('button', {
    class: 'btn btn-ghost',
    disabled: !planLoaded,
    text: 'Export content changes',
    onclick: async () => {
      try {
        const res = await exportContentPatch();
        if (!res.ok) { toast('No content notes to export yet', true); return; }
        toast(`Saved ${res.name} · ${res.count} topics`);
      } catch (err) {
        toast('Export failed', true);
      }
    },
  });

  // --- LLM analysis prompt ---
  // Summarises the whole plan + progress into a prompt you paste into an LLM,
  // which then analyses your prep and can hand back an importable content patch.
  const llmOut = el('textarea', { class: 'llm-out', readonly: true, spellcheck: false, placeholder: 'Your generated prompt appears here — copy it into ChatGPT or Claude.', style: 'display:none' });
  const llmCopyBtn = el('button', { class: 'btn btn-ghost', text: 'Copy prompt', style: 'display:none', onclick: async () => {
    try { await navigator.clipboard.writeText(llmOut.value); toast('Prompt copied — paste it into your LLM'); }
    catch { llmOut.select(); toast('Select-all + copy the text above', true); }
  } });
  const llmBtn = el('button', {
    class: 'btn btn-primary',
    text: 'Generate analysis prompt',
    disabled: !planLoaded,
    onclick: async () => {
      try {
        const text = await buildLLMReport();
        llmOut.value = text;
        llmOut.style.display = ''; llmCopyBtn.style.display = '';
        try { await navigator.clipboard.writeText(text); toast('Prompt generated & copied'); }
        catch { toast('Prompt generated — copy it below'); }
      } catch (err) {
        toast('Could not build the prompt', true);
      }
    },
  });

  const wipeBtn = el('button', {
    class: 'btn btn-danger',
    text: 'Erase all local data',
    onclick: async () => {
      if (!confirm('Erase the plan, schedule and log from this device? Export first if you want a backup.')) return;
      await wipeAll();
      toast('All local data erased');
      navigate('/now');
    },
  });

  // --- This device's sync role ---
  // Content (study guides) is desktop-authoritative; the daily schedule + log is
  // phone-owned. Loading a snapshot merges under those rules, so the role matters.
  const roleBtn = (r, label) => el('button', {
    class: 'btn ' + (role === r ? 'btn-primary' : 'btn-ghost'),
    text: label,
    onclick: async () => { if (role !== r) { await setDeviceRole(r); navigate('/data'); } },
  });
  const roleRow = el('div', { class: 'row', style: 'gap:10px;margin-top:6px' }, [
    roleBtn('phone', '📱 This is my phone'),
    roleBtn('desktop', '🖥️ This is my desktop'),
  ]);

  mount.append(
    el('p', { class: 'eyebrow', text: `Backup & sync · schema v${SCHEMA_VERSION}` }),
    el('h1', { text: 'Data' }),
    el('p', {
      class: 'muted',
      text: 'Everything lives on this device. For hands-off sync across devices, connect Cloud sync below. Prefer no account? Use the file-based iCloud option instead. Either way, Guruji merges devices smartly rather than overwriting.',
    }),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'This device' }),
    el('p', { class: 'muted', text: role === 'desktop'
      ? 'Set as your desktop — it owns your study-guide content (your notes win when you sync). Your phone stays in charge of the daily schedule and session log.'
      : 'Set as your phone — it owns your daily schedule and session log (they’re never overwritten by a desktop snapshot). Study-guide content flows in from the desktop. Progress like “done” syncs both ways, newest change winning.' }),
    roleRow,

    el('hr', { class: 'sep' }),

    ...cloudNodes,

    el('hr', { class: 'sep' }),

    ...syncNodes,

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Load' }),
    el('p', { class: 'muted', text: 'A plan, another device’s guruji.json, or a migration file — Guruji detects which. A device snapshot is merged under the sync rules above (never a blind overwrite); a fresh plan is loaded outright. Older files are upgraded automatically.' }),
    resetRow,
    el('div', { class: 'field' }, [
      el('label', { text: 'From a file (iCloud Drive, Files…)' }),
      fileInput,
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Or paste JSON' }),
      pasteArea,
      el('div', { class: 'row', style: 'margin-top:10px' }, [importPasteBtn, pasteFromClipboard]),
      errorBox,
    ]),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Backup' }),
    el('p', { class: 'muted', text: planLoaded ? 'A dated, never-overwritten copy — for keeping history.' : 'Nothing to back up yet.' }),
    backupBtn,

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Coach with an LLM' }),
    el('p', { class: 'muted', text: planLoaded
      ? 'Generate a prompt that summarizes your goal, pacing and progress. Paste it into ChatGPT or Claude for an outside read on where you stand — it can hand back an importable “content patch” you load right here to adjust the plan.'
      : 'Load a plan first, then you can generate an analysis prompt.' }),
    el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, [llmBtn, llmCopyBtn]),
    llmOut,

    // Content sync — desktop only, since content is authored on the desktop.
    el('div', { class: 'desktop-only' }, [
      el('hr', { class: 'sep' }),
      el('h2', { text: 'Sync content' }),
      el('p', { class: 'muted', text: 'Your topic notes as a timestamped migration file. Load it on another device (or into your iCloud file) to carry your study content across — it only updates notes, never touching that device’s tracking, status or schedule.' }),
      contentBtn,
    ]),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Danger zone' }),
    el('p', { class: 'muted', text: 'Removes everything stored in this browser. Cannot be undone.' }),
    wipeBtn,
  );

  // Diagnostics — so "is the latest build actually running, and does the app
  // agree with my phone about what day it is?" is answerable at a glance.
  const diag = el('div', { class: 'diag' });
  mount.append(el('hr', { class: 'sep' }), diag);
  renderDiagnostics(diag);
}

async function renderDiagnostics(mount) {
  // The cached build (what the service worker precached) vs the RUNNING build
  // (what this JS bundle actually is). On an installed PWA these can diverge —
  // the cache updates but the old code keeps executing — which is exactly how
  // "diagnostics says v145 but the new content isn't here" happens.
  let cached = 'unknown';
  try {
    const keys = (await caches.keys()) || [];
    // Pick the HIGHEST guruji version present — the newest installed worker —
    // so stray older caches don't mask a pending update.
    const guru = keys.filter((k) => /^guruji-v\d+/.test(k))
      .map((k) => ({ k, n: parseInt((k.match(/v(\d+)/) || [])[1] || '0', 10) }))
      .sort((a, b) => b.n - a.n);
    if (guru.length) cached = guru[0].k;
  } catch { /* caches unavailable */ }
  const running = APP_BUILD;
  const stale = cached !== 'unknown' && cached !== running;
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '—'; } catch { return '—'; } })();
  const now = new Date();
  const line = (k, v, cls) => el('div', { class: 'diag-row' }, [
    el('span', { class: 'diag-k', text: k }),
    el('span', { class: 'diag-v' + (cls ? ' ' + cls : ''), text: v }),
  ]);

  // Force a genuine update: drop caches + unregister the worker, then reload from
  // network. The reliable escape hatch when a PWA is stuck on an old bundle.
  const forceUpdate = async () => {
    try {
      if ('caches' in window) { for (const k of await caches.keys()) await caches.delete(k); }
      if ('serviceWorker' in navigator) { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }
    } catch { /* best effort */ }
    location.reload();
  };
  // Recovery: re-run the bundled content-pack seeders now (adds anything missing,
  // e.g. a study guide that didn't appear).
  const rebuildGuides = async () => {
    try {
      const r = await reseedContentPacks();
      toast(r.added || r.refreshed ? `Study guides rebuilt · ${r.added} added, ${r.refreshed} refreshed` : 'Study guides already up to date');
    } catch { toast('Rebuild failed', true); }
  };

  clear(mount).append(
    el('p', { class: 'eyebrow', text: 'Diagnostics' }),
    line('Running build', running, stale ? 'diag-warn' : null),
    line('Cached build', cached, stale ? 'diag-warn' : null),
    line('App’s “today”', todayISO(now)),
    line('Device time', now.toLocaleString()),
    line('Timezone', tz),
    stale
      ? el('div', { style: 'margin-top:10px' }, [
        el('p', { class: 'muted', style: 'font-size:12px;color:var(--wind,#d98324)', text: 'A newer build is cached but this older code is still running — that’s why new content may be missing. Tap Update to force it.' }),
        el('button', { class: 'btn btn-primary', style: 'margin-top:8px', text: 'Update to the latest build', onclick: forceUpdate }),
      ])
      : el('p', { class: 'muted', style: 'margin-top:8px;font-size:12px', text: 'Running and cached builds match. If a study guide still isn’t showing, tap Rebuild study guides below.' }),
    el('div', { style: 'margin-top:10px' }, [
      el('button', { class: 'btn btn-ghost', text: 'Rebuild study guides', onclick: rebuildGuides }),
    ]),
  );
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// A full-screen veil shown while a file loads — and, when an older file is
// being brought up to the current schema, it names the upgrade steps so the
// migration is visible instead of happening silently.
function showImport(msg) {
  const main = el('div', { class: 'iv-main', text: msg });
  const steps = el('ul', { class: 'iv-steps' });
  const veil = el('div', { class: 'import-veil' }, [
    el('div', { class: 'iv-bar' }, [el('span')]),
    main, steps,
  ]);
  veil._main = main; veil._steps = steps;
  document.body.appendChild(veil);
  requestAnimationFrame(() => veil.classList.add('show'));
  return veil;
}
function setImport(veil, msg, steps) {
  if (!veil) return;
  veil._main.textContent = msg;
  clear(veil._steps);
  (steps || []).forEach((s) => veil._steps.appendChild(el('li', { text: s })));
}
function hideImport(veil) {
  if (!veil) return;
  veil.classList.remove('show');
  setTimeout(() => veil.remove(), 350);
}
