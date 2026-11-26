// The STL files as a slicer reads them: corners at the same point are one
// corner, and then every edge should be shared by just two triangles, which
// run along it opposite ways. (Where two pieces of a part only touch, along
// an edge or at a corner, four triangles share an edge, and slicers report
// faces the wrong way round.)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { encode } from "fast-png";
import { buildParts } from "../lib/builder.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

/** {triangles, bad: edges not shared by exactly two triangles running opposite ways} of an STL file's bytes. */
function edgesOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  const ids = new Map();
  const id = (o) => {
    const key = `${view.getFloat32(o, true)},${view.getFloat32(o + 4, true)},${view.getFloat32(o + 8, true)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    return ids.get(key);
  };
  const edges = new Map();
  for (let i = 0; i < count; i++) {
    const o = 84 + 50 * i + 12;
    const t = [id(o), id(o + 12), id(o + 24)];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t[k], t[(k + 1) % 3]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = edges.get(key) || [0, 0];
      e[a < b ? 0 : 1] += 1;
      edges.set(key, e);
    }
  }
  let bad = 0;
  for (const [fwd, back] of edges.values()) if (fwd !== 1 || back !== 1) bad += 1;
  return { triangles: count, bad };
}

function assertClean(design, what) {
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: () => {} });
    for (const [pid, shape] of Object.entries(shapes)) {
      const { bad } = edgesOf(kernel.stlBytes(shape));
      assert.equal(bad, 0, `${what}: ${pid} has ${bad} edges that aren't shared by two triangles`);
    }
  });
}

// A picture of squares in a few colours, each touching others of its colour only at their corners.
const CHECKS = (() => {
  const [w, h] = [40, 30];
  const colours = [[0, 0, 0], [255, 255, 255], [200, 30, 30], [30, 60, 200]];
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(colours[(x + y) % 2 + 2 * (Math.floor(y / 10) % 2)], 3 * (y * w + x));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-slicing-")), "checks.png");
  fs.writeFileSync(file, encode({ width: w, height: h, data, channels: 3, depth: 8 }));
  return file;
})();

test("a picture whose squares touch at their corners makes clean STL files, its case's and its inlays'", () => {
  for (const style of ["posterise", "mosaic", "fill", "vector"]) {
    const design = new Design({ cases: [new CaseSpec("main", { style: "MusicBox", height: 20.0, min_width: 80, min_depth: 60,
      decorations: { top: { image: { file: CHECKS, style, columns: 40, colours: 4, detail: 0.3 } },
        around: { text: { text: "ROUND", size: 10.0, across: 40.0 }, image: { file: CHECKS, style: "fill", zoom: 0.6, across: -30.0 } } } })] });
    design.placements.push(new Placement("s", "Stamp", "main", { surface: "top", mount: "outside",
      params: { stamp_height: 15.0, picture_file: CHECKS, picture_style: "posterise", picture_columns: 20 } }));
    design.relayout();
    assertClean(design, style);
  }
});

test("a MusicBox case at any size, and a wordsearch's separator, make clean STL files", () => {
  // (At this width, the MusicBox's corners used to leave a crack in its lid.)
  for (const [w, d] of [[187.928932, 130.0], [100.0, 80.0]]) {
    const design = new Design({ cases: [new CaseSpec("main", { style: "MusicBox", height: 30.0, min_width: w, min_depth: d,
      lid_height: 7.0, lid_thickness: 1.5 })] });
    design.relayout();
    assertClean(design, `a ${w} x ${d} MusicBox`);
  }
  const design = new Design({ cases: [new CaseSpec("face", { style: "Square", height: 20.0 })] });
  design.placements.push(new Placement("w", "WordsearchObscured", "face", { surface: "top", mount: "inside" }));
  design.relayout();
  assertClean(design, "a wordsearch");
});
