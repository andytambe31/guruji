// Data view: iCloud sync (canonical file), import (file + paste, plan or
// migration patch), dated backup, and a wipe.
import { el, clear, toast, todayISO } from '../util.js';
import { importFromText, readFile, exportCanonical, exportToFile, exportContentPatch, snapshotText } from '../importexport.js';
import { wipeAll, hasPlan, getDeviceRole, setDeviceRole } from '../store.js';
import { fsaSupported, isLinked, linkedName, linkFile, unlink, writeLinked, readLinked, getLastSync, setLastSync, getAutoSync, setAutoSync, shareSnapshot } from '../fsync.js';
import { SCHEMA_VERSION } from '../migrations.js';

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

  // Build the sync section, tuned to what this browser can do.
  const syncNodes = [el('h2', { text: 'Sync with iCloud' })];
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
      text: 'Everything lives on this device. To sync: Save to iCloud here, keep guruji.json in iCloud Drive, then Load it on your other device — Guruji merges the two smartly rather than overwriting.',
    }),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'This device' }),
    el('p', { class: 'muted', text: role === 'desktop'
      ? 'Set as your desktop — it owns your study-guide content (your notes win when you sync). Your phone stays in charge of the daily schedule and session log.'
      : 'Set as your phone — it owns your daily schedule and session log (they’re never overwritten by a desktop snapshot). Study-guide content flows in from the desktop. Progress like “done” syncs both ways, newest change winning.' }),
    roleRow,

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
  let build = 'unknown';
  try {
    const keys = (await caches.keys()) || [];
    const v = keys.find((k) => /^guruji-v\d+/.test(k));
    if (v) build = v;
  } catch { /* caches unavailable */ }
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '—'; } catch { return '—'; } })();
  const now = new Date();
  const line = (k, v) => el('div', { class: 'diag-row' }, [
    el('span', { class: 'diag-k', text: k }),
    el('span', { class: 'diag-v', text: v }),
  ]);
  clear(mount).append(
    el('p', { class: 'eyebrow', text: 'Diagnostics' }),
    line('App build', build),
    line('App’s “today”', todayISO(now)),
    line('Device time', now.toLocaleString()),
    line('Timezone', tz),
    el('p', { class: 'muted', style: 'margin-top:8px;font-size:12px', text: 'If “App build” isn’t the latest, close the app fully and reopen while online to update. If “App’s today” doesn’t match your phone’s date, tell me — but it should now use your device’s local day.' }),
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
