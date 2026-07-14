// File-handle sync — the "smart path" to one iCloud file.
//
// On browsers with the File System Access API (Chrome/Edge desktop), you pick
// your iCloud Drive guruji.json ONCE; we keep a durable handle to it, so Save
// writes straight into that file and Pull reads straight from it — no Downloads
// folder, no re-picking. The handle persists across sessions (stored in IDB);
// regaining write permission needs one click per session (browser security).
//
// Where the API is missing (iOS Safari), callers fall back to the share sheet /
// download + file-picker flow. Everything here degrades gracefully.
import { STORES, get, put, del } from './db.js';

export const fsaSupported = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;

// The live handle. Kept in memory for the session and best-effort persisted to
// IDB so a real (structured-cloneable) handle survives a reload; a test mock
// that isn't cloneable simply won't persist, which is fine.
let cached = null;

async function hydrate() {
  if (cached) return cached;
  try { const rec = await get(STORES.kv, 'syncFileHandle'); if (rec && rec.v) cached = rec.v; } catch { /* none */ }
  return cached;
}

export async function isLinked() {
  return !!(await hydrate());
}

export async function linkedName() {
  const h = await hydrate();
  return h && h.name ? h.name : null;
}

// Pick (or create) the iCloud file to sync with. Must be called from a user
// gesture. Returns the chosen file's name, or null if the user cancelled.
export async function linkFile() {
  if (!fsaSupported()) return null;
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: 'guruji.json',
      types: [{ description: 'Guruji sync file', accept: { 'application/json': ['.json'] } }],
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return null; // user cancelled the picker
    throw e;
  }
  cached = handle;
  try { await put(STORES.kv, { k: 'syncFileHandle', v: handle }); } catch { /* non-cloneable mock — keep in memory only */ }
  return handle.name || 'guruji.json';
}

export async function unlink() {
  cached = null;
  try { await del(STORES.kv, 'syncFileHandle'); } catch { /* ignore */ }
}

// Ask (or re-ask) for a permission level on the linked handle. Returns true if
// granted. requestPermission needs a user gesture; queryPermission does not, so
// a silent auto-pull can check without prompting.
export async function ensurePermission(mode = 'read', { prompt = true } = {}) {
  const h = await hydrate();
  if (!h) return false;
  const opts = { mode };
  try {
    if ((await h.queryPermission(opts)) === 'granted') return true;
    if (!prompt) return false;
    return (await h.requestPermission(opts)) === 'granted';
  } catch { return false; }
}

// Write text into the linked file (in place). Throws if not linked / denied.
export async function writeLinked(text) {
  const h = await hydrate();
  if (!h) throw new Error('No linked file');
  if (!(await ensurePermission('readwrite'))) throw new Error('Write permission denied');
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
  return h.name || 'guruji.json';
}

// Read the linked file's current text. `prompt:false` keeps it silent (for a
// best-effort auto-pull on open). Returns null if not linked / not permitted.
export async function readLinked({ prompt = true } = {}) {
  const h = await hydrate();
  if (!h) return null;
  if (!(await ensurePermission('read', { prompt }))) return null;
  const file = await h.getFile();
  return file.text();
}

// ---- Last-synced marker (for the "3h ago · Pull latest" nudge) ----
export async function getLastSync() {
  try { const rec = await get(STORES.kv, 'lastSyncAt'); return rec ? rec.v : null; } catch { return null; }
}
export async function setLastSync(iso) {
  try { await put(STORES.kv, { k: 'lastSyncAt', v: iso }); } catch { /* ignore */ }
}

// Auto-pull-on-open preference (opt-in).
export async function getAutoSync() {
  try { const rec = await get(STORES.kv, 'autoSync'); return !!(rec && rec.v); } catch { return false; }
}
export async function setAutoSync(on) {
  try { await put(STORES.kv, { k: 'autoSync', v: !!on }); } catch { /* ignore */ }
}

// Share a snapshot via the native share sheet (iOS: "Save to Files → iCloud").
// Returns true if the share was invoked. Falls back to false where unsupported.
export async function shareSnapshot(text, filename = 'guruji.json') {
  try {
    const file = new File([text], filename, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Guruji sync' });
      return true;
    }
  } catch { /* cancelled or unsupported */ }
  return false;
}
