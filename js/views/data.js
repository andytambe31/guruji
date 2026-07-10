// Data view: import (file + paste) and export, plus a wipe.
import { el, toast } from '../util.js';
import { importFromText, readFile, exportToFile } from '../importexport.js';
import { wipeAll, hasPlan } from '../store.js';

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
      toast('Import failed — see details', true);
      return;
    }
    toast(`Imported ${res.summary.items} items`);
    navigate('/now');
  }

  const exportBtn = el('button', {
    class: 'btn btn-primary',
    text: 'Export backup (.json)',
    disabled: !planLoaded,
    onclick: async () => {
      try {
        const name = await exportToFile();
        toast(`Exported ${name}`);
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
    el('p', { class: 'eyebrow', text: 'Backup & sync' }),
    el('h1', { text: 'Data' }),
    el('p', {
      class: 'muted',
      text: 'Your plan lives only on this device. Back up by exporting to a file and keeping it in iCloud Drive — then import it on your other device.',
    }),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Import plan' }),
    el('div', { class: 'field' }, [
      el('label', { text: 'From a file' }),
      fileInput,
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Or paste JSON' }),
      pasteArea,
      el('div', { class: 'row', style: 'margin-top:10px' }, [importPasteBtn, pasteFromClipboard]),
      errorBox,
    ]),

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Export' }),
    el('p', { class: 'muted', text: planLoaded ? 'Download the current plan, schedule, statuses and log as one JSON file.' : 'Nothing to export yet — import a plan first.' }),
    exportBtn,

    el('hr', { class: 'sep' }),

    el('h2', { text: 'Danger zone' }),
    el('p', { class: 'muted', text: 'Removes everything stored in this browser. Cannot be undone.' }),
    wipeBtn,
  );
}
