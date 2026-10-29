// Building parts, the hinge check, STL files and templates.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, buildParts, check } from "../lib/builder.js";
import { Design } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";
import * as stl from "../lib/stl.js";
import { placementTemplate } from "../lib/template.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quiet = () => {};

test("the kernel's solids are exact, closed and measurable", () => {
  kernel.scope(() => {
    const box = kernel.makeBox(10, 10, 10).cut(kernel.makeCylinder(3, 20, [5, 5, -5]));
    assert.ok(box.isValid());
    // As the Python thingmaker measures it (manifold3d 3.5.4).
    assert.equal(box.Volume.toFixed(6), "719.623623");
    assert.equal(kernel.circleSegments(4), 32);
    assert.equal(box.Solids.length, 1);
  });
});

test("an STL file loads as a solid and writes back out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-"));
  const file = path.join(dir, "boxes.stl");
  stl.writeBoxes(file, [[0, 0, 0, 10, 20, 30], [20, 0, 0, 5, 5, 5]]);
  assert.deepEqual(stl.bounds(file), [0, 25, 0, 20, 0, 30]);
  kernel.scope(() => {
    const shape = kernel.loadStl(file);
    assert.equal(shape.Solids.length, 2);
    assert.ok(Math.abs(shape.Volume - (6000 + 125)) < 1e-6);
    const out = path.join(dir, "out.stl");
    kernel.writeStl(shape, out);
    assert.ok(Math.abs(kernel.loadStl(out).Volume - shape.Volume) < 1e-3);
  });
  fs.rmSync(dir, { recursive: true });
});

test("a hinged pair of cases builds into four single solids that open without touching", () => {
  const design = Design.load(path.join(ROOT, "designs", "hinge_test.json"));
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    assert.deepEqual(Object.keys(shapes).sort(), ["bottom.base", "bottom.lid", "top.base", "top.lid"]);
    const [parts, problems, sweeps] = check(design, shapes);
    assert.deepEqual(problems, []);
    for (const info of Object.values(parts)) {
      assert.equal(info.solids, 1);
      assert.ok(info.valid);
    }
    assert.ok(sweeps.hinge.every(([, overlap]) => overlap <= 0.01));
  });
});

test("a build writes print and assembled STLs, the design and a manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-"));
  const design = Design.load(path.join(ROOT, "designs", "example_board_case.json"));
  const manifest = build(design, dir, quiet);
  assert.deepEqual(manifest.problems, []);
  for (const pid of ["case.base", "case.lid"]) {
    assert.ok(fs.existsSync(path.join(dir, "print", `${pid}.stl`)));
    assert.ok(fs.existsSync(path.join(dir, "assembled", `${pid}.stl`)));
    assert.equal(manifest.parts[pid].solids, 1);
  }
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "design.json"), "utf8"));
  assert.equal(saved.name, design.name);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).parts["case.base"].volume_mm3 > 0);
  fs.rmSync(dir, { recursive: true });
});

test("a device's template is one thin plate", () => {
  const design = Design.load(path.join(ROOT, "designs", "pi3aplus_case.json"));
  kernel.scope(() => {
    const plate = placementTemplate(design, design.placements[0]);
    const b = plate.bounds();
    assert.equal(plate.Solids.length, 1);
    assert.ok(Math.abs(b[5] - b[4] - 0.5) < 1e-6);
  });
});
