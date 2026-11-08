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
  design.placements.push(new Placement("speaker", "SmallSpeaker", "a", { surface: "left", mount: "inside", stick: ["bottom"] }));
  design.relayout();
  // The layout puts the speaker over the Pi; pushed down onto it, as a design file could have it.
  assert.ok(!design.warnings().some((p) => /collides/.test(p)));
  design.placements[1].y = 0;
  const problems = kernel.scope(() => design.warnings());
  assert.ok(problems.some((p) => p.includes("speaker collides with one")), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("too short for the retaining screws")), problems.join("\n"));
});

test("placements put on top of each other on a surface are moved apart", () => {
  const design = new Design({ cases: [boxCase("a", { min_width: 200, min_depth: 100 })] });
  design.placements.push(new Placement("one", "Pi3APlus", "a", { stick: ["left"] }));
  design.placements.push(new Placement("two", "Pi3APlus", "a", { stick: ["left"] }));
  design.relayout();
  const [one, two] = design.placements;
  // Both stuck to the left, so parted front to back.
  assert.equal(one.x, two.x);
  assert.ok(Math.abs(one.y - two.y) >= 57.0 - 1e-6, `${one.y} and ${two.y}`);
  assert.ok(!design.warnings().some((p) => /collides/.test(p)));
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

test("a case can fit its height to what's on its walls, floor and lid", () => {
  const sized = (fit, ...placements) => {
    const design = new Design({ cases: [boxCase("case", { height: 20.0, fit_height: fit })] });
    design.placements.push(...placements);
    design.relayout();
    return design;
  };
  // A 42mm speaker on a wall: its height and its margins - under the retaining screws' nut blocks, as it's as wide as
  // the wall is long.
  const wall = sized(true, new Placement("s", "SmallSpeaker", "case", { surface: "left", mount: "inside" }));
  assert.equal(wall.cases[0].height, 53.1);
  assert.deepEqual(wall.warnings(), []);
  assert.ok(!wall.warnings().some((w) => /overhangs|sticks out/.test(w)));
  // Without fit_height, the height it was given - but grown, rather than leave the speaker sticking out of it.
  assert.equal(sized(false, new Placement("s", "SmallSpeaker", "case", { surface: "left", mount: "inside" })).cases[0].height, 53.1);
  const tall = new Design({ cases: [boxCase("case", { height: 70.0 })] });
  tall.placements.push(new Placement("s", "SmallSpeaker", "case", { surface: "left", mount: "inside" }));
  tall.relayout();
  assert.equal(tall.cases[0].height, 70.0);
  // A Pico (7.8mm, to the top of its USB socket) on the floor under a pixel ring hanging 8.4mm from the lid, 1mm apart.
  const stack = sized(true, new Placement("pico", "Pico", "case"),
    new Placement("ring", "PixelRingLightPipes", "case", { surface: "top", mount: "inside" }));
  assert.equal(stack.cases[0].height, 17.2);
  // A Pi 4's USB stack leaves through the wall, but is as tall inside.
  assert.equal(sized(true, new Placement("pi", "PI4Landscape", "case")).cases[0].height, 27.0);
  // A screen hanging from the lid faces down into the case, so it counts (on the floor, it'd go up through the lid).
  const lid = sized(true, new Placement("screen", "LCDPanel", "case", { surface: "top", mount: "inside" }),
    new Placement("pico", "Pico", "case", { stick: ["left", "front"], params: { margin_left: 3, margin_front: 3 } }));
  assert.equal(lid.cases[0].height, 33.1);
  assert.deepEqual([lid.placements[1].x, lid.placements[1].y], [0.0, 0.0]);
  assert.ok(!lid.warnings().some((w) => /collides/.test(w)));
  // A speaker on a wall sits above a battery compartment filling the floor (26mm), rather than the case growing
  // round it centred.
  const box = new Design({ cases: [boxCase("case", { height: 20.0, fit_height: true })] });
  box.placements.push(new Placement("speaker", "SmallSpeaker", "case", { surface: "right", mount: "inside" }),
    new Placement("battery", "BatteryCompartment", "case", { surface: "bottom", mount: "outside", params: { back: "plate" } }));
  box.relayout();
  assert.equal(box.cases[0].height, 63.5);
  assert.deepEqual(box.warnings().filter((w) => !/nut blocks/.test(w)), []);
  // Nothing in it: the height it had.
  assert.equal(sized(true).cases[0].height, 20.0);
  // Written only when it's on, so other designs are as the Python thingmaker writes them.
  assert.equal(stack.to_dict().cases[0].fit_height, true);
  assert.ok(!("fit_height" in sized(false).to_dict().cases[0]));
  assert.equal(Design.from_dict(JSON.parse(stack.dumps())).cases[0].fit_height, true);
  assert.throws(() => boxCase("case", { fit_height: "yes" }), /fit_height must be true or false/);
});
