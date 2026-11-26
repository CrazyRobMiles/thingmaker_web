// Stamps (lib/stamp.js): text and a picture in a rectangle of their own,
// with a decoration's settings, drawn on top of the face's decoration.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildParts, check } from "../lib/builder.js";
import * as catalogue from "../lib/catalogue.js";
import * as decoration from "../lib/decoration.js";
import * as geom from "../lib/geom.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import { pictureRefs } from "../lib/imports.js";
import * as kernel from "../lib/kernel.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PICTURE = path.join(ROOT, "images", "camera_outline.png");
const quiet = () => {};

function lidDesign(decorations, stamp) {
  const design = new Design({ cases: [new CaseSpec("c", { style: "Square", height: 20.0, min_width: 100, min_depth: 70,
    decorations })] });
  if (stamp) design.placements.push(new Placement("s", "Stamp", "c", { surface: "top", mount: "outside", params: stamp }));
  design.relayout();
  return design;
}

test("a stamp has every setting a decoration's text and picture have", () => {
  const params = catalogue.CATALOG.Stamp.device_params();
  for (const [kind, prefix] of [["text", "text_"], ["image", "picture_"]]) {
    for (const [name, dflt] of decoration.FIELDS[kind]) assert.deepEqual(params[prefix + name][0], dflt, prefix + name);
  }
  assert.ok("stamp_width" in params && "stamp_height" in params);
  assert.throws(() => catalogue.make("Stamp", "s", { picture_style: "jigsaw" }), /picture: style must be one of/);
  assert.equal(catalogue.CATALOG.Stamp.OUTSIDE_ONLY, true);
});

test("a stamp is drawn on top of the face's decoration, leaving nothing unfilled", () => {
  const decorations = { top: { image: { file: PICTURE, depth: 1.0 } } };
  const stamp = { text_text: "HI", text_size: 14.0, text_depth: 0.6, stamp_width: 40.0, stamp_height: 20.0 };
  const volumes = {};
  for (const [what, design] of [["plain", lidDesign({}, null)], ["decorated", lidDesign(decorations, null)],
    ["stamped", lidDesign(decorations, stamp)]]) {
    assert.deepEqual(design.problems(), [], what);
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, [], what);
      const ids = Object.keys(shapes).filter((pid) => pid.startsWith("c.lid"));
      volumes[what] = Object.fromEntries(ids.map((pid) => [pid, parts[pid].volume_mm3]));
      for (const a of ids) {
        for (const b of ids) if (a < b) assert.ok(shapes[a].common(shapes[b]).Volume < 0.001, `${what}: ${a} and ${b} overlap`);
      }
      // The lid and its inlays are the whole lid, but for the hair of space round each inlay (decoration.SEAM):
      // no hole left under the stamp.
      const short = what === "plain" ? 0 : volumes.plain["c.lid"] - ids.reduce((t, pid) => t + shapes[pid].Volume, 0);
      if (what !== "plain") assert.ok(short > 0 && short < 10.0, `${what}: ${short}mm3 short of the plain lid`);
    });
  }
  assert.ok(volumes.stamped["c.lid.stamp.s.text"] > 1.0, "the stamp's inlay");
  assert.ok(volumes.stamped["c.lid.deco.top.image"] < volumes.decorated["c.lid.deco.top.image"], "the picture, left out under it");
});

test("a stamp's text reads the right way up on the lid, from the front", () => {
  const design = lidDesign({}, { text_text: "O  L", text_size: 10.0, stamp_width: 40.0, stamp_height: 15.0 });
  const spec = design.placement("s");
  const item = spec.make();
  const toCase = design.placement_case_matrix(spec, item);
  kernel.scope(() => {
    // As the builder draws it on the top: turned round.
    const [[[, , section]]] = item.draw(180.0);
    const caseX = (s) => s.toPolygons().flat().map(([x, y]) => geom.applyPoint(toCase, [x, y, 0])[0]);
    // The "O" is the one with a hole in it; seen from the front, it's on the left.
    const [u0, , u1] = item.rect();
    const half = (from, to) => section.intersect(kernel.Section.square(to - from, 1000).translate(from, -500));
    const [left, right] = [half(u0, (u0 + u1) / 2), half((u0 + u1) / 2, u1)];
    const withHole = (s) => s.toPolygons().length > 1;
    const a = withHole(left) ? left : right;
    const b = a === left ? right : left;
    assert.ok(withHole(a) && !withHole(b), "one letter each side");
    assert.ok(Math.max(...caseX(a)) < Math.min(...caseX(b)), "the O is left of the L, in the case");
  });
});

test("a stamp's problems, its picture in several colours, and its picture found with the design's", () => {
  let design = lidDesign({}, { picture_file: "images/nothing-here.png" });
  assert.deepEqual(design.problems().map((p) => p[0]), ["s: picture: no file images/nothing-here.png"]);
  design = lidDesign({}, { picture_file: PICTURE, picture_style: "posterise", picture_columns: 24, picture_colours: 3,
    picture_palette: "#000000 #ffffff" });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const stamped = Object.keys(shapes).filter((pid) => pid.includes(".stamp."));
    assert.ok(stamped.length >= 1 && stamped.every((pid) => /^c\.lid\.stamp\.s\.image[12]$/.test(pid)), stamped.join(", "));
  });
  assert.deepEqual(pictureRefs(design.to_dict()).map((r) => r.file), [PICTURE]);
});
