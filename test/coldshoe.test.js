// The cold shoe foot (lib/coldshoe.js): its shape, and that it builds on
// every sort of surface.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildParts, check } from "../lib/builder.js";
import * as catalogue from "../lib/catalogue.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

const quiet = () => {};
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-3, `${what}: ${a} isn't ${b}`);

test("a cold shoe foot is a T: a 12mm neck, and an 18mm plate 2mm thick that slides under the shoe's rails", () => {
  kernel.scope(() => {
    const shoe = catalogue.make("ColdShoe", "s");
    const foot = shoe.foot();
    assert.equal(foot.Solids.length, 1);
    const [x0, x1, y0, y1, z0, z1] = foot.bounds();
    close(x1 - x0, 17.8, "the plate's width");
    close(y1 - y0, 18.0, "its length");
    close(z0, 0.0, "it stands on the outside face");
    close(z1, 3.0 + 1.9, "its height");
    // Across the neck (half way up it), and across the plate.
    const slice = (z) => foot.common(kernel.makeBox(40, 4, 0.2, [-10, 7, z])).bounds();
    const neck = slice(1.4);
    close(neck[1] - neck[0], 12.0, "the neck's width");
    const plate = slice(3.8);
    close(plate[1] - plate[0], 17.8, "the plate's width, half way through it");
    // Its corners cut off at the leading (low-y) end, 2mm each way, to guide it in; not at the other.
    const across = (y) => {
      const b = foot.common(kernel.makeBox(40, 0.01, 0.2, [-10, y, 3.8])).bounds();
      return b[1] - b[0];
    };
    assert.ok(Math.abs(across(y0 + 0.5) - (17.8 - 2 * 1.5)) < 0.05, `${across(y0 + 0.5)} across, 0.5mm in from the leading end`);
    close(across(y0 + 3.0), 17.8, "the plate's width past the lead-in");
    close(across(y1 - 0.5), 17.8, "the plate's width at the far end");
    close(catalogue.make("ColdShoe", "s", { lead_in: 0 }).foot().Volume - foot.Volume, 2 * (2 * 2 / 2) * 1.9, "the corners' volume");
    assert.throws(() => catalogue.make("ColdShoe", "s", { lead_in: 3 }), /reaches past the neck/);
    // The screws' heads are sunk into the plate's face, so the face is flush.
    for (const [sx, sy] of shoe.screw_positions()) {
      const head = foot.common(kernel.makeCylinder(2.5, 0.2, [sx, sy, z1 - 0.2])).Volume;
      assert.ok(head < 1e-6, `the screw at ${sx}, ${sy} isn't countersunk`);
    }
  });
  assert.throws(() => catalogue.make("ColdShoe", "s", { neck_width: 20 }), /can't be wider than its plate/);
  assert.equal(catalogue.CATALOG.ColdShoe.OUTSIDE_ONLY, true);
});

test("a cold shoe foot builds on the floor, the lid and the walls, each part one solid, the foot a part of its own", () => {
  for (const [surface, panels] of [["bottom", false], ["top", false], ["front", false], ["left", true], ["top", true]]) {
    const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 30.0, panels })] });
    design.placements.push(new Placement("shoe", "ColdShoe", "case", { surface, mount: "outside" }));
    design.relayout();
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      const what = `on the ${surface}${panels ? " of a panel case" : ""}`;
      assert.deepEqual(problems, [], what);
      assert.ok(parts["shoe.foot"], what);
      for (const [name, part] of Object.entries(parts)) {
        assert.equal(part.solids, 1, `${what}: ${name}`);
        assert.ok(part.valid, `${what}: ${name}`);
      }
      // Printed lying on its outside face, a part puts the foot's plate on the bed (its lowest), with no overhang.
      if (surface !== "front") {
        const [, , , , z0] = shapes["shoe.foot"].bounds();
        const bed = shapes["shoe.foot"].common(kernel.makeBox(400, 400, 0.2, [-200, -200, z0])).Volume;
        assert.ok(Math.abs(bed - (17.8 * 18 - 2 * Math.PI * 2.9 ** 2) * 0.2) < 1.0, `${what}: ${bed}mm3 of plate on the bed`);
      }
    });
  }
});

test("the screws go into bosses inside the case", () => {
  const volumes = [];
  for (const boss_height of [0, 4]) {
    // (A case of a fixed size: bosses or none, the lid is the same.)
    const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 30.0, min_width: 60, min_depth: 60 })] });
    design.placements.push(new Placement("shoe", "ColdShoe", "case", { surface: "top", mount: "outside", params: { boss_height } }));
    design.relayout();
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, []);
      volumes.push(parts["case.lid"].volume_mm3);
    });
  }
  // Two bosses 7mm across and 4mm high, less the pilot holes in them.
  const bosses = 2 * Math.PI * 3.5 ** 2 * 4;
  assert.ok(volumes[1] - volumes[0] > bosses * 0.85 && volumes[1] - volumes[0] < bosses, `${volumes[1] - volumes[0]}mm3 of bosses`);
});
