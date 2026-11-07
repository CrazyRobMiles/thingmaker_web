// The web version's stand-in for public/js/api.js: the same calls, answered
// by Web Workers in this page (static/engine-worker.js for the design,
// static/build-worker.js for the live model and for Build) instead of a
// server. The static build puts this in place of public/js/api.js.
import { candidates, storedPath } from "../lib/files-browser.js";
import { connect } from "./folder.js";
import * as fonts from "./fonts.js";
import * as importer from "./importer.js";

const ENGINE = new URL("./engine-worker.js", import.meta.url);
const BUILDER = new URL("./build-worker.js", import.meta.url);
const LAST_DESIGN = "thingmaker.lastDesign";

let folder = null;
let engine = null;
let live = null;
let starting = null;
let seq = 0;
const waiting = new Map();

function worker(url, handle) {
  const w = new Worker(url, { type: "module" });
  const ready = new Promise((resolve, reject) => {
    w.addEventListener("message", function first(e) {
      if (e.data.type === "ready") resolve();
      else if (e.data.type === "failed") reject(new Error(e.data.message));
      else return;
      w.removeEventListener("message", first);
    });
    w.addEventListener("error", (e) => reject(new Error(e.message || "a worker couldn't start")));
  });
  w.postMessage({ type: "init", handle });
  return [w, ready];
}

function answer(e) {
  const msg = e.data;
  if (msg.type === "subassemblies-changed") {
    live.postMessage({ type: "reload" });
    return;
  }
  const done = waiting.get(msg.id);
  if (!done) return;
  waiting.delete(msg.id);
  if (msg.ok === false) done.reject(new Error(msg.message || msg.error || "failed"));
  else done.resolve(msg);
}

/** Connect to the folder and start the workers (once). */
export function ready() {
  if (!starting) {
    starting = (async () => {
      folder = await connect();
      document.title = `thingmaker - ${folder.name}`;
      let engineReady;
      let liveReady;
      [engine, engineReady] = worker(ENGINE, folder.handle);
      [live, liveReady] = worker(BUILDER, folder.handle);
      engine.addEventListener("message", answer);
      live.addEventListener("message", answer);
      await Promise.all([engineReady, liveReady]);
    })();
  }
  return starting;
}

function ask(target, message, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    target.postMessage({ ...message, id }, transfer);
  });
}

async function call(route, body = {}, query = {}) {
  await ready();
  return (await ask(engine, { route, body, query })).result;
}

function remember(path) {
  try {
    localStorage.setItem(LAST_DESIGN, path);
  } catch (e) {
    // not remembered, then
  }
}

export async function get(path, params = {}) {
  if (path === "/api/startup") {
    let last = null;
    try {
      last = localStorage.getItem(LAST_DESIGN);
    } catch (e) {
      last = null;
    }
    const startup = await call("GET /api/startup");
    // Open the design worked on last time, if it's still there.
    if (last) {
      try {
        const found = await call("GET /api/browse", {}, { dir: last.replace(/\/[^/]*$/, "") || "/", filter: "json" });
        if (found.entries.some((e) => e.path === last)) startup.designPath = last;
      } catch (e) {
        // start with a new design
      }
    }
    return startup;
  }
  return call(`GET ${path}`, {}, params);
}

export async function post(path, body = {}) {
  if (path === "/api/build") return startBuild(body);
  if (path === "/api/build/stop") return stopBuild(body.id);
  const result = await call(`POST ${path}`, body);
  if ((path === "/api/open" || path === "/api/save") && result.path) remember(result.path);
  return result;
}

/** Copy a file from this computer into the folder's images/ (or uploads/). */
export async function upload(file, to = "uploads") {
  const bytes = await file.arrayBuffer();
  return (await ask(engine, { route: "POST /api/upload", body: { name: file.name, to, bytes }, query: {} }, [bytes])).result.path;
}

export async function stlFile(path) {
  return call("GET /api/stl", {}, { path });
}

/** The live build of a design: {parts, problems}. */
export async function liveBuild(design) {
  await ready();
  try {
    const msg = await ask(live, { type: "live", design });
    return { parts: msg.parts, problems: msg.problems };
  } catch (e) {
    return { parts: [], problems: [`The model couldn't be built: ${e.message}`] };
  }
}

// -- Build: a worker of its own, so Stop ends it straight away --

const builds = new Map();
let buildSeq = 0;

function finish(run, status) {
  if (run.status) return;
  run.status = status;
  run.worker.terminate();
  if (run.handlers) run.handlers.end(status);
}

async function startBuild({ design, path }) {
  await ready();
  if (!design.cases.length) return { ok: false, message: "Nothing to build - add a case first" };
  const id = String(++buildSeq);
  const stem = path ? path.replace(/^.*\//, "").replace(/\.[^.]*$/, "") : "untitled";
  const [w, started] = worker(BUILDER, folder.handle);
  const run = { worker: w, lines: [], handlers: null, status: null };
  builds.set(id, run);
  w.addEventListener("message", (e) => {
    if (e.data.type === "line") {
      run.lines.push(e.data.text);
      if (run.handlers) run.handlers.line(e.data.text);
    } else if (e.data.type === "end") finish(run, e.data.status);
  });
  started.then(() => w.postMessage({ type: "build", design, path }), (e) => {
    run.lines.push(`ERROR: ${e.message}`);
    finish(run, { result: "failed" });
  });
  return { ok: true, id, outDir: `/output/${stem}` };
}

function stopBuild(id) {
  const run = builds.get(String(id));
  if (run) finish(run, { result: "stopped" });
  return { ok: true };
}

export function buildEvents(id, handlers) {
  const run = builds.get(String(id));
  if (!run) return handlers.end({ result: "failed" });
  run.handlers = handlers;
  for (const line of run.lines) handlers.line(line);
  if (run.status) handlers.end(run.status);
}

// -- the folder --

/** A picture chosen in the folder (/images/x.png), as it's written into the
design: relative to the folder (images/x.png), as the Node version writes
them too. */
export function storedPicturePath(path) {
  return storedPath(path);
}

/** Where in the folder to start looking for a picture a design names. */
export function pictureFolder(path) {
  return candidates(path)[0] || "/images/";
}

/** File > Fonts...: resolves to true if fonts were added to the folder
(they're used once thingmaker starts again). */
export async function manageFonts() {
  await ready();
  return fonts.manageFonts(folder.handle);
}

/** File > Import design...: resolves to {path, meta} for the design
brought into the folder (meta if subassemblies came in with it), or null. */
export async function importDesign() {
  await ready();
  return importer.importDesign(call);
}

/** File > Import subassembly...: resolves to the new meta, or null. */
export async function importSubassemblies() {
  await ready();
  return importer.importSubassemblies(call);
}

/** Choose another folder (or confirm this one), and start again on it. */
export async function changeFolder() {
  const chosen = await connect({ change: true });
  if (folder && !(await chosen.handle.isSameEntry(folder.handle))) location.reload();
  else folder = chosen;
}
