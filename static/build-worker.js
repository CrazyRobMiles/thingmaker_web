// The web version's builds, in Web Workers: the live model (one worker,
// rebuilt after every change) and Build (a worker of its own each time, so
// Stop can end it there and then).
//
// Messages in: {type: "init", handle}, then
//   {type: "live", id, design}        -> {id, ok, parts, problems}
//   {type: "reload"}                  -> {type: "reloaded"} (subassemblies changed)
//   {type: "build", design, path}     -> {type: "line", text}... then {type: "end", status}
import * as files from "#files";
import { loadLibraries, loadPictures, mountFolder } from "./prepare.js";

let lib = null;

async function live({ id, design }) {
  try {
    await loadPictures(design);
    const result = lib.kernel.scope(() => {
      const d = lib.design.Design.from_dict(design);
      const built = lib.builder.liveBuild(d);
      return { built, colours: lib.view.inlayColours(d, Object.keys(built.print)) };
    });
    const parts = [];
    const transfer = [];
    for (const [pid, mesh] of Object.entries(result.built.print)) {
      parts.push({ id: pid, world: lib.geom.flatten(result.built.world[pid]), colour: result.colours[pid] || null,
        vertices: mesh.vertices, triangles: mesh.triangles });
      transfer.push(mesh.vertices.buffer, mesh.triangles.buffer);
    }
    postMessage({ id, ok: true, parts, problems: result.built.problems }, transfer);
  } catch (e) {
    console.error(e);
    postMessage({ id, ok: false, error: `${e.constructor.name}: ${e.message}` });
  }
}

async function build({ design, path }) {
  const log = (text) => postMessage({ type: "line", text });
  const outDir = path ? lib.builder.defaultOutputDir(path) : files.join("/output", "untitled");
  log(`Building into ${outDir}`);
  try {
    await loadPictures(design);
    // What's there already (old STL files are cleared out first).
    await files.loadDir(outDir, { recursive: true });
    const manifest = lib.kernel.scope(() => lib.builder.build(lib.design.Design.from_dict(design), outDir, log));
    log("Writing the files to the folder...");
    await files.flush();
    postMessage({ type: "end", status: { result: "built", problems: manifest.problems, outDir } });
  } catch (e) {
    log(`ERROR: build failed:\n${e.stack || e}`);
    postMessage({ type: "end", status: { result: "failed" } });
  }
}

let queue = Promise.resolve();

onmessage = (event) => {
  const msg = event.data;
  queue = queue.then(async () => {
    if (msg.type === "init") {
      try {
        await mountFolder(msg.handle);
        lib = {
          builder: await import("../lib/builder.js"),
          design: await import("../lib/design.js"),
          kernel: await import("../lib/kernel.js"),
          view: await import("../lib/view.js"),
          geom: await import("../lib/geom.js"),
          catalogue: await import("../lib/catalogue.js"),
        };
        postMessage({ type: "ready" });
      } catch (e) {
        postMessage({ type: "failed", message: e.message || String(e) });
      }
    } else if (msg.type === "live") await live(msg);
    else if (msg.type === "build") await build(msg);
    else if (msg.type === "reload") {
      await loadLibraries();
      lib.catalogue.reload();
      postMessage({ type: "reloaded" });
    }
  });
};
