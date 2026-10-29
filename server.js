#!/usr/bin/env node
/* The thingmaker editor: a web server holding the design model, the
geometry kernel and the designs on this machine's disk, and a browser page
(public/) for editing them in 3D.

    node server.js [designs/cyberdeck.json | STL file or folder] [--port 8484] [--host 127.0.0.1] [--no-open]

With a design, it opens it; with an STL file or a folder of them, it shows
them in the Print parts view (and keeps them up to date as they change).

Designs are kept as JSON files on this machine (designs/ unless you choose
somewhere else, or set THINGMAKER_DESIGNS); they're the same files the
Python thingmaker reads and writes. The server only listens on this machine
(127.0.0.1) unless told otherwise with --host. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { defaultOutputDir } from "./lib/builder.js";
import * as catalogue from "./lib/catalogue.js";
import { Design, DesignError } from "./lib/design.js";
import { applyEdit, subassemblyChanged } from "./lib/edits.js";
import * as kernel from "./lib/kernel.js";
import * as stl from "./lib/stl.js";
import * as subassemblies from "./lib/subassemblies.js";
import { placementTemplate, templatePath } from "./lib/template.js";
import { meta, view } from "./lib/view.js";

const ROOT = subassemblies.REPO_ROOT;
const DESIGNS_DIR = process.env.THINGMAKER_DESIGNS || path.join(ROOT, "designs");
const OUTPUT_DIR = path.join(ROOT, "output");
const IMAGES_DIR = path.join(ROOT, "images");
const UPLOADS_DIR = path.join(ROOT, "uploads");
const PUBLIC_DIR = path.join(ROOT, "public");
const THREE_DIR = path.join(ROOT, "node_modules", "three");

// -- arguments --

const args = process.argv.slice(2);
let port = 8484;
let host = "127.0.0.1";
let openBrowser = true;
let startPath = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--port") port = Number(args[++i]);
  else if (a === "--host") host = args[++i];
  else if (a === "--no-open") openBrowser = false;
  else if (a === "-h" || a === "--help") {
    process.stdout.write("usage: node server.js [DESIGN.json | STL file or folder] [--port N] [--host H] [--no-open]\n");
    process.exit(0);
  } else startPath = path.resolve(a);
}

// -- helpers --

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp",
  ".stl": "model/stl", ".ico": "image/x-icon",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(data);
}

function fail(res, message, status = 400) {
  send(res, status, { ok: false, message });
}

function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too much data"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const body = await readBody(req, 64 * 1024 * 1024);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) return fail(res, "not found", 404);
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
}

function stat(file) {
  try {
    return fs.statSync(file);
  } catch (e) {
    return null;
  }
}

/** A design dict as the editor gets it, with its view. */
function present(design) {
  return { design: design.to_dict(), view: view(design) };
}

function outputDirFor(designPath) {
  return designPath ? defaultOutputDir(designPath) : path.join(OUTPUT_DIR, "untitled");
}

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".gif"];

function listDir(dir, filter) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) isDir = Boolean(stat(full)?.isDirectory());
    const ext = path.extname(entry.name).toLowerCase();
    const wanted = filter === "json" ? ext === ".json" : filter === "stl" ? ext === ".stl"
      : filter === "image" ? IMAGE_EXTS.includes(ext) : filter === "dir" ? false : true;
    if (isDir || wanted) entries.push({ name: entry.name, path: full, dir: isDir });
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return entries;
}

function drives() {
  if (process.platform !== "win32") return [];
  const out = [];
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c) + ":\\";
    if (stat(d)) out.push(d);
  }
  return out;
}

// -- live builds (a worker thread) --

let worker = null;
let workerSeq = 0;
const workerWaiting = new Map();

function startWorker() {
  worker = new Worker(new URL("./lib/worker.js", import.meta.url));
  worker.on("message", (msg) => {
    const done = workerWaiting.get(msg.id);
    workerWaiting.delete(msg.id);
    if (done) done(msg);
  });
  worker.on("error", (e) => {
    process.stderr.write(`live build worker failed: ${e.stack || e}\n`);
  });
  worker.on("exit", () => {
    for (const done of workerWaiting.values()) done({ ok: false, error: "the build worker stopped" });
    workerWaiting.clear();
    startWorker();
  });
}

function askWorker(msg) {
  return new Promise((resolve) => {
    const id = ++workerSeq;
    workerWaiting.set(id, resolve);
    worker.postMessage({ ...msg, id });
  });
}

/** Meshes as one binary blob: a uint32 header length, the header (JSON),
padding to 4 bytes, then each part's vertices (float32) and triangles
(uint32). */
function packMeshes(parts, problems) {
  const header = { problems, parts: [] };
  let offset = 0;
  for (const p of parts) {
    header.parts.push({ id: p.id, world: p.world, colour: p.colour, vertexOffset: offset, vertexCount: p.vertices.length,
      triangleOffset: offset + p.vertices.byteLength, triangleCount: p.triangles.length });
    offset += p.vertices.byteLength + p.triangles.byteLength;
  }
  const head = Buffer.from(JSON.stringify(header), "utf8");
  const start = 4 + head.length + ((4 - ((4 + head.length) % 4)) % 4);
  const out = Buffer.alloc(start + offset);
  out.writeUInt32LE(head.length, 0);
  head.copy(out, 4);
  let at = start;
  for (const p of parts) {
    Buffer.from(p.vertices.buffer, p.vertices.byteOffset, p.vertices.byteLength).copy(out, at);
    at += p.vertices.byteLength;
    Buffer.from(p.triangles.buffer, p.triangles.byteOffset, p.triangles.byteLength).copy(out, at);
    at += p.triangles.byteLength;
  }
  return out;
}

// -- full builds (build.js in a child process, so they can be stopped) --

const builds = new Map();
let buildSeq = 0;

function startBuild(design, designPath) {
  const outDir = outputDirFor(designPath);
  fs.mkdirSync(outDir, { recursive: true });
  const snapshotPath = path.join(outDir, "design.json");
  design.save(snapshotPath);
  const id = String(++buildSeq);
  const child = spawn(process.execPath, [path.join(ROOT, "build.js"), snapshotPath, outDir], { cwd: ROOT });
  const run = { id, child, outDir, lines: [`Building into ${outDir}`], listeners: new Set(), done: false, status: null, stopped: false };
  builds.set(id, run);
  const emit = (event, data) => {
    for (const res of run.listeners) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  let partial = "";
  const onData = (chunk) => {
    const text = partial + chunk.toString("utf8");
    const lines = text.split(/\r?\n/);
    partial = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      run.lines.push(line.replace(/^\t+|\t+$/g, ""));
      emit("line", run.lines[run.lines.length - 1]);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", () => {
    if (partial.trim()) {
      run.lines.push(partial);
      emit("line", partial);
    }
    run.done = true;
    const manifestPath = path.join(outDir, "manifest.json");
    if (run.stopped) run.status = { result: "stopped" };
    else if (!fs.existsSync(manifestPath)) run.status = { result: "failed" };
    else {
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      } catch (e) {
        // reported as built, without its problems
      }
      run.status = { result: "built", problems: manifest.problems || [], outDir };
    }
    emit("end", run.status);
    for (const res of run.listeners) res.end();
    run.listeners.clear();
    // Forget it after a while.
    setTimeout(() => builds.delete(id), 10 * 60 * 1000);
  });
  return run;
}

// -- the API --

const snapshotCache = new Map(); // output dir -> [manifest mtime, snapshot dict or null]

const routes = {
  "GET /api/startup": () => {
    const s = startPath ? stat(startPath) : null;
    if (s && (s.isDirectory() || startPath.toLowerCase().endsWith(".stl"))) return { stlSource: startPath };
    return { designPath: startPath, designsDir: DESIGNS_DIR };
  },

  "GET /api/meta": () => meta(),

  "POST /api/new": ({ body }) => present(new Design({ name: String(body.name || "").trim() || "Untitled" })),

  "POST /api/open": ({ body }) => {
    const file = path.resolve(String(body.path));
    return { ...present(Design.load(file)), path: file };
  },

  "POST /api/view": ({ body }) => present(Design.from_dict(body.design)),

  "POST /api/edit": ({ body }) => {
    const result = applyEdit(body.design, body.edit);
    return { ok: result.ok, message: result.message || null, select: result.select || null, fit: Boolean(result.fit),
      ...present(result.design) };
  },

  "POST /api/save": ({ body }) => {
    let file = path.resolve(String(body.path));
    if (!path.extname(file)) file += ".json";
    const design = Design.from_dict(body.design);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    design.save(file);
    return { path: file };
  },

  "GET /api/paths": ({ query }) => {
    const designPath = query.get("path") || null;
    return { outputDir: outputDirFor(designPath), designsDir: DESIGNS_DIR, sep: path.sep, imagesDir: IMAGES_DIR,
      outputRoot: OUTPUT_DIR, subassembliesDir: subassemblies.SUBASSEMBLIES_DIR };
  },

  "GET /api/browse": ({ query }) => {
    const filter = query.get("filter") || "";
    let dir = query.get("dir");
    if (!dir) dir = filter === "image" ? IMAGES_DIR : filter === "stl" ? OUTPUT_DIR : DESIGNS_DIR;
    dir = path.resolve(dir);
    while (!stat(dir)?.isDirectory()) {
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    const parent = path.dirname(dir) === dir ? null : path.dirname(dir);
    const places = [["Designs", DESIGNS_DIR], ["Output", OUTPUT_DIR], ["Pictures", IMAGES_DIR],
      ["Subassemblies", subassemblies.SUBASSEMBLIES_DIR], ["Uploads", UPLOADS_DIR], ["Home", os.homedir()]]
      .filter(([, p]) => stat(p)?.isDirectory());
    return { dir, parent, entries: listDir(dir, filter), places, drives: drives(), sep: path.sep };
  },

  "GET /api/buildstate": ({ query }) => {
    const designPath = query.get("path");
    if (!designPath) return { manifestMtime: null };
    const outDir = outputDirFor(designPath);
    const manifest = stat(path.join(outDir, "manifest.json"));
    if (!manifest) return { manifestMtime: null };
    const mtime = manifest.mtimeMs;
    const cached = snapshotCache.get(outDir);
    if (!cached || cached[0] !== mtime) {
      let snapshot = {};
      const snapshotPath = path.join(outDir, "design.json");
      try {
        snapshot = stat(snapshotPath) ? Design.load(snapshotPath).to_dict() : {};
      } catch (e) {
        snapshot = {};
      }
      snapshotCache.set(outDir, [mtime, snapshot]);
    }
    const known = Number(query.get("known"));
    if (known === mtime) return { manifestMtime: mtime };
    return { manifestMtime: mtime, snapshot: snapshotCache.get(outDir)[1] };
  },

  "POST /api/build": ({ body }) => {
    const design = Design.from_dict(body.design);
    if (!design.cases.length) return { ok: false, message: "Nothing to build - add a case first" };
    const run = startBuild(design, body.path || null);
    return { ok: true, id: run.id, outDir: run.outDir };
  },

  "POST /api/build/stop": ({ body }) => {
    const run = builds.get(String(body.id));
    if (run && !run.done) {
      run.stopped = true;
      run.child.kill();
    }
    return { ok: true };
  },

  "POST /api/template": ({ body }) => {
    const design = Design.from_dict(body.design);
    const spec = design.placement(body.placement);
    let file = body.path ? path.resolve(String(body.path)) : templatePath(outputDirFor(body.designPath || null), spec);
    if (!path.extname(file)) file += ".stl";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    kernel.writeStl(placementTemplate(design, spec), file);
    return { path: file };
  },

  "GET /api/stls": ({ query }) => {
    const source = path.resolve(String(query.get("path")));
    const s = stat(source);
    let files = [];
    if (s?.isDirectory()) files = fs.readdirSync(source).filter((n) => n.toLowerCase().endsWith(".stl")).sort().map((n) => path.join(source, n));
    else if (s?.isFile()) files = [source];
    return { files: files.map((f) => ({ name: path.basename(f).replace(/\.[^.]*$/, ""), path: f, mtime: stat(f)?.mtimeMs ?? null })) };
  },

  "GET /api/stlbounds": ({ query }) => ({ bounds: stl.bounds(path.resolve(String(query.get("path")))) }),

  "GET /api/subassembly": ({ query }) => {
    const cls = catalogue.CATALOG[query.get("name")];
    if (!cls || !cls.SPEC || !cls.SPEC.name) throw new DesignError(`No subassembly ${query.get("name")}`);
    return { spec: cls.SPEC };
  },

  "POST /api/subassembly/save": async ({ body }) => {
    const name = String(body.name || "").trim();
    if (!body.overwrite && name in catalogue.CATALOG) throw new Error(`there is already a device or subassembly called ${name}`);
    const folder = catalogue.createSubassembly(name, String(body.mock || "").trim(), {
      cutouts: body.cutouts || [], mountings: body.mountings || {}, displayName: String(body.displayName || "").trim() || name,
      description: String(body.description || "").trim(), overwrite: Boolean(body.overwrite),
    });
    await askWorker({ reload: true });
    const out = { folder, meta: meta() };
    if (body.design) Object.assign(out, kernel.scope(() => present(subassemblyChanged(body.design, name))));
    return out;
  },
};

/** Raw uploads: the body is the file. */
async function upload(req, res, query) {
  const name = path.basename(String(query.get("name") || "upload")).replace(/[^A-Za-z0-9_. -]/g, "_");
  const dir = query.get("to") === "images" ? IMAGES_DIR : UPLOADS_DIR;
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, name);
  const ext = path.extname(name);
  for (let n = 2; stat(file); n++) file = path.join(dir, `${path.basename(name, ext)}_${n}${ext}`);
  fs.writeFileSync(file, await readBody(req));
  send(res, 200, { path: file });
}

async function live(req, res) {
  const body = await readJson(req);
  const result = await askWorker({ design: body.design });
  if (!result.ok) return send(res, 200, packMeshes([], [`The model couldn't be built: ${result.error}`]), "application/octet-stream");
  send(res, 200, packMeshes(result.parts, result.problems), "application/octet-stream");
}

function events(req, res, query) {
  const run = builds.get(String(query.get("id")));
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
  if (!run) {
    res.write(`event: end\ndata: ${JSON.stringify({ result: "unknown" })}\n\n`);
    return res.end();
  }
  for (const line of run.lines) res.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
  if (run.done) {
    res.write(`event: end\ndata: ${JSON.stringify(run.status)}\n\n`);
    return res.end();
  }
  run.listeners.add(res);
  req.on("close", () => run.listeners.delete(res));
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === "POST /api/live") return await live(req, res);
    if (route === "POST /api/upload") return await upload(req, res, url.searchParams);
    if (route === "GET /api/build/events") return events(req, res, url.searchParams);
    if (route === "GET /api/stl") {
      const file = path.resolve(String(url.searchParams.get("path")));
      if (path.extname(file).toLowerCase() !== ".stl") return fail(res, "not an STL file", 403);
      return serveFile(res, file);
    }
    if (routes[route]) {
      const body = req.method === "POST" ? await readJson(req) : {};
      const result = await kernel.scope(() => routes[route]({ body, query: url.searchParams }));
      return send(res, 200, await result);
    }
    if (req.method !== "GET") return fail(res, "not found", 404);
    // Static files: the page, three.js, and the maths shared with the server.
    const pathname = decodeURIComponent(url.pathname);
    let file;
    let base = PUBLIC_DIR;
    if (pathname === "/") file = path.join(PUBLIC_DIR, "index.html");
    else if (pathname.startsWith("/vendor/three/")) {
      base = THREE_DIR;
      file = path.join(THREE_DIR, pathname.slice("/vendor/three/".length));
    } else if (pathname === "/lib/geom.js" || pathname === "/lib/py.js") {
      base = ROOT;
      file = path.join(ROOT, pathname);
    } else file = path.join(PUBLIC_DIR, pathname);
    if (!path.resolve(file).startsWith(path.resolve(base) + path.sep)) return fail(res, "not found", 404);
    return serveFile(res, file);
  } catch (e) {
    if (!(e instanceof DesignError)) process.stderr.write(`${route}: ${e.stack || e}\n`);
    if (!res.headersSent) fail(res, e.message || String(e));
  }
}

function openInBrowser(url) {
  const [cmd, cmdArgs] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    // the URL is printed anyway
  }
}

startWorker();
const server = http.createServer((req, res) => {
  handle(req, res);
});
let tries = 0;
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" && tries < 10) {
    tries += 1;
    port += 1;
    server.listen(port, host);
  } else {
    process.stderr.write(`thingmaker: can't start the server: ${e.message}\n`);
    process.exit(1);
  }
});
server.on("listening", () => {
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}/`;
  process.stdout.write(`thingmaker editor: ${url}\nDesigns: ${DESIGNS_DIR}\nPress Ctrl+C to stop.\n`);
  if (Object.keys(catalogue.LOAD_ERRORS).length) process.stdout.write("Some subassembly folders couldn't be loaded (see above).\n");
  if (openBrowser) openInBrowser(url);
});
server.listen(port, host);
