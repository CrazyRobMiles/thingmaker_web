// Getting work back: the design being edited is saved in the browser
// (IndexedDB) a moment after every change, so a closed tab or a crash loses
// nothing, and every Save keeps a copy as an earlier version. Nothing here
// replaces the design files themselves; it's a safety net beside them.
import * as idb from "./idb.js";

const AUTOSAVE_MS = 1000;
const KEEP_UNDO = 30;
const KEEP_VERSIONS = 50; // per design file

let timer = null;
let latest = null;
let started = false;

/** Start autosaving - once any unsaved changes from last time have been
offered back, so they aren't written over first. */
export function begin(state) {
  started = true;
  note(state);
}

/** Note the editor's state (design, path, dirty, undo) to be autosaved. */
export function note(state) {
  if (!started) return;
  latest ={ path: state.path, design: state.design, dirty: state.dirty, undo: state.undo.slice(-KEEP_UNDO), time: Date.now() };
  clearTimeout(timer);
  timer = setTimeout(write, AUTOSAVE_MS);
}

async function write() {
  if (!latest) return;
  try {
    await idb.put("autosave", latest, "current");
  } catch (e) {
    console.warn("couldn't autosave:", e);
  }
}

/** The last autosaved state, if it had unsaved changes. */
export async function unsaved() {
  try {
    const saved = await idb.get("autosave", "current");
    return saved && saved.dirty ? saved : null;
  } catch (e) {
    return null;
  }
}

/** Forget the unsaved changes from last time (they were discarded). */
export async function forget() {
  try {
    await idb.remove("autosave", "current");
  } catch (e) {
    console.warn("couldn't forget the unsaved changes:", e);
  }
}

/** Keep a saved design as an earlier version of its file. */
export async function keepVersion(path, design) {
  try {
    await idb.put("history", { path, name: design.name, design, time: Date.now() });
    const versions = await idb.entries("history", "path", path);
    for (const [key] of versions.slice(0, Math.max(0, versions.length - KEEP_VERSIONS))) await idb.remove("history", key);
  } catch (e) {
    console.warn("couldn't keep a copy of the design:", e);
  }
}

/** [{path, name, design, time}] kept for `path`, newest first (all files'
for null). */
export async function versions(path = null) {
  try {
    const list = path ? await idb.entries("history", "path", path) : await idb.entries("history");
    return list.map(([, v]) => v).sort((a, b) => b.time - a.time);
  } catch (e) {
    return [];
  }
}
