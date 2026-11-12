// What's in a case with rounded or bevelled inside corners keeps clear of them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CaseSpec, Design, Placement } from "../lib/design.js";

/** Whether (x, y) is inside a w x d cavity whose corners are cut by `corner(xEnd, yEnd)`. */
function inside(x, y, w, d, corner) {
  const eps = 1e-6;
  if (x < -eps || y < -eps || x > w + eps || y > d + eps) return false;
  for (const xEnd of ["low", "high"]) {
    for (const yEnd of ["low", "high"]) {
      const shape = corner(xEnd, yEnd);
      if (!shape) continue;
      const u = xEnd === "low" ? x : w - x;
      const v = yEnd === "low" ? y : d - y;
      const [kind, r] = shape;
      if (kind === "round" && u < r && v < r && Math.hypot(r - u, r - v) > r + eps) return false;
      if (kind === "bevel" && u + v < r - eps) return false;
    }
  }
  return true;
}

const STYLES = [
  ["MusicBox", {}, () => ["round", 5]],
  ["Rounded", { edge: 8, wall_thickness: 3 }, () => ["round", 5]],
  ["Bevelled", { edge: 8, wall_thickness: 3 }, () => ["bevel", 8 - (2 - Math.SQRT2) * 3]],
];

test("what's in a case keeps clear of its shaped inside corners", () => {
  for (const [style, extra, corner] of STYLES) {
    for (const surface of ["bottom", "top", "front", "back", "left", "right"]) {
      for (const stick of [[], ["left", "front"], ["right", "back"], ["left"], ["right"], ["front"], ["back"], ["top"], ["bottom"]]) {
        const sides = surface === "bottom" || surface === "top" ? ["left", "right", "front", "back"]
          : ["front", "back"].includes(surface) ? ["left", "right", "top", "bottom"] : ["front", "back", "top", "bottom"];
        if (!stick.every((s) => sides.includes(s))) continue;
        const design = new Design({ cases: [new CaseSpec("case", { style, height: 40.0, ...extra })] });
        design.placements.push(new Placement("pico", "Pico", "case", { surface, mount: "inside", stick }));
        design.relayout();
        const kase = design.cases[0];
        const spec = design.placements[0];
        for (const b of design._cavity_bodies(spec, spec.make())) {
          for (const [x, y] of [[b[0], b[2]], [b[1], b[2]], [b[1], b[3]], [b[0], b[3]]]) {
            // (What goes out through a wall is outside the cavity there anyway.)
            const outward = x < -1e-6 || y < -1e-6 || x > kase.width + 1e-6 || y > kase.depth + 1e-6;
            if (outward) continue;
            assert.ok(inside(x, y, kase.width, kase.depth, corner),
              `${style}, on the ${surface}, stuck ${stick}: (${x.toFixed(2)}, ${y.toFixed(2)}) in ${kase.width} x ${kase.depth}`);
          }
        }
      }
    }
  }
});

test("a Pico on the floor of a MusicBox keeps just far enough from the walls", () => {
  const design = new Design({ cases: [new CaseSpec("case", { style: "MusicBox", height: 10.0 })] });
  design.placements.push(new Placement("pico", "Pico", "case", { surface: "bottom", mount: "inside" }));
  design.relayout();
  const board = Math.min(...design._cavity_bodies(design.placements[0], design.placements[0].make()).map((b) => b[0]));
  assert.ok(Math.abs(board - 5 * (1 - Math.SQRT1_2)) < 1e-4, `the board is ${board}mm from the left wall`);
  // In a square case it can go closer.
  const square = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 10.0 })] });
  square.placements.push(new Placement("pico", "Pico", "case", { surface: "bottom", mount: "inside" }));
  square.relayout();
  assert.ok(square.cases[0].width < design.cases[0].width - 1.5);
});
