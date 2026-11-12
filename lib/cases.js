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
import * as geom from "./geom.js";

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

  /** The inside of the base: shaped like the outside, or square-cornered
(square_inside) for a base made of panels to meet in the corners. */
  _inside_box(width, depth, height, position) {
    if (this.square_inside) return Part.makeBox(width, depth, height, position);
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
    base = base.cut(this._inside_box(this.width, this.depth, this.base_side_height, [0, 0, 0]));
    const band = this.lid_inset_height + this.fit_gap;
    base = base.cut(this._shaped_box(totalWidth, totalDepth, band, [-t, -t, this.base_side_height - band]));
    const fillWidth = totalWidth - t;
    const fillDepth = totalDepth - t;
    base = base.fuse(this._shaped_box(fillWidth, fillDepth, band, [-t / 2.0, -t / 2.0, this.base_side_height - band]));
    base = base.cut(this._inside_box(this.width, this.depth, band, [0, 0, this.base_side_height - band]));
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
  box.square_inside = caseSpec.panels;
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

/** A fillet: the right-angled triangle `size` each way in the corner
between two faces, run `length` along it - in a frame whose X runs into
the case from the face it's on (it's sunk 0.2 into that), Y from the face it
rests against, and Z along the corner from `origin`. */
function fillet(size, length, x, y, origin) {
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return Part.makePrism([[-0.2, 0.0], [size, 0.0], [0.0, size], [-0.2, size]], length).transformed(geom.fromAxes(x, y, z, origin));
}

/** A panel case's base, split into its floor and walls (case frame): {part
id: shape}. Its inside corners are square; the walls stand on the floor,
and the front and back walls fit between the left and right ones, butt
jointed, the outside's shaped corners going with whichever panel they're
in. A fillet along the bottom of each wall rests on the floor, and one up
each end of the left and right walls rests against the front or back wall
(to `top`) - the front and back walls' bottom fillets stop short of the
corners' fillets and bolt blocks. */
export function panelShells(caseSpec, box, top) {
  const base = box.get_base();
  const W = caseSpec.width, D = caseSpec.depth;
  const F = dm.PANEL_FILLET;
  const B = 10000.0;
  const region = (x0, x1, y0, y1, z0, z1) => Part.makeBox(x1 - x0, y1 - y0, z1 - z0, [x0, y0, z0]);
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
  // (Each split's faces either cut through material or lie on a face of the
  // shell with the material on the same side: one lying on the inside of a
  // wall or the floor with the material on the other side would leave a
  // flat sheet of nothing behind across the case.)
  const walls = base.cut(region(-B, B, -B, B, -B, 0.0));
  const ends = walls.cut(region(-B, 0.0, -B, B, -B, B)).cut(region(W, B, -B, B, -B, B));
  const clear = dm.PANEL_BLOCK_DEPTH + 0.5;
  const along = Math.max(0.0, W - 2 * clear);
  const out = {};
  out[caseSpec.floor_part] = base.common(region(-B, B, -B, B, -B, 0.0));
  const ending = (shape, x, y, origin) => (along > 0 ? shape.fuse(fillet(F, along, x, y, origin)) : shape);
  out[caseSpec.wall_part("front")] = ending(ends.common(region(-B, B, -B, D / 2.0, -B, B)), Y, Z, [clear, 0.0, 0.0]);
  out[caseSpec.wall_part("back")] = ending(ends.common(region(-B, B, D / 2.0, B, -B, B)), nY, Z, [W - clear, D, 0.0]);
  for (const side of ["left", "right"]) {
    const left = side === "left";
    let shape = walls.common(left ? region(-B, 0.0, -B, B, -B, B) : region(W, B, -B, B, -B, B));
    const inward = left ? X : nX;
    shape = shape.fuse(fillet(F, D, inward, Z, left ? [0.0, D, 0.0] : [W, 0.0, 0.0]));
    if (top > 0) {
      // Up the corners: resting against the front, then the back.
      shape = shape.fuse(fillet(F, top, inward, Y, left ? [0.0, 0.0, 0.0] : [W, 0.0, top]));
      shape = shape.fuse(fillet(F, top, inward, nY, left ? [0.0, D, top] : [W, D, 0.0]));
    }
    out[caseSpec.wall_part(side)] = shape;
  }
  return out;
}

/** A panel bolt's shapes (case frame): [its block, what's cut from the part
the block's on - the hole the bolt screws into (or its hole and the nut's
socket, at the far end of the block) - and the hole cut through the part it
goes through]. `bolt` is from Design.panel_bolts(). */
export function panelBoltParts(caseSpec, bolt) {
  const [x0, x1, y0, y1, z0, z1] = bolt.box;
  // Sunk a little into its own wall, so it fuses into one with it.
  const sink = 0.2;
  const [axis, lowHigh] = dm.SIDE_AXIS[bolt.side];
  const lo = [x0, y0, z0], hi = [x1, y1, z1];
  if (lowHigh === "low") lo[axis] -= sink;
  else hi[axis] += sink;
  const block = Part.makeBox(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], lo);
  const n = bolt.dir;
  const length = Math.hypot(...[0, 1, 2].map((i) => bolt.end_at[i] - bolt.head[i])) + 2.0;
  const start = bolt.head.map((v, i) => v - n[i]);
  const hole = (diameter) => Part.makeCylinder(diameter / 2.0, length, start, n);
  let grip = hole(caseSpec.panel_nuts ? dm.SCREW_HOLE : dm.PANEL_TAP_HOLE);
  if (caseSpec.panel_nuts) {
    // A hexagon, its corners along the wall (the block's long way across).
    const u = bolt.kind === "floor" ? (axis === 0 ? [0, 1, 0] : [1, 0, 0]) : [0, 0, 1];
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const flats = dm.NUT_ACROSS_FLATS;
    const c = flats / 3 ** 0.5;
    const deep = dm.NUT_THICKNESS + 0.3;
    const hexagon = [[c, 0], [c / 2.0, flats / 2.0], [-c / 2.0, flats / 2.0], [-c, 0], [-c / 2.0, -flats / 2.0], [c / 2.0, -flats / 2.0]];
    const origin = bolt.end_at.map((value, i) => value - n[i] * deep);
    grip = grip.fuse(Part.makePrism(hexagon, deep + 1.0).transformed(geom.fromAxes(u, v, n, origin)));
  }
  return [block, grip, hole(dm.SCREW_HOLE)];
}
