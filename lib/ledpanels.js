/* Devices round a flexible LED panel - a 16 x 16 grid of LEDs 10mm apart, as
the wordsearch clock (github.com/CrazyRobMiles/PICO-wordsearch-clock) uses -
lying face down on the inside of the surface its light shows through.

A flexible panel has no holes to fix it by, so it's held by pressing it: it
lies on whatever stands between it and the surface (light pipes, or the
wordsearch's separator), and a frame - a part of its own - goes over its
edges and screws down onto pillars round it. The pillars are a little short
of the back of the panel, so tightening the screws squeezes it.

  - WordsearchThrough, WordsearchObscured: a wordsearch's letters in the
    surface - right through it, or behind a thin skin - as a part of their
    own (<id>.inlay) to print in another colour, with a separator (<id>.
    separator, best printed black) between the surface and the panel to keep
    each LED's light to its own letter.
  - LEDArray16x16Round, LEDArray16x16Square: a dot through the surface (or
    behind a thin skin, to diffuse the light) over each LED, with a light
    pipe round it standing up to the panel.

Device frame as for every device: Z = 0 the inside face of the surface, the
surface Z -baseHeight..0. The panel's corner is at (panelX, panelY). */
import { BUILT_IN, Device, classAttrs, union } from "./devices.js";
import * as engraving from "./engraving.js";
import { Box3 } from "./geom.js";
import * as Part from "./kernel.js";
import { Section } from "./kernel.js";

// The pillars the frame screws down onto (as a recessed device's baseplate's).
const PILLAR_DIAMETER = 7.0;
const PILOT_DIAMETER = 2.5;
const SCREW_HOLE = 3.4;
const SCREW_HEAD = 3.0; // room for the screws' heads above the frame
const PILLAR_GAP = 0.5; // between the panel's edge and the pillars
const PILLAR_SPACING = 85.0; // the furthest apart they go round the panel
const SQUEEZE = 0.2; // how far short of the panel's back the pillars stop
const SKIN_UNDER_PILOT = 0.8; // left at the outside face under a pillar's hole

/** The wordsearch clock's own letters (its clockface.json). */
export const CLOCK_LETTERS = ["EIGHTTWOTWELVEEO", "PTSOSNINETEENILN", "AQHENIJSIXTEENEE", "SUSRTEXQPFORTYVN",
  "TAKIEUEIGHTEENEI", "FRYKXEPNINEESENW", "ITCSEVENTEENTZBT", "FEOTWENTYRERRKLE", "TRNSNINEHEUECVVN",
  "YDNETOYTTOTOFLEO", "ELEVENCRFRLLEEHF", "KFCENOILACAWTYTF", "ZITNTHAUOHTFFHWL", "EVEITHQWBCITGIJI",
  "REDPASTWOFKIOHVN", "ONYTHIRTYKEFOURE"].join("/");

function positive(kind, values) {
  for (const [name, value] of Object.entries(values)) {
    if (!(value > 0)) throw new Error(`${kind}'s ${name} must be more than 0 (got ${value})`);
  }
}

function notNegative(kind, values) {
  for (const [name, value] of Object.entries(values)) {
    if (!(value >= 0)) throw new Error(`${kind}'s ${name} can't be negative (got ${value})`);
  }
}

/** A flexible LED panel, columns x rows LEDs `pitch` apart, held face down
`standoff` from the surface by pillars round it and a frame over its
edges. Subclasses say what's between it and the surface. */
export class FlexPanelDevice extends Device {
  constructor(partType, partName, { xMargin = 0.5, yMargin = 0.5, columns = 16, rows = 16, pitch = 10.0, standoff = 3.0,
    panel_thickness = 0.7, frame_thickness = 2.0, frame_overlap = 5.0 } = {}) {
    const kind = "an LED panel";
    positive(kind, { columns, rows, pitch, panel_thickness, frame_thickness, frame_overlap });
    notNegative(kind, { standoff });
    const cols = Math.round(columns);
    const rowCount = Math.round(rows);
    const panelWidth = cols * pitch;
    const panelDepth = rowCount * pitch;
    if (2 * frame_overlap >= Math.min(panelWidth, panelDepth)) {
      throw new Error(`the frame's overlap (${frame_overlap}mm) leaves no opening over a ${panelWidth} x ${panelDepth}mm panel`);
    }
    const reach = PILLAR_GAP + PILLAR_DIAMETER;
    super(partType, partName, panelWidth + 2 * reach, panelDepth + 2 * reach, { xMargin, yMargin, cutHeight: 0.0 });
    Object.assign(this, { columns: cols, rows: rowCount, pitch, standoff, panel_thickness, frame_thickness, frame_overlap,
      panelWidth, panelDepth, reach });
  }

  get panelX() {
    return this.xMargin + this.reach;
  }

  get panelY() {
    return this.yMargin + this.reach;
  }

  /** The top of the pillars: the bottom of the frame. */
  get pillarTop() {
    return this.standoff + this.panel_thickness - SQUEEZE;
  }

  /** The middle of LED (column, row) - row 0 the top row, column 0 the left,
  as seen from outside the surface (the inside's mirror image). */
  ledCentre(column, row) {
    return [this.panelX + (this.columns - 1 - column + 0.5) * this.pitch, this.panelY + (this.rows - 1 - row + 0.5) * this.pitch];
  }

  /** [[x, y]...] of the pillars: in the corners round the panel, and along
  its sides no more than PILLAR_SPACING apart. */
  pillar_positions() {
    const c = PILLAR_GAP + PILLAR_DIAMETER / 2.0;
    const x0 = this.panelX - c, x1 = this.panelX + this.panelWidth + c;
    const y0 = this.panelY - c, y1 = this.panelY + this.panelDepth + c;
    const along = (a, b) => {
      const n = Math.max(1, Math.ceil((b - a) / PILLAR_SPACING - 1e-9));
      return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
    };
    const out = [];
    const xs = along(x0, x1), ys = along(y0, y1);
    for (const x of xs) out.push([x, y0], [x, y1]);
    for (const y of ys.slice(1, -1)) out.push([x0, y], [x1, y]);
    return out;
  }

  /** The pillars, from the outside face up (so they're one with the
  surface). */
  pillars(baseHeight) {
    const h = this.pillarTop + baseHeight;
    return this.pillar_positions().map(([x, y]) => Part.makeCylinder(PILLAR_DIAMETER / 2.0, h, [x, y, -baseHeight]));
  }

  /** The pillars' holes for the frame's screws. */
  pilot_holes(baseHeight) {
    const z0 = -baseHeight + Math.min(SKIN_UNDER_PILOT, baseHeight / 2.0);
    return this.pillar_positions().map(([x, y]) => Part.makeCylinder(PILOT_DIAMETER / 2.0, this.pillarTop + 0.5 - z0, [x, y, z0]));
  }

  /** The frame: over the panel's edges and the pillars, screwed down onto
  them, with an opening over the rest of the panel for its wires. */
  frame() {
    const r = PILLAR_DIAMETER / 2.0;
    const z = this.pillarTop;
    const t = this.frame_thickness;
    const x0 = this.panelX - this.reach, y0 = this.panelY - this.reach;
    const outer = this._rounded(x0, y0, x0 + this.panelWidth + 2 * this.reach, y0 + this.panelDepth + 2 * this.reach, r, z, z + t);
    const o = this.frame_overlap;
    const opening = this._rounded(this.panelX + o, this.panelY + o, this.panelX + this.panelWidth - o, this.panelY + this.panelDepth - o,
      Math.min(2.0, o), z - 1.0, z + t + 1.0);
    const holes = this.pillar_positions().map(([x, y]) => Part.makeCylinder(SCREW_HOLE / 2.0, t + 2.0, [x, y, z - 1.0]));
    return outer.cut(union([opening, ...holes]));
  }

  /** What stands between the surface and the panel, fused to the surface
  (none, here). */
  standoff_material(baseHeight) {
    return null;
  }

  get_fuser(x, y, baseHeight) {
    return union([...this.pillars(baseHeight), this.standoff_material(baseHeight)]);
  }

  /** What goes through (or into) the surface over the LEDs. */
  openings(baseHeight) {
    return null;
  }

  get_cutter(x, y, baseHeight) {
    return union([...this.pilot_holes(baseHeight), this.openings(baseHeight)]);
  }

  extra_parts(baseHeight) {
    return { frame: this.frame() };
  }

  body_boxes() {
    const top = this.pillarTop + this.frame_thickness;
    return [
      new Box3(this.panelX, this.panelY, 0.0, this.panelWidth, this.panelDepth, this.standoff, "light pipes"),
      new Box3(this.panelX, this.panelY, this.standoff, this.panelWidth, this.panelDepth, this.panel_thickness, "LED panel"),
      new Box3(this.xMargin, this.yMargin, this.pillarTop, this.panelWidth + 2 * this.reach, this.panelDepth + 2 * this.reach,
        this.frame_thickness + SCREW_HEAD, "frame"),
      ...this.pillar_positions().map(([px, py]) => new Box3(px - PILLAR_DIAMETER / 2.0, py - PILLAR_DIAMETER / 2.0, 0.0,
        PILLAR_DIAMETER, PILLAR_DIAMETER, top - this.frame_thickness, "pillar")),
    ];
  }
}

const PANEL_PARAMS = {
  panel_thickness: [0.7, "Thickness of the flexible LED panel (mm)"],
  frame_thickness: [2.0, "Thickness of the frame that holds the panel down (mm)"],
  frame_overlap: [5.0, "How far the frame reaches in over the panel's edges (mm)"],
};

classAttrs(FlexPanelDevice, {
  CATEGORY: "light", RECESSABLE: false, CUTS_THROUGH: true, DEFAULT_MOUNT: "inside", INSIDE_ONLY: true,
});

// -- wordsearch faces --

const capHeights = new Map();

/** How big to ask for `font` to get capitals `height` tall. */
function fontSize(font, height) {
  if (!capHeights.has(font)) {
    const ys = engraving.textOutline("H", font, 10.0).flat().map((p) => p[1]);
    capHeights.set(font, (Math.max(...ys) - Math.min(...ys)) / 10.0);
  }
  return height / capHeights.get(font);
}

/** The rows of a wordsearch's letters, from `letters` ("ABC/DEF/...", the
top row first). */
export function wordsearchRows(letters) {
  const rows = String(letters).split("/").map((r) => r.trim()).filter((r) => r.length);
  if (!rows.length) throw new Error("a wordsearch needs some letters (its rows separated by /)");
  const width = [...rows[0]].length;
  if (rows.some((r) => [...r].length !== width)) {
    throw new Error(`every row of a wordsearch needs the same number of letters (${rows.map((r) => [...r].length).join(", ")})`);
  }
  return rows.map((r) => [...r]);
}

/** A wordsearch's letters, one in the middle of each LED's square, read the
right way round from outside the surface. */
export class WordsearchFace extends FlexPanelDevice {
  constructor(partType, partName, { letters = CLOCK_LETTERS, font = "arialbd", letter_height = 6.5, pitch = 10.0,
    skin = 0.4, sheet = 0.5, separator_height = 3.0, separator_wall = 1.5, ...rest } = {}) {
    const grid = wordsearchRows(letters);
    positive("a wordsearch", { letter_height, separator_height, separator_wall });
    notNegative("a wordsearch", { skin, sheet });
    if (separator_wall >= pitch) throw new Error(`a wordsearch's separator walls (${separator_wall}mm) are as wide as its squares`);
    const through = partType === "WordsearchThrough";
    super(partType, partName, { columns: grid[0].length, rows: grid.length, pitch,
      standoff: (through ? sheet : 0.0) + separator_height, ...rest });
    Object.assign(this, { letters, letterGrid: grid, font, letter_height, skin, sheet, separator_height, separator_wall, through });
  }

  /** The letters as a Section in the device frame - each mirrored, as the
  inside face is the outside's mirror image, and centred in its square.
  `filled`: with the holes in them (an O's middle) filled in. */
  letterSection(filled = false) {
    this._sections = this._sections || {};
    if (!(filled in this._sections)) this._sections[filled] = this._letterSection(filled);
    return this._sections[filled];
  }

  _letterSection(filled) {
    const size = fontSize(this.font, this.letter_height);
    const pieces = [];
    this.letterGrid.forEach((row, r) => row.forEach((ch, c) => {
      if (!ch.trim()) return;
      const rings = engraving.textOutline(ch, this.font, size).map((ring) => ring.map(([x, y]) => [-x, y]))
        .filter((ring) => ring.length > 2);
      if (!rings.length) return;
      let s = filled ? Section.union(rings.map((ring) => Section.fromRings([ring], "NonZero"))) : Section.fromRings(rings, "EvenOdd");
      const b = (filled ? s : Section.union(rings.map((ring) => Section.fromRings([ring], "NonZero")))).bounds();
      const [cx, cy] = this.ledCentre(c, r);
      pieces.push(s.translate(cx - (b[0] + b[2]) / 2.0, cy - (b[1] + b[3]) / 2.0));
    }));
    return Section.union(pieces);
  }

  /** Where the letters are let into the surface: from the skin (obscured) or
  the outside face (through) to the inside face. */
  _letterSpan(baseHeight) {
    const z0 = this.through ? -baseHeight : -baseHeight + Math.min(this.skin, baseHeight - 0.2);
    return [z0, -z0];
  }

  openings(baseHeight) {
    if (this.through) return Part.extrudeSection(this.letterSection(true), baseHeight + 1.5, -baseHeight - 1.0);
    const [z0] = this._letterSpan(baseHeight);
    return Part.extrudeSection(this.letterSection(), -z0 + 0.5, z0);
  }

  /** The separator: a wall round each LED's square, from the surface (or the
  sheet behind the letters) to the panel. */
  separator() {
    const z0 = this.through ? this.sheet : 0.0;
    return gridWalls(this.panelX, this.panelY, this.columns, this.rows, this.pitch, this.separator_wall, z0, this.separator_height);
  }

  extra_parts(baseHeight) {
    const [z0, h] = this._letterSpan(baseHeight);
    let letters = Part.extrudeSection(this.letterSection(), h, z0);
    const parts = { frame: this.frame(), separator: this.separator() };
    if (this.through) {
      // Behind them, a sheet that holds them together; and the holes in them,
      // in the surface's colour.
      if (this.sheet > 0) letters = letters.fuse(Part.makeBox(this.panelWidth, this.panelDepth, this.sheet, [this.panelX, this.panelY, 0.0]));
      const counters = Part.extrudeSection(this.letterSection(true).subtract(this.letterSection()), baseHeight, -baseHeight);
      if (counters.Volume > 1e-3) parts.counters = counters;
    }
    parts.inlay = letters;
    return parts;
  }
}

/** Walls `wall` thick round each square of a columns x rows grid `pitch`
apart, cornered at (x0, y0) - the outer ones half that, inside the grid -
from z0, `height` high. */
function gridWalls(x0, y0, columns, rows, pitch, wall, z0, height) {
  const w = columns * pitch, d = rows * pitch;
  const outer = Part.makeBox(w, d, height, [x0, y0, z0]);
  const inner = Part.makeBox(w - wall, d - wall, height + 2.0, [x0 + wall / 2.0, y0 + wall / 2.0, z0 - 1.0]);
  const walls = [outer.cut(inner)];
  for (let i = 1; i < columns; i++) walls.push(Part.makeBox(wall, d, height, [x0 + i * pitch - wall / 2.0, y0, z0]));
  for (let j = 1; j < rows; j++) walls.push(Part.makeBox(w, wall, height, [x0, y0 + j * pitch - wall / 2.0, z0]));
  return union(walls);
}

const WORDSEARCH_PARAMS = {
  letters: [CLOCK_LETTERS, "The letters, a row at a time from the top, the rows separated by / (one LED behind each)"],
  font: ["arialbd", "Font for the letters (a font's file name, as in the fonts list: arialbd is Arial Bold)"],
  letter_height: [6.5, "Height of a capital letter (mm)"],
  pitch: [10.0, "Distance between the panel's LEDs - the size of each letter's square (mm)"],
  separator_height: [3.0, "Height of the separator between the surface and the LED panel (mm)"],
  separator_wall: [1.5, "Thickness of the separator's walls between the letters (mm)"],
};

export class WordsearchThrough extends WordsearchFace {
  constructor(partName, options = {}) {
    super("WordsearchThrough", partName, options);
  }
}
classAttrs(WordsearchThrough, {
  DISPLAY_NAME: "Wordsearch face, letters right through",
  DESCRIPTION: "A wordsearch clock's face: letters right through the surface (a part to print in another colour, joined " +
    "by a thin sheet behind them), a separator, and a frame holding a 16 x 16 flexible LED panel behind it.",
  PARAMS: { ...WORDSEARCH_PARAMS,
    sheet: [0.5, "Thickness of the sheet behind the letters that holds them together (mm)"], ...PANEL_PARAMS },
  LOOSE_PARTS: ["counters"],
});

export class WordsearchObscured extends WordsearchFace {
  constructor(partName, options = {}) {
    super("WordsearchObscured", partName, options);
  }
}
classAttrs(WordsearchObscured, {
  DISPLAY_NAME: "Wordsearch face, letters behind the surface",
  DESCRIPTION: "A wordsearch clock's face: letters let into the inside of the surface behind a thin skin (a part to print " +
    "in another colour), a separator, and a frame holding a 16 x 16 flexible LED panel behind it.",
  PARAMS: { ...WORDSEARCH_PARAMS, skin: [0.4, "Thickness of the surface left over the letters (mm)"], ...PANEL_PARAMS },
});

// -- LED arrays with light pipes --

/** A 16 x 16 (or any size) LED panel with a dot over each LED - round or
square - and a light pipe round it, up to the panel. */
export class LEDArray extends FlexPanelDevice {
  constructor(partType, partName, { columns = 16, rows = 16, pitch = 10.0, dot_size = null, skin = 0.8, pipe_height = 3.0,
    pipe_wall = null, ...rest } = {}) {
    const round = partType === "LEDArray16x16Round";
    dot_size = dot_size ?? (round ? 6.0 : 8.0);
    pipe_wall = pipe_wall ?? (round ? 1.0 : 1.5);
    positive("an LED array", { dot_size, pipe_height, pipe_wall });
    notNegative("an LED array", { skin });
    const room = round ? dot_size + 2 * pipe_wall : dot_size + pipe_wall;
    if (room > pitch + 1e-9) {
      throw new Error(`an LED array's dots (${dot_size}mm) and their pipes' walls (${pipe_wall}mm) don't fit ${pitch}mm apart`);
    }
    super(partType, partName, { columns, rows, pitch, standoff: pipe_height, ...rest });
    Object.assign(this, { round, dot_size, skin, pipe_height, pipe_wall });
  }

  _dotBottom(baseHeight) {
    return this.skin > 0 ? -baseHeight + Math.min(this.skin, baseHeight - 0.2) : -baseHeight - 1.0;
  }

  _centres() {
    const out = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.columns; c++) out.push(this.ledCentre(c, r));
    return out;
  }

  /** The light pipes: a tube round each round dot, or walls round each
  square, from the surface up to the panel. */
  standoff_material(baseHeight) {
    if (!this.round) {
      return gridWalls(this.panelX, this.panelY, this.columns, this.rows, this.pitch, this.pipe_wall, -baseHeight,
        this.pipe_height + baseHeight);
    }
    const r = this.dot_size / 2.0 + this.pipe_wall;
    return Part.compound(this._centres().map(([x, y]) => Part.makeCylinder(r, this.pipe_height + baseHeight, [x, y, -baseHeight])));
  }

  /** The dots, and on up through the pipes. */
  openings(baseHeight) {
    const z0 = this._dotBottom(baseHeight);
    const h = this.pipe_height + 0.5 - z0;
    const s = this.dot_size;
    return Part.compound(this._centres().map(([x, y]) => (this.round ? Part.makeCylinder(s / 2.0, h, [x, y, z0])
      : Part.makeBox(s, s, h, [x - s / 2.0, y - s / 2.0, z0]))));
  }
}

const ARRAY_PARAMS = (round) => ({
  columns: [16, "Number of LEDs across the panel"],
  rows: [16, "Number of LEDs up the panel"],
  pitch: [10.0, "Distance between the panel's LEDs (mm)"],
  dot_size: [round ? 6.0 : 8.0, round ? "Diameter of each dot (mm)" : "Width of each square dot (mm)"],
  skin: [0.8, "Thickness of the surface left over each dot to soften the light (mm); 0 = right through"],
  pipe_height: [3.0, "Height of the light pipes, from the surface to the LED panel (mm)"],
  pipe_wall: [round ? 1.0 : 1.5, round ? "Thickness of each light pipe's wall (mm)" : "Thickness of the walls between the dots (mm)"],
  ...PANEL_PARAMS,
});

export class LEDArray16x16Round extends LEDArray {
  constructor(partName, options = {}) {
    super("LEDArray16x16Round", partName, options);
  }
}
classAttrs(LEDArray16x16Round, {
  DISPLAY_NAME: "16x16 LED panel, round light pipes",
  DESCRIPTION: "A 16 x 16 flexible LED panel (10mm apart) behind the surface, a round dot over each LED with a light pipe " +
    "round it, held down by a frame screwed onto pillars round it.",
  PARAMS: ARRAY_PARAMS(true),
});

export class LEDArray16x16Square extends LEDArray {
  constructor(partName, options = {}) {
    super("LEDArray16x16Square", partName, options);
  }
}
classAttrs(LEDArray16x16Square, {
  DISPLAY_NAME: "16x16 LED panel, square light pipes",
  DESCRIPTION: "A 16 x 16 flexible LED panel (10mm apart) behind the surface, a square dot over each LED with walls " +
    "between them, held down by a frame screwed onto pillars round it.",
  PARAMS: ARRAY_PARAMS(false),
});

Object.assign(BUILT_IN, { WordsearchThrough, WordsearchObscured, LEDArray16x16Round, LEDArray16x16Square });
