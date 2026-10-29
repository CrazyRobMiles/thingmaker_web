/* Outlines to engrave: text in any installed TrueType/OpenType font, and
pictures (the dark parts, or the light ones; a mosaic; or the lines in them).
Each comes back as a list of closed rings of [x, y] points in mm, holes
included, to be filled with the even-odd rule. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import opentype from "opentype.js";
import { Section, scope } from "./kernel.js";
import * as imaging from "./imaging.js";
import { radians, repr, roundInt } from "./py.js";

export const FONT_DIRS = [
  path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Windows", "Fonts"),
  "/usr/share/fonts", "/usr/local/share/fonts", path.join(os.homedir(), ".fonts"),
  path.join(os.homedir(), ".local/share/fonts"), "/System/Library/Fonts", "/Library/Fonts",
  path.join(os.homedir(), "Library/Fonts"),
];
const CURVE_STEPS = 8; // points along each curved stretch of a letter

function findFonts(folder, found) {
  let entries;
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) findFonts(full, found);
    else if (/\.(ttf|otf)$/i.test(entry.name)) {
      const name = entry.name.replace(/\.[^.]+$/, "").toLowerCase();
      if (!(name in found)) found[name] = full;
    }
  }
}

/** {name: path} of every installed font - name being the font file's name
without its extension (e.g. "arial", "arialbd"). */
export function fonts() {
  const found = {};
  for (const folder of FONT_DIRS) if (folder && fs.existsSync(folder)) findFonts(folder, found);
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
  const key = `${file}|${fs.statSync(file).mtimeMs}`;
  if (!loadedFonts.has(key)) {
    const buf = fs.readFileSync(file);
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
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
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
  return fs.statSync(file).mtimeMs;
}

function isFile(file) {
  try {
    return Boolean(file) && fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
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
  const key = JSON.stringify(["image", path.resolve(file), mtime(file), Number(width), Number(threshold), Boolean(invert),
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

export const MOSAIC_STYLES = ["mosaic", "dots", "lines"];

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const mosaicCache = new Map();

/** The picture at `file` as a grid of `columns` cells across, `width` mm
wide, in `colours` colours (median cut): [[[rgb, rings]...], [width,
height]] - darkest colour first. Cells are drawn as "mosaic" (whole cells,
each row's runs of one colour as one strip), "dots" (a square dot in each
cell) or "lines" (each row's runs as a strip), `spacing` of a cell clear
round dots and lines. `leaveOut` ("lightest" or "darkest") drops that
colour. */
export function mosaicLayers(file, width = 60.0, columns = 48, colours = 4, style = "mosaic", spacing = 0.2,
  leaveOut = "none", dither = false, angle = 0.0) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([path.resolve(file), mtime(file), Number(width), Math.trunc(columns), Math.trunc(colours), style,
    Number(spacing), leaveOut, Boolean(dither)]);
  if (!mosaicCache.has(key)) {
    if (mosaicCache.size > 50) mosaicCache.clear();
    mosaicCache.set(key, _mosaic(file, width, Math.trunc(columns), Math.trunc(colours), style, spacing, leaveOut, dither));
  }
  const [layers, size] = mosaicCache.get(key);
  return [layers.map(([rgb, rings]) => [rgb, turn(rings.map((r) => r.map((p) => [...p])), angle)]), size];
}

function _mosaic(file, width, columns, colours, style, spacing, leaveOut, dither) {
  if (!MOSAIC_STYLES.includes(style)) throw new Error(`mosaic style must be one of ${MOSAIC_STYLES.join(", ")} (got ${repr(style)})`);
  if (columns < 1 || colours < 1) throw new Error("a mosaic needs at least one column and one colour");
  const image = loadRgb(file);
  const rows = Math.max(1, roundInt((columns * image.height) / image.width));
  const small = imaging.resize(image, columns, rows);
  // (`dither` is accepted but, as in the Python thingmaker - where Pillow's
  // quantize() ignores it - it makes no difference.)
  const pixels = imaging.quantizeMedianCut(small, colours).data;
  const seen = new Map();
  for (let i = 0; i < columns * rows; i++) {
    const rgb = [pixels[3 * i], pixels[3 * i + 1], pixels[3 * i + 2]];
    seen.set(rgb.join(","), rgb);
  }
  let found = [...seen.values()].sort((a, b) => luminance(a) - luminance(b) || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  if (leaveOut === "lightest") found = found.slice(0, -1);
  else if (leaveOut === "darkest") found = found.slice(1);
  const cell = width / columns;
  const gap = style === "mosaic" ? 0.0 : Math.max(0.0, Math.min(0.45, spacing)) * cell;
  const layers = [];
  for (const rgb of found) {
    const rings = [];
    for (let y = 0; y < rows; y++) {
      const y0 = (rows - 1 - y) * cell;
      const on = (x) => pixels[3 * (y * columns + x)] === rgb[0] && pixels[3 * (y * columns + x) + 1] === rgb[1] &&
        pixels[3 * (y * columns + x) + 2] === rgb[2];
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
    if (rings.length) layers.push([rgb, rings]);
  }
  return [layers, [width, rows * cell]];
}

// -- vector pictures --

export const VECTOR_TRACES = ["outlines", "centre"];
const MAX_VECTOR_PIXELS = 1200; // across the traced picture, whatever `detail` asks for
const BACKGROUND_SHADE = 24.0; // brightness (0-255) within which a colour counts as background
const vectorCache = new Map();

/** The picture at `file`, `width` mm wide, drawn as lines `lineWidth` mm
wide: it's reduced to `colours` colours, and each colour but the background
gets lines in that colour, traced round the edges of its patches
("outlines") or along their middles ("centre"). Returns [[[rgb, rings]...],
[width, height]], darkest first. Where lines of two colours meet, the darker
is on top. */
export function vectorLayers(file, width = 60.0, colours = 4, trace = "outlines", lineWidth = 0.8, detail = 0.25,
  leaveOut = "none", angle = 0.0) {
  if (!isFile(file)) throw new Error(`no image file ${repr(file)}`);
  const key = JSON.stringify([path.resolve(file), mtime(file), Number(width), Math.trunc(colours), trace, Number(lineWidth),
    Number(detail), leaveOut]);
  if (!vectorCache.has(key)) {
    if (vectorCache.size > 20) vectorCache.clear();
    // (Its sections are only needed while it's worked out.)
    vectorCache.set(key, scope(() => _vector(file, width, Math.trunc(colours), trace, lineWidth, detail, leaveOut)));
  }
  const [layers, size] = vectorCache.get(key);
  return [layers.map(([rgb, rings]) => [rgb, turn(rings.map((r) => r.map((p) => [...p])), angle)]), size];
}

function _vector(file, width, colours, trace, lineWidth, detail, leaveOut) {
  if (!VECTOR_TRACES.includes(trace)) throw new Error(`vector trace must be one of ${VECTOR_TRACES.join(", ")} (got ${repr(trace)})`);
  if (colours < 2) throw new Error("a vector picture needs at least two colours: the lines and the background");
  if (lineWidth <= 0 || detail <= 0) throw new Error("a vector picture's line width and detail must be more than 0");
  const image = loadRgb(file);
  const columns = Math.trunc(Math.min(MAX_VECTOR_PIXELS, Math.max(16, roundInt(width / detail))));
  const rows = Math.max(2, roundInt((columns * image.height) / image.width));
  const small = imaging.medianFilter3(imaging.resize(image, columns, rows));
  const { labels, centres } = colourGroups(small, colours);
  const order = [...centres.keys()].sort((a, b) => luminance(centres[a]) - luminance(centres[b]));
  const background = centres[leaveOut === "darkest" ? order[0] : order[order.length - 1]];
  const scale = width / columns;
  const height = rows * scale;
  const frame = Section.square(width, height);
  let drawn = new Section();
  const layers = [];
  for (const i of order) {
    // Shades close to the background (the fuzz round its edges) are
    // background too.
    if (Math.abs(luminance(centres[i]) - luminance(background)) < BACKGROUND_SHADE) continue;
    const mask = Uint8Array.from(labels, (l) => (l === i ? 1 : 0));
    const shown = centres[i].map((v) => roundInt(v));
    let paths = trace === "outlines" ? outlinePaths(mask, columns, rows) : centrePaths(mask, columns, rows);
    // Pixel (column, row) to mm, y up; tidied, and specks dropped.
    paths = paths.map((p) => tidy(p).map(([c, r]) => [(c + 0.5) * scale, height - (r + 0.5) * scale]));
    paths = paths.filter((p) => pathLength(p) >= lineWidth);
    const section = stroke(paths, lineWidth / 2.0).intersect(frame).subtract(drawn);
    if (section.isEmpty()) continue;
    drawn = drawn.add(section);
    layers.push([shown, section.toPolygons()]);
  }
  return [layers, [width, height]];
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
