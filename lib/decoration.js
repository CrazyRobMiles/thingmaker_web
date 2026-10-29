/* Decorations: text and a picture engraved into the outside faces of a
case, each optionally inlaid in other colours.

A case's `decorations` map a surface name ("top", "front", ...) to up to
two layers, {"text": {...}, "image": {...}}, with the settings in
TEXT_FIELDS / IMAGE_FIELDS. Each is fitted to the surface's whole outside
face (edge to edge, walls included), then zoomed, turned and moved across
it, and clipped to it. The text is cut first and keeps its own colour; the
picture fills everything else, kept `gap` clear of the text.

faceLayers() works all this out in 2D, in the surface's own frame (as seen
from outside), and gives each layer's outline; the builder cuts them into
the case's parts and makes the inlays. */
import fs from "node:fs";
import * as engraving from "./engraving.js";
import * as geom from "./geom.js";
import { Section } from "./kernel.js";
import { deepEqual, pyFloat, pyStr, repr, sorted } from "./py.js";

const COLOUR_HELP = "Colour it's shown in in the editor (e.g. #202020) - print it in whatever you like";

export const TEXT_FIELDS = [
  // name, default, description[, choices]
  ["text", "", "What it says (type \\n for a new line)"],
  ["font", engraving.DEFAULT_FONT, "Font", Object.keys(engraving.FONTS).length ? Object.keys(engraving.FONTS) : [engraving.DEFAULT_FONT]],
  ["size", 10.0, "Font size: the distance from one line to the next (mm)"],
  ["angle", 0.0, "Turned this many degrees anticlockwise"],
  ["across", 0.0, "Moved this far across the face from its middle (mm)"],
  ["up", 0.0, "Moved this far up the face from its middle (mm)"],
  ["depth", 0.6, "How deep it's cut (mm)"],
  ["inlay", "yes", "Make the cut's shape as a part of its own, to print in another colour", ["no", "yes"]],
  ["gap", 0.5, "Space kept clear round it in the picture (mm)"],
  ["colour", "#202020", COLOUR_HELP],
];

export const IMAGE_STYLES = ["outline", ...engraving.MOSAIC_STYLES, "vector"];
export const IMAGE_FIELDS = [
  ["file", "", "The picture file"],
  ["style", "outline", "outline: its dark (or light) parts in one colour; mosaic, dots, lines: a grid of cells in a few " +
    "colours; vector: the lines in it, drawn in their colours", IMAGE_STYLES],
  ["zoom", 1.0, "1 fits the picture to the face; more makes it bigger"],
  ["angle", 0.0, "Turned this many degrees anticlockwise"],
  ["across", 0.0, "Moved this far across the face from its middle (mm)"],
  ["up", 0.0, "Moved this far up the face from its middle (mm)"],
  ["depth", 0.6, "How deep it's cut (mm)"],
  ["inlay", "yes", "Make the cut's shape as a part (one per colour) of its own, to print in other colours", ["no", "yes"]],
  ["threshold", 128.0, "outline: brightness (0-255) below which a part counts as dark"],
  ["invert", "no", "outline: engrave the light parts instead of the dark ones", ["no", "yes"]],
  ["colour", "#202020", "outline: " + COLOUR_HELP],
  ["columns", 48.0, "mosaic, dots, lines: cells across the picture"],
  ["colours", 4.0, "mosaic, dots, lines, vector: how many colours (filaments), counting the background"],
  ["spacing", 0.2, "dots, lines: gap round each, as a fraction of a cell"],
  ["leave_out", "none", "mosaic, dots, lines: leave a colour out, so the case shows there; vector: the background, " +
    "which gets no lines (none: the lightest)", ["none", "lightest", "darkest"]],
  ["dither", "no", "mosaic, dots, lines: dither between the colours", ["no", "yes"]],
  ["trace", "outlines", "vector: outlines: lines round each patch of colour; centre: one line along the middle of each " +
    "stroke (for line drawings)", engraving.VECTOR_TRACES],
  ["line_width", 0.8, "vector: width of the lines (mm)"],
  ["detail", 0.25, "vector: size of the smallest thing traced (mm); smaller is finer but slower"],
];

export const FIELDS = { text: TEXT_FIELDS, image: IMAGE_FIELDS };
export const SURFACES = ["bottom", "top", "front", "back", "left", "right"];

export class DecorationError extends Error {}

export function defaults(kind) {
  const out = {};
  for (const f of FIELDS[kind]) out[f[0]] = f[1];
  return out;
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** `decorations` checked and completed: {surface: {kind: settings}}, every
setting present, numbers as floats. */
export function normalise(caseId, decorations) {
  if (decorations === null || decorations === undefined) return {};
  if (!isPlainObject(decorations)) throw new DecorationError(`case ${caseId}: decorations must map surfaces to text/image settings`);
  const out = {};
  for (const [surface, layers] of Object.entries(decorations)) {
    if (!SURFACES.includes(surface)) {
      throw new DecorationError(`case ${caseId}: no surface ${repr(surface)} to decorate (known: ${SURFACES.join(", ")})`);
    }
    if (!isPlainObject(layers)) throw new DecorationError(`case ${caseId}: decorations for ${surface} must map text/image to settings`);
    for (const [kind, settings] of Object.entries(layers)) {
      if (!(kind in FIELDS)) throw new DecorationError(`case ${caseId} ${surface}: decorations are text or image, not ${repr(kind)}`);
      const known = {};
      for (const f of FIELDS[kind]) known[f[0]] = f;
      const unknown = sorted(Object.keys(settings || {}).filter((k) => !(k in known)));
      if (unknown.length) throw new DecorationError(`case ${caseId} ${surface} ${kind} has no setting(s) ${unknown.join(", ")}`);
      const full = {};
      for (const [name, field] of Object.entries(known)) {
        let value = settings && name in settings ? settings[name] : field[1];
        if (typeof field[1] === "string") {
          value = pyStr(value);
          if (field.length > 3 && !field[3].includes(value)) {
            throw new DecorationError(`case ${caseId} ${surface} ${kind}: ${name} must be one of ${field[3].join(", ")} (got ${repr(value)})`);
          }
        } else {
          try {
            value = pyFloat(value);
          } catch (e) {
            throw new DecorationError(`case ${caseId} ${surface} ${kind}: ${name} must be a number (got ${repr(value)})`);
          }
        }
        full[name] = value;
      }
      for (const name of ["depth", "size", "zoom", "columns", "colours", "line_width", "detail"]) {
        if (name in full && full[name] <= 0) throw new DecorationError(`case ${caseId} ${surface} ${kind}: ${name} must be more than 0`);
      }
      if (!out[surface]) out[surface] = {};
      out[surface][kind] = full;
    }
  }
  return out;
}

/** Only the settings that differ from the defaults - for the design file. */
export function compact(decorations) {
  const out = {};
  for (const [surface, layers] of Object.entries(decorations)) {
    for (const [kind, settings] of Object.entries(layers)) {
      const base = defaults(kind);
      const kept = {};
      for (const [k, v] of Object.entries(settings)) if (!deepEqual(v, base[k])) kept[k] = v;
      if (!out[surface]) out[surface] = {};
      out[surface][kind] = kept;
    }
  }
  return out;
}

export function parseColour(text, fallback = [32, 32, 32]) {
  const t = String(text).trim().replace(/^#+/, "");
  if (t.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(t)) return fallback;
  return [0, 2, 4].map((i) => parseInt(t.slice(i, i + 2), 16));
}

// -- geometry --

/** [u0, v0, u1, v1]: the whole outside face of `surf` (a design Surface for
the outside of `kase`) in its own frame - the case's outer box seen from that
side. */
export function faceRect(kase, surf) {
  const t = kase.wall_thickness, bt = kase.base_thickness, lt = kase.lid_thickness;
  const corners = [];
  for (const x of [-t, kase.width + t]) {
    for (const y of [-t, kase.depth + t]) for (const z of [-bt, kase.height + lt]) corners.push([x, y, z]);
  }
  const inv = geom.inverseRigid(surf.case_matrix);
  const pts = corners.map((c) => geom.applyPoint(inv, c));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
}

function section(rings) {
  const rs = rings.filter((r) => r.length > 2);
  return rs.length ? Section.fromRings(rs, "EvenOdd") : new Section();
}

/** `s` moved so `centre` lands on `target`, turned `angle` degrees about it. */
function place(s, centre, angle, target) {
  return s.translate(-centre[0], -centre[1]).rotate(angle).translate(target[0], target[1]);
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    return false;
  }
}

/** [[[name, rgb, section, depth, inlay]...], problems] - each layer's outline
on the outside face, in the surface's frame: "text", then "image" (outline)
or "image1", "image2" ... (a mosaic's or vector picture's colours, darkest
first). Also returns problems found on the way (a picture that can't be
read ...). The sections are made in the current kernel scope. */
export function faceLayers(kase, surf, layers) {
  const [u0, v0, u1, v1] = faceRect(kase, surf);
  const middle = [(u0 + u1) / 2.0, (v0 + v1) / 2.0];
  const clip = Section.square(u1 - u0, v1 - v0).translate(u0, v0);
  const out = [];
  const problems = [];
  let textArea = null;

  const text = layers.text;
  if (text && text.text.trim()) {
    let rings = [];
    try {
      rings = engraving.textOutline(text.text.replaceAll("\\n", "\n"), text.font, text.size, 0.0);
    } catch (e) {
      problems.push(`text: ${e.message}`);
    }
    if (rings.length) {
      let s = section(rings);
      const b = s.bounds();
      s = place(s, [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0], text.angle, [middle[0] + text.across, middle[1] + text.up]).intersect(clip);
      if (!s.isEmpty()) {
        out.push(["text", parseColour(text.colour), s, text.depth, text.inlay === "yes"]);
        textArea = text.gap > 0 ? s.offset(text.gap, "Round") : s;
      }
    }
  }

  const image = layers.image;
  if (image && image.file) {
    if (!isFile(image.file)) {
      problems.push(`picture: no file ${image.file}`);
    } else {
      try {
        const [pw, ph] = engraving.imageSize(image.file);
        const fit = Math.min(u1 - u0, ((v1 - v0) * pw) / ph) * image.zoom;
        let height = (fit * ph) / pw;
        const target = [middle[0] + image.across, middle[1] + image.up];
        let pieces;
        if (image.style === "outline") {
          const rings = engraving.imageOutline(image.file, fit, image.threshold, image.invert === "yes");
          pieces = [["image", parseColour(image.colour), rings]];
        } else if (image.style === "vector") {
          const [traced, size] = engraving.vectorLayers(image.file, fit, Math.trunc(image.colours), image.trace,
            image.line_width, image.detail, image.leave_out);
          height = size[1];
          pieces = traced.map(([rgb, rings], i) => [`image${i + 1}`, rgb, rings]);
        } else {
          const [mosaic, size] = engraving.mosaicLayers(image.file, fit, Math.trunc(image.columns), Math.trunc(image.colours),
            image.style, image.spacing, image.leave_out, image.dither === "yes");
          height = size[1];
          pieces = mosaic.map(([rgb, rings], i) => [`image${i + 1}`, rgb, rings]);
        }
        for (const [name, rgb, rings] of pieces) {
          let s = place(section(rings), [fit / 2.0, height / 2.0], image.angle, target).intersect(clip);
          if (textArea !== null) s = s.subtract(textArea);
          if (!s.isEmpty()) out.push([name, rgb, s, image.depth, image.inlay === "yes"]);
        }
      } catch (e) {
        problems.push(`picture: ${e.message}`);
      }
    }
  }
  return [out, problems];
}

export function layerColours(kase, surf, layers) {
  const out = {};
  for (const [name, rgb] of faceLayers(kase, surf, layers)[0]) out[name] = rgb;
  return out;
}
