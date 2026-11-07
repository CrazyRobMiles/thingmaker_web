/* The editor's API: what the editor page asks of thingmaker, and the
answers. The Node server (server.js) serves these over HTTP; the static web
version (static/engine-worker.js) answers them in a Web Worker, on the folder
the person has given it. Both get their files through "#files".

createApi(places) returns {"METHOD /api/route": handler}; a handler takes
{body, query} (query has .get(name)) and returns the answer, or throws. The
live build, full builds and uploads' transport are the host's own. */
import * as files from "#files";
import { defaultOutputDir } from "./builder.js";
import * as catalogue from "./catalogue.js";
import { Design, DesignError } from "./design.js";
import { applyEdit, subassemblyChanged } from "./edits.js";
import * as imports from "./imports.js";
import * as kernel from "./kernel.js";
import * as stl from "./stl.js";
import * as subassemblies from "./subassemblies.js";
import { placementTemplate, templatePath } from "./template.js";
import { meta, view } from "./view.js";

export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".bmp", ".gif"];

/** The folders thingmaker keeps things in, under `root`. */
export function folders(root, designsDir = null) {
  return {
    root,
    designs: designsDir || files.join(root, "designs"),
    output: files.join(root, "output"),
    images: files.join(root, "images"),
    uploads: files.join(root, "uploads"),
    fonts: files.join(root, "fonts"),
    subassemblies: subassemblies.SUBASSEMBLIES_DIR,
  };
}

/** A design dict as the editor gets it, with its view. */
export function present(design) {
  return { design: design.to_dict(), view: view(design) };
}

export function listDir(dir, filter) {
  const entries = [];
  for (const entry of files.readdir(dir)) {
    if (entry.name.startsWith(".")) continue;
    const full = files.join(dir, entry.name);
    const ext = files.extname(entry.name).toLowerCase();
    const wanted = filter === "json" ? ext === ".json" : filter === "stl" ? ext === ".stl"
      : filter === "image" ? IMAGE_EXTS.includes(ext) : filter === "dir" ? false : true;
    if (entry.dir || wanted) entries.push({ name: entry.name, path: full, dir: entry.dir });
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return entries;
}

/** Keep an uploaded file (`bytes`, named `name`) in uploads/, or images/ for
`to` "images", without replacing anything there (the same file uploaded
again is the one already there). Returns its path. */
export function saveUpload(where, name, bytes, to) {
  return imports.keepFile(to === "images" ? where.images : where.uploads, name || "upload", bytes);
}

/** The routes. `where` is folders(); `extra` may give {places: [[label,
path]], drives: () => [...], onSubassemblySaved: async () => {}}. */
export function createApi(where, extra = {}) {
  const outputDirFor = (designPath) => (designPath ? defaultOutputDir(designPath) : files.join(where.output, "untitled"));
  const snapshotCache = new Map(); // output dir -> [manifest mtime, snapshot dict]
  return {
    outputDirFor,

    "GET /api/meta": () => meta(),

    "POST /api/new": ({ body }) => present(new Design({ name: String(body.name || "").trim() || "Untitled" })),

    "POST /api/open": ({ body }) => {
      const file = files.resolve(String(body.path));
      return { ...present(Design.load(file)), path: file };
    },

    "POST /api/view": ({ body }) => present(Design.from_dict(body.design)),

    "POST /api/edit": ({ body }) => {
      const result = applyEdit(body.design, body.edit);
      return { ok: result.ok, message: result.message || null, select: result.select || null, fit: Boolean(result.fit),
        ...present(result.design) };
    },

    "POST /api/save": ({ body }) => {
      let file = files.resolve(String(body.path));
      if (!files.extname(file)) file += ".json";
      const design = Design.from_dict(body.design);
      files.mkdir(files.dirname(file));
      design.save(file);
      return { path: file };
    },

    "GET /api/paths": ({ query }) => {
      const designPath = query.get("path") || null;
      return { outputDir: outputDirFor(designPath), designsDir: where.designs, sep: files.sep, imagesDir: where.images,
        outputRoot: where.output, subassembliesDir: where.subassemblies };
    },

    // A picture a design names: where it is ("located"), and the path to
    // put in the design for it ("stored": relative to the thingmaker folder).
    "GET /api/picture": ({ query }) => {
      const p = query.get("path") || "";
      return { located: files.locate(p), stored: files.storedPath(p) };
    },

    "GET /api/browse": ({ query }) => {
      const filter = query.get("filter") || "";
      let dir = query.get("dir");
      if (!dir) dir = filter === "image" ? where.images : filter === "stl" ? where.output : where.designs;
      dir = files.resolve(dir);
      while (!files.isDir(dir)) {
        const up = files.dirname(dir);
        if (up === dir) break;
        dir = up;
      }
      const parent = files.dirname(dir) === dir ? null : files.dirname(dir);
      const places = (extra.places || [["Designs", where.designs], ["Output", where.output], ["Pictures", where.images],
        ["Subassemblies", where.subassemblies], ["Uploads", where.uploads]]).filter(([, p]) => files.isDir(p));
      return { dir, parent, entries: listDir(dir, filter), places, drives: extra.drives ? extra.drives() : [], sep: files.sep };
    },

    "GET /api/buildstate": ({ query }) => {
      const designPath = query.get("path");
      if (!designPath) return { manifestMtime: null };
      const outDir = outputDirFor(designPath);
      const manifest = files.stat(files.join(outDir, "manifest.json"));
      if (!manifest) return { manifestMtime: null };
      const mtime = manifest.mtimeMs;
      const cached = snapshotCache.get(outDir);
      if (!cached || cached[0] !== mtime) {
        let snapshot = {};
        const snapshotPath = files.join(outDir, "design.json");
        try {
          snapshot = files.exists(snapshotPath) ? Design.load(snapshotPath).to_dict() : {};
        } catch (e) {
          snapshot = {};
        }
        snapshotCache.set(outDir, [mtime, snapshot]);
      }
      const known = Number(query.get("known"));
      if (known === mtime) return { manifestMtime: mtime };
      return { manifestMtime: mtime, snapshot: snapshotCache.get(outDir)[1] };
    },

    "POST /api/template": ({ body }) => {
      const design = Design.from_dict(body.design);
      const spec = design.placement(body.placement);
      let file = body.path ? files.resolve(String(body.path)) : templatePath(outputDirFor(body.designPath || null), spec);
      if (!files.extname(file)) file += ".stl";
      files.mkdir(files.dirname(file));
      kernel.writeStl(placementTemplate(design, spec), file);
      return { path: file };
    },

    "GET /api/stls": ({ query }) => {
      const source = files.resolve(String(query.get("path")));
      let found = [];
      if (files.isDir(source)) {
        found = files.readdir(source).map((e) => e.name).filter((n) => n.toLowerCase().endsWith(".stl")).sort()
          .map((n) => files.join(source, n));
      } else if (files.isFile(source)) found = [source];
      return { files: found.map((f) => ({ name: files.basename(f).replace(/\.[^.]*$/, ""), path: f, mtime: files.stat(f)?.mtimeMs ?? null })) };
    },

    "GET /api/stlbounds": ({ query }) => ({ bounds: stl.bounds(files.resolve(String(query.get("path")))) }),

    // Bringing things in from elsewhere on the computer (lib/imports.js).
    "POST /api/import/check": ({ body }) => imports.needs(body.design),

    "POST /api/import/design": ({ body }) => {
      const pictures = {};
      for (const p of body.pictures || []) pictures[p.file] = { name: p.name, bytes: new Uint8Array(p.bytes) };
      return { path: imports.importDesign(where, body.design, { name: body.name, pictures }) };
    },

    "POST /api/import/subassembly": async ({ body }) => {
      const contents = {};
      for (const [rel, bytes] of Object.entries(body.files || {})) contents[rel] = new Uint8Array(bytes);
      const result = imports.importSubassembly(where, contents, { fallback: body.fallback || "", replace: Boolean(body.replace) });
      if ((result.status === "added" || result.status === "replaced") && extra.onSubassemblySaved) {
        await extra.onSubassemblySaved(files.join(where.subassemblies, result.name));
      }
      return { ...result, meta: meta() };
    },

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
      if (extra.onSubassemblySaved) await extra.onSubassemblySaved(folder);
      const out = { folder, meta: meta() };
      if (body.design) Object.assign(out, kernel.scope(() => present(subassemblyChanged(body.design, name))));
      return out;
    },
  };
}
