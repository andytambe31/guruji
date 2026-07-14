// Cloud sync via a private GitHub Gist — the seamless, Safari-friendly path.
//
// A single private gist holds guruji.json. The app pulls it on open and pushes
// it when you leave, merging both sides through the same authority-based
// mergeRemote as file sync. Auth is a gist-scoped Personal Access Token stored
// ONLY in this device's IndexedDB — never exported, never sent anywhere but
// api.github.com over HTTPS. Everything degrades gracefully (offline, bad token).
import { STORES, get, put, del } from './db.js';
import { snapshotText, importFromText } from './importexport.js';

const GIST_DESC = 'Guruji sync — private study data (safe to keep)';
const FILENAME = 'guruji.json';
const API = 'https://api.github.com';

// ---- config (token / gist id / enabled) — all local ----
export async function getToken() { try { const r = await get(STORES.kv, 'gistToken'); return r ? r.v : null; } catch { return null; } }
async function setToken(v) { await put(STORES.kv, { k: 'gistToken', v: v || null }); }
export async function getGistId() { try { const r = await get(STORES.kv, 'gistId'); return r ? r.v : null; } catch { return null; } }
async function setGistId(v) { await put(STORES.kv, { k: 'gistId', v: v || null }); }
export async function isGistConfigured() { return !!(await getToken()) && !!(await getGistId()); }

async function ghFetch(method, path, body) {
  const token = await getToken();
  if (!token) throw new Error('No token');
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Error('Bad token (401) — check the gist scope');
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.status === 204 ? null : res.json();
}

// Validate the token, find our existing sync gist or create one, and enable.
export async function connectGist(token) {
  await setToken(String(token || '').trim());
  // Look for an existing Guruji gist (so a second device reuses the first's).
  let mine = [];
  try { mine = await ghFetch('GET', '/gists?per_page=100'); } catch (e) { await setToken(null); throw e; }
  const existing = (mine || []).find((g) => g.description === GIST_DESC && g.files && g.files[FILENAME]);
  if (existing) { await setGistId(existing.id); return { id: existing.id, created: false }; }
  const created = await ghFetch('POST', '/gists', {
    description: GIST_DESC, public: false,
    files: { [FILENAME]: { content: await snapshotText() } },
  });
  await setGistId(created.id);
  return { id: created.id, created: true };
}

export async function disconnectGist() {
  await setToken(null);
  try { await del(STORES.kv, 'gistId'); } catch { /* ignore */ }
}

// Push local state up to the gist.
export async function pushGist() {
  const id = await getGistId();
  if (!id) throw new Error('Not connected');
  await ghFetch('PATCH', `/gists/${id}`, { files: { [FILENAME]: { content: await snapshotText() } } });
  await setLastCloudSync();
  return true;
}

// Pull the gist and merge it into local state. Returns the merge summary.
export async function pullGist() {
  const id = await getGistId();
  if (!id) throw new Error('Not connected');
  const g = await ghFetch('GET', `/gists/${id}`);
  const f = g && g.files && g.files[FILENAME];
  if (!f) return { ok: false };
  let content = f.content;
  if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
  if (!content) return { ok: false };
  const res = await importFromText(content); // detects the snapshot → mergeRemote
  await setLastCloudSync();
  return res;
}

// Read-modify-write: pull+merge, then push the merged result back. This is the
// safe converging op — run on open and when leaving the app.
export async function syncGist() {
  if (!(await isGistConfigured())) return { ok: false };
  const pulled = await pullGist();
  await pushGist();
  return { ok: true, pulled: pulled && pulled.summary };
}

// ---- last cloud sync marker (shared display) ----
export async function getLastCloudSync() { try { const r = await get(STORES.kv, 'lastCloudSyncAt'); return r ? r.v : null; } catch { return null; } }
async function setLastCloudSync() { try { await put(STORES.kv, { k: 'lastCloudSyncAt', v: new Date().toISOString() }); } catch { /* ignore */ } }
