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
import * as files from "#files";
import * as band from "./band.js";
import * as engraving from "./engraving.js";
import * as geom from "./geom.js";
import { Section } from "./kernel.js";
// (As design.isFrame() - which imports this.)
const isFrame = (kase) => kase.style === "Frame";
import { deepEqual, toFloat, toText, repr, sorted } from "./numbers.js";

const COLOUR_HELP = "Colour it's shown in in the editor (e.g. #202020) - print it in whatever you like";

// Which filament (AMS slot) it's printed in, in the Bambu Studio project
// Build writes (lib/bambu.js).
const FILAMENT_FIELD = ["filament", "", "Bambu Studio project: the filament (AMS slot) it's printed in, e.g. 3; a picture in " +
  "several colours takes one for each of its filaments in turn (e.g. 2 3 4); empty: chosen by its colour"];

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
  FILAMENT_FIELD,
];

export const IMAGE_STYLES = ["outline", "fill", ...engraving.MOSAIC_STYLES, "vector"]; // (posterise, mosaic, dots, lines)
export const IMAGE_FIELDS = [
  ["file", "", "The picture file"],
  ["style", "outline", "outline: its dark (or light) parts in one colour; fill: patches of a few colours, like a poster; " +
    "posterise: a grid of square pixels in a few colours, found by median cut (as the FreeCAD examples make them); " +
    "mosaic, dots, lines: a grid of cells in a few colours (the picture's own, as fill and vector find them); vector: the lines in it, drawn in their colours", IMAGE_STYLES],
  ["zoom", 1.0, "1 fits the picture to the face; more makes it bigger"],
  ["angle", 0.0, "Turned this many degrees anticlockwise"],
  ["across", 0.0, "Moved this far across the face from its middle (mm)"],
  ["up", 0.0, "Moved this far up the face from its middle (mm)"],
  ["depth", 0.6, "How deep it's cut (mm)"],
  ["inlay", "yes", "Make the cut's shape as a part (one per colour) of its own, to print in other colours", ["no", "yes"]],
  ["threshold", 128.0, "outline: brightness (0-255) below which a part counts as dark"],
  ["invert", "no", "outline: engrave the light parts instead of the dark ones", ["no", "yes"]],
  ["colour", "#202020", "outline: " + COLOUR_HELP],
  ["columns", 48.0, "posterise, mosaic, dots, lines: cells across the picture"],
  ["colours", 4.0, "fill, posterise, mosaic, dots, lines, vector: how many colours the picture is reduced to, counting the background"],
  ["palette", "", "fill, posterise, mosaic, dots, lines, vector: the filaments' colours (e.g. #202020 #f0f0f0 #c03030), each of the " +
    "picture's colours printed in the nearest; empty: each in a filament of its own"],
  ["mapping", "", "fill, posterise, mosaic, dots, lines, vector: which filament each of the picture's colours (darkest first) is printed " +
    "in - its number, - to leave it out, * for the nearest (e.g. 1 2 2 - 3); empty: the nearest"],
  ["spacing", 0.2, "dots, lines: gap round each, as a fraction of a cell"],
  ["leave_out", "none", "fill, posterise, mosaic, dots, lines: leave a colour out, so the case shows there; vector: the background, " +
    "which gets no lines (none: the lightest)", ["none", "lightest", "darkest"]],
  ["dither", "no", "posterise, mosaic, dots, lines: dither between the colours (Floyd-Steinberg), for shades between them", ["no", "yes"]],
  ["trace", "outlines", "vector: outlines: lines round each patch of colour; centre: one line along the middle of each " +
    "stroke (for line drawings)", engraving.VECTOR_TRACES],
  ["line_width", 0.8, "vector: width of the lines (mm)"],
  ["detail", 0.25, "fill, vector: size of the smallest thing traced (mm); smaller is finer but slower"],
  FILAMENT_FIELD,
];

export const FIELDS = { text: TEXT_FIELDS, image: IMAGE_FIELDS };
export const SURFACES = ["bottom", "top", "front", "back", "left", "right"];
// A band right round the walls, carrying on round the corners (lib/band.js).
export const BAND = "around";

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
    if (!SURFACES.includes(surface) && surface !== BAND) {
      throw new DecorationError(`case ${caseId}: no surface ${repr(surface)} to decorate (known: ${[...SURFACES, BAND].join(", ")})`);
    }
    if (!isPlainObject(layers)) throw new DecorationError(`case ${caseId}: decorations for ${surface} must map text/image to settings`);
    for (const [kind, settings] of Object.entries(layers)) {
      if (!(kind in FIELDS)) throw new DecorationError(`case ${caseId} ${surface}: decorations are text or image, not ${repr(kind)}`);
      if (!out[surface]) out[surface] = {};
      out[surface][kind] = normaliseLayer(kind, settings, `case ${caseId} ${surface} ${kind}`);
    }
  }
  return out;
}

/** One layer's settings (`kind` "text" or "image") checked and completed:
every setting present, numbers as floats. `where` names it in errors. */
export function normaliseLayer(kind, settings, where) {
  const known = {};
  for (const f of FIELDS[kind]) known[f[0]] = f;
  const unknown = sorted(Object.keys(settings || {}).filter((k) => !(k in known)));
  if (unknown.length) throw new DecorationError(`${where} has no setting(s) ${unknown.join(", ")}`);
  const full = {};
  for (const [name, field] of Object.entries(known)) {
    let value = settings && name in settings ? settings[name] : field[1];
    if (typeof field[1] === "string") {
      value = toText(value);
      if (field.length > 3 && !field[3].includes(value)) {
        throw new DecorationError(`${where}: ${name} must be one of ${field[3].join(", ")} (got ${repr(value)})`);
      }
    } else {
      try {
        value = toFloat(value);
      } catch (e) {
        throw new DecorationError(`${where}: ${name} must be a number (got ${repr(value)})`);
      }
    }
    full[name] = value;
  }
  for (const name of ["depth", "size", "zoom", "columns", "colours", "line_width", "detail"]) {
    if (name in full && full[name] <= 0) throw new DecorationError(`${where}: ${name} must be more than 0`);
  }
  if (kind === "image") {
    try {
      engraving.parsePalette(full.palette);
      engraving.parseMapping(full.mapping);
    } catch (e) {
      throw new DecorationError(`${where}: ${e.message}`);
    }
  }
  return full;
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

/** The parts a surface's decoration goes into: every part of the case (a
side's reaches the lid's skirt too) - but a frame's picture is on its
plate only, and its back's on its back. */
export function decoratedParts(kase, surfaceName) {
  if (!isFrame(kase)) return kase.parts;
  if (surfaceName === BAND) return [];
  // (A simple frame has no back.)
  if (surfaceName === "bottom") return kase.frame_type === "simple" ? [] : [kase.base_part];
  return surfaceName === "top" ? [kase.lid_part] : [];
}

/** [u0, v0, u1, v1]: the whole outside face of `surf` (a design Surface for
the outside of `kase`) in its own frame - the case's outer box seen from that
side. A frame's picture's is its plate. */
export function faceRect(kase, surf, inset = 0.0) {
  const t = kase.wall_thickness - inset, bt = kase.base_thickness, lt = kase.lid_thickness;
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

/* Nothing an inlay's made of touches anything else - another inlay, another
piece of itself, or the case - except over a face: touching along an edge
or at a corner (as a posterised picture's diagonal squares would), they'd
share edges with four faces, which slicers take for faces the wrong way
round. So what's drawn has such places parted by SEAM (separated()), and
what's cut for it is SEAM bigger all round (cutSection()), leaving a hair of
space round each inlay. */
export const SEAM = 0.01;
// ... and then simplified to within this, to leave out the points rounding
// corners adds, and any more a picture's outline can do without (fewer
// points, quicker cuts).
const TIDY = 0.002;

/** What's cut for an inlay drawn as `s`: SEAM bigger all round. */
export function cutSection(s) {
  return s.isEmpty() ? s : s.offset(SEAM, "Round", 2.0, 8).simplify(TIDY);
}

/** `s` with the places where two of its pieces only touch parted by SEAM. */
function separated(s) {
  if (s.isEmpty()) return s;
  return s.offset(-SEAM, "Round", 2.0, 8).offset(SEAM, "Round", 2.0, 8).simplify(TIDY);
}

/** `s` moved so `centre` lands on `target`, turned `angle` degrees about it. */
function place(s, centre, angle, target) {
  return s.translate(-centre[0], -centre[1]).rotate(angle).translate(target[0], target[1]);
}


/** [[[name, rgb, section, depth, inlay]...], problems] - each layer's outline
on the outside face, in the surface's frame: "text", then "image" (outline)
or "image1", "image2" ... (the filaments of a picture in several colours,
by number, darkest first). Also returns problems found on the way (a picture that can't be
read ...). The sections are made in the current kernel scope. */
export function faceLayers(kase, surf, layers, covered = null) {
  // (A frame's picture fits the window in its front, and carries on a
  // little way under it, so no edge of the plate shows.)
  const framed = isFrame(kase) && surf.name === "top";
  const [u0, v0, u1, v1] = framed ? faceRect(kase, surf, kase.frame_lip) : faceRect(kase, surf);
  const [c0, d0, c1, d1] = framed ? faceRect(kase, surf, kase.frame_lip / 2.0) : [u0, v0, u1, v1];
  const middle = [(u0 + u1) / 2.0, (v0 + v1) / 2.0];
  // The top's frame (as devices on it use it) has its v axis towards the
  // front of the case: turned round, so its decorations read the right way
  // up from the front, and move right and back as they do on the other faces.
  const turned = surf.name === "top" ? 180.0 : 0.0;
  return drawLayers([u0, v0, u1, v1], [c0, d0, c1, d1], layers, turned, covered);
}

/** [[[name, rgb, section, depth, inlay]...], problems]: text and a picture
(`layers`: {text, image} settings) drawn in a rectangle, as faceLayers()
draws them on a face (and a stamp in its footprint): fitted to `fitRect`
([u0, v0, u1, v1]), turned `turned` degrees about its middle, clipped to
`clipRect`, and clear of `covered` (a Section, or null: what's drawn on
top of them). */
export function drawLayers(fitRect, clipRect, layers, turned = 0.0, covered = null) {
  const [u0, v0, u1, v1] = fitRect;
  const [c0, d0, c1, d1] = clipRect;
  const middle = [(u0 + u1) / 2.0, (v0 + v1) / 2.0];
  const at = (layer) => (turned ? [middle[0] - layer.across, middle[1] - layer.up] : [middle[0] + layer.across, middle[1] + layer.up]);
  const clip = Section.square(c1 - c0, d1 - d0).translate(c0, d0);
  const out = [];
  const problems = [];
  let textArea = null;
  // (Clear of what's on top's pocket, which is a hair bigger than it.)
  if (covered) covered = cutSection(covered);

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
      s = place(s, [(b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0], text.angle + turned, at(text)).intersect(clip);
      if (covered) s = s.subtract(covered);
      s = separated(s);
      if (!s.isEmpty()) {
        out.push(["text", parseColour(text.colour), s, text.depth, text.inlay === "yes"]);
        textArea = cutSection(text.gap > 0 ? s.offset(text.gap, "Round") : s);
      }
    }
  }

  const image = layers.image;
  // Where the picture is (in a web page, it may be in the folder it's been
  // given rather than at the path the design was written with).
  const file = image && image.file ? files.locate(image.file) : null;
  if (image && image.file) {
    if (!files.isFile(file)) {
      problems.push(`picture: no file ${image.file}`);
    } else {
      try {
        const [pw, ph] = engraving.imageSize(file);
        const fit = Math.min(u1 - u0, ((v1 - v0) * pw) / ph) * image.zoom;
        let height = (fit * ph) / pw;
        const target = at(image);
        let pieces;
        const colourMap = { palette: image.palette, mapping: image.mapping };
        if (image.style === "outline") {
          const rings = engraving.imageOutline(file, fit, image.threshold, image.invert === "yes");
          pieces = [["image", parseColour(image.colour), rings]];
        } else if (image.style === "vector") {
          const [traced, size] = engraving.vectorLayers(file, fit, Math.trunc(image.colours), image.trace,
            image.line_width, image.detail, image.leave_out, 0.0, colourMap);
          height = size[1];
          pieces = traced.map(([n, rgb, rings]) => [`image${n}`, rgb, rings]);
        } else if (image.style === "fill") {
          const [filled, size] = engraving.fillLayers(file, fit, Math.trunc(image.colours), image.detail, image.leave_out, 0.0,
            colourMap);
          height = size[1];
          pieces = filled.map(([n, rgb, rings]) => [`image${n}`, rgb, rings]);
        } else {
          const [mosaic, size] = engraving.mosaicLayers(file, fit, Math.trunc(image.columns), Math.trunc(image.colours),
            image.style, image.spacing, image.leave_out, image.dither === "yes", 0.0, colourMap);
          height = size[1];
          pieces = mosaic.map(([n, rgb, rings]) => [`image${n}`, rgb, rings]);
        }
        for (const [name, rgb, rings] of pieces) {
          let s = place(section(rings), [fit / 2.0, height / 2.0], image.angle + turned, target).intersect(clip);
          if (textArea !== null) s = s.subtract(textArea);
          if (covered) s = s.subtract(covered);
          s = separated(s);
          if (!s.isEmpty()) out.push([name, rgb, s, image.depth, image.inlay === "yes"]);
        }
      } catch (e) {
        problems.push(`picture: ${e.message}`);
      }
    }
  }
  return [out, problems];
}

/** faceLayers() for the band round the walls (BAND): drawn in the band
unrolled (lib/band.js), (s, v) - fitted to its whole length, centred on the
middle of the front, and its height (the walls', floor to lid). */
export function bandLayers(kase, layers, covered = null, path = null) {
  path = path || band.bandPath(kase);
  const rect = [-path.length / 2.0, path.height[0], path.length / 2.0, path.height[1]];
  return drawLayers(rect, rect, layers, 0.0, covered);
}

/** {layer: rgb} of a face's (`surf`) decoration, or the band's (surf null). */
export function layerColours(kase, surf, layers) {
  const out = {};
  for (const [name, rgb] of (surf ? faceLayers(kase, surf, layers) : bandLayers(kase, layers))[0]) out[name] = rgb;
  return out;
}
