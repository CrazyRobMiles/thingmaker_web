// Pictures in several colours: the colours found in a picture, which
// filament each is printed in (a palette and a mapping), the fill style, and
// the editor's preview.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { encode } from "fast-png";
import { buildParts } from "../lib/builder.js";
import * as decoration from "../lib/decoration.js";
import { CaseSpec, Design, DesignError, surface } from "../lib/design.js";
import * as engraving from "../lib/engraving.js";
import * as geom from "../lib/geom.js";
import * as kernel from "../lib/kernel.js";

const quiet = () => {};
const [W, H] = [300, 200];

// A picture 300 x 200 pixels: white, with a black bar across the bottom, a
// red disc on the left and a blue square on the right.
const PICTURE = (() => {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let rgb = [255, 255, 255];
      if (y >= 170) rgb = [0, 0, 0];
      else if ((x - 80) ** 2 + (y - 80) ** 2 < 50 ** 2) rgb = [220, 30, 30];
      else if (x >= 170 && x < 270 && y >= 30 && y < 130) rgb = [30, 50, 200];
      data.set(rgb, 3 * (y * W + x));
    }
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "thingmaker-colours-")), "shapes.png");
  fs.writeFileSync(file, encode({ width: W, height: H, data, channels: 3, depth: 8 }));
  return file;
})();

// As fractions of the picture: the bar, the disc and the square.
const BAR = 30 / H;
const DISC = (Math.PI * 50 ** 2) / (W * H);
const SQUARE = (100 * 100) / (W * H);

const near = (a, b, within, what) => assert.ok(Math.abs(a - b) <= within, `${what}: ${a} isn't ${b} (within ${within})`);
const close = (rgb, want, what) => rgb.forEach((v, i) => near(v, want[i], 12, `${what} [${i}]`));

/** Map {filament number: [rgb, fraction of the picture]} of fillLayers(),
in its order. */
function filled(options = {}, leaveOut = "none") {
  const [layers, [w, h]] = engraving.fillLayers(PICTURE, 60.0, 4, 0.3, leaveOut, 0.0, options);
  near(w, 60.0, 1e-9, "width");
  near(h, 40.0, 0.2, "height (a whole number of pixels)");
  return kernel.scope(() => new Map(layers.map(([n, rgb, rings]) =>
    [n, [rgb, kernel.Section.fromRings(rings, "EvenOdd").area() / (w * h)]])));
}

test("a picture's colours are found darkest first, the same at any size", () => {
  const found = engraving.pictureColours(PICTURE, 4);
  assert.equal(found.length, 4);
  close(found[0], [0, 0, 0], "black");
  close(found[1], [30, 50, 200], "blue");
  close(found[2], [220, 30, 30], "red");
  close(found[3], [255, 255, 255], "white");
});

test("a filled picture is patches of its colours, fitting together with no gaps", () => {
  const layers = filled();
  assert.deepEqual([...layers.keys()], [1, 2, 3, 4]);
  near(layers.get(1)[1], BAR, 0.01, "the bar");
  near(layers.get(2)[1], SQUARE, 0.01, "the square");
  near(layers.get(3)[1], DISC, 0.01, "the disc");
  near([...layers.values()].reduce((t, [, a]) => t + a, 0), 1.0, 1e-6, "all of them");
  // Leaving the lightest out: the background isn't printed, the rest are.
  const out = filled({}, "lightest");
  assert.deepEqual([...out.keys()], [1, 2, 3]);
  near(out.get(3)[1], DISC, 0.01, "the disc, the background left out");
});

test("a palette prints each colour in the nearest filament, and a mapping says which outright", () => {
  // Black, white and red filaments: the blue square comes out black.
  let layers = filled({ palette: "#101010 #f0f0f0, #c03030" });
  assert.deepEqual([...layers.keys()], [1, 3, 2], "darkest first, numbered as in the palette");
  assert.deepEqual(layers.get(1)[0], [16, 16, 16]);
  near(layers.get(1)[1], BAR + SQUARE, 0.015, "the bar and the square, in black");
  near(layers.get(3)[1], DISC, 0.01, "the disc, in red");
  // The found colours are black, blue, red, white: the square goes red, the
  // disc's left out, and the background is the default (the nearest: white).
  layers = filled({ palette: "#101010 #f0f0f0 #c03030", mapping: "1 3 - *" });
  near(layers.get(3)[1], SQUARE, 0.01, "the square, in red");
  near(layers.get(2)[1], 1 - BAR - SQUARE - DISC, 0.015, "the background, round the disc that's left out");
  // With no palette, the filaments are the picture's own colours.
  layers = filled({ mapping: "1 1" });
  assert.deepEqual([...layers.keys()], [1, 3, 4]);
  near(layers.get(1)[1], BAR + SQUARE, 0.015, "the square in the bar's colour");

  assert.throws(() => filled({ palette: "#101010 red" }), /'red' isn't a colour/);
  assert.throws(() => filled({ palette: "#101010", mapping: "1 2" }), /no filament 2 \(the palette has 1\)/);
  assert.throws(() => filled({ mapping: "1 x" }), /'x' isn't a filament's number/);
  assert.throws(() => new CaseSpec("c", { decorations: { top: { image: { file: "a.png", mapping: "0" } } } }), DesignError);
});

test("a mosaic and a vector picture are printed in the filaments their colours are mapped to", () => {
  const [mosaic] = engraving.mosaicLayers(PICTURE, 60.0, 30, 4, "mosaic", 0.2, "none", false, 0.0,
    { palette: "#000000 #ffffff #ff0000" });
  assert.deepEqual(mosaic.map(([n]) => n), [1, 3, 2]);
  const [vector] = engraving.vectorLayers(PICTURE, 60.0, 4, "outlines", 0.8, 0.3, "none", 0.0, { mapping: "1 1 2" });
  // The background (white) gets no lines; blue's are in black.
  assert.deepEqual(vector.map(([n]) => n), [1, 2]);
});

test("a picture's colours are shown in the editor as they'll be printed", () => {
  const image = { ...decoration.defaults("image"), file: PICTURE, style: "fill", palette: "#101010 #f0f0f0 #c03030",
    mapping: "* * -" };
  const preview = engraving.colourPreview(PICTURE, image);
  assert.equal(preview.found.length, 4);
  assert.deepEqual(preview.filaments, ["#101010", "#f0f0f0", "#c03030"]);
  assert.deepEqual(preview.assign, [0, 0, -1, 1]);
  assert.deepEqual(preview.explicit, [false, false, true, false]);
  assert.deepEqual([preview.result.width, preview.result.height], [160, 107]);
  const rgba = Buffer.from(preview.result.rgba, "base64");
  assert.equal(rgba.length, 160 * 107 * 4);
  const at = (x, y) => [...rgba.subarray(4 * (y * 160 + x), 4 * (y * 160 + x) + 4)];
  assert.deepEqual(at(43, 43), [0, 0, 0, 0], "the disc, left out");
  assert.deepEqual(at(117, 43), [16, 16, 16, 255], "the square, in black");
  assert.equal(engraving.colourPreview(PICTURE, { ...image, style: "outline" }), null);
  // A mosaic's preview is its cells.
  const mosaic = engraving.colourPreview(PICTURE, { ...image, style: "mosaic", columns: 24, palette: "", mapping: "" });
  assert.deepEqual([mosaic.result.width, mosaic.result.height], [24, 16]);
});

test("a filled picture on a lid is inlaid, a part for each filament", () => {
  const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 20.0, min_width: 60, min_depth: 40,
    decorations: { top: { image: { file: PICTURE, style: "fill", detail: 0.5, palette: "#101010 #f0f0f0 #c03030" } } } })] });
  design.relayout();
  const kase = design.case("case");
  const [layers, problems] = kernel.scope(() => decoration.faceLayers(kase, surface(kase, "top", "outside"), kase.decorations.top));
  assert.deepEqual(problems, []);
  assert.deepEqual(layers.map(([name]) => name), ["image1", "image3", "image2"]);
  kernel.scope(() => {
    const [shapes] = buildParts(design, { log: quiet });
    for (const n of [1, 2, 3]) assert.ok(shapes[`case.lid.deco.top.image${n}`], `filament ${n}'s inlay`);
  });
});

test("a picture on the lid reads the right way up from the front, as on the walls", () => {
  let still = null;
  for (const [name, across, up, turn] of [["top", 0, 0, 0], ["front", 0, 0, 0], ["top", 0, 0, 90], ["top", 10, 5, 0]]) {
    const design = new Design({ cases: [new CaseSpec("case", { style: "Square", height: 30.0, min_width: 90, min_depth: 60,
      decorations: { [name]: { image: { file: PICTURE, style: "fill", detail: 0.5, across, up, angle: turn } } } })] });
    design.relayout();
    const kase = design.case("case");
    const surf = surface(kase, name, "outside");
    // Where each colour's middle is in the case: [x, y, z].
    const where = Object.fromEntries(kernel.scope(() => decoration.faceLayers(kase, surf, kase.decorations[name])[0].map(([n, , s]) => {
      const b = s.bounds();
      return [n, geom.applyPoint(surf.case_matrix, [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0])];
    })));
    const [bar, square, disc] = [where.image1, where.image2, where.image3];
    const what = `on the ${name}, ${across} across, ${up} up, turned ${turn}`;
    if (name === "front") {
      assert.ok(disc[0] < square[0] && bar[2] < disc[2], `${what}: the disc on the left, the bar at the bottom`);
    } else if (turn) {
      // Turned a quarter anticlockwise: the bar on the right.
      assert.ok(bar[0] > disc[0] && disc[1] < square[1], `${what}: the bar on the right, the disc in front of the square`);
    } else if (across) {
      near(disc[0] - still[0], 10, 0.5, `${what}: moved right`);
      near(disc[1] - still[1], 5, 0.5, `${what}: moved back`);
    } else {
      assert.ok(disc[0] < square[0] && bar[1] < disc[1], `${what}: the disc on the left, the bar at the front`);
      still = disc;
    }
  }
});

test("a posterised picture is square pixels in colours found by median cut, dithered or not", () => {
  // A grey ramp from black to white, left to right.
  const [w, h] = [64, 16];
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill(Math.round((x * 255) / (w - 1)), 3 * (y * w + x), 3 * (y * w + x) + 3);
  const ramp = path.join(path.dirname(PICTURE), "ramp.png");
  fs.writeFileSync(ramp, encode({ width: w, height: h, data, channels: 3, depth: 8 }));
  const cells = (dither) => {
    const p = engraving.colourPreview(ramp, { ...decoration.defaults("image"), style: "posterise", columns: 32, colours: 2,
      dither: dither ? "yes" : "no" });
    const rgba = Buffer.from(p.result.rgba, "base64");
    const row = (y) => [...Array(32).keys()].map((x) => rgba[4 * (y * 32 + x)]);
    return [p, row(3), row(4)];
  };
  // Two colours, dark and light: plain, the left half's dark and the right half's light.
  const [plain, row] = cells(false);
  assert.equal(plain.found.length, 2);
  assert.deepEqual([plain.result.width, plain.result.height], [32, 8]);
  const changes = (r) => r.filter((v, i) => i && v !== r[i - 1]).length;
  assert.equal(changes(row), 1, "one change, half way");
  // Dithered, they're mixed: more of the light one further right.
  const [, a, b] = cells(true);
  assert.ok(changes(a) > 6, `${changes(a)} changes dithered`);
  const light = (r, from, to) => r.slice(from, to).filter((v) => v > 128).length;
  assert.ok(light(a, 0, 8) + light(b, 0, 8) < light(a, 24, 32) + light(b, 24, 32), "lighter to the right");
  // Built: a part for each colour, the pixels in runs.
  const [layers, size] = engraving.mosaicLayers(ramp, 64.0, 32, 2, "posterise", 0.2, "none", true);
  assert.deepEqual(layers.map(([n]) => n), [1, 2]);
  near(size[1], 16.0, 1e-9, "its height: 8 pixels of 2mm");
});
