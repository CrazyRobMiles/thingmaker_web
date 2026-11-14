// Snap-fit cases, and the devices round a flexible LED panel: the wordsearch
// faces and the LED arrays with light pipes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CaseSpec, Design, Placement, partInCaseMatrix } from "../lib/design.js";
import { buildParts, check } from "../lib/builder.js";
import * as kernel from "../lib/kernel.js";
import { transformed } from "../lib/meshes.js";
import { CLOCK_LETTERS, wordsearchRows } from "../lib/ledpanels.js";

const quiet = () => {};

/** The parts' overlaps where they sit in the design: ["a/b volume"...]. */
function overlaps(shapes, world) {
  const ids = Object.keys(shapes);
  const placed = Object.fromEntries(ids.map((p) => [p, transformed(shapes[p], world[p])]));
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = 0; j < i; j++) {
      const v = placed[ids[i]].common(placed[ids[j]]).Volume;
      if (v > 0.01) out.push(`${ids[i]}/${ids[j]} ${v.toFixed(2)}`);
    }
  }
  return out;
}

test("snap fit: kept in the file, no retaining screws, and ridges and grooves that don't touch", () => {
  const kase = new CaseSpec("c", { snap_fit: true });
  assert.equal(kase.to_dict().snap_fit, true);
  assert.equal(CaseSpec.from_dict(kase.to_dict()).snap_fit, true);
  assert.ok(!("snap_fit" in new CaseSpec("c").to_dict()));
  for (const style of ["Square", "MusicBox", "Rounded", "Bevelled"]) {
    for (const panels of [false, true]) {
      const design = new Design({ cases: [new CaseSpec("c", { style, snap_fit: true, panels, min_width: 70, min_depth: 50, height: 30,
        lid_height: 10, edge: 4 })] });
      design.relayout();
      assert.deepEqual(design.case_screw_frames(design.cases[0]), [], style);
      assert.deepEqual(design.problems(), [], style);
      kernel.scope(() => {
        const [shapes, world] = buildParts(design, { log: quiet });
        const [, problems] = check(design, shapes);
        assert.deepEqual(problems, [], style);
        assert.deepEqual(overlaps(shapes, world), [], `${style}${panels ? " panels" : ""}`);
        // The ridges are there: the lid is more than its plain shell.
        const plain = new Design({ cases: [new CaseSpec("c", { style, panels, min_width: 70, min_depth: 50, height: 30, lid_height: 10,
          edge: 4, screw_nuts: false })] });
        plain.relayout();
        plain.case_screw_frames = () => [];
        const [bare] = buildParts(plain, { log: quiet });
        const lid = design.cases[0].lid_part;
        assert.ok(shapes[lid].Volume > bare[lid].Volume + 10, style);
        const kase2 = design.cases[0];
        const base = kase2.base_parts.reduce((v, p) => v + shapes[p].Volume, 0);
        const bareBase = kase2.base_parts.reduce((v, p) => v + bare[p].Volume, 0);
        assert.ok(base < bareBase - 10, `${style}: the grooves`);
        assert.ok(partInCaseMatrix(kase2, lid));
      });
    }
  }
});

test("snap fit: thin walls and short lids are problems", () => {
  const thin = new Design({ cases: [new CaseSpec("c", { snap_fit: true, wall_thickness: 2.0 })] });
  assert.match(thin.problems()[0][0], /too thin for the snap fit's grooves; make them at least 2.7mm/);
  const short = new Design({ cases: [new CaseSpec("c", { snap_fit: true, lid_height: 2.0 })] });
  assert.match(short.problems()[0][0], /too short for the snap fit's ridges/);
});

test("a wordsearch's letters: rows of the same length", () => {
  assert.equal(wordsearchRows(CLOCK_LETTERS).length, 16);
  assert.ok(wordsearchRows(CLOCK_LETTERS).every((r) => r.length === 16));
  assert.deepEqual(wordsearchRows(" AB / CD "), [["A", "B"], ["C", "D"]]);
  assert.throws(() => wordsearchRows("ABC/DE"), /same number of letters/);
  assert.throws(() => wordsearchRows(" / "), /needs some letters/);
});

/** A snap-fit clock case with `type` on the inside of its lid, built. */
function clock(type, params = {}) {
  const design = new Design({ cases: [new CaseSpec("clock", { style: "Square", snap_fit: true, height: 20, lid_height: 10, lid_thickness: 2.0 })],
    placements: [new Placement("face", type, "clock", { surface: "top", mount: "inside", params })] });
  design.relayout();
  return design;
}

test("the wordsearch faces build as the clock's: letters, separator and frame", () => {
  for (const [type, letterSolids] of [["WordsearchThrough", 1], ["WordsearchObscured", 256]]) {
    const design = clock(type);
    assert.deepEqual(design.problems(), [], type);
    // The panel (160mm) and the pillars round it.
    assert.equal(design.cases[0].width, 176);
    kernel.scope(() => {
      const [shapes, world] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, [], type);
      assert.deepEqual(overlaps(shapes, world), [], type);
      assert.equal(parts["face.inlay"].solids, letterSolids, type);
      // The clock's separator: 160mm square, 1.5mm walls, 3mm high.
      assert.ok(Math.abs(parts["face.separator"].volume_mm3 - 21312) < 1, type);
      assert.equal(parts["face.frame"].solids, 1);
      assert.equal(parts["clock.lid"].solids, 1, type);
      if (type === "WordsearchThrough") {
        // The middles of A, B, D, O, P, Q and R, in the face's colour.
        assert.ok(parts["face.counters"].solids > 30);
        // The letters go right through: the face is a hole where they are.
        const b = shapes["face.inlay"].bounds();
        assert.ok(Math.abs(b[5] - b[4] - 2.5) < 1e-6, "2mm face and 0.5mm sheet");
      } else {
        assert.ok(!("face.counters" in parts));
      }
    });
  }
});

test("a wordsearch face can only go inside, and needs its letters in even rows", () => {
  const design = new Design({ cases: [new CaseSpec("c", {})],
    placements: [new Placement("f", "WordsearchObscured", "c", { surface: "top", mount: "outside" })] });
  design.relayout();
  assert.ok(design.problems().some((p) => /can only go on the inside/.test(p[0])));
  assert.throws(() => new Placement("f", "WordsearchObscured", "c", { surface: "top", params: { letters: "AB/C" } }).make(),
    /same number of letters/);
  // A smaller one: the case fits it.
  const small = clock("WordsearchObscured", { letters: "ABCD/EFGH" });
  assert.equal(small.cases[0].width, 56);
  assert.equal(small.cases[0].depth, 36);
});

test("the LED arrays: a dot and a light pipe over each LED", () => {
  for (const type of ["LEDArray16x16Round", "LEDArray16x16Square"]) {
    const design = clock(type);
    assert.deepEqual(design.problems(), [], type);
    kernel.scope(() => {
      const [shapes, world] = buildParts(design, { log: quiet });
      const [, problems] = check(design, shapes);
      assert.deepEqual(problems, [], type);
      assert.deepEqual(overlaps(shapes, world), [], type);
      // Over an LED (the middle of a square), a dot under a skin; between
      // them, the pipes' walls.
      const lid = shapes["clock.lid"].transformed(partInCaseMatrix(design.cases[0], "clock.lid"));
      const probe = (x, y, z0, z1) => lid.common(kernel.makeBox(0.2, 0.2, z1 - z0, [x - 0.1, y - 0.1, z0])).Volume;
      const kase = design.cases[0];
      const skin = probe(8 + 5, 8 + 5, kase.height + 1.25, kase.height + 1.95);
      const dot = probe(8 + 5, 8 + 5, kase.height - 2.9, kase.height + 1.1);
      const wall = probe(8 + 10, 8 + 10, kase.height - 2.9, kase.height - 0.1);
      assert.ok(skin > 0.02, `${type}: skin`);
      assert.ok(dot < 1e-6, `${type}: dot`);
      assert.ok(wall > 0.1 || type === "LEDArray16x16Round", `${type}: walls between the dots`);
    });
  }
  assert.throws(() => new Placement("a", "LEDArray16x16Round", "c", { surface: "top", params: { dot_size: 9 } }).make(), /don't fit/);
});
