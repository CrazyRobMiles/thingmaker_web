/* The editor's live builds, on a worker thread so the server stays
responsive: the real parts are rebuilt a moment after every change and sent
to the browser to show in place of the layout.

Messages in: {id, design} (a design's dict) to build, or {id, reload: true}
after a subassembly has been saved. Out: {id, ok, parts: [{id, world,
colour, vertices, triangles}], problems} or {id, ok: false, error}. */
import { parentPort } from "node:worker_threads";
import { liveBuild } from "./builder.js";
import * as catalogue from "./catalogue.js";
import { Design } from "./design.js";
import * as kernel from "./kernel.js";
import { inlayColours } from "./view.js";
import * as geom from "./geom.js";

parentPort.on("message", (msg) => {
  if (msg.reload) {
    catalogue.reload();
    parentPort.postMessage({ id: msg.id, ok: true });
    return;
  }
  try {
    const result = kernel.scope(() => {
      const design = Design.from_dict(msg.design);
      const built = liveBuild(design);
      const colours = inlayColours(design, Object.keys(built.print));
      return { built, colours };
    });
    const parts = [];
    const transfer = [];
    for (const [pid, mesh] of Object.entries(result.built.print)) {
      parts.push({ id: pid, world: geom.flatten(result.built.world[pid]), colour: result.colours[pid] || null,
        vertices: mesh.vertices, triangles: mesh.triangles });
      transfer.push(mesh.vertices.buffer, mesh.triangles.buffer);
    }
    parentPort.postMessage({ id: msg.id, ok: true, parts, problems: result.built.problems }, transfer);
  } catch (e) {
    process.stderr.write(`live build failed: ${e.stack || e}\n`);
    parentPort.postMessage({ id: msg.id, ok: false, error: `${e.constructor.name}: ${e.message}` });
  }
});
