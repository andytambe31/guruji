// Thin promise wrapper over IndexedDB. All live data lives here — never
// localStorage (iOS evicts localStorage for home-screen PWAs after ~7 days).

const DB_NAME = 'guruji';
const DB_VERSION = 1;

// Object stores. keyPath-based so records carry their own id.
export const STORES = {
  kv: 'kv',             // singletons: { k, v } — e.g. plan meta
  phases: 'phases',     // { id, name, weeks, dateRange, order }
  items: 'items',       // { id, title, phase, week, mode, estMinutes, dependsOn, status, order }
  schedule: 'schedule', // { id, day, start, end, mode }
  log: 'log',           // { id, itemId, ... session record }
};

let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.kv)) {
        db.createObjectStore(STORES.kv, { keyPath: 'k' });
      }
      if (!db.objectStoreNames.contains(STORES.phases)) {
        db.createObjectStore(STORES.phases, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.items)) {
        const s = db.createObjectStore(STORES.items, { keyPath: 'id' });
        s.createIndex('mode', 'mode', { unique: false });
        s.createIndex('status', 'status', { unique: false });
        s.createIndex('order', 'order', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.schedule)) {
        db.createObjectStore(STORES.schedule, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.log)) {
        const s = db.createObjectStore(STORES.log, { keyPath: 'id' });
        s.createIndex('date', 'date', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, storeNames, mode) {
  const t = db.transaction(storeNames, mode);
  return t;
}

function reqAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(store) {
  const db = await openDB();
  return reqAsPromise(tx(db, store, 'readonly').objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return reqAsPromise(tx(db, store, 'readonly').objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  const p = reqAsPromise(t.objectStore(store).put(value));
  await txDone(t);
  return p;
}

export async function del(store, key) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).delete(key);
  return txDone(t);
}

export async function clearStore(store) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  t.objectStore(store).clear();
  return txDone(t);
}

// Bulk write many records into one store in a single transaction.
export async function bulkPut(store, values) {
  const db = await openDB();
  const t = tx(db, store, 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  return txDone(t);
}

// Replace the entire contents of several stores atomically-ish: clear then fill.
export async function replaceStores(map) {
  const db = await openDB();
  const names = Object.keys(map);
  const t = tx(db, names, 'readwrite');
  for (const name of names) {
    const os = t.objectStore(name);
    os.clear();
    for (const v of map[name]) os.put(v);
  }
  return txDone(t);
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}
