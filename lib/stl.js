/* Just enough STL reading for the design model: the bounding box of a
binary or ASCII STL file. The builder loads STLs as solids with
lib/kernel.js; this is only for knowing how big a mesh is. */
import fs from "node:fs";
import path from "node:path";
import { stlTriangles } from "./kernel.js";
import { floatRepr } from "./py.js";

const cache = new Map();

/** Write axis-aligned boxes ([x, y, z, width, depth, height] each) to an
ASCII STL file - each one a closed mesh with outward-facing triangles.
Handy for simple mocks and cutouts, and for tests. */
export function writeBoxes(file, boxes, name = "thingmaker") {
  const lines = [`solid ${name}`];
  // corner index = dx * 4 + dy * 2 + dz; each face listed anticlockwise from outside
  const faces = [[[0, 1, 3, 2], [-1, 0, 0]], [[4, 6, 7, 5], [1, 0, 0]],
    [[0, 4, 5, 1], [0, -1, 0]], [[2, 3, 7, 6], [0, 1, 0]],
    [[0, 2, 6, 4], [0, 0, -1]], [[1, 5, 7, 3], [0, 0, 1]]];
  for (const [x, y, z, w, d, h] of boxes) {
    const c = [];
    for (const dx of [0, 1]) for (const dy of [0, 1]) for (const dz of [0, 1]) c.push([x + dx * w, y + dy * d, z + dz * h]);
    for (const [[a, b, e, f], n] of faces) {
      for (const tri of [[a, b, e], [a, e, f]]) {
        lines.push(`  facet normal ${n.join(" ")}`);
        lines.push("    outer loop");
        for (const i of tri) lines.push(`      vertex ${c[i].map((v) => floatRepr(v)).join(" ")}`);
        lines.push("    endloop");
        lines.push("  endfacet");
      }
    }
  }
  lines.push(`endsolid ${name}`);
  fs.writeFileSync(file, lines.join("\n") + "\n", "ascii");
}

/** [xmin, xmax, ymin, ymax, zmin, zmax] of an STL file. Cached until the
file changes. */
export function bounds(file) {
  const key = `${path.resolve(file)}|${fs.statSync(file).mtimeMs}`;
  if (!cache.has(key)) {
    const corners = stlTriangles(file);
    if (!corners.length) throw new Error(`${file} has no triangles in it`);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < corners.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = corners[i + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    cache.set(key, [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]]);
  }
  return cache.get(key);
}
