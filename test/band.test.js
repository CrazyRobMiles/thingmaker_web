// The band round a case's walls (lib/band.js): a decoration that carries on
// round the corners.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as band from "../lib/band.js";
import { buildParts, check } from "../lib/builder.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PICTURE = path.join(ROOT, "images", "camera_outline.png");
const quiet = () => {};
const near = (a, b, what, within = 1e-6) => assert.ok(Math.abs(a - b) <= within, `${what}: ${a} isn't ${b}`);

function caseDesign(style, decorations = {}, extra = {}) {
  const design = new Design({ cases: [new CaseSpec("c", { style, height: 30.0, min_width: 80, min_depth: 50, edge: 4.0,
    wall_thickness: 3.0, decorations, ...extra })] });
  design.relayout();
  return design;
}

test("the band unrolls the walls' outside, round their corners, from the middle of the front", () => {
  const [W, D] = [80 + 6, 50 + 6];
  for (const [style, corner, length] of [["Square", ["square", 0], 2 * (W + D)],
    ["MusicBox", ["round", 5], 2 * (W + D) - 8 * 5 + 2 * Math.PI * 5],
    ["Rounded", ["round", 4], 2 * (W + D) - 8 * 4 + 2 * Math.PI * 4],
    ["Bevelled", ["bevel", 4], 2 * (W + D) - 8 * 4 + 4 * 4 * Math.SQRT2]]) {
    const kase = caseDesign(style).case("c");
    assert.deepEqual(band.outsideCorner(kase), corner, style);
    const p = band.bandPath(kase);
    near(p.length, length, `${style}'s length`, 1e-9);
    near(p.segments[0].from, -length / 2, `${style} starts half way round`, 1e-9);
    near(p.segments[p.segments.length - 1].to, length / 2, `${style} ends half way round`, 1e-9);
    const front = p.segments.find((g) => g.side === "front");
    near(front.from, -front.to, `${style}'s front is centred on 0`, 1e-9);
    assert.deepEqual(p.height, [-3.0, 33.0]);
  }
});

test("text in the band carries on round the corner, and the band leaves nothing unfilled", () => {
  for (const style of ["MusicBox", "Rounded", "Bevelled"]) {
    const plain = caseDesign(style);
    const design = caseDesign(style, { around: { text: { text: "ROUND THE CORNER", size: 9.0, across: 40.0 } },
      front: { image: { file: PICTURE, depth: 1.0 } } });
    assert.deepEqual(design.problems(), [], style);
    kernel.scope(() => {
      const [plainShapes] = buildParts(plain, { log: quiet });
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, [], style);
      const base = Object.keys(shapes).filter((pid) => pid.startsWith("c.base"));
      assert.ok(base.includes("c.base.deco.around.text") && base.includes("c.base.deco.front.image"), base.join(", "));
      for (const pid of base) assert.ok(parts[pid].valid, `${style}: ${pid}`);
      // The base and its inlays are the whole base, but for the hair of space round each inlay (decoration.SEAM):
      // nothing left unfilled under the band or the front's picture.
      const short = plainShapes["c.base"].Volume - base.reduce((t, pid) => t + shapes[pid].Volume, 0);
      assert.ok(short > 0 && short < 10.0, `${style}: the base and its inlays are ${short}mm3 short of the whole base`);
      // Moved 40mm right, it runs off the front, round the corner and along the right side.
      const [x0, x1, y0, y1] = shapes["c.base.deco.around.text"].bounds();
      assert.ok(x1 > 83.0 - 0.7 && y1 > 10.0, `${style}: along the right side (${x1}, ${y1})`);
      assert.ok(y0 < -2.3 && x0 < 70.0, `${style}: and the front (${x0}, ${y0})`);
      // The text's cut in, not floating off the corner: it's all within the case's outline.
      assert.ok(x1 <= 83.0 + 1e-6 && y0 >= -3.0 - 1e-6, `${style}: inside the outline`);
    });
  }
});

test("a stamp on a wall is on top of the band", () => {
  const design = caseDesign("MusicBox", { around: { image: { file: PICTURE, zoom: 2.0 } } });
  const volumes = [];
  for (const withStamp of [false, true]) {
    design.placements = withStamp
      ? [new Placement("s", "Stamp", "c", { surface: "front", mount: "outside", params: { text_text: "X", text_size: 12.0, stamp_height: 15.0 } })] : [];
    design.relayout();
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [, problems] = check(design, shapes);
      assert.deepEqual(problems, []);
      volumes.push(shapes["c.base.deco.around.image"].Volume);
      if (withStamp) {
        assert.ok(shapes["c.base.stamp.s.text"]);
        assert.ok(shapes["c.base.stamp.s.text"].common(shapes["c.base.deco.around.image"]).Volume < 0.001);
      }
    });
  }
  assert.ok(volumes[1] < volumes[0] - 0.5, `the band's picture, left out under the stamp (${volumes})`);
});

test("a band too deep for its corners, or round a frame, is a problem", () => {
  let problems = caseDesign("Rounded", { around: { text: { text: "x", depth: 1.5 } } }, { edge: 1.5 }).problems().map((p) => p[0]);
  assert.match(problems.join("\n"), /too deep to go round its corners \(1\.5mm round\); make it less than 1\.3mm/);
  problems = caseDesign("Frame", { around: { text: { text: "x" } } }).problems().map((p) => p[0]);
  assert.match(problems.join("\n"), /its around decoration isn't made/);
});
