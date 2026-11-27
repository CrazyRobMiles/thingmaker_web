// Picture frames (cases of style "Frame"): a back (a tray), the picture's
// plate, the frame round them and the turn buttons holding them in.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildParts, check } from "../lib/builder.js";
import * as cases from "../lib/cases.js";
import * as geom from "../lib/geom.js";
import { CaseSpec, Design, Placement, frameHeight, lidMatrix } from "../lib/design.js";
import { applyEdit } from "../lib/edits.js";
import * as kernel from "../lib/kernel.js";

const quiet = () => {};
const near = (a, b, what, within = 1e-3) => assert.ok(Math.abs(a - b) <= within, `${what}: ${a} isn't ${b}`);

function frameDesign(settings = {}) {
  const design = new Design({ cases: [new CaseSpec("f", { style: "Frame", height: 4.0, wall_thickness: 2.0, base_thickness: 2.0,
    lid_thickness: 2.0, min_width: 150, min_depth: 100, ...settings })] });
  design.relayout();
  return design;
}

test("a frame is a back, a picture's plate, the frame round them and turn buttons, each printable as it is", () => {
  for (const frame_profile of ["flat", "bevelled", "rounded"]) {
    const design = frameDesign({ frame_profile });
    const kase = design.case("f");
    assert.deepEqual(kase.parts, ["f.back", "f.picture", "f.frame", "f.buttons"]);
    kernel.scope(() => {
      const [shapes, world] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, [], frame_profile);
      assert.deepEqual(design.problems(), [], frame_profile);
      for (const pid of kase.parts) assert.ok(parts[pid].valid, `${frame_profile}: ${pid}`);
      // Two buttons on each long side, one on each short side.
      assert.equal(parts["f.buttons"].solids, 6);
      // Each part lies on the bed as it's made: the back on its floor, the
      // plate and the frame face down.
      for (const pid of ["f.back", "f.picture", "f.frame"]) {
        const [, , , , z0] = shapes[pid].bounds();
        const bed = shapes[pid].common(kernel.makeBox(400, 400, 0.2, [-200, -200, z0])).Volume;
        assert.ok(bed > 100, `${frame_profile}: ${pid} has ${bed}mm3 on the bed`);
      }
      // Put together, nothing overlaps.
      const placed = Object.fromEntries(kase.parts.map((pid) => [pid, shapes[pid].transformed(world[pid])]));
      for (const a of kase.parts) {
        for (const b of kase.parts) {
          if (a < b) assert.ok(placed[a].common(placed[b]).Volume < 0.01, `${frame_profile}: ${a} and ${b} overlap`);
        }
      }
      // The frame's front covers the plate's edges, frame_lip (5mm) in; the back's underside is level with the frame's.
      const plate = placed["f.picture"].bounds();
      const frame = placed["f.frame"].bounds();
      near(frame[5], plate[5] + 3.0, "the front, 3mm in front of the plate");
      near(frame[4], placed["f.back"].bounds()[4], "the frame's back, level with the back's");
      const front = placed["f.frame"].common(kernel.makeBox(400, 400, 0.2, [-200, -200, plate[5] + 0.1]));
      const [x0, x1] = front.common(kernel.makeBox(400, 1, 0.2, [-200, 50, plate[5] + 0.1])).bounds();
      assert.ok(x0 < plate[0] && x1 > plate[1], "the front reaches right across");
      const window = kernel.makeBox(plate[1] - plate[0] - 10.0, plate[3] - plate[2] - 10.0, 0.2, [plate[0] + 5.0, plate[2] + 5.0, plate[5] + 0.1]);
      near(front.common(window).Volume, 0.0, "nothing over the window");
    });
  }
});

test("a frame's turn buttons reach over its back, and its screws go into the frame", () => {
  const design = frameDesign({ frame_profile: "flat" });
  const kase = design.case("f");
  kernel.scope(() => {
    const [buttons] = cases.buttonParts(kase);
    const back = cases.makeBox(kase).get_base();
    const [x0, x1, y0, y1, z0] = back.bounds();
    // Pushed up into the back, each button would take 3mm or so of its edge.
    for (const b of buttons.Solids) {
      const [bx0, bx1, by0, by1] = b.bounds();
      const over = Math.max(x0 - bx0 > 0 ? bx1 - x0 : 0, bx1 - x1 > 0 ? x1 - bx0 : 0, y0 - by0 > 0 ? by1 - y0 : 0, by1 - y1 > 0 ? y1 - by0 : 0);
      near(over, 3.0, "how far a button reaches over the back", 0.01);
      assert.ok(b.translate([0, 0, 2.5]).common(back).Volume > 0, "it's under the back's edge");
    }
    near(buttons.bounds()[5], z0, "the buttons are on the back of the frame");
  });
  // A shallow frame's screw holes stop short of its front.
  const shallow = frameDesign({ height: 1.0, base_thickness: 1.5, lid_thickness: 1.5, frame_front: 2.0 });
  assert.equal(frameHeight(shallow.case("f")), 6.0);
  kernel.scope(() => {
    const [shapes] = buildParts(shallow, { log: quiet });
    const [parts, problems] = check(shallow, shapes);
    assert.deepEqual(problems, []);
    assert.equal(parts["f.frame"].solids, 1);
  });
});

test("a frame's picture is inlaid in its plate, fitted to the window", () => {
  const design = frameDesign({ decorations: { top: { text: { text: "Hello", size: 20.0 } } } });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const inlays = Object.keys(shapes).filter((pid) => pid.includes(".deco."));
    assert.deepEqual(inlays, ["f.picture.deco.top.text"]);
  });
});

test("what a frame can't have, and settings that won't work, are problems", () => {
  let design = frameDesign({ frame_lip: 60.0 });
  assert.match(design.problems().map((p) => p[0]).join("\n"), /covers the whole picture/);
  design = frameDesign({ frame_width: 4.0 });
  assert.match(design.problems().map((p) => p[0]).join("\n"), /too narrow \(4mm\) for its turn buttons/);
  design = frameDesign({ frame_width: 4.0, frame_buttons: false });
  assert.deepEqual(design.problems(), []);
  assert.deepEqual(design.case("f").parts, ["f.back", "f.picture", "f.frame"]);
  design = frameDesign({ decorations: { left: { text: { text: "x" } } } });
  design.placements.push(new Placement("led", "Hole", "f", { surface: "front", mount: "inside" }));
  design.relayout();
  const problems = design.problems().map((p) => p[0]).join("\n");
  assert.match(problems, /led: case f is a picture frame, whose sides are covered/);
  assert.match(problems, /its left decoration isn't made/);
});

test("a case made a frame keeps what's aimed at its base, and only a frame's file has a frame's settings", () => {
  const design = new Design({ cases: [new CaseSpec("c", { min_width: 80, min_depth: 60 })] });
  design.placements.push(new Placement("led", "Hole", "c", { surface: "bottom", mount: "inside" }));
  design.relayout();
  assert.ok(!("frame_width" in design.to_dict().cases[0]));
  const result = applyEdit(design.to_dict(), { op: "set", kind: "case", id: "c", field: "style", value: "Frame" });
  assert.ok(result.ok, result.message);
  const kase = result.design.case("c");
  assert.equal(kase.base_part, "c.back");
  assert.equal(result.design.placement("led").surface, "bottom");
  const saved = result.design.to_dict().cases[0];
  assert.equal(saved.frame_width, 12.0);
  assert.equal(saved.frame_profile, "bevelled");
  assert.ok(!("frame_buttons" in saved));
  assert.deepEqual(Design.from_dict(result.design.to_dict()).to_dict(), result.design.to_dict());
});

test("a keyhole hanger on a frame's back: a hole for the screw's head, a slot up from it, and a channel behind", () => {
  const design = frameDesign({ height: 6.0 });
  design.placements.push(new Placement("hang", "KeyholeHanger", "f", { surface: "bottom", mount: "outside" }));
  design.relayout();
  assert.deepEqual(design.problems(), []);
  const spec = design.placement("hang");
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const [parts, problems] = check(design, shapes);
    assert.deepEqual(problems, []);
    assert.equal(parts["f.back"].solids, 1);
    // Where the hole and the top of the slot are, in the case.
    const item = spec.make();
    const toCase = design.placement_case_matrix(spec, item);
    const [hole, top] = item._ends().map(([x, y]) => geom.applyPoint(toCase, [x, y, 0]).slice(0, 2));
    assert.ok(top[1] > hole[1] + 9.0, "the slot runs up the frame (+Y: the top of its picture) from the hole");
    const back = shapes["f.back"]; // (in the case frame, as the back is made)
    const solid = (x, y, z) => back.common(kernel.makeBox(0.4, 0.4, 0.2, [x - 0.2, y - 0.2, z])).Volume > 0.01;
    const bt = 2.0;
    // In through the hole; the slot's edges in front of the head; the channel behind.
    assert.ok(!solid(...hole, -bt + 0.5) && !solid(...hole, -bt + 3.0), "the hole goes in");
    assert.ok(!solid(...top, -bt + 0.5), "the slot's open at the top");
    assert.ok(solid(top[0] + 3.5, top[1], -bt + 0.5), "the slot's edges hold the head");
    assert.ok(!solid(top[0] + 3.5, top[1], -bt + 3.0), "the channel's behind them");
    assert.ok(solid(...top, -bt + 5.0), "and closed behind that, in the boss");
  });
});

test("a simple frame is just the frame, with a hook hole, and the picture's plate snapping into it", () => {
  const design = frameDesign({ frame_type: "simple" });
  const kase = design.case("f");
  assert.deepEqual(kase.parts, ["f.frame", "f.picture"]);
  assert.deepEqual(design.problems(), []);
  const volumes = [];
  for (const frame_hook of [true, false]) {
    kase.frame_hook = frame_hook;
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, []);
      volumes.push(parts["f.frame"].volume_mm3);
      if (!frame_hook) return;
      // Put together (in the case frame): the frame's back is level with the plate's back the case's height behind it.
      const frame = shapes["f.frame"].transformed(lidMatrix(kase));
      const plate = shapes["f.picture"].transformed(lidMatrix(kase));
      near(frame.bounds()[4], 0.0, "the frame's back");
      near(plate.bounds()[4], 4.0, "the plate's back");
      near(frame.common(plate).Volume, 0.0, "the frame and the plate overlapping");
      // Its ridges reach in past the plate's edge, into the groove round it.
      const [x0, x1, y0, y1] = plate.bounds();
      const inside = kernel.makeBox(x1 - x0, y1 - y0, 0.2, [x0, y0, 4.9]);
      assert.ok(frame.common(inside).Volume > 0.1, "the ridges reach over the plate's edge");
      // The hook hole: in the back of the top rail, halfway along.
      const solid = (x, y, z) => frame.common(kernel.makeBox(0.4, 0.4, 0.2, [x - 0.2, y - 0.2, z])).Volume > 0.01;
      const rail = y1 + 0.15 + 6.0;
      assert.ok(!solid(75.0, rail - 1.5, 0.5) && !solid(75.0, rail - 1.5, 3.0), "the hole the head goes in through");
      assert.ok(solid(75.0 + 3.0, rail + 1.5, 0.5) && !solid(75.0 + 3.0, rail + 1.5, 3.0), "the slot's edges, and the channel behind");
    });
  }
  assert.ok(volumes[1] - volumes[0] > 100, "the hook hole takes something out");

  let problems = frameDesign({ frame_type: "simple", frame_width: 10.0 }).problems().map((p) => p[0]).join("\n");
  assert.match(problems, /too narrow \(10mm\) for its hook hole; make it at least 12mm/);
  const withDevice = frameDesign({ frame_type: "simple" });
  withDevice.placements.push(new Placement("hang", "KeyholeHanger", "f", { surface: "bottom", mount: "outside" }));
  withDevice.relayout();
  problems = withDevice.problems().map((p) => p[0]).join("\n");
  assert.match(problems, /hang: case f is a simple picture frame, which has no back/);
});

test("a frame's picture is the size asked for, whatever size the design's other cases are", () => {
  const design = new Design({ cases: [new CaseSpec("f", { style: "Frame", height: 6.0, wall_thickness: 2.0, min_width: 120.0, min_depth: 80.0 }),
    new CaseSpec("box", { style: "Square", height: 20.0, min_width: 250.0, min_depth: 200.0 })] });
  design.relayout();
  const [f, box] = design.cases;
  assert.deepEqual([f.width, f.depth], [120.0, 80.0]);
  assert.deepEqual([box.width, box.depth], [250.0, 200.0]);
  // The window: the plate (the wall thickness out from the inside) less the lip over its edges.
  const kase = cases.makeBox(f);
  const [x0, y0, x1, y1] = kase.window();
  assert.deepEqual([x1 - x0, y1 - y0], [120.0 + 2 * (2.0 - 5.0), 80.0 + 2 * (2.0 - 5.0)]);
});

test("the editor can ask a frame's picture's size, to match the frame's shape to it", async () => {
  const { createApi, folders } = await import("../lib/api.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const routes = createApi(folders(fs.mkdtempSync(path.join(os.tmpdir(), "tm-size-"))));
  const design = Design.load(new URL("../designs/picture_frame.json", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
  const body = { design: design.to_dict(), case: "frame", surface: "top" };
  const size = routes["POST /api/picture/size"]({ body });
  assert.ok(size.width > 0 && size.height > 0, JSON.stringify(size));
  body.surface = "bottom";
  assert.match(routes["POST /api/picture/size"]({ body }).problem, /no picture/);
});
