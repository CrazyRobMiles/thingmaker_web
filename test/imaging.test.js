// Picture handling and engraving outlines.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as engraving from "../lib/engraving.js";
import * as imaging from "../lib/imaging.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PICTURE = path.join(ROOT, "images", "camera_outline.png");

test("pictures read, resize and reduce to a few colours", () => {
  const img = imaging.flattenOnWhite(imaging.readImage(PICTURE));
  const small = imaging.resize(img, 40, 30);
  assert.equal(small.data.length, 40 * 30 * 3);
  const q = imaging.quantizeMedianCut(small, 3);
  const colours = new Set();
  for (let i = 0; i < 40 * 30; i++) colours.add(q.data.slice(3 * i, 3 * i + 3).join(","));
  assert.ok(colours.size <= 3);
});

test("k-means is repeatable", () => {
  const pixels = Float32Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? (i * 7) % 255 : (i * 13) % 255));
  const a = imaging.kmeans(pixels, 3);
  const b = imaging.kmeans(pixels, 3);
  assert.deepEqual(a.centres, b.centres);
  assert.deepEqual([...a.labels], [...b.labels]);
});

test("contours trace round a patch and close", () => {
  const grid = { width: 6, height: 6, data: new Float32Array(36).fill(255) };
  for (const i of [14, 15, 20, 21]) grid.data[i] = 0;
  const lines = imaging.contourLines(grid, 128);
  assert.equal(lines.length, 1);
  const line = lines[0];
  assert.deepEqual(line[0], line[line.length - 1]);
});

test("simplifying a polyline keeps its corners", () => {
  const square = [];
  for (let i = 0; i <= 10; i++) square.push([i, 0]);
  for (let i = 1; i <= 10; i++) square.push([10, i]);
  const simple = imaging.approxPolyDP(square, 0.3, false);
  assert.deepEqual(simple, [[0, 0], [10, 0], [10, 10]]);
});

test("text and pictures become rings to engrave", () => {
  if (engraving.DEFAULT_FONT) {
    const rings = engraving.textOutline("Hi", engraving.DEFAULT_FONT, 10.0);
    assert.ok(rings.length >= 2);
    const ys = rings.flat().map((p) => p[1]);
    assert.ok(Math.max(...ys) > 5 && Math.min(...ys) > -1, "letters stand on the baseline, y up");
  }
  const outline = engraving.imageOutline(PICTURE, 30.0);
  assert.ok(outline.length > 0);
  const [layers, size] = engraving.mosaicLayers(PICTURE, 30.0, 12, 2);
  assert.equal(size[0], 30.0);
  assert.ok(layers.length >= 1);
});
