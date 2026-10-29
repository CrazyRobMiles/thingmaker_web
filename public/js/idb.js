// A little IndexedDB: one database ("thingmaker") with a few object
// stores, and promise-returning get/put/delete/all.

const DB = "thingmaker";
const VERSION = 1;
const STORES = { settings: {}, autosave: {}, history: { autoIncrement: true, index: "path" } };

let opened = null;

function open() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, options] of Object.entries(STORES)) {
          if (db.objectStoreNames.contains(name)) continue;
          const store = db.createObjectStore(name, options.autoIncrement ? { autoIncrement: true } : undefined);
          if (options.index) store.createIndex(options.index, options.index);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return opened;
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = "readonly") {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function get(name, key) {
  return done((await store(name)).get(key));
}

export async function put(name, value, key = undefined) {
  return done((await store(name, "readwrite")).put(value, key));
}

export async function remove(name, key) {
  return done((await store(name, "readwrite")).delete(key));
}

/** [[key, value]...] of a store, or of the entries whose `index` is `value`. */
export async function entries(name, index = null, value = undefined) {
  const s = await store(name);
  const source = index ? s.index(index) : s;
  const range = index ? IDBKeyRange.only(value) : undefined;
  return new Promise((resolve, reject) => {
    const out = [];
    const req = source.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      out.push([cursor.primaryKey, cursor.value]);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
