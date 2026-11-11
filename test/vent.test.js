// The Vent device: its patterns, its fans, and that it builds.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildParts, check } from "../lib/builder.js";
import * as catalogue from "../lib/catalogue.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import { Vent } from "../lib/devices.js";
import * as kernel from "../lib/kernel.js";

const quiet = () => {};
const vent = (params = {}) => catalogue.make("Vent", "v", params);

/** The openings' extents, in the vent's own frame: [x0, y0, x1, y1]. */
function extent(o) {
  if (o.circle) {
    const [x, y, r] = o.circle;
    return [x - r, y - r, x + r, y + r];
  }
  const [x0, y0, x1, y1, r] = o.slot;
  return [Math.min(x0, x1) - r, Math.min(y0, y1) - r, Math.max(x0, x1) + r, Math.max(y0, y1) + r];
}

test("a vent's lines and holes fill its area, apart", () => {
  const lines = vent({ pattern: "horizontal lines", width: 40, height: 30, line_width: 2, gap: 2 }).allOpenings();
  assert.equal(lines.length, 8); // 8 lines 4mm apart fit in 30mm
  for (const o of lines) assert.deepEqual(extent(o).map((v) => Math.round(v * 1000) / 1000).filter((_, i) => i % 2 === 0)[0], 0);
  const up = vent({ pattern: "vertical lines", width: 40, height: 30 }).allOpenings();
  assert.equal(up.length, 10);
  assert.ok(up.every((o) => o.slot[0] === o.slot[2]));
  const grid = vent({ pattern: "grid of holes", width: 40, height: 30, hole_diameter: 3, gap: 2 }).allOpenings();
  assert.equal(grid.length, 8 * 6);
  for (const pattern of Vent.PATTERNS) {
    const v = vent({ pattern, width: 50, height: 30 });
    const openings = v.allOpenings();
    assert.ok(openings.length > 3, pattern);
    for (const o of openings) {
      const [x0, y0, x1, y1] = extent(o);
      assert.ok(x0 >= -1e-6 && y0 >= -1e-6 && x1 <= 50 + 1e-6 && y1 <= 30 + 1e-6, `${pattern}: ${extent(o)}`);
    }
  }
});

test("an ellipse of holes stays inside the ellipse, its holes apart", () => {
  for (const [w, h] of [[40, 40], [60, 30], [25, 50]]) {
    const v = vent({ pattern: "ellipse of holes", width: w, height: h, hole_diameter: 3, gap: 2 });
    const holes = v.allOpenings().map((o) => o.circle);
    assert.ok(holes.length > 10);
    for (const [x, y, r] of holes) {
      // Its centre is inside the ellipse shrunk by its radius.
      const [a, b] = [w / 2 - r, h / 2 - r];
      assert.ok(((x - w / 2) / a) ** 2 + ((y - h / 2) / b) ** 2 <= 1 + 1e-6, `${w}x${h}: ${x}, ${y}`);
    }
    for (let i = 0; i < holes.length; i++) {
      for (let j = 0; j < i; j++) {
        const d = Math.hypot(holes[i][0] - holes[j][0], holes[i][1] - holes[j][1]);
        assert.ok(d >= 3 + 2 - 0.05, `${w}x${h}: holes ${i} and ${j} are ${d}mm apart`);
      }
    }
  }
});

test("fans set a vent's size, with screw holes and the pattern in front of their blades", () => {
  const big = vent({ fans: 1, fan_size: "large", width: 10, height: 10 });
  assert.deepEqual([big.ventWidth, big.ventHeight], [40, 40]);
  assert.deepEqual(big.screwHoles(), [[4, 4], [36, 4], [36, 36], [4, 36]]);
  const small = vent({ fans: 2, fan_size: "small", pattern: "grid of holes" });
  assert.deepEqual([small.ventWidth, small.ventHeight], [51, 25]);
  assert.deepEqual(small.screwHoles().slice(4, 6), [[28.5, 2.5], [48.5, 2.5]]);
  for (const pattern of Vent.PATTERNS) {
    for (const fan_size of ["large", "small"]) {
      const v = vent({ fans: 2, fan_size, pattern });
      const { opening, screw } = v.fan;
      const centres = v.fanCentres();
      const openings = v.allOpenings();
      assert.ok(openings.length > 2, `${pattern} ${fan_size}`);
      for (const o of openings) {
        // Inside one fan's opening, so clear of every screw hole.
        const [x0, y0, x1, y1] = extent(o);
        const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        const near = centres.find(([cx]) => Math.abs((x0 + x1) / 2 - cx) < v.fan.size / 2);
        if (o.circle) assert.ok(Math.hypot(o.circle[0] - near[0], o.circle[1] - near[1]) + o.circle[2] <= opening / 2 + 1e-6);
        else assert.ok(corners.every(([x, y]) => Math.hypot(x - near[0], y - near[1]) <= opening / 2 + 1e-6), `${pattern}: ${o.slot}`);
        for (const [sx, sy] of v.screwHoles()) {
          assert.ok(Math.min(...corners.map(([x, y]) => Math.hypot(x - sx, y - sy))) > screw / 2, `${pattern}: a screw hole`);
        }
      }
    }
  }
  assert.throws(() => vent({ pattern: "stars" }), /pattern must be one of/);
  assert.throws(() => vent({ fan_size: "huge" }), /fan_size must be one of/);
  assert.throws(() => vent({ gap: -1 }), /can't be negative/);
});

test("a vent builds into a case, on a wall and on the lid, with and without fans", () => {
  for (const [surface, params] of [["front", { pattern: "horizontal lines", ends: "straight" }],
    ["top", { pattern: "ellipse of holes", width: 50, height: 40 }], ["back", { pattern: "vertical lines", fans: 1 }],
    ["top", { pattern: "grid of holes", fans: 2, fan_size: "small" }], ["bottom", { pattern: "horizontal lines", fans: 1 }]]) {
    const volumes = [];
    for (const withVent of [false, true]) {
      const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 50.0, min_width: 120, min_depth: 80 })] });
      if (withVent) design.placements.push(new Placement("vent", "Vent", "case", { surface, mount: "inside", params }));
      design.relayout();
      kernel.scope(() => {
        const [shapes] = buildParts(design, { log: quiet });
        const [parts, problems] = check(design, shapes);
        assert.deepEqual(problems, [], `${surface} ${JSON.stringify(params)}`);
        const part = surface === "top" ? "case.lid" : "case.base";
        assert.equal(parts[part].solids, 1, `${surface} ${JSON.stringify(params)}`);
        assert.ok(parts[part].valid);
        volumes.push(parts[part].volume_mm3);
      });
    }
    assert.ok(volumes[1] < volumes[0] - 50, `${surface} ${JSON.stringify(params)}: ${volumes}`);
  }
});

test("what cuts through a wall stays below the step for the lid's skirt", () => {
  for (const [type, params] of [["Vent", {}], ["Vent", { fans: 1 }], ["Hole", { diameter: 8 }], ["SmallSpeaker", {}]]) {
    for (const surface of ["front", "back", "left", "right"]) {
      // Stuck to the top of its wall, in a case that keeps its height (and is big enough that the retaining
      // screws' nut blocks, which it would keep clear of too, are well away from it).
      const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 60.0, lid_height: 6.0,
        min_width: 150, min_depth: 150 })] });
      design.placements.push(new Placement("v", type, "case", { surface, mount: "inside", stick: ["top"], params }));
      design.relayout();
      const kase = design.cases[0];
      const spec = design.placements[0];
      const item = spec.make();
      const top = Math.max(...item.body_boxes().map((b) => b.transformedBounds(design.placement_case_matrix(spec, item))[5]));
      // Its top margin (0.5mm) below the step: the lid's height and the gap round its skirt.
      assert.ok(Math.abs(top - (kase.height - 6.15 - 0.5)) < 1e-6, `${type} on the ${surface} wall: its top is at ${top}`);
      assert.equal(kase.height, 60.0);
    }
  }
  // Pillars alone don't cut through, so they can go on up the inside of the wall.
  assert.equal(catalogue.CATALOG.Vent.CUTS_THROUGH, true);
  assert.equal(catalogue.CATALOG.SmallSpeaker.CUTS_THROUGH, true);
  assert.equal(catalogue.CATALOG.Pi3APlus.CUTS_THROUGH, false);
});
