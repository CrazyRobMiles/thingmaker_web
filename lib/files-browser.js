/* File access in a web page (Chrome and Edge): the folder the person has
given thingmaker with the File System Access API, as "/". The rest of
thingmaker reads and writes files synchronously, as it does in Node
(lib/files-node.js), so this keeps a copy of what it needs in memory:

- mount() it on the folder's handle, then load what's going to be read -
  loadDir() and loadFile() - before running thingmaker code that reads it.
  Reading a file that hasn't been loaded is an error, so a missed load shows
  up rather than reading stale or empty data.
- Writes (writeFile(), mkdir(), unlink()) change the copy straight away and
  are queued for the disk; flush() writes them, in order.

Paths are POSIX-style, "/" being the given folder. */

export const sep = "/";
export const root = "/";

export function normalize(p) {
  const out = [];
  for (const part of String(p).replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return "/" + out.join("/");
}

export function join(...parts) {
  const joined = parts.filter((x) => x !== "").join("/");
  return joined.startsWith("/") ? normalize(joined) : normalize(joined).slice(1) || ".";
}

export function resolve(...parts) {
  let p = "/";
  for (const part of parts) p = String(part).startsWith("/") ? part : `${p}/${part}`;
  return normalize(p);
}

export function dirname(p) {
  const n = normalize(p);
  return n.slice(0, n.lastIndexOf("/")) || "/";
}

export function basename(p, ext = "") {
  const name = String(p).replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

export function extname(p) {
  const name = basename(p);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i) : "";
}

export function relative(from, to) {
  const a = normalize(from).split("/").filter(Boolean);
  const b = normalize(to).split("/").filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function isAbsolute(p) {
  return String(p).startsWith("/");
}

export function env() {
  return undefined;
}

export function homedir() {
  return "/";
}

// -- the copy of the folder --

let rootHandle = null;
const nodes = new Map(); // path -> {dir, data, mtimeMs, size, entries: Map(name -> dir) | null}
const handles = new Map(); // path -> FileSystemHandle
let pending = [];

class NotLoaded extends Error {}

function missing(p) {
  const e = new Error(`no such file or folder: ${p}`);
  e.code = "ENOENT";
  return e;
}

/** Use `handle` (a FileSystemDirectoryHandle) as "/". */
export function mount(handle) {
  rootHandle = handle;
  nodes.clear();
  handles.clear();
  pending = [];
  nodes.set("/", { dir: true, entries: null, mtimeMs: 0, size: 0 });
  handles.set("/", handle);
}

export function mounted() {
  return rootHandle;
}

async function handleFor(p, { create = false, dir = false } = {}) {
  p = normalize(p);
  if (handles.has(p) && !create) return handles.get(p);
  const parts = p.split("/").filter(Boolean);
  let h = rootHandle;
  let at = "";
  for (let i = 0; i < parts.length; i++) {
    at += "/" + parts[i];
    const last = i === parts.length - 1;
    h = last && !dir ? await h.getFileHandle(parts[i], { create }) : await h.getDirectoryHandle(parts[i], { create });
    handles.set(at, h);
  }
  return h;
}

function noteInParent(p, dir) {
  const parent = nodes.get(dirname(p));
  if (parent && parent.entries) parent.entries.set(basename(p), dir);
}

function forget(p) {
  for (const key of [...nodes.keys()]) if (key === p || key.startsWith(p + "/")) nodes.delete(key);
  for (const key of [...handles.keys()]) if (key === p || key.startsWith(p + "/")) handles.delete(key);
  const parent = nodes.get(dirname(p));
  if (parent && parent.entries) parent.entries.delete(basename(p));
}

/** Load the list of what's in folder `p` (and, with `recursive`, in the
folders inside it; with `contents`, every file's bytes too). Resolves to
false if there's no folder there. */
export async function loadDir(p, { recursive = false, contents = false } = {}) {
  p = normalize(p);
  let h;
  try {
    h = await handleFor(p, { dir: true });
  } catch (e) {
    if (p !== "/") forget(p);
    return false;
  }
  const entries = new Map();
  const files = [];
  const dirs = [];
  for await (const [name, child] of h.entries()) {
    const dir = child.kind === "directory";
    entries.set(name, dir);
    const cp = p === "/" ? `/${name}` : `${p}/${name}`;
    handles.set(cp, child);
    (dir ? dirs : files).push(cp);
  }
  const old = nodes.get(p);
  nodes.set(p, { dir: true, entries, mtimeMs: old ? old.mtimeMs : 0, size: 0 });
  noteInParent(p, true);
  // Things that have gone from the folder.
  if (old && old.entries) for (const name of old.entries.keys()) if (!entries.has(name)) forget(p === "/" ? `/${name}` : `${p}/${name}`);
  for (const f of files) {
    if (contents) await loadFile(f);
    else if (!nodes.has(f)) nodes.set(f, { dir: false, data: null, mtimeMs: 0, size: 0 });
  }
  for (const d of dirs) {
    if (recursive) await loadDir(d, { recursive, contents });
    else if (!nodes.has(d)) nodes.set(d, { dir: true, entries: null, mtimeMs: 0, size: 0 });
  }
  return true;
}

/** Load file `p` (again, if it's changed on disk). Resolves to false if
there's no file there. With `contents` false, only its size and time are
read. */
export async function loadFile(p, { contents = true } = {}) {
  p = normalize(p);
  let file;
  try {
    file = await (await handleFor(p)).getFile();
  } catch (e) {
    forget(p);
    return false;
  }
  const old = nodes.get(p);
  if (old && !old.dir && old.mtimeMs === file.lastModified && old.size === file.size && (old.data || !contents)) return true;
  const data = contents ? new Uint8Array(await file.arrayBuffer()) : null;
  nodes.set(p, { dir: false, data, mtimeMs: file.lastModified, size: file.size });
  noteInParent(p, false);
  return true;
}

/** Write out everything queued, in order. */
export async function flush() {
  while (pending.length) {
    const op = pending.shift();
    try {
      if (op.op === "mkdir") await handleFor(op.path, { create: true, dir: true });
      else if (op.op === "unlink") {
        const parent = await handleFor(dirname(op.path), { dir: true });
        await parent.removeEntry(basename(op.path)).catch(() => {});
        handles.delete(op.path);
      } else {
        const h = await handleFor(op.path, { create: true });
        const w = await h.createWritable();
        await w.write(op.data);
        await w.close();
        const file = await h.getFile();
        const node = nodes.get(op.path);
        if (node && node.data === op.data) {
          node.mtimeMs = file.lastModified;
          node.size = file.size;
        }
      }
    } catch (e) {
      pending = [];
      throw new Error(`couldn't write ${op.path}: ${e.message}`);
    }
  }
}

// -- what thingmaker reads and writes with --

export function stat(p) {
  const node = nodes.get(normalize(p));
  if (!node) return null;
  return { mtimeMs: node.mtimeMs, size: node.size, file: !node.dir, dir: node.dir };
}

export function exists(p) {
  return stat(p) !== null;
}

export function isFile(p) {
  return Boolean(stat(p)?.file);
}

export function isDir(p) {
  return Boolean(stat(p)?.dir);
}

export function readFile(p) {
  const node = nodes.get(normalize(p));
  if (!node || node.dir) throw missing(p);
  if (!node.data) throw new NotLoaded(`${p} hasn't been read from the folder`);
  return node.data;
}

export function readText(p) {
  return new TextDecoder().decode(readFile(p));
}

export function readdir(p) {
  const node = nodes.get(normalize(p));
  if (!node || !node.dir) throw missing(p);
  if (!node.entries) throw new NotLoaded(`${p} hasn't been listed`);
  return [...node.entries].map(([name, dir]) => ({ name, dir }));
}

export function mkdir(p) {
  p = normalize(p);
  let at = "";
  for (const part of p.split("/").filter(Boolean)) {
    at += "/" + part;
    const node = nodes.get(at);
    if (node && node.dir) continue;
    if (node) throw new Error(`${at} is a file`);
    nodes.set(at, { dir: true, entries: new Map(), mtimeMs: Date.now(), size: 0 });
    noteInParent(at, true);
  }
  pending.push({ op: "mkdir", path: p });
}

export function writeFile(p, data) {
  p = normalize(p);
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  if (!isDir(dirname(p))) mkdir(dirname(p));
  nodes.set(p, { dir: false, data: bytes, mtimeMs: Date.now(), size: bytes.length });
  noteInParent(p, false);
  pending.push({ op: "write", path: p, data: bytes });
}

export function unlink(p) {
  p = normalize(p);
  if (!isFile(p)) throw missing(p);
  forget(p);
  pending.push({ op: "unlink", path: p });
}

/** Files that aren't in the folder - the site's own fonts, say - as folder
`p` (outside the folder's listing: "/:site/fonts", say, which no file on a
Windows disk can be called). files: {name: bytes}. Read-only. */
export function provide(p, files) {
  p = normalize(p);
  nodes.set(p, { dir: true, entries: new Map(Object.keys(files).map((name) => [name, false])), mtimeMs: 0, size: 0 });
  for (const [name, data] of Object.entries(files)) nodes.set(`${p}/${name}`, { dir: false, data, mtimeMs: 0, size: data.length });
}

export const SITE_FONTS = "/:site/fonts";

/** Fonts are the ones in the folder's fonts/, then the site's own. */
export function fontDirs() {
  return ["/fonts", SITE_FONTS];
}

/** The places in the folder a design's picture might be, best first: a
path in the folder, a path relative to it (as this version writes them), or
the end of a path on another computer (D:\...\thingmaker\images\x.png might
be images/x.png here) - and failing all of those, images/<its name>. */
export function candidates(p) {
  if (!p) return [];
  const parts = String(p).split(/[\\/]+/).filter(Boolean);
  const out = [];
  if (/^([a-zA-Z]:)?[\\/]/.test(p)) {
    if (p.startsWith("/")) out.push(normalize(p));
    for (let i = 1; i < parts.length; i++) out.push("/" + parts.slice(i).join("/"));
  } else out.push(normalize("/" + parts.join("/")));
  if (parts.length) out.push("/images/" + parts[parts.length - 1]);
  return [...new Set(out)];
}

/** Where a design's picture is in the folder (see candidates()), among the
files loaded; `p` itself if it's in none of them. */
export function locate(p) {
  for (const c of candidates(p)) if (isFile(c) && nodes.get(c).data) return c;
  return p;
}

/** Load a design's picture, wherever it is in the folder. */
export async function loadPicture(p) {
  for (const c of candidates(p)) if (await loadFile(c)) return c;
  return null;
}
