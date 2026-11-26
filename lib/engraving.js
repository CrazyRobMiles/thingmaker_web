/* Outlines to engrave: text in any installed TrueType/OpenType font, and
pictures (the dark parts, or the light ones; a mosaic; or the lines in them).
Each comes back as a list of closed rings of [x, y] points in mm, holes
included, to be filled with the even-odd rule. */
import * as files from "#files";
import opentype from "opentype.js";
import { Section, scope } from "./kernel.js";
import * as imaging from "./imaging.js";
import { radians, repr, roundInt } from "./numbers.js";

// The system's fonts and the thingmaker folder's fonts/ (in a web page, just fonts/).
export const FONT_DIRS = files.fontDirs();
const CURVE_STEPS = 8; // points along each curved stretch of a letter

function findFonts(folder, found) {
  let entries;
  try {
    entries = files.readdir(folder);
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = files.join(folder, entry.name);
    if (entry.dir) findFonts(full, found);
    else if (/\.(ttf|otf)$/i.test(entry.name)) {
      const name = entry.name.replace(/\.[^.]+$/, "").toLowerCase();
      if (!(name in found)) found[name] = full;
    }
  }
}

// The free fonts in fonts/ that stand in for Windows' when they aren't
// installed: the same widths, letter for letter, so text lays out the same.
const STAND_INS = {
  arial: "liberationsans-regular", arialbd: "liberationsans-bold", ariali: "liberationsans-italic",
  arialbi: "liberationsans-bolditalic",
  times: "liberationserif-regular", timesbd: "liberationserif-bold", timesi: "liberationserif-italic",
  timesbi: "liberationserif-bolditalic",
  cour: "liberationmono-regular", courbd: "liberationmono-bold", couri: "liberationmono-italic",
  courbi: "liberationmono-bolditalic",
};

/** {name: path} of every installed font - name being the font file's name
without its extension (e.g. "arial", "arialbd"). Arial, Times New Roman and
Courier New are there even if they aren't installed, if their stand-ins are. */
export function fonts() {
  const found = {};
  for (const folder of FONT_DIRS) if (folder && files.isDir(folder)) findFonts(folder, found);
  for (const [name, standIn] of Object.entries(STAND_INS)) if (!(name in found) && standIn in found) found[name] = found[standIn];
  const out = {};
  for (const name of Object.keys(found).sort()) out[name] = found[name];
  return out;
}

export const FONTS = fonts();
export const DEFAULT_FONT = "arial" in FONTS ? "arial" : Object.keys(FONTS)[0] || "";

function turn(rings, angle) {
  if (!angle) return rings;
  const c = Math.cos(radians(angle));
  const s = Math.sin(radians(angle));
  return rings.map((ring) => ring.map(([x, y]) => [x * c - y * s, x * s + y * c]));
}

const outlineCache = new Map();

/** make() - remembered by key, as layout makes devices over and over. */
function cached(key, make) {
  if (!outlineCache.has(key)) {
    if (outlineCache.size > 200) outlineCache.clear();
    outlineCache.set(key, make());
  }
  return outlineCache.get(key).map((ring) => ring.map((p) => [p[0], p[1]]));
}

const loadedFonts = new Map();

function loadFont(file) {
  const key = `${file}|${files.stat(file).mtimeMs}`;
  if (!loadedFonts.has(key)) {
    const buf = files.readFile(file);
    loadedFonts.set(key, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return loadedFonts.get(key);
}

/** `text` in `font` (a name from fonts(), or a font file's path), `size` mm
from one line to the next, turned `angle` degrees anticlockwise. */
export function textOutline(text, font = DEFAULT_FONT, size = 10.0, angle = 0.0) {
  return cached(JSON.stringify(["text", text, font, Number(size), Number(angle)]), () => _textOutline(text, font, size, angle));
}

function _textOutline(text, font, size, angle) {
  const file = FONTS[font.toLowerCase()] || font;
  if (!file || !files.isFile(file)) {
    if (!Object.keys(FONTS).length) throw new Error("no fonts to engrave it with (put some in the thingmaker folder's fonts/)");
    throw new Error(`no font ${repr(font)} (installed fonts: ${Object.keys(FONTS).slice(0, 8).join(", ")} ...)`);
  }
  let face;
  try {
    face = loadFont(file);
  } catch (e) {
    throw new Error(`can't read the font ${repr(font)}: ${e.message}`);
  }
  const rings = [];
  text.split("\n").forEach((line, lineNo) => {
    if (!line.trim()) return;
    const baseline = -lineNo * size * 1.2;
    // opentype.js draws with y down; flip it so y is up, as on the face.
    const p = face.getPath(line, 0, 0, size, { kerning: true });
    let ring = [];
    let first = null;
    let at = null;
    const pt = (x, y) => [x, baseline - y];
    for (const cmd of p.commands) {
      if (cmd.type === "M") {
        if (ring.length > 2) rings.push(ring);
        first = pt(cmd.x, cmd.y);
        ring = [first];
        at = first;
      } else if (cmd.type === "L") {
        at = pt(cmd.x, cmd.y);
        ring.push(at);
      } else if (cmd.type === "Q") {
        const c1 = pt(cmd.x1, cmd.y1);
        const end = pt(cmd.x, cmd.y);
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          const u = 1 - t;
          ring.push([u * u * at[0] + 2 * u * t * c1[0] + t * t * end[0], u * u * at[1] + 2 * u * t * c1[1] + t * t * end[1]]);
        }
        at = end;
      } else if (cmd.type === "C") {
        const c1 = pt(cmd.x1, cmd.y1);
        const c2 = pt(cmd.x2, cmd.y2);
        const end = pt(cmd.x, cmd.y);
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          const u = 1 - t;
          ring.push([
            u * u * u * at[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
            u * u * u * at[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
          ]);
        }
        at = end;
      } else if (cmd.type === "Z" && first) {
        // Back to the start, along a straight line (as matplotlib's paths do).
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS;
          ring.push([at[0] + (first[0] - at[0]) * t, at[1] + (first[1] - at[1]) * t]);
        }
        at = first;
      }
    }
    if (ring.length > 2) rings.push(ring);
  });
  return turn(rings, angle);
}

function mtime(file) {
  return files.stat(file).mtimeMs;
}

function isFile(file) {
  return Boolean(file) && files.isFile(file);
}

/** The picture at `file` as RGB, transparent parts white. */
function loadRgb(file) {
  return imaging.flattenOnWhite(imaging.readImage(file));
}

/** [width, height] of the picture at `file`, in pixels. */
export function imageSize(file) {
  const img = imaging.readImage(file);
  return [img.width, img.height];
}

/** The dark parts (light with `invert`) of the picture at `file`, scaled to
`width` mm across: the picture is resampled to `pixel` mm and traced where
its brightness (0-255) crosses `threshold`, turned `angle` degrees
anticlockwise. */
export function imageOutline(file, width = 30.0, threshold = 128.0, invert = false, angle = 0.0, pixel = 0.1) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify(["image", files.resolve(file), mtime(file), Number(width), Number(threshold), Boolean(invert),
    Number(angle), Number(pixel)]);
  return cached(key, () => _imageOutline(file, width, threshold, invert, angle, pixel));
}

function _imageOutline(file, width, threshold, invert, angle, pixel) {
  const grey = imaging.toGrey(loadRgb(file));
  const columns = Math.max(2, roundInt(width / pixel));
  const rows = Math.max(2, roundInt((columns * grey.height) / grey.width));
  const small = imaging.resize(grey, columns, rows);
  const z = { width: columns, height: rows, data: Float32Array.from(small.data, (v) => (invert ? 255.0 - v : v)) };
  // Dark below the threshold: trace where it crosses it, with a light
  // border all round so shapes at the edge still close.
  const padded = imaging.pad(z, 1, 255.0);
  const scale = width / columns;
  const rings = [];
  for (const line of imaging.contourLines(padded, threshold)) {
    const ring = line.map(([col, row]) => [(col - 1) * scale, (rows - (row - 1)) * scale]);
    if (ring.length > 2) rings.push(ring);
  }
  return turn(rings, angle);
}

// (posterise is a mosaic with its colours found as the FreeCAD examples find
// them; see mosaicCells().)
export const MOSAIC_STYLES = ["posterise", "mosaic", "dots", "lines"];

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Colours sorted darkest first. */
function sortColours(colours) {
  return [...colours].sort((a, b) => luminance(a) - luminance(b) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

// -- colours: what a picture is reduced to, and which filament each goes to --

/* A picture is reduced to a few colours ("found"), darkest first. Each is
printed in a filament: by default each found colour is a filament of its own
(and shown in that colour). With a `palette` (the filaments' colours, e.g.
"#202020 #f0f0f0 #c03030"), each goes to the palette colour nearest it. A
`mapping` says outright, found colour by found colour, which filament each
goes to: "1 2 2 - 3" - a filament's number (in the palette, or among the
found colours if there's no palette), "-" to leave it out (so the case shows
there), "*" for the default. Several found colours can share a filament.

The parts are named after the filaments' numbers ("image1", "image2" ...),
so they keep their names when the picture's colours are mapped differently. */

// The colours of the picture styles that trace it (fill, vector) are found
// in a copy this many pixels across - so they're the same whatever size it's
// engraved at, and in the editor's preview.
const COLOUR_SAMPLE = 200;
const foundCache = new Map();

/** The `colours` colours the picture at `file` is reduced to for fill and
vector: like colours grouped (k-means) in a copy COLOUR_SAMPLE pixels
across, smoothed with a median filter. [[r, g, b]...], darkest first. */
export function pictureColours(file, colours) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([files.resolve(file), mtime(file), Math.trunc(colours)]);
  if (!foundCache.has(key)) {
    if (foundCache.size > 50) foundCache.clear();
    const image = loadRgb(file);
    const columns = Math.min(COLOUR_SAMPLE, image.width);
    const rows = Math.max(1, roundInt((columns * image.height) / image.width));
    const small = imaging.medianFilter3(imaging.resize(image, columns, rows));
    const { centres } = colourGroups(small, Math.max(1, Math.trunc(colours)));
    const found = new Map();
    for (const c of centres) {
      const rgb = [...c].map((v) => Math.min(255, Math.max(0, roundInt(v))));
      found.set(rgb.join(","), rgb);
    }
    foundCache.set(key, sortColours([...found.values()]));
  }
  return foundCache.get(key).map((c) => [...c]);
}

/** How far apart two colours look (roughly: green counts most, blue least). */
function colourDistance(a, b) {
  return 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
}

function nearest(colours, rgb) {
  let best = 0;
  let bestDistance = Infinity;
  colours.forEach((c, i) => {
    const d = colourDistance(c, rgb);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** Each pixel of `img` (RGB) labelled with the nearest of `colours`. */
function labelPixels(img, colours) {
  const n = img.width * img.height;
  const labels = new Int32Array(n);
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = (img.data[3 * i] << 16) | (img.data[3 * i + 1] << 8) | img.data[3 * i + 2];
    let label = seen.get(key);
    if (label === undefined) {
      label = nearest(colours, [img.data[3 * i], img.data[3 * i + 1], img.data[3 * i + 2]]);
      seen.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

/** A palette ("#202020 #f0f0f0, #c03030") as [[r, g, b]...]. */
export function parsePalette(text) {
  const out = [];
  for (const token of String(text || "").split(/[\s,;]+/).filter(Boolean)) {
    const hex = token.replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`palette: ${repr(token)} isn't a colour like #c03030`);
    out.push([0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  }
  return out;
}

/** A mapping ("1 2 2 - 3 *") as [filament index (from 0), -1 for left out,
or null for the default]. */
export function parseMapping(text) {
  return String(text || "").split(/[\s,;]+/).filter(Boolean).map((token) => {
    if (token === "-") return -1;
    if (token === "*") return null;
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`colour mapping: ${repr(token)} isn't a filament's number, "-" (leave it out) or "*" (the default)`);
    }
    return n - 1;
  });
}

/** Which filament each of the `found` colours is printed in: {filaments:
[[r, g, b]...], assign: [filament index, or -1 for left out, per found
colour], explicit: [whether the mapping said so, per found colour]}.
`leaveOut` ("lightest" or "darkest") leaves out that found colour, unless
the mapping says otherwise. */
export function assignColours(found, { palette = "", mapping = "", leaveOut = "none" } = {}) {
  const pal = parsePalette(palette);
  const map = parseMapping(mapping);
  const filaments = pal.length ? pal : found.map((c) => [...c]);
  const assign = found.map((c, i) => (pal.length ? nearest(pal, c) : i));
  const explicit = found.map((_, i) => i < map.length && map[i] !== null);
  const out = !found.length ? -1 : leaveOut === "lightest" ? found.length - 1 : leaveOut === "darkest" ? 0 : -1;
  if (out >= 0 && !explicit[out]) assign[out] = -1;
  map.forEach((m, i) => {
    if (i >= found.length || m === null) return;
    if (m >= filaments.length) {
      throw new Error(`colour mapping: there's no filament ${m + 1} (${pal.length ? `the palette has ${pal.length}` :
        `there's no palette, and the picture has ${found.length} colours`})`);
    }
    assign[i] = m;
  });
  return { filaments, assign, explicit };
}

/** A vector picture's background gets no lines: the found colour `leaveOut`
names (the lightest, unless it's "darkest"), and those close to it in
brightness (the fuzz round its edges) - but not where the mapping says
otherwise. Changes `assign`. */
function vectorBackground(found, assign, explicit, leaveOut) {
  if (!found.length) return;
  const background = found[leaveOut === "darkest" ? 0 : found.length - 1];
  found.forEach((c, i) => {
    if (!explicit[i] && Math.abs(luminance(c) - luminance(background)) < BACKGROUND_SHADE) assign[i] = -1;
  });
}

/** The filaments used in `assign`, darkest first. */
function usedFilaments(filaments, assign) {
  const used = [...new Set(assign.filter((f) => f >= 0))];
  return used.sort((a, b) => luminance(filaments[a]) - luminance(filaments[b]) || a - b);
}

// -- mosaics --

const mosaicCache = new Map();

/** The picture at `file` as a grid of `columns` cells across, `width` mm
wide, in `colours` colours (median cut), each printed in a filament (see
assignColours(); `colourMap` gives the palette and mapping): [[[filament
number, rgb, rings]...], [width, height]] - darkest first. Cells are drawn as
"mosaic" (whole cells, each row's runs of one filament as one strip), "dots"
(a square dot in each cell) or "lines" (each row's runs as a strip),
`spacing` of a cell clear round dots and lines. `leaveOut` ("lightest" or
"darkest") drops that colour. */
export function mosaicLayers(file, width = 60.0, columns = 48, colours = 4, style = "mosaic", spacing = 0.2,
  leaveOut = "none", dither = false, angle = 0.0, { palette = "", mapping = "" } = {}) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([files.resolve(file), mtime(file), Number(width), Math.trunc(columns), Math.trunc(colours), style,
    Number(spacing), leaveOut, Boolean(dither), palette, mapping]);
  if (!mosaicCache.has(key)) {
    if (mosaicCache.size > 50) mosaicCache.clear();
    mosaicCache.set(key, _mosaic(file, width, Math.trunc(columns), Math.trunc(colours), style, spacing, leaveOut, dither,
      palette, mapping));
  }
  const [layers, size] = mosaicCache.get(key);
  return [layers.map(([n, rgb, rings]) => [n, [...rgb], turn(rings.map((r) => r.map((p) => [...p])), angle)]), size];
}

/** A mosaic's cells: {columns, rows, found (the colours, darkest first),
cells (each cell's)}. The picture's shrunk to `columns` cells across; a
`posterise` picture's colours are then found by median cut in those cells
(as Pillow quantizes, and the FreeCAD examples posterise), the others' are
the picture's own (pictureColours()). Each cell takes the nearest of them to
its average colour - or, dithered, Floyd-Steinberg's choice. */
function mosaicCells(file, columns, colours, style = "mosaic", dither = false) {
  if (columns < 1 || colours < 1) throw new Error("a mosaic needs at least one column and one colour");
  const image = loadRgb(file);
  const rows = Math.max(1, roundInt((columns * image.height) / image.width));
  const small = imaging.resize(image, columns, rows);
  const found = style === "posterise" ? sortColours(imaging.medianCutColours(small, colours)) : pictureColours(file, colours);
  const cells = dither ? imaging.ditherFloydSteinberg(small, found) : labelPixels(small, found);
  return { columns, rows, found, cells };
}

function _mosaic(file, width, columns, colours, style, spacing, leaveOut, dither, palette, mapping) {
  if (!MOSAIC_STYLES.includes(style)) throw new Error(`mosaic style must be one of ${MOSAIC_STYLES.join(", ")} (got ${repr(style)})`);
  const { rows, found, cells } = mosaicCells(file, columns, colours, style, dither);
  const { filaments, assign } = assignColours(found, { palette, mapping, leaveOut });
  const filament = Int32Array.from(cells, (c) => assign[c]);
  const cell = width / columns;
  const gap = style === "mosaic" || style === "posterise" ? 0.0 : Math.max(0.0, Math.min(0.45, spacing)) * cell;
  const layers = [];
  for (const f of usedFilaments(filaments, assign)) {
    const rings = [];
    for (let y = 0; y < rows; y++) {
      const y0 = (rows - 1 - y) * cell;
      const on = (x) => filament[y * columns + x] === f;
      let x = 0;
      while (x < columns) {
        if (!on(x)) {
          x += 1;
          continue;
        }
        const start = x;
        if (style === "dots") x += 1;
        else while (x < columns && on(x)) x += 1;
        const x0 = start * cell + gap;
        const x1 = x * cell - gap;
        rings.push([[x0, y0 + gap], [x1, y0 + gap], [x1, y0 + cell - gap], [x0, y0 + cell - gap]]);
      }
    }
    if (rings.length) layers.push([f + 1, filaments[f], rings]);
  }
  return [layers, [width, rows * cell]];
}

// -- vector pictures --

export const VECTOR_TRACES = ["outlines", "centre"];
const MAX_VECTOR_PIXELS = 1200; // across the traced picture, whatever `detail` asks for
const BACKGROUND_SHADE = 24.0; // brightness (0-255) within which a colour counts as background
const vectorCache = new Map();

/** The picture at `file`'s size in pixels when it's traced `width` mm wide
at `detail` mm: [columns, rows]. */
function tracedSize(image, width, detail) {
  const columns = Math.trunc(Math.min(MAX_VECTOR_PIXELS, Math.max(16, roundInt(width / detail))));
  return [columns, Math.max(2, roundInt((columns * image.height) / image.width))];
}

/** The picture at `file`, `width` mm wide, drawn as lines `lineWidth` mm
wide: it's reduced to `colours` colours, and each colour but the background
gets lines in its filament's colour (see assignColours(); `colourMap` gives
the palette and mapping), traced round the edges of its patches
("outlines") or along their middles ("centre"). Returns [[[filament number,
rgb, rings]...], [width, height]], darkest first. Where lines of two
filaments meet, the darker is on top. */
export function vectorLayers(file, width = 60.0, colours = 4, trace = "outlines", lineWidth = 0.8, detail = 0.25,
  leaveOut = "none", angle = 0.0, { palette = "", mapping = "" } = {}) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([files.resolve(file), mtime(file), Number(width), Math.trunc(colours), trace, Number(lineWidth),
    Number(detail), leaveOut, palette, mapping]);
  if (!vectorCache.has(key)) {
    if (vectorCache.size > 20) vectorCache.clear();
    // (Its sections are only needed while it's worked out.)
    vectorCache.set(key, scope(() => _vector(file, width, Math.trunc(colours), trace, lineWidth, detail, leaveOut, palette, mapping)));
  }
  const [layers, size] = vectorCache.get(key);
  return [layers.map(([n, rgb, rings]) => [n, [...rgb], turn(rings.map((r) => r.map((p) => [...p])), angle)]), size];
}

function _vector(file, width, colours, trace, lineWidth, detail, leaveOut, palette, mapping) {
  if (!VECTOR_TRACES.includes(trace)) throw new Error(`vector trace must be one of ${VECTOR_TRACES.join(", ")} (got ${repr(trace)})`);
  if (colours < 2) throw new Error("a vector picture needs at least two colours: the lines and the background");
  if (lineWidth <= 0 || detail <= 0) throw new Error("a vector picture's line width and detail must be more than 0");
  const image = loadRgb(file);
  const [columns, rows] = tracedSize(image, width, detail);
  const small = imaging.medianFilter3(imaging.resize(image, columns, rows));
  const found = pictureColours(file, colours);
  const labels = labelPixels(small, found);
  const vectorLeaveOut = leaveOut === "darkest" ? "darkest" : "lightest";
  const { filaments, assign, explicit } = assignColours(found, { palette, mapping, leaveOut: vectorLeaveOut });
  vectorBackground(found, assign, explicit, vectorLeaveOut);
  const scale = width / columns;
  const height = rows * scale;
  const frame = Section.square(width, height);
  let drawn = new Section();
  const layers = [];
  for (const f of usedFilaments(filaments, assign)) {
    const mask = Uint8Array.from(labels, (l) => (assign[l] === f ? 1 : 0));
    let paths = trace === "outlines" ? outlinePaths(mask, columns, rows) : centrePaths(mask, columns, rows);
    // Pixel (column, row) to mm, y up; tidied, and specks dropped.
    paths = paths.map((p) => tidy(p).map(([c, r]) => [(c + 0.5) * scale, height - (r + 0.5) * scale]));
    paths = paths.filter((p) => pathLength(p) >= lineWidth);
    const section = stroke(paths, lineWidth / 2.0).intersect(frame).subtract(drawn);
    if (section.isEmpty()) continue;
    drawn = drawn.add(section);
    layers.push([f + 1, filaments[f], section.toPolygons()]);
  }
  return [layers, [width, height]];
}

// -- filled pictures --

const fillCache = new Map();

/** The picture at `file`, `width` mm wide, as patches of colour, like a
poster: it's reduced to `colours` colours, each printed in a filament (see
assignColours(); `colourMap` gives the palette and mapping), and each
filament's patches traced as smooth filled shapes, to `detail` mm. The
shapes fit together with no gaps: the filament that covers the most fills
whatever the others (and the colours left out) don't. Returns
[[[filament number, rgb, rings]...], [width, height]], darkest first. */
export function fillLayers(file, width = 60.0, colours = 4, detail = 0.25, leaveOut = "none", angle = 0.0,
  { palette = "", mapping = "" } = {}) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([files.resolve(file), mtime(file), Number(width), Math.trunc(colours), Number(detail), leaveOut,
    palette, mapping]);
  if (!fillCache.has(key)) {
    if (fillCache.size > 20) fillCache.clear();
    fillCache.set(key, scope(() => _fill(file, width, Math.trunc(colours), detail, leaveOut, palette, mapping)));
  }
  const [layers, size] = fillCache.get(key);
  return [layers.map(([n, rgb, rings]) => [n, [...rgb], turn(rings.map((r) => r.map((p) => [...p])), angle)]), size];
}

function _fill(file, width, colours, detail, leaveOut, palette, mapping) {
  if (colours < 1) throw new Error("a filled picture needs at least one colour");
  if (detail <= 0) throw new Error("a filled picture's detail must be more than 0");
  const image = loadRgb(file);
  const [columns, rows] = tracedSize(image, width, detail);
  const small = imaging.medianFilter3(imaging.resize(image, columns, rows));
  const found = pictureColours(file, colours);
  const { filaments, assign } = assignColours(found, { palette, mapping, leaveOut });
  const filament = Int32Array.from(labelPixels(small, found), (l) => assign[l]);
  const counts = new Map();
  for (const f of filament) counts.set(f, (counts.get(f) || 0) + 1);
  const scale = width / columns;
  const height = rows * scale;
  const frame = Section.square(width, height);
  // The smaller patches first (they win where outlines overlap); the
  // filament covering the most is what's left, after them and what's left
  // out.
  const bySize = [...counts.keys()].filter((f) => f >= 0).sort((a, b) => counts.get(a) - counts.get(b) || a - b);
  const rest = bySize[bySize.length - 1];
  const sections = new Map();
  let drawn = counts.has(-1) ? patches(filament, -1, columns, rows, scale).intersect(frame) : new Section();
  for (const f of bySize) {
    if (f === rest) continue;
    const s = patches(filament, f, columns, rows, scale).intersect(frame).subtract(drawn);
    if (s.isEmpty()) continue;
    drawn = drawn.add(s);
    sections.set(f, s);
  }
  if (rest !== undefined && rest >= 0) {
    const s = frame.subtract(drawn);
    if (!s.isEmpty()) sections.set(rest, s);
  }
  const layers = [];
  for (const f of usedFilaments(filaments, [...sections.keys()])) layers.push([f + 1, filaments[f], sections.get(f).toPolygons()]);
  return [layers, [width, height]];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Where `filament` is `f` (a grid `w` x `h` of pixels `scale` mm across),
as a smooth filled outline, y up; specks of under two pixels or so left
out. */
function patches(filament, f, w, h, scale) {
  const mask = Float32Array.from(filament, (v) => (v === f ? 1 : 0));
  const z = imaging.pad(imaging.gaussianBlur({ width: w, height: h, data: mask }, 0.7), 1, 0.0);
  const height = h * scale;
  const smallest = 2 * scale * scale;
  const rings = [];
  for (const line of imaging.contourLines(z, 0.5)) {
    if (line.length < 4) continue;
    const ring = tidy(line).slice(0, -1).map(([c, r]) => [(c - 0.5) * scale, height - (r - 0.5) * scale]);
    if (ring.length > 2 && Math.abs(ringArea(ring)) >= smallest) rings.push(ring);
  }
  return rings.length ? Section.fromRings(rings, "EvenOdd") : new Section();
}

// -- the editor's preview --

const PREVIEW_COLUMNS = 160; // across the preview of a fill or vector picture

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An RGB image as {width, height, rgba: base64}. */
function rgbaImage(img) {
  const n = img.width * img.height;
  const out = new Uint8Array(4 * n);
  for (let i = 0; i < n; i++) {
    out.set([img.data[3 * i], img.data[3 * i + 1], img.data[3 * i + 2], 255], 4 * i);
  }
  return { width: img.width, height: img.height, rgba: toBase64(out) };
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** What a picture's colours come out as, for the editor (null for an
outline picture): {found: ["#rrggbb"...] (darkest first), filaments:
["#rrggbb"...], assign: [filament index or -1, per found colour], explicit:
[whether the mapping said so], original: {width, height, rgba}, result:
{width, height, rgba} (each pixel its filament's colour, transparent where
it's left out)}. `image` is a picture's decoration settings. */
export function colourPreview(file, image) {
  if (image.style === "outline") return null;
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const picture = loadRgb(file);
  const colours = Math.trunc(image.colours);
  let found;
  let labels;
  let size;
  if (MOSAIC_STYLES.includes(image.style)) {
    const cells = mosaicCells(file, Math.trunc(image.columns), colours, image.style, image.dither === "yes");
    found = cells.found;
    labels = cells.cells;
    size = [cells.columns, cells.rows];
  } else {
    const columns = Math.min(PREVIEW_COLUMNS, picture.width);
    size = [columns, Math.max(1, roundInt((columns * picture.height) / picture.width))];
    found = pictureColours(file, colours);
    labels = labelPixels(imaging.medianFilter3(imaging.resize(picture, size[0], size[1])), found);
  }
  const leaveOut = image.style === "vector" ? (image.leave_out === "darkest" ? "darkest" : "lightest") : image.leave_out;
  const { filaments, assign, explicit } = assignColours(found, { palette: image.palette, mapping: image.mapping, leaveOut });
  if (image.style === "vector") vectorBackground(found, assign, explicit, leaveOut);
  const result = new Uint8Array(4 * labels.length);
  labels.forEach((l, i) => {
    const f = assign[l];
    if (f >= 0) result.set([...filaments[f], 255], 4 * i);
  });
  const columns = Math.min(PREVIEW_COLUMNS * 2, picture.width);
  const original = imaging.resize(picture, columns, Math.max(1, roundInt((columns * picture.height) / picture.width)));
  return {
    found: found.map(hex), filaments: filaments.map(hex), assign, explicit,
    original: rgbaImage(original), result: { width: size[0], height: size[1], rgba: toBase64(result) },
  };
}

/** The picture's pixels sorted into `colours` groups of like colour
(k-means): {labels, centres}. */
function colourGroups(img, colours) {
  const n = img.width * img.height;
  const data = new Float32Array(n * 3);
  const distinct = new Set();
  for (let i = 0; i < n; i++) {
    data[3 * i] = img.data[3 * i];
    data[3 * i + 1] = img.data[3 * i + 1];
    data[3 * i + 2] = img.data[3 * i + 2];
    if (distinct.size <= colours) distinct.add((img.data[3 * i] << 16) | (img.data[3 * i + 1] << 8) | img.data[3 * i + 2]);
  }
  return imaging.kmeans(data, Math.min(colours, distinct.size));
}

/** The edges of the patches in `mask`, as paths of [column, row] points:
closed (first point repeated) round a patch, and open where they run off
the edge of the picture. */
function outlinePaths(mask, w, h) {
  const z = imaging.gaussianBlur({ width: w, height: h, data: Float32Array.from(mask) }, 0.8);
  const padded = imaging.pad(z, 1, null); // no crossings at the border
  return imaging.contourLines(padded, 0.5).filter((l) => l.length > 1).map((l) => l.map(([x, y]) => [x - 1.0, y - 1.0]));
}

const NEIGHBOURS = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]; // 4-connected first

/** The middle lines of the patches in `mask` (thinned to one pixel and
followed from end to end), as paths of [column, row] points. */
function centrePaths(mask, w, h) {
  const blurred = imaging.gaussianBlur({ width: w, height: h, data: Float32Array.from(mask) }, 0.8);
  const smooth = Uint8Array.from(blurred.data, (v) => (v >= 0.5 ? 1 : 0));
  const thinned = imaging.thin(smooth, w, h);
  const on = new Set();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (thinned[r * w + c]) on.add(r * w + c);
  const neighbours = (p) => {
    const r = Math.floor(p / w);
    const c = p % w;
    const out = [];
    for (const [dr, dc] of NEIGHBOURS) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < h && cc < w && on.has(rr * w + cc)) out.push(rr * w + cc);
    }
    return out;
  };
  // Start from line ends, then junctions, then whatever's left (loops).
  const degree = new Map();
  for (const p of on) degree.set(p, neighbours(p).length);
  const starts = [...on].sort((a, b) => {
    const ka = [degree.get(a) !== 1, degree.get(a) === 2];
    const kb = [degree.get(b) !== 1, degree.get(b) === 2];
    return (ka[0] - kb[0]) || (ka[1] - kb[1]) || a - b;
  });
  const visited = new Set();
  const paths = [];
  for (const start of starts) {
    for (;;) {
      let free = neighbours(start).filter((n) => !visited.has(n));
      if (visited.has(start) && !free.length) break;
      visited.add(start);
      const p = [start];
      let current = start;
      let previous = null;
      for (;;) {
        free = neighbours(current).filter((n) => !visited.has(n));
        if (!free.length) {
          // Join up with whatever it ran into (a junction, or the start of a
          // loop) rather than stopping a pixel short.
          for (const n of neighbours(current)) {
            if (n !== previous && (p.length > 2 || n !== start)) {
              p.push(n);
              break;
            }
          }
          break;
        }
        previous = current;
        current = free[0];
        visited.add(current);
        p.push(current);
      }
      if (p.length > 1) paths.push(p.map((q) => [q % w, Math.floor(q / w)]));
      if (!neighbours(start).filter((n) => !visited.has(n)).length) break;
    }
  }
  return paths;
}

/** A path of pixel points smoothed (taking the steps out of it) and
simplified to the fewest points that stay within a third of a pixel. */
function tidy(p) {
  let pts = p.map((q) => [q[0], q[1]]);
  const closed = pts.length > 3 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-8 &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-8;
  const k = 2;
  if (closed && pts.length > 2 * k + 2) {
    const ring = pts.slice(0, -1);
    const n = ring.length;
    const smooth = ring.map((_, i) => {
      let sx = 0;
      let sy = 0;
      for (let j = -k; j <= k; j++) {
        const q = ring[(i + j + n) % n];
        sx += q[0];
        sy += q[1];
      }
      return [sx / (2 * k + 1), sy / (2 * k + 1)];
    });
    pts = smooth.concat([smooth[0]]);
  } else if (!closed && pts.length > 2) {
    const smooth = pts.map((q) => [...q]);
    for (let i = 1; i < pts.length - 1; i++) {
      const j = Math.min(k, i, pts.length - 1 - i);
      let sx = 0;
      let sy = 0;
      for (let m = i - j; m <= i + j; m++) {
        sx += pts[m][0];
        sy += pts[m][1];
      }
      smooth[i] = [sx / (2 * j + 1), sy / (2 * j + 1)];
    }
    pts = smooth;
  }
  if (closed) pts = pts.slice(0, -1);
  const f32 = pts.map(([x, y]) => [Math.fround(x), Math.fround(y)]);
  const simple = imaging.approxPolyDP(f32, 0.3, closed);
  return closed ? simple.concat([simple[0]]) : simple;
}

function pathLength(p) {
  let total = 0;
  for (let i = 1; i < p.length; i++) total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return total;
}

/** The paths drawn with a round pen of radius r: each segment as a bar,
with a disc at each point to round the joins and ends. */
function stroke(paths, r) {
  const pieces = [];
  const disc = Section.circle(r, 16);
  for (const p of paths) {
    for (const [x, y] of p) pieces.push(disc.translate(x, y));
    for (let i = 1; i < p.length; i++) {
      const [x0, y0] = p[i - 1];
      const [x1, y1] = p[i];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) continue;
      const nx = (-dy / length) * r;
      const ny = (dx / length) * r;
      pieces.push(Section.fromRings([[[x0 + nx, y0 + ny], [x0 - nx, y0 - ny], [x1 - nx, y1 - ny], [x1 + nx, y1 + ny]]], "Positive"));
    }
  }
  if (!pieces.length) return new Section();
  return Section.union(pieces);
}
