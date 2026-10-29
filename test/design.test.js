// The design model: loading, saving, layout and the problems list.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as dm from "../lib/design.js";
import * as geom from "../lib/geom.js";
import { CaseSpec, Design, DesignError, HingeSpec, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DESIGNS = path.join(ROOT, "designs");

function boxCase(id = "case", extra = {}) {
  return new CaseSpec(id, { style: "Square", height: 30.0, ...extra });
}

test("every example design loads, and saving it again changes nothing", () => {
  for (const name of fs.readdirSync(DESIGNS).filter((n) => n.endsWith(".json"))) {
    kernel.scope(() => {
      const first = Design.load(path.join(DESIGNS, name)).dumps();
      const again = Design.from_dict(JSON.parse(first)).dumps();
      assert.equal(again, first, name);
    });
  }
});

test("files are written as Python writes them", () => {
  const design = new Design({ name: "Tést", cases: [boxCase()] });
  const text = design.dumps();
  assert.match(text, /"version": 2,/);
  assert.match(text, /"width": 100\.0,/);
  assert.match(text, /"position": \[\n {8}0\.0,/);
  assert.match(text, /"name": "T\\u00e9st"/);
});

test("bad designs are refused with a reason", () => {
  assert.throws(() => Design.from_dict({ format: "something-else" }), DesignError);
  assert.throws(() => Design.from_dict({ version: 99 }), /newer than this thingmaker/);
  assert.throws(() => new CaseSpec("c", { style: "Wobbly" }), /unknown style/);
  assert.throws(() => new CaseSpec("c", { height: -1 }), /must be positive/);
  assert.throws(() => new CaseSpec("c", { colour: "red" }), /unknown field/);
  assert.throws(() => new HingeSpec("h", ["a", "a"]), /two different cases/);
  assert.throws(() => new Placement("p", "NoSuchThing", "c"), /no device or subassembly/);
  assert.throws(() => new Placement("p", "Hole", "c", { stick: ["left", "right"] }), /two opposite sides/);
  assert.throws(() => new Placement("p", "Hole", "c", { surface: "front", stick: ["front"] }), /can only stick to/);
  assert.throws(() => new Placement("p", "Pi3APlus", "c", { connector_cuts: { nope: true } }), /no connector cut/);
  const d = { cases: [boxCase().to_dict(), boxCase().to_dict()] };
  assert.throws(() => Design.from_dict(d), /Duplicate id/);
});

test("a case shrinks to fit what's in it, and every case gets the same size", () => {
  const design = new Design({ cases: [boxCase("a"), boxCase("b")] });
  design.placements.push(new Placement("pi", "Pi3APlus", "a", { x: 10, y: 10 }));
  design.relayout();
  const [a, b] = design.cases;
  assert.equal(a.width, 66.0);
  assert.equal(a.depth, 57.0);
  assert.equal(b.width, a.width);
  assert.equal(b.depth, a.depth);
  assert.deepEqual([design.placements[0].x, design.placements[0].y], [0.0, 0.0]);
});

test("minimums keep a case bigger, and an unstuck device stays centred", () => {
  const design = new Design({ cases: [boxCase("a", { min_width: 200.0, min_depth: 100.0 })] });
  design.placements.push(new Placement("pi", "Pi3APlus", "a", { x: 0, y: 0 }));
  design.relayout();
  const pi = design.placements[0];
  assert.equal(design.cases[0].width, 200.0);
  assert.equal(pi.x, (200 - 66) / 2);
  assert.equal(pi.y, (100 - 57) / 2);
});

test("a device stuck to a side sits its margin from it; moving it changes that margin", () => {
  const design = new Design({ cases: [boxCase("a", { min_width: 200.0, min_depth: 100.0 })] });
  design.placements.push(new Placement("pi", "Pi3APlus", "a", { stick: ["left", "front"], params: { margin_left: 5.0 } }));
  design.relayout();
  const pi = design.placement("pi");
  assert.equal(pi.x, 0.0);
  assert.equal(pi.y, 0.0);
  // The board itself is 5mm from the left wall.
  assert.equal(pi.make().board_frame()[0], 5.0);
  pi.x += 10;
  design.take_up_stuck_gaps("pi");
  assert.equal(pi.params.margin_left, 15.0);
  assert.equal(pi.x, 0.0);
});

test("renaming a case updates what refers to it; removing it takes them away", () => {
  const design = new Design({ cases: [boxCase("a"), boxCase("b")] });
  design.hinges.push(new HingeSpec("h", ["a", "b"]));
  design.placements.push(new Placement("pi", "Pi3APlus", "a", { connector_cut_targets: ["a.lid"] }));
  design.rename("a", "main");
  assert.deepEqual(design.hinges[0].cases, ["main", "b"]);
  assert.equal(design.placements[0].case, "main");
  assert.deepEqual(design.placements[0].connector_cut_targets, ["main.lid"]);
  assert.throws(() => design.rename("b", "main"), /already in use/);
  assert.throws(() => design.rename("b", "x.y"), /can't contain/);
  design.remove("main");
  assert.equal(design.hinges.length, 0);
  assert.equal(design.placements.length, 0);
});

test("a hinge places its second case, folded open about the shared edge", () => {
  const design = new Design({ cases: [boxCase("a"), boxCase("b", { height: 20.0 })] });
  design.hinges.push(new HingeSpec("h", ["a", "b"], { open_angle: 180.0, gap: 0.0 }));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  // Opened flat, b stands upright behind a, the tops of their lids level
  // at the pivot (the outside of a's back wall, on top of its lid).
  let m = design.case_matrices().b;
  assert.ok(near(m[2][2], 1));
  assert.ok(near(geom.applyPoint(m, [0, 0, 20 + 3])[2], 30 + 3));
  assert.ok(geom.applyPoint(m, [0, 0, 0])[1] > 80 + 3);
  // Shut, it lies upside down on top of a, lid to lid.
  design.hinges[0].open_angle = 0;
  m = design.case_matrices().b;
  assert.ok(near(m[2][2], -1));
  assert.ok(near(geom.applyPoint(m, [0, 0, 20 + 3])[2], 30 + 3));
  assert.ok(design.hinge_length(design.hinges[0]) > dm.MIN_HINGE_LENGTH);
  assert.throws(() => {
    design.hinges.push(new HingeSpec("h2", ["b", "a"]));
    design.case_matrices();
  }, /loop/);
});

test("the problems list finds collisions, overhangs and short lids", () => {
  const design = new Design({ cases: [boxCase("a", { min_width: 200, min_depth: 100, lid_height: 2.0 })] });
  design.placements.push(new Placement("one", "Pi3APlus", "a", { stick: ["left"] }));
  design.placements.push(new Placement("two", "Pi3APlus", "a", { stick: ["left"] }));
  design.relayout();
  const problems = kernel.scope(() => design.warnings());
  assert.ok(problems.some((p) => p.includes("two collides with one")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("too short for the retaining screws")), problems.join("\n"));
});

test("a new placement is centred where it's added, and named after its type", () => {
  const design = new Design({ cases: [boxCase("a")] });
  const spec = dm.newPlacement(design, "Hole", "a", "front", "outside", [20, 10]);
  assert.equal(spec.id, "hole1");
  assert.equal(spec.x, 20 - 3);
  assert.equal(spec.y, 10 - 3);
  const keyboard = dm.newPlacement(design, "NumKeyboard", "a", "top", "inside");
  assert.equal(keyboard.params.mounting, "underneath");
});
