// The web version's file access (lib/files-browser.js), on a stand-in for
// the File System Access API's handles.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as files from "../lib/files-browser.js";

class FakeFile {
  constructor(parent, name, data = new Uint8Array()) {
    this.kind = "file";
    this.name = name;
    this.data = data;
    this.time = 1000;
  }

  async getFile() {
    const data = this.data;
    return { lastModified: this.time, size: data.length, arrayBuffer: async () => data.slice().buffer };
  }

  async createWritable() {
    const chunks = [];
    return { write: async (d) => chunks.push(new Uint8Array(d)), close: async () => {
      this.data = chunks.length ? chunks[0] : new Uint8Array();
      this.time += 1;
    } };
  }
}

class FakeDir {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.children = new Map();
  }

  async *entries() {
    yield* this.children.entries();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    let h = this.children.get(name);
    if (!h && create) this.children.set(name, (h = new FakeDir(name)));
    if (!h || h.kind !== "directory") throw new DOMException(name, "NotFoundError");
    return h;
  }

  async getFileHandle(name, { create = false } = {}) {
    let h = this.children.get(name);
    if (!h && create) this.children.set(name, (h = new FakeFile(this, name)));
    if (!h || h.kind !== "file") throw new DOMException(name, "NotFoundError");
    return h;
  }

  async removeEntry(name) {
    this.children.delete(name);
  }
}

function folder() {
  const root = new FakeDir("thingmaker");
  const designs = new FakeDir("designs");
  designs.children.set("a.json", new FakeFile(designs, "a.json", new TextEncoder().encode('{"name": "A"}')));
  const images = new FakeDir("images");
  images.children.set("overhead.png", new FakeFile(images, "overhead.png", new Uint8Array([1, 2, 3])));
  root.children.set("designs", designs);
  root.children.set("images", images);
  return root;
}

test("paths are POSIX paths in the folder", () => {
  assert.equal(files.join("/designs", "a.json"), "/designs/a.json");
  assert.equal(files.join("a", "b"), "a/b");
  assert.equal(files.resolve("/designs", "../images/x.png"), "/images/x.png");
  assert.equal(files.dirname("/designs/a.json"), "/designs");
  assert.equal(files.basename("/designs/a.json", ".json"), "a");
  assert.equal(files.extname("x.tar.STL"), ".STL");
  assert.equal(files.relative("/output/x", "/output/x/print/p.stl"), "print/p.stl");
  assert.equal(files.normalize("//a//b/../c"), "/a/c");
});

test("files are read once loaded, and only then", async () => {
  const root = folder();
  files.mount(root);
  await files.loadDir("/");
  assert.ok(files.isDir("/designs"));
  assert.throws(() => files.readText("/designs/a.json"), /no such file/);
  await files.loadDir("/designs");
  assert.ok(files.isFile("/designs/a.json"));
  assert.throws(() => files.readText("/designs/a.json"), /hasn't been read/);
  assert.ok(await files.loadFile("/designs/a.json"));
  assert.equal(files.readText("/designs/a.json"), '{"name": "A"}');
  assert.equal(await files.loadFile("/designs/none.json"), false);
  assert.equal(files.exists("/designs/none.json"), false);
  await files.loadDir("/designs");
  assert.deepEqual(files.readdir("/designs"), [{ name: "a.json", dir: false }]);
});

test("writes change the copy at once and the folder on flush", async () => {
  const root = folder();
  files.mount(root);
  await files.loadDir("/");
  files.writeFile("/output/x/print/p.stl", new Uint8Array([9, 9]));
  assert.deepEqual([...files.readFile("/output/x/print/p.stl")], [9, 9]);
  assert.ok(!root.children.has("output"));
  await files.flush();
  const p = (await (await (await (await root.getDirectoryHandle("output")).getDirectoryHandle("x")).getDirectoryHandle("print")).getFileHandle("p.stl"));
  assert.deepEqual([...p.data], [9, 9]);
  files.unlink("/output/x/print/p.stl");
  assert.equal(files.exists("/output/x/print/p.stl"), false);
  await files.flush();
  assert.equal((await (await (await root.getDirectoryHandle("output")).getDirectoryHandle("x")).getDirectoryHandle("print")).children.size, 0);
});

test("a design's picture is found in the folder, wherever its path came from", async () => {
  files.mount(folder());
  await files.loadDir("/");
  assert.equal(await files.loadPicture("D:\\GitHub\\thingmaker\\images\\overhead.png"), "/images/overhead.png");
  assert.equal(files.locate("D:\\GitHub\\thingmaker\\images\\overhead.png"), "/images/overhead.png");
  assert.equal(await files.loadPicture("images/overhead.png"), "/images/overhead.png");
  assert.equal(await files.loadPicture("/home/me/pictures/overhead.png"), "/images/overhead.png");
  assert.equal(await files.loadPicture("C:/elsewhere/none.png"), null);
  assert.equal(files.locate("C:/elsewhere/none.png"), "C:/elsewhere/none.png");
});
