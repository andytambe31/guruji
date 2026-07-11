// Data view: iCloud sync (canonical file), import (file + paste, plan or
// migration patch), dated backup, and a wipe.
import { el, toast } from '../util.js';
import { importFromText, readFile, exportCanonical, exportToFile } from '../importexport.js';
import { wipeAll, hasPlan } from '../store.js';
import { SCHEMA_VERSION } from '../migrations.js';

export async function renderData(mount, { navigate }) {
  const planLoaded = await hasPlan();

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

  async function doImport(text) {
    errorBox.textContent = '';
    const res = await importFromText(text);
    if (!res.ok) {
      errorBox.textContent = res.errors.slice(0, 12).join('\n');
      toast('Load failed — see details', true);
      return;
    }
    if (res.kind === 'patch') {
      toast(res.already ? 'Migration already applied' : `Migration applied${res.description ? ': ' + res.description : ''}`);
    } else {
      const bumped = res.migrated && res.migrated.length ? ` · upgraded v${res.from}→v${res.to}` : '';
      toast(`Loaded ${res.summary.items} items${bumped}`);
    }
    navigate('/now');
  }

  const syncBtn = el('button', {
    class: 'btn btn-primary',
    text: 'Save to iCloud (guruji.json)',
    disabled: !planLoaded,
    onclick: async () => {
      try {
        await exportCanonical();
        toast('Saved guruji.json — keep it in iCloud Drive');
      } catch (err) {
        toast('Save failed', true);
      }
    },
  });

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

  mount.append(
    el('p', { class: 'eyebrow', text: `Backup & sync · schema v${SCHEMA_VERSION}` }),
    el('h1', { text: 'Data' }),
    el('p', {
      class: 'muted',
      text: 'Everything lives on this device. To sync: Save to iCloud here, keep guruji.json in iCloud Drive, then Load it on your other device. Overwriting the same file each time keeps every device in step.',
    }),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Sync with iCloud' }),
    el('p', { class: 'muted', text: planLoaded ? 'Writes the current plan, schedule, statuses, log and cognitive-load context into one guruji.json.' : 'Load a plan first, then you can save it.' }),
    syncBtn,

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Load' }),
    el('p', { class: 'muted', text: 'A plan, a full backup, or a migration file — Guruji detects which. Older files are upgraded to the current schema automatically.' }),
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

    el('h2', { text: 'Danger zone' }),
    el('p', { class: 'muted', text: 'Removes everything stored in this browser. Cannot be undone.' }),
    wipeBtn,
  );
}
