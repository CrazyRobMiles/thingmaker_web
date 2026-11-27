// The Bambu Studio project Build writes (lib/bambu.js): each printed part an
// object on a plate of its own, its inlays parts of it in their filaments.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import * as bambu from "../lib/bambu.js";
import { build, buildParts, projectName } from "../lib/builder.js";
import { CaseSpec, Design, Placement } from "../lib/design.js";
import * as kernel from "../lib/kernel.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PICTURE = path.join(ROOT, "images", "camera_outline.png");
const quiet = () => {};

function decorated(extra = {}) {
  const design = new Design({ name: "Deck", cases: [new CaseSpec("main", { style: "Square", height: 20.0, min_width: 80, min_depth: 60,
    decorations: { front: { text: { text: "HELLO", size: 8.0, ...extra.text } }, bottom: { image: { file: PICTURE, ...extra.image } } } })] });
  design.placements.push(new Placement("s", "Stamp", "main", { surface: "top", mount: "outside",
    params: { stamp_height: 15.0, text_text: "S", text_size: 8.0, text_colour: "#c03030", ...extra.stamp } }));
  design.relayout();
  return design;
}

/** {files, parts: [{object, id, name, filament}], plates: [[object ids]], items, meshes: {id: [vertex count, triangles]}} of a project's bytes. */
function read(bytes) {
  const files = unzipSync(bytes);
  const settings = strFromU8(files["Metadata/model_settings.config"]);
  const parts = [];
  for (const o of settings.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)) {
    for (const p of o[2].matchAll(/<part id="(\d+)"[\s\S]*?key="name" value="([^"]+)"[\s\S]*?key="extruder" value="(\d+)"/g)) {
      parts.push({ object: Number(o[1]), id: Number(p[1]), name: p[2], filament: Number(p[3]) });
    }
  }
  const plates = [...settings.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => [...m[1].matchAll(/key="object_id" value="(\d+)"/g)].map((x) => Number(x[1])));
  const model = strFromU8(files["3D/3dmodel.model"]);
  const items = [...model.matchAll(/<item objectid="(\d+)"[^>]*transform="([^"]+)"/g)].map((m) => [Number(m[1]), m[2].split(" ").map(Number).slice(9)]);
  const meshes = {};
  for (const [name, data] of Object.entries(files)) {
    if (!name.startsWith("3D/Objects/")) continue;
    for (const o of strFromU8(data).split("<object ").slice(1)) {
      const tris = [...o.matchAll(/v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
      meshes[Number(o.match(/id="(\d+)"/)[1])] = [(o.match(/<vertex /g) || []).length, tris];
    }
  }
  return { files, parts, plates, items, meshes };
}

test("each printed part is an object on a plate of its own, made of it and its inlays, in place", () => {
  const design = decorated();
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const made = bambu.project(design, shapes);
    const { files, parts, plates, items, meshes } = read(made.bytes);
    assert.ok(files["[Content_Types].xml"] && files["_rels/.rels"] && files["3D/_rels/3dmodel.model.rels"]);
    // With printer and filament settings (without them, Bambu Studio takes it for an old project and loads one plate).
    const config = JSON.parse(strFromU8(files["Metadata/project_settings.config"]));
    assert.equal(config.printer_model, "Bambu Lab P1S");
    assert.equal(config.filament_colour.length, bambu.AMS_SLOTS);
    assert.equal(config.wipe_tower_x.length, 2);
    assert.match(strFromU8(files["3D/3dmodel.model"]), new RegExp(`<metadata name="Application">BambuStudio-${config.version}</metadata>`));
    // The base with its text, picture and stamp; the lid alone.
    const objectOf = Object.fromEntries(parts.map((p) => [p.name, p.object]));
    const base = parts.filter((p) => p.object === objectOf["main.base"]).map((p) => p.name).sort();
    assert.deepEqual(base, ["main.base", "main.base.deco.bottom.image", "main.base.deco.front.text"]);
    assert.deepEqual(parts.filter((p) => p.object === objectOf["main.lid"]).map((p) => p.name).sort(), ["main.lid", "main.lid.stamp.s.text"]);
    assert.deepEqual(made.plates.map((ps) => ps[0]).sort(), ["main.base", "main.lid"]);
    assert.deepEqual(plates.map((p) => p.length), [1, 1]);
    assert.notEqual(plates[0][0], plates[1][0]);
    // Each plate's object in the middle of its bed (the second plate to the right), resting on it.
    const plateOf = new Map(items.map(([id, at]) => [id, at]));
    const first = plateOf.get(plates[0][0]);
    const second = plateOf.get(plates[1][0]);
    assert.deepEqual(first.slice(0, 2), [128, 128]);
    assert.deepEqual(second.slice(0, 2), [128 + 307.2, 128]);
    // Every part's mesh closed: each edge in two triangles, running it opposite ways.
    for (const [id, [, tris]] of Object.entries(meshes)) {
      const edges = new Map();
      for (const t of tris) for (let k = 0; k < 3; k++) {
        const [a, b] = [t[k], t[(k + 1) % 3]];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        const e = edges.get(key) || [0, 0];
        e[a < b ? 0 : 1] += 1;
        edges.set(key, e);
      }
      assert.ok([...edges.values()].every(([f, b]) => f === 1 && b === 1), `mesh ${id} isn't closed`);
    }
    assert.equal(Object.keys(meshes).length, Object.keys(shapes).length);
  });
});

test("case parts are in filament 1 and inlays in one per colour, or the one their setting asks for", () => {
  let design = decorated();
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const f = bambu.filaments(design, Object.keys(shapes));
    assert.equal(f["main.base"], 1);
    assert.equal(f["main.lid"], 1);
    // The text and the picture both #202020: one filament; the stamp's red another.
    assert.equal(f["main.base.deco.front.text"], f["main.base.deco.bottom.image"]);
    assert.ok(f["main.base.deco.front.text"] >= 2);
    assert.notEqual(f["main.lid.stamp.s.text"], f["main.base.deco.front.text"]);
    assert.equal(bambu.project(design, shapes).warnings.length, 0);
  });
  design = decorated({ text: { filament: "3" }, image: { filament: "4" }, stamp: { text_filament: "2" } });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const { parts } = read(bambu.project(design, shapes).bytes);
    const f = Object.fromEntries(parts.map((p) => [p.name, p.filament]));
    assert.deepEqual([f["main.base"], f["main.base.deco.front.text"], f["main.base.deco.bottom.image"], f["main.lid.stamp.s.text"]], [1, 3, 4, 2]);
  });
  // More than an AMS holds is a warning; a setting that isn't numbers is an error.
  design = decorated({ text: { filament: "6" } });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    assert.match(bambu.project(design, shapes).warnings.join("\n"), /main\.base's plate uses filament 6: an AMS has 4/);
  });
  design = decorated({ text: { filament: "red" } });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    assert.throws(() => bambu.filaments(design, Object.keys(shapes)), /should be filament numbers/);
  });
});

test("a picture in several colours takes the filaments its setting lists, in turn", () => {
  const design = decorated({ image: { style: "posterise", columns: 16, colours: 3, leave_out: "none", filament: "5 6 7" } });
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    const f = bambu.filaments(design, Object.keys(shapes));
    const layers = Object.keys(shapes).filter((p) => p.startsWith("main.base.deco.bottom.image"));
    assert.ok(layers.length >= 2, layers.join(", "));
    for (const pid of layers) assert.equal(f[pid], 4 + Number(pid.slice(-1)), pid);
  });
});

test("Build writes the project beside the print STLs, and the manifest says what's on each plate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-bambu-"));
  const design = decorated();
  const manifest = build(design, dir, quiet);
  assert.equal(projectName(design), "Deck.3mf");
  assert.equal(manifest.project.file, "print/Deck.3mf");
  assert.ok(fs.existsSync(path.join(dir, "print", "Deck.3mf")));
  assert.equal(manifest.project.plates.length, 2);
  assert.equal(manifest.project.filaments["main.base"], 1);
  assert.equal(projectName({ name: 'a/b: "c"' }), "a_b_ _c_.3mf");
});

test("a part of hundreds of thousands of triangles (a big picture's) goes in the project", () => {
  kernel.scope(() => {
    // A plate rippled all over, so it stays that many triangles when it's tidied.
    const plate = kernel.makeBox(120.0, 120.0, 2.0).bent(([x, y, z]) => [x, y, z + 0.3 * Math.sin(x * 3) * Math.cos(y * 3)], 0.25);
    const design = new Design({ name: "Big", cases: [] });
    const made = bambu.project(design, { big: plate });
    const { meshes } = read(made.bytes);
    const [, tris] = Object.values(meshes)[0];
    assert.ok(tris.length > 200000, `${tris.length} triangles`);
  });
});
