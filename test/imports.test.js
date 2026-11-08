// Bringing designs, pictures and subassemblies into a thingmaker folder
// (lib/imports.js), on a folder made for the test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createApi, folders } from "../lib/api.js";
import * as catalogue from "../lib/catalogue.js";
import * as imports from "../lib/imports.js";

const REPO = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-imports-"));
const where = { ...folders(tmp), subassemblies: path.join(tmp, "subassemblies") };

/** A subassembly folder's files, as the web page sends them. */
function folderFiles(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir)) out[name] = new Uint8Array(fs.readFileSync(path.join(dir, name)));
  return out;
}

test("a file kept twice is kept once; a different one of its name goes alongside", () => {
  const a = new Uint8Array([1, 2, 3]);
  const first = imports.keepFile(where.images, "pic.png", a);
  assert.equal(first, path.join(where.images, "pic.png"));
  assert.equal(imports.keepFile(where.images, "pic.png", a), first);
  assert.equal(imports.keepFile(where.images, "pic.png", new Uint8Array([9])), path.join(where.images, "pic_2.png"));
  assert.equal(imports.keepFile(where.images, "C:\\x\\..\\odd name?.png", a), path.join(where.images, "odd name_.png"));
});

test("a subassembly is copied in, and not over a different one unless asked", () => {
  const contents = folderFiles(path.join(REPO, "subassemblies", "ExampleBoard"));
  assert.deepEqual(imports.importSubassembly(where, contents), { name: "ExampleBoard", status: "added" });
  assert.ok("ExampleBoard" in catalogue.CATALOG);
  assert.equal(imports.importSubassembly(where, contents).status, "same");
  const changed = { ...contents, "mock.stl": folderFiles(path.join(REPO, "subassemblies", "NumKeyboard"))["mock.stl"] };
  assert.equal(imports.importSubassembly(where, changed).status, "different");
  assert.ok(Buffer.from(contents["mock.stl"]).equals(fs.readFileSync(path.join(where.subassemblies, "ExampleBoard", "mock.stl"))));
  assert.equal(imports.importSubassembly(where, changed, { replace: true }).status, "replaced");
});

test("a broken subassembly isn't left behind, and can't reach outside its folder", () => {
  const spec = (o) => new TextEncoder().encode(JSON.stringify({ format: "thingmaker-subassembly", version: 1, ...o }));
  assert.throws(() => imports.importSubassembly(where, { "subassembly.json": spec({ name: "Broken", mock: "mock.stl" }) }),
    /Broken can't be used/);
  assert.ok(!fs.existsSync(path.join(where.subassemblies, "Broken", "subassembly.json")));
  assert.throws(() => imports.importSubassembly(where, { "subassembly.json": spec({ name: "Sneaky", mock: "m.stl" }),
    "../../designs/x.json": new Uint8Array([1]) }), /isn't a file in its folder/);
  assert.throws(() => imports.importSubassembly(where, { "readme.txt": new Uint8Array([1]) }), /no subassembly.json/);
  assert.throws(() => imports.importSubassembly(where, { "subassembly.json": spec({ name: "PI4Landscape", mock: "m.stl" }) }),
    /built-in device/);
});

test("a design comes in with the pictures it was given, named relative to the folder", () => {
  const design = JSON.parse(fs.readFileSync(path.join(REPO, "designs", "picturebox.json"), "utf8"));
  const kase = design.cases[0];
  const face = Object.keys(kase.decorations)[0];
  kase.decorations[face].image.file = "E:\\Someone else's\\camera.png";
  assert.deepEqual(imports.needs(design).pictures, [{ file: "E:\\Someone else's\\camera.png", found: null }]);
  const missing = { ...design, subassemblies: [{ ...(design.devices || [])[0], type: "NotHereYet" }] };
  assert.deepEqual(imports.missingTypes(missing), ["NotHereYet"]);

  const bytes = new Uint8Array(fs.readFileSync(path.join(REPO, "images", "camera_outline.png")));
  const file = imports.importDesign(where, design, { name: "picturebox.json",
    pictures: { "E:\\Someone else's\\camera.png": { name: "camera.png", bytes } } });
  assert.equal(file, path.join(where.designs, "picturebox.json"));
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(path.resolve(REPO, saved.cases[0].decorations[face].image.file), path.join(where.images, "camera.png"));
  // Again: a second design, the same picture.
  const again = imports.importDesign(where, design, { name: "picturebox",
    pictures: { "E:\\Someone else's\\camera.png": { name: "camera.png", bytes } } });
  assert.equal(again, path.join(where.designs, "picturebox_2.json"));
  assert.deepEqual(fs.readdirSync(where.images).filter((n) => n.startsWith("camera")), ["camera.png"]);
  assert.throws(() => imports.readDesign("{}"), /isn't a thingmaker design/);
});

test("a new design starts empty, or with one empty case", async () => {
  const routes = createApi(folders(fs.mkdtempSync(path.join(os.tmpdir(), "tm-new-"))));
  assert.deepEqual(routes["POST /api/new"]({ body: { name: "x" } }).design.cases, []);
  const [kase] = routes["POST /api/new"]({ body: { name: "x", withCase: true } }).design.cases;
  assert.equal(kase.id, "case1");
});
