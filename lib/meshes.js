/* STL meshes as solids, and transforms, shared by the builder and
subassemblies (whose fixings and cutouts are STL files). */
import fs from "node:fs";
import path from "node:path";
import * as kernel from "./kernel.js";

/** A copy of `shape` moved by the rigid 4x4 matrix m. */
export function transformed(shape, m) {
  return shape.transformed(m);
}

/** `shape` (fixings standing on a surface at z=0) fused with roots: its
cross-section just above the surface, carried straight down to z=-depth.
Like a pillar running down through the material it stands on, this bonds
the fixings to the surface even where the surface isn't exactly at z=0. */
export function rooted(shape, depth, probe = 0.05) {
  return shape.rooted(depth, probe);
}

const solids = new Map();

/** A closed STL mesh as a solid (kept until the file changes). A mesh of
several separate pieces - four standoffs, say - is fine. */
export function meshSolid(file) {
  const stat = fs.statSync(file);
  const key = `${path.resolve(file)}|${stat.mtimeMs}|${stat.size}`;
  if (!solids.has(key)) {
    for (const [k, shape] of solids) {
      if (k.startsWith(path.resolve(file) + "|")) {
        solids.delete(k);
        shape._m.__kept = false;
        kernel.release(shape);
      }
    }
    solids.set(key, kernel.persist(kernel.loadStl(file)));
  }
  return solids.get(key);
}
