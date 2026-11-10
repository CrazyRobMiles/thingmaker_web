// The devices described as data (lib/library.js): each one loads, builds into
// a case, and still matches the boxmaker device it was ported from
// (tools/boxmaker/records/).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildParts, check } from "../lib/builder.js";
import * as catalogue from "../lib/catalogue.js";
import * as devices from "../lib/devices.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";
import { defineDevice, DEFINITIONS, expandOpenings } from "../lib/library.js";
import { recognise } from "../tools/boxmaker/recognise.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const quiet = () => {};
const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} isn't ${b}`);

test("every definition is in the catalogue, with its settings and connectors", () => {
  for (const def of DEFINITIONS) {
    const cls = catalogue.CATALOG[def.type];
    assert.ok(cls, `${def.type} isn't in the catalogue`);
    assert.equal(catalogue.kindOf(def.type), "device");
    assert.deepEqual(Object.keys(cls.CONNECTORS_TABLE), Object.keys(def.connectors || {}));
    const device = catalogue.make(def.type, "d");
    assert.ok(device.body_boxes().length > 0);
    assert.equal(device.connector_cuts().length, Object.keys(def.connectors || {}).length);
  }
});

test("every definition ported from boxmaker still has boxmaker's pillars and openings", () => {
  for (const def of DEFINITIONS.filter((d) => d.source && d.source.record)) {
    const found = recognise(JSON.parse(fs.readFileSync(path.join(ROOT, def.source.record), "utf8")));
    const mine = def.pillars || { at: [] };
    assert.equal(mine.at.length, found.pillars.at.length, `${def.type}: number of pillars`);
    if (mine.at.length) {
      close(mine.radius, found.pillars.radius, `${def.type}: pillar radius`);
      close(mine.height, found.pillars.height, `${def.type}: pillar height`);
      if (found.pillars.holeRadius !== undefined) close(mine.holeRadius, found.pillars.holeRadius, `${def.type}: hole radius`);
      close(mine.holeBelow ?? 0, found.pillars.holeBelow ?? 0, `${def.type}: screw hole below the pillars`);
      mine.at.forEach(([x, y], i) => {
        close(x, found.pillars.at[i][0], `${def.type}: pillar ${i} x`);
        close(y, found.pillars.at[i][1], `${def.type}: pillar ${i} y`);
      });
    }
    // The same holes, in any order (a ring's are worked out, so to within a micron or so).
    const mm = (v) => Math.round(v * 1000);
    const key = (o) => JSON.stringify([o.circle ? "circle" : "box", o.skin ?? null, o.depth ?? null, o.pipe || null, o.throughPillars || false]);
    const sorted = (list) => list.map((o) => ({ ...o, at: o.circle || o.box }))
      .sort((a, b) => key(a).localeCompare(key(b)) || mm(a.at[0]) - mm(b.at[0]) || mm(a.at[1]) - mm(b.at[1]));
    const mineOpenings = sorted(expandOpenings(def.openings).filter((o) => !o.byHand).map(({ description, ...o }) => o));
    const theirs = sorted(found.openings);
    assert.equal(mineOpenings.length, theirs.length, `${def.type}: number of openings`);
    mineOpenings.forEach((o, i) => {
      assert.equal(key(o), key(theirs[i]), `${def.type}: opening ${i}`);
      o.at.forEach((v, k) => assert.ok(Math.abs(v - theirs[i].at[k]) < 1e-4, `${def.type}: opening ${i}: ${o.at} isn't ${theirs[i].at}`));
    });
    assert.deepEqual(def.blocks || [], found.blocks, `${def.type}: blocks`);
  }
});

test("a Pico builds into a case, its USB socket opening the front wall", () => {
  const volumes = [];
  for (const usb of [false, true]) {
    const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 25.0 })] });
    design.placements.push(new Placement("pico", "Pico", "case", { connector_cuts: { usb } }));
    design.relayout();
    kernel.scope(() => {
      const [shapes] = buildParts(design, { log: quiet });
      const [parts, problems] = check(design, shapes);
      assert.deepEqual(problems, []);
      assert.equal(parts["case.base"].solids, 1);
      assert.ok(parts["case.base"].valid);
      volumes.push(parts["case.base"].volume_mm3);
    });
  }
  // The opening: a little over 14 x 8.8mm (the socket and 3mm all round) through a 2mm wall, and more.
  assert.ok(volumes[0] - volumes[1] > 14 * 8.8 * 2 * 0.9, `the USB cut took ${volumes[0] - volumes[1]}mm3`);
});

test("a speaker and a ring of light pipes build into a lid, through it", () => {
  for (const type of ["SmallSpeaker", "PixelRingLightPipes"]) {
    const volumes = [];
    for (const placed of [false, true]) {
      const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 25.0, min_width: 70, min_depth: 70 })] });
      if (placed) design.placements.push(new Placement("d", type, "case", { surface: "top", mount: "inside" }));
      design.relayout();
      kernel.scope(() => {
        const [shapes] = buildParts(design, { log: quiet });
        const [parts, problems] = check(design, shapes);
        assert.deepEqual(problems, [], type);
        assert.equal(parts["case.lid"].solids, 1, type);
        assert.ok(parts["case.lid"].valid, type);
        volumes.push(parts["case.lid"].volume_mm3);
      });
    }
    assert.notEqual(volumes[0], volumes[1], `${type} changed nothing`);
  }
});

test("every device has a category, and the editor lists them by category, then name", async () => {
  const { meta } = await import("../lib/view.js");
  const m = meta();
  const order = m.categories.map(([c]) => c);
  for (const name of m.devices) assert.ok(order.includes(m.types[name].category), `${name}: ${m.types[name].category}`);
  const keys = m.devices.map((n) => [order.indexOf(m.types[n].category), m.types[n].displayName]);
  const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  assert.deepEqual(keys, sorted);
  assert.equal(m.types.Pico.category, "cpu");
  assert.equal(m.types.SmallSpeaker.category, "sound");
  assert.equal(m.types.PixelRingLightPipes.category, "light");
  assert.equal(m.types.M5StackKB2.category, "button");
});

test("every definition builds into a case, on the floor and on the lid, as one valid solid", () => {
  for (const def of DEFINITIONS) {
    for (const surface of ["bottom", "top"]) {
      const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 45.0 })] });
      design.placements.push(new Placement("d", def.type, "case", { surface, mount: "inside" }));
      design.relayout();
      kernel.scope(() => {
        const [shapes] = buildParts(design, { log: quiet });
        const [parts, problems] = check(design, shapes);
        const what = `${def.type} on the ${surface}`;
        assert.deepEqual(problems, [], what);
        for (const part of ["case.base", "case.lid"]) {
          assert.equal(parts[part].solids, 1, `${what}: ${part}`);
          assert.ok(parts[part].valid, `${what}: ${part}`);
        }
      });
    }
  }
});

test("the small speaker has a rim round it, up to its frame", () => {
  const def = DEFINITIONS.find((d) => d.type === "SmallSpeaker");
  kernel.scope(() => {
    const volume = (cls, options) => new cls("s", options).get_fuser(0, 0, 2).Volume;
    const rim = (options) => volume(catalogue.CATALOG.SmallSpeaker, options) - volume(defineDevice({ ...def, rims: [] }), options);
    // A tube 19.5mm inside, 1mm thick, from the outside face (2mm down) up to the pillars' tops - touching the pillars.
    assert.ok(Math.abs(rim() - Math.PI * (20.5 ** 2 - 19.5 ** 2) * 4) < 2, `${rim()}`);
    assert.ok(Math.abs(rim({ pillarHeight: 3 }) - Math.PI * (20.5 ** 2 - 19.5 ** 2) * 5) < 2, `${rim({ pillarHeight: 3 })}`);
  });
});

test("every device's pillars have open screw holes", () => {
  // A hole ending exactly at its pillar's top could be sealed over, and the bubble left filled in.
  const { applyFuserCutter, buildGeometry, PillarSupportedDevice, PillarType } = devices;
  for (const [type, cls] of Object.entries(catalogue.CATALOG)) {
    if (!(cls.prototype instanceof PillarSupportedDevice)) continue;
    kernel.scope(() => {
      const item = catalogue.make(type, "d");
      if (item.pillarType === PillarType.SOLID || !item.holeRadius) return;
      const positions = item._pillarPositions(0, 0);
      if (!positions.length) return;
      const [fuser, cutter] = buildGeometry(item, 0, 0, 2);
      const shape = applyFuserCutter(kernel.makeBox(400, 400, 2, [-150, -150, -2]), fuser, cutter);
      assert.ok(shape.Solids.every((p) => p.Volume > 0), `${type}: a sealed hole`);
      for (const [x, y] of positions) {
        const probe = kernel.makeCylinder(item.holeRadius * 0.8, item.pillarHeight * 0.8, [x, y, item.pillarHeight * 0.1]);
        assert.ok(shape.common(probe).Volume < 0.01, `${type}: the pillar at ${x}, ${y} has no hole`);
      }
    });
  }
});
