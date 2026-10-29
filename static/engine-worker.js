// The web version's engine: lib/api.js's routes, answered in a Web Worker on
// the folder the person has given thingmaker (static/api.js asks them).
//
// Messages in: {type: "init", handle} once, then {id, route, body, query}.
// Out: {type: "ready"} (or {type: "failed", message}), then {id, ok, result}
// or {id, ok: false, message} for each request.
import * as files from "#files";
import { loadDesign, loadPictures, mountFolder } from "./prepare.js";

let api = null;
let routes = null;
let kernel = null;
let where = null;

/** Read what a request will use, before it's answered. */
async function prepare(route, body, query) {
  const q = (name) => query[name] ?? null;
  switch (route) {
    case "POST /api/open":
      await loadDesign(files.resolve(String(body.path)));
      break;
    case "POST /api/view":
    case "POST /api/save":
    case "POST /api/template":
      await loadPictures(body.design);
      break;
    case "POST /api/edit":
      await loadPictures(body.design);
      if (body.edit && body.edit.op === "decoration_set" && body.edit.field === "file") await files.loadPicture(body.edit.value);
      break;
    case "GET /api/browse":
      await files.loadDir("/");
      await files.loadDir(q("dir") || (q("filter") === "image" ? where.images : q("filter") === "stl" ? where.output : where.designs));
      break;
    case "GET /api/buildstate": {
      if (!q("path")) break;
      const out = routes.outputDirFor(q("path"));
      await files.loadFile(files.join(out, "manifest.json"), { contents: false });
      await files.loadFile(files.join(out, "design.json"));
      break;
    }
    case "GET /api/stls": {
      const source = files.resolve(String(q("path")));
      if (await files.loadDir(source)) {
        for (const { name, dir } of files.readdir(source)) {
          if (!dir && name.toLowerCase().endsWith(".stl")) await files.loadFile(files.join(source, name), { contents: false });
        }
      } else await files.loadFile(source, { contents: false });
      break;
    }
    case "GET /api/stl":
    case "GET /api/stlbounds":
      await files.loadFile(files.resolve(String(q("path"))));
      break;
    case "POST /api/subassembly/save": {
      const sources = [body.mock, ...(body.cutouts || []).map((c) => c.file),
        ...Object.values(body.mountings || {}).flatMap((m) => Object.values(m))];
      for (const s of sources) if (s) await files.loadFile(files.resolve(String(s)));
      await files.loadDir(files.join(where.subassemblies, String(body.name || "")));
      await loadPictures(body.design);
      break;
    }
    default:
      break;
  }
}

const own = {
  "GET /api/startup": () => ({ designsDir: where.designs }),

  "GET /api/stl": ({ query }) => {
    const file = files.resolve(String(query.get("path")));
    if (files.extname(file).toLowerCase() !== ".stl") throw new Error("not an STL file");
    return files.readFile(file).slice().buffer;
  },

  "POST /api/upload": ({ body }) => ({ path: api.saveUpload(where, body.name, new Uint8Array(body.bytes), body.to) }),
};

async function answer({ id, route, body = {}, query = {} }) {
  try {
    await prepare(route, body, query);
    const handler = own[route] || routes[route];
    if (!handler) throw new Error(`no such request: ${route}`);
    const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined));
    const result = await kernel.scope(() => handler({ body, query: params }));
    await files.flush();
    const transfer = result instanceof ArrayBuffer ? [result] : [];
    postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    console.debug(route, e);
    postMessage({ id, ok: false, message: (e && e.message) || String(e) });
  }
}

let queue = Promise.resolve();

onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    try {
      await mountFolder(msg.handle);
      // Only now: the library reads fonts and subassemblies as it loads.
      api = await import("../lib/api.js");
      kernel = await import("../lib/kernel.js");
      where = api.folders("/");
      routes = api.createApi(where, {
        places: [["The folder", "/"], ["Designs", where.designs], ["Output", where.output], ["Pictures", where.images],
          ["Subassemblies", where.subassemblies], ["Fonts", where.fonts], ["Uploads", where.uploads]],
        onSubassemblySaved: () => postMessage({ type: "subassemblies-changed" }),
      });
      postMessage({ type: "ready" });
    } catch (e) {
      console.error(e);
      postMessage({ type: "failed", message: e.message || String(e) });
    }
    return;
  }
  // One at a time, in order, as the server answers them.
  queue = queue.then(() => answer(msg));
};
