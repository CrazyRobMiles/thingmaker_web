/* Case shapes - ported from custard-cream-case's cases.py by way of the
Python thingmaker. The single-lid Box family: Square, MusicBox,
RoundBottom, Round, Rounded and Bevelled.

Frames:
- get_base(): the cavity occupies X 0..width, Y 0..depth,
  Z 0..base_side_height; the floor is Z -base_thickness..0 and the walls are
  wall_thickness thick outside the cavity. The top lid_inset_height of the
  walls is stepped down to their inner half so the lid's skirt can wrap
  over it.
- get_lid(): printed open side up - its plate is Z -lid_thickness..0 and its
  skirt rises lid_side_height above that. design.lidMatrix() flips it onto
  the base for the assembled view. */
import * as Part from "./kernel.js";
import { Section } from "./kernel.js";
import * as dm from "./design.js";

export const BaseScrewType = { SIDE_SCREWS: 1, NO_SCREWS: 2, DEFAULT: 1 };

export class Case {
  constructor({ wall_thickness = 4.0, base_thickness = 4.0, lid_thickness = 4.0, fit_gap = 0.15, lid_inset_height = 5.0 } = {}) {
    this.wall_thickness = wall_thickness;
    this.base_thickness = base_thickness;
    this.lid_thickness = lid_thickness;
    this.fit_gap = fit_gap;
    this.lid_inset_height = lid_inset_height;
  }

  get_base() {
    throw new Error("not implemented");
  }
}

/** A floor/wall shell with one lid on top. The one hook concrete box types
override is _shaped_box(), which decides how a cross-section's corners are
shaped. */
export class Box extends Case {
  constructor({ base_side_height = 10.0, lid_side_height = 20.0, fixing_hole_diameter = 2.8, fixing_hole_horiz_inset = 5.0,
    screw_type = BaseScrewType.DEFAULT, lid_inset_height = 5.0, ...rest } = {}) {
    super({ lid_inset_height, ...rest });
    this.width = 10.0;
    this.depth = 10.0;
    this.base_side_height = base_side_height;
    this.lid_side_height = lid_side_height;
    this.fixing_hole_diameter = fixing_hole_diameter;
    this.fixing_hole_horiz_inset = fixing_hole_horiz_inset;
    this.fixing_hole_vert_inset = lid_inset_height / 2.0;
    this.screw_type = screw_type;
  }

  _shaped_box(width, depth, height, position) {
    throw new Error("not implemented");
  }

  /** The outside of the base or the lid (each built with its closed end at
  the bottom) - a style that shapes the edges round that end too overrides
  this. */
  _outer(width, depth, height, position) {
    return this._shaped_box(width, depth, height, position);
  }

  _cut_base_screw_holes(base) {
    return base;
  }

  _cut_lid_screw_holes(lid) {
    return lid;
  }

  get_base() {
    const t = this.wall_thickness;
    const totalWidth = this.width + 2 * t;
    const totalDepth = this.depth + 2 * t;
    const totalHeight = this.base_side_height + this.base_thickness;
    let base = this._outer(totalWidth, totalDepth, totalHeight, [-t, -t, -this.base_thickness]);
    base = base.cut(this._shaped_box(this.width, this.depth, this.base_side_height, [0, 0, 0]));
    const band = this.lid_inset_height + this.fit_gap;
    base = base.cut(this._shaped_box(totalWidth, totalDepth, band, [-t, -t, this.base_side_height - band]));
    const fillWidth = totalWidth - t;
    const fillDepth = totalDepth - t;
    base = base.fuse(this._shaped_box(fillWidth, fillDepth, band, [-t / 2.0, -t / 2.0, this.base_side_height - band]));
    base = base.cut(this._shaped_box(this.width, this.depth, band, [0, 0, this.base_side_height - band]));
    if (this.screw_type === BaseScrewType.SIDE_SCREWS) base = this._cut_base_screw_holes(base);
    return base;
  }

  get_lid() {
    const t = this.wall_thickness;
    const totalWidth = this.width + 2 * t;
    const totalDepth = this.depth + 2 * t;
    const totalHeight = this.lid_side_height + this.lid_thickness;
    let lid = this._outer(totalWidth, totalDepth, totalHeight, [-t, -t, -this.lid_thickness]);
    lid = lid.cut(this._shaped_box(this.width, this.depth, this.lid_side_height, [0, 0, 0]));
    const recessWidth = this.width + t + this.fit_gap;
    const recessDepth = this.depth + t + this.fit_gap;
    const recessHeight = this.lid_inset_height + this.fit_gap / 2;
    lid = lid.cut(this._shaped_box(recessWidth, recessDepth, recessHeight,
      [-(t / 2) - this.fit_gap / 2, -(t / 2) - this.fit_gap / 2, this.lid_side_height - recessHeight]));
    if (this.screw_type === BaseScrewType.SIDE_SCREWS) lid = this._cut_lid_screw_holes(lid);
    return lid;
  }
}

/** Plain rectangular box, with side screw holes joining base and lid. */
export class Square extends Box {
  _shaped_box(width, depth, height, position) {
    return Part.makeBox(width, depth, height, position);
  }

  _corner_screw_positions(heightRef) {
    const z = heightRef - this.fixing_hole_vert_inset;
    const t = this.wall_thickness;
    const inset = this.fixing_hole_horiz_inset;
    return [[-t, inset, z], [-t, this.depth - inset, z], [this.width, this.depth - inset, z], [this.width, inset, z]];
  }

  _cut_base_screw_holes(base) {
    for (const pos of this._corner_screw_positions(this.base_side_height)) {
      base = base.cut(Part.makeCylinder(this.fixing_hole_diameter / 2.0, this.wall_thickness, pos, [1, 0, 0]));
    }
    return base;
  }

  _cut_lid_screw_holes(lid) {
    for (const pos of this._corner_screw_positions(this.lid_side_height)) {
      lid = lid.cut(Part.makeCylinder(this.fixing_hole_diameter / 2.0, this.wall_thickness, pos, [1, 0, 0]));
    }
    return lid;
  }
}

/** Cylindrical box - the wider of width/depth sets the radius. Ported for
completeness; the editor doesn't offer it because its walls aren't flat
surfaces devices can be placed on. */
export class Round extends Box {
  _shaped_box(width, depth, height, position) {
    const radius = width > depth ? width / 2.0 : depth / 2.0;
    const result = Part.makeCylinder(radius, height, position);
    return result.translate([radius, radius, 0]);
  }

  _cut_base_screw_holes(base) {
    const pos = [this.width / 2.0, -this.wall_thickness / 2.0, this.base_side_height - this.fixing_hole_vert_inset];
    return base.cut(Part.makeCylinder(this.fixing_hole_diameter / 2.0, this.wall_thickness, pos, [0, 1, 0]));
  }

  _cut_lid_screw_holes(lid) {
    const pos = [this.width / 2.0, -this.wall_thickness, this.lid_side_height - this.fixing_hole_vert_inset];
    return lid.cut(Part.makeCylinder(this.fixing_hole_diameter / 2.0, this.wall_thickness, pos, [0, 1, 0]));
  }
}

/** Shared corner-rounding recipe behind MusicBox/RoundBottom's
_shaped_box() - cut a square corner away and fill it with a matching
cylinder, for each [x_sign, y_sign, radius] in `corners`. */
function cornerRoundedBox(width, depth, height, position, corners) {
  let result = Part.makeBox(width, depth, height, position);
  for (const [xo, yo, r] of corners) {
    const w2 = width / 2.0;
    const x = w2 + (w2 - r) * xo;
    const d2 = depth / 2.0;
    const y = d2 + (d2 - r) * yo;
    const cp = [x, y, 0];
    const cutout = Part.makeBox(r, r, height, position);
    cutout.translate(cp);
    cutout.translate([-r / 2.0, -r / 2.0, 0]);
    cutout.translate([(r / 2.0) * xo, (r / 2.0) * yo, 0]);
    result = result.cut(cutout);
    const roundFill = Part.makeCylinder(r, height, cp);
    roundFill.translate(position);
    result = result.fuse(roundFill);
  }
  return result;
}

/** Rectangular box with all 4 corners lightly rounded (radius 5mm). */
export class MusicBox extends Box {
  _shaped_box(width, depth, height, position) {
    return cornerRoundedBox(width, depth, height, position, [[-1, -1, 5], [1, -1, 5], [-1, 1, 5], [1, 1, 5]]);
  }
}

/** Rectangular box with only its two "far" (depth-positive) corners rounded
(radius 10mm). */
export class RoundBottom extends Box {
  _shaped_box(width, depth, height, position) {
    return cornerRoundedBox(width, depth, height, position, [[-1, 1, 10], [1, 1, 10]]);
  }
}

/** A box whose outside edges are all shaped - the four upright corners, and
the edges round the base's floor and the lid's plate - `edge` mm in. The
joint between base and lid stays square. Inside, the corners follow the
outside's (offset by the wall); the floor's and the plate's inside edges
stay square. */
export class EdgedBox extends Box {
  constructor({ edge = 3.0, ...rest } = {}) {
    super(rest);
    this.edge = edge;
  }

  /** How far in from the outside a cross-section `width` wide is. */
  _offset(width) {
    return (this.width + 2 * this.wall_thickness - width) / 2.0;
  }

  _fit_corner(corner, width, depth) {
    return Math.max(0.0, Math.min(corner, Math.min(width, depth) / 2.0 - 0.01));
  }

  _shaped_box(width, depth, height, position) {
    const corner = this._fit_corner(this._corner(this._offset(width)), width, depth);
    const section = this._section(width, depth, corner).translate(Number(position[0]), Number(position[1]));
    return Part.extrudeSection(section, height, position[2]);
  }
}

/** A box with all its outside edges rounded, `edge` mm radius. */
export class Rounded extends EdgedBox {
  _section(width, depth, corner) {
    if (corner <= 0) return Section.square(width, depth);
    const inner = Section.square(width - 2 * corner, depth - 2 * corner).translate(corner, corner);
    return inner.offset(corner, "Round", 2.0, Part.circleSegments(corner));
  }

  _corner(offset) {
    return this.edge - offset;
  }

  _outer(width, depth, height, position) {
    const r = this._fit_corner(Math.min(this.edge, height), width, depth);
    if (r <= 0) return this._shaped_box(width, depth, height, position);
    const [x0, y0, z0] = position.map(Number);
    // The hull of a ball in each bottom corner and the shaped cross-section
    // from their middles up: rounded all round underneath.
    const balls = [];
    for (const x of [x0 + r, x0 + width - r]) {
      for (const y of [y0 + r, y0 + depth - r]) balls.push(Part.makeSphere(r).translate([x, y, z0 + r]));
    }
    const top = this._shaped_box(width, depth, height - r, [x0, y0, z0 + r]);
    const hull = Part.hull([...balls, top]);
    // (The balls reach up past a part shorter than twice the radius.)
    return hull.common(this._shaped_box(width, depth, height, position));
  }
}

/** A box with all its outside edges bevelled at 45 degrees, `edge` mm in
from each face. */
export class Bevelled extends EdgedBox {
  _section(width, depth, corner) {
    const c = corner;
    if (c <= 0) return Section.square(width, depth);
    return Section.fromRings([[[c, 0.0], [width - c, 0.0], [width, c], [width, depth - c], [width - c, depth], [c, depth],
      [0.0, depth - c], [0.0, c]]]);
  }

  _corner(offset) {
    // A 45 degree bevel moved in by `offset` is shorter along each face by
    // (2 - sqrt 2) x offset.
    return this.edge - (2.0 - 2 ** 0.5) * offset;
  }

  _outer(width, depth, height, position) {
    const c = this._fit_corner(Math.min(this.edge, height), width, depth);
    if (c <= 0) return this._shaped_box(width, depth, height, position);
    const [x0, y0, z0] = position.map(Number);
    // The hull of the cross-section moved in by the bevel on the bottom, and
    // the shaped cross-section from the bevel's height up.
    const bottom = this._shaped_box(width - 2 * c, depth - 2 * c, 0.01, [x0 + c, y0 + c, z0]);
    const top = this._shaped_box(width, depth, height - c, [x0, y0, z0 + c]);
    return Part.hull([bottom, top]).common(this._shaped_box(width, depth, height, position));
  }
}

export const STYLES = { Square, MusicBox, RoundBottom, Round, Rounded, Bevelled };

/** A Box for a design CaseSpec. Its own screw holes are left out: the
builder adds retaining screws with nut sockets instead (see screwParts()). */
export function makeBox(caseSpec) {
  const Cls = STYLES[caseSpec.style];
  const extra = Cls.prototype instanceof EdgedBox ? { edge: caseSpec.edge } : {};
  // The step in the base's walls is as deep as the lid's skirt, so the whole
  // skirt wraps over it and the lid sits down on the walls.
  const box = new Cls({
    base_side_height: caseSpec.height, lid_side_height: caseSpec.lid_height, wall_thickness: caseSpec.wall_thickness,
    base_thickness: caseSpec.base_thickness, lid_thickness: caseSpec.lid_thickness, screw_type: BaseScrewType.NO_SCREWS,
    fit_gap: dm.FIT_GAP, lid_inset_height: caseSpec.lid_height, ...extra,
  });
  box.width = caseSpec.width;
  box.depth = caseSpec.depth;
  return box;
}

/** One retaining screw's shapes, in the case frame: [the block on the
inside of the base's wall that holds the nut, what's cut from the base -
the nut's hexagonal socket and the bolt's hole - and the bolt's hole, to
cut from the lid's skirt too]. Without nuts (screw_nuts off), no block and
no socket: [null, the hole, the hole]. `frame` is from
Design.case_screw_frames(). */
export function screwParts(caseSpec, frame) {
  const z = dm.screwHeight(caseSpec);
  if (!caseSpec.screw_nuts) {
    const hole = Part.makeCylinder(dm.SCREW_HOLE / 2.0, caseSpec.wall_thickness + 2.0, [-caseSpec.wall_thickness - 1.0, 0, z], [1, 0, 0]);
    return [null, hole.transformed(frame), hole.transformed(frame)];
  }
  const flats = dm.NUT_ACROSS_FLATS;
  const corner = flats / 3 ** 0.5;
  const depth = dm.NUT_THICKNESS;
  const half = dm.nutBlockHalfWidth();
  const top = caseSpec.height - dm.NUT_TOP_MARGIN / 2.0;
  const bottom = z - flats / 2.0 - dm.NUT_BLOCK_WALL;
  // (into the case, up) profile, run along the wall; sunk 0.2 into it.
  let block = Part.makePrism([[-0.2, top], [depth, top], [depth, bottom], [-0.2, bottom - depth - 0.2]], 2 * half);
  block = block.transformed([[1, 0, 0, 0], [0, 0, -1, half], [0, 1, 0, 0], [0, 0, 0, 1]]);
  // (along the wall, up) hexagon, run into the case from the wall face.
  const hexagon = [[corner, z], [corner / 2.0, z + flats / 2.0], [-corner / 2.0, z + flats / 2.0], [-corner, z],
    [-corner / 2.0, z - flats / 2.0], [corner / 2.0, z - flats / 2.0]];
  const socket = Part.makePrism(hexagon, depth + 0.5).transformed([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  const hole = Part.makeCylinder(dm.SCREW_HOLE / 2.0, caseSpec.wall_thickness + depth + 2.0,
    [-caseSpec.wall_thickness - 1.0, 0, z], [1, 0, 0]);
  return [block.transformed(frame), socket.fuse(hole).transformed(frame), hole.transformed(frame)];
}
