// Finding and naming a design's pictures in Node (lib/files-node.js): paths
// relative to the thingmaker folder, and paths from another computer.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import * as files from "../lib/files-node.js";

const overhead = path.join(files.root, "images", "overhead.png");

test("pictures are found where the design says, or in the thingmaker folder", () => {
  assert.equal(files.locate(overhead), overhead);
  assert.equal(files.locate("images/overhead.png"), path.resolve("images/overhead.png") === overhead
    ? "images/overhead.png" : overhead);
  assert.equal(files.locate("D:\\Somewhere\\else\\thingmaker\\images\\overhead.png"), overhead);
  assert.equal(files.locate("/home/pi/thingmaker/images/overhead.png"), overhead);
  assert.equal(files.locate("C:\\Pictures\\overhead.png"), overhead);
  assert.equal(files.locate("images/no_such_picture.png"), "images/no_such_picture.png");
  assert.equal(files.locate(""), "");
});

test("pictures in the thingmaker folder are named relative to it", () => {
  assert.equal(files.storedPath(overhead), "images/overhead.png");
  const outside = path.resolve(files.root, "..", "elsewhere", "x.png");
  assert.equal(files.storedPath(outside), outside);
});
