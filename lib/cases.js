/* Case shapes - ported from custard-cream-case's cases.py. The single-lid Box family: Square, MusicBox,
Round, Rounded and Bevelled; and Frame, a picture frame.

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

/** Shared corner-rounding recipe behind MusicBox's
_shaped_box() - cut a square corner away and fill it with a matching
cylinder, for each [x_sign, y_sign, radius] in `corners`. */
function cornerRoundedBox(width, depth, height, position, corners) {
  // Its cross-section rounded and stood up, rather than square corners cut
  // out of a box and cylinders put back: at some sizes, what those leave
  // only nearly meets, and a crack's left inside the walls (which slicers
  // take for faces the wrong way round). (The corners are all the same.)
  const r = Math.max(0.0, Math.min(...corners.map((c) => c[2]), width / 2.0 - 0.01, depth / 2.0 - 0.01));
  const [x0, y0, z0] = position.map(Number);
  const section = r > 0
    ? Section.square(width - 2 * r, depth - 2 * r).translate(r, r).offset(r, "Round", 2.0, Part.circleSegments(r))
    : Section.square(width, depth);
  return Part.extrudeSection(section.translate(x0, y0), height, z0);
}

/** Rectangular box with all 4 corners lightly rounded (radius 5mm). */
export class MusicBox extends Box {
  _shaped_box(width, depth, height, position) {
    return cornerRoundedBox(width, depth, height, position, [[-1, -1, 5], [1, -1, 5], [-1, 1, 5], [1, 1, 5]]);
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

/* A picture frame (a case of style "Frame"), lying on its back, its picture
facing up:

- its back (the base) is a tray: the floor, and walls the case's height,
  for anything in the frame (the space behind the picture);
- its picture is on a flat plate (the lid, no skirt) as big as the tray,
  sitting on the tray's walls;
- the frame goes round both, from the back's underside up past the plate,
  its front (frame_front thick) overlapping the plate's edges by frame_lip;
  the back and the plate drop into it from behind;
- turn buttons, screwed into the frame's back, hold the back in: turned
  along the frame, it comes out.

The frame's front edge, and the edge round the picture, are flat, bevelled
or rounded (frame_profile), `edge` mm. */
export class Frame extends Square {
  constructor({ frame_type = "full", frame_width = 12.0, frame_lip = 5.0, frame_front = 3.0, frame_profile = "bevelled", edge = 3.0,
    ...rest } = {}) {
    super(rest);
    Object.assign(this, { frame_type, frame_width, frame_lip, frame_front, frame_profile, edge });
  }

  /** How far the frame reaches behind the picture's plate: past the back
  (a full frame's), or the case's height (a simple frame's, which has no
  back). */
  _behind() {
    return this.base_side_height + (this.frame_type === "simple" ? 0.0 : this.base_thickness);
  }

  /** The tray: the floor and the walls, the full height (no step for a skirt). */
  get_base() {
    const t = this.wall_thickness;
    const tray = Part.makeBox(this.width + 2 * t, this.depth + 2 * t, this.base_side_height + this.base_thickness,
      [-t, -t, -this.base_thickness]);
    return tray.cut(Part.makeBox(this.width, this.depth, this.base_side_height + 1.0, [0, 0, 0]));
  }

  /** The picture's plate (in the lid's frame: Z -lid_thickness..0, its face
  at the bottom). */
  get_lid() {
    const t = this.wall_thickness;
    return Part.makeBox(this.width + 2 * t, this.depth + 2 * t, this.lid_thickness, [-t, -t, -this.lid_thickness]);
  }

  /** [x0, y0, x1, y1] of the opening the back and the plate drop into. */
  rebate() {
    const r = this.wall_thickness + this.fit_gap;
    return [-r, -r, this.width + r, this.depth + r];
  }

  /** [x0, y0, x1, y1] of the window in the frame's front the picture shows
  through. */
  window() {
    const r = this.wall_thickness - this.frame_lip;
    return [-r, -r, this.width + r, this.depth + r];
  }

  /** The frame, in the lid's frame (printed face down: its front at the
  bottom, Z -(lid_thickness + frame_front), its back at Z height, plus
  base_thickness for a full frame). */
  get_frame() {
    const [x0, y0, x1, y1] = this.rebate();
    const fw = this.frame_width;
    const front = -(this.lid_thickness + this.frame_front);
    const height = this._behind() - front;
    const [w, d] = [x1 - x0 + 2 * fw, y1 - y0 + 2 * fw];
    const at = [x0 - fw, y0 - fw, front];
    const e = Math.max(0.0, Math.min(this.edge, this.frame_front, fw / 2.0, height / 2.0));
    let frame;
    if (this.frame_profile === "bevelled" && e > 0) {
      const face = Part.makeBox(w - 2 * e, d - 2 * e, 0.01, [at[0] + e, at[1] + e, front]);
      frame = Part.hull([face, Part.makeBox(w, d, height - e, [at[0], at[1], front + e])]);
    } else if (this.frame_profile === "rounded" && e > 0) {
      const balls = [];
      for (const x of [at[0] + e, at[0] + w - e]) for (const y of [at[1] + e, at[1] + d - e]) balls.push(Part.makeSphere(e).translate([x, y, front + e]));
      frame = Part.hull([...balls, Part.makeBox(w, d, height - e, [at[0], at[1], front + e])]);
    } else {
      frame = Part.makeBox(w, d, height, at);
    }
    // The rebate, up to the plate's face (a little past it, for the fit).
    frame = frame.cut(Part.makeBox(x1 - x0, y1 - y0, height, [x0, y0, -this.lid_thickness - 0.05]));
    // The window, its edge bevelled (opening out towards the front) or not.
    const [wx0, wy0, wx1, wy1] = this.window();
    const b = this.frame_profile === "flat" ? 0.0 : Math.max(0.0, Math.min(this.edge, this.frame_front, this.frame_lip - 0.5));
    const [ww, wd] = [wx1 - wx0, wy1 - wy0];
    let window = Part.makeBox(ww, wd, this.frame_front + 1.0, [wx0, wy0, front - 0.5]);
    if (b > 0) {
      window = window.fuse(Part.hull([Part.makeBox(ww, wd, 0.01, [wx0, wy0, front + b]),
        Part.makeBox(ww + 2 * b, wd + 2 * b, 0.01, [wx0 - b, wy0 - b, front - 0.01])]));
    }
    return frame.cut(window);
  }
}

/** A simple frame's snap fit: [the ridges round the inside of the frame
(in the frame's own frame), the groove round the edge of the picture's
plate (in its frame)] - the ridges halfway up the plate's edge, reaching
SNAP_ENGAGE into the groove, stopping short of the corners so the frame's
sides can spring out as the plate's pushed in from behind. */
export function frameSnapParts(caseSpec) {
  const t = caseSpec.wall_thickness, W = caseSpec.width, D = caseSpec.depth;
  const z = caseSpec.height + caseSpec.lid_thickness / 2.0; // (case frame)
  const out = dm.SNAP_RADIUS - dm.SNAP_ENGAGE; // the line the ridges and grooves run along, out from the plate's edge
  const ridges = [];
  const grooves = [];
  // [axis it runs along, across it, from, to]
  for (const [axis, across, from, to] of [[0, -t - out, -t, W + t], [0, D + t + out, -t, W + t],
    [1, -t - out, -t, D + t], [1, W + t + out, -t, D + t]]) {
    const length = to - from;
    const margin = Math.min(dm.SNAP_MARGIN, length / 4.0);
    const extend = Math.min(dm.SNAP_EXTEND, margin / 2.0);
    const rod = (radius, a, b) => {
      const at = axis === 0 ? [a, across, z] : [across, a, z];
      return Part.makeCylinder(radius, b - a, at, axis === 0 ? [1, 0, 0] : [0, 1, 0]);
    };
    ridges.push(rod(dm.SNAP_RADIUS, from + margin, to - margin));
    grooves.push(rod(dm.SNAP_RADIUS + dm.SNAP_GAP / 2.0, from + margin - extend, to - margin + extend));
  }
  const toPart = geom.inverseRigid(dm.lidMatrix(caseSpec));
  return [Part.compound(ridges).transformed(toPart), Part.compound(grooves).transformed(toPart)];
}

/** A simple frame's hook hole (see design.HOOK_HEAD), in the frame's own
frame. */
export function hookHole(caseSpec) {
  const [, , , y1] = makeBox(caseSpec).rebate();
  const x = caseSpec.width / 2.0;
  const middle = y1 + caseSpec.frame_width / 2.0;
  const { HOOK_HEAD, HOOK_SHANK, HOOK_SLOT, HOOK_LIP, HOOK_DEPTH } = dm;
  const [hole, top] = [middle - HOOK_SLOT / 2.0, middle + HOOK_SLOT / 2.0];
  const r = HOOK_HEAD / 2.0;
  // (Case frame: the frame's back is Z 0, the wall behind it.)
  const along = (radius, z0, z1) => Part.hull([Part.makeCylinder(radius, z1 - z0, [x, hole, z0]),
    Part.makeCylinder(radius, z1 - z0, [x, top, z0])]);
  const cut = Part.makeCylinder(r, HOOK_LIP + HOOK_DEPTH + 0.01, [x, hole, -0.01])
    .fuse(along(HOOK_SHANK / 2.0, -0.01, HOOK_LIP + 0.01))
    .fuse(along(r, HOOK_LIP, HOOK_LIP + HOOK_DEPTH));
  return cut.transformed(geom.inverseRigid(dm.lidMatrix(caseSpec)));
}

// Turn buttons: this wide (twice their radius), this thick, reaching this far
// over the back; screwed on with self-tapping screws this size (into holes
// this deep in the frame).
export const BUTTON_RADIUS = 4.0;
export const BUTTON_THICKNESS = 2.5;
export const BUTTON_OVERLAP = 3.0;
export const BUTTON_SCREW = 2.9;
export const BUTTON_SCREW_DEPTH = 8.0;

/** Where a frame's turn buttons are, in the case frame: [[pivot [x, y], the
way in from it to the back [dx, dy]]...] - one on each side, two on a side
over 120mm. Each pivots on the middle of the frame's width. */
export function buttonPositions(caseSpec) {
  const box = makeBox(caseSpec);
  const [x0, y0, x1, y1] = box.rebate();
  const half = caseSpec.frame_width / 2.0;
  const out = [];
  const along = (start, end, at, inward) => {
    const n = end - start > 120.0 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const p = start + ((i + 0.5) * (end - start)) / n;
      out.push([inward[0] ? [at, p] : [p, at], inward]);
    }
  };
  along(x0, x1, y0 - half, [0, 1]);
  along(x0, x1, y1 + half, [0, -1]);
  along(y0, y1, x0 - half, [1, 0]);
  along(y0, y1, x1 + half, [-1, 0]);
  return out;
}

/** [the turn buttons (in the case frame, under the frame's back), the
holes for their screws (in the frame's own frame)]. */
export function buttonParts(caseSpec) {
  const z = -caseSpec.base_thickness - BUTTON_THICKNESS;
  const r = Math.min(BUTTON_RADIUS, caseSpec.frame_width / 2.0 - 0.5);
  const reach = caseSpec.frame_width / 2.0 + dm.FIT_GAP + BUTTON_OVERLAP - r; // pivot to the far end's middle
  const buttons = [];
  const holes = [];
  const toFrame = geom.inverseRigid(dm.lidMatrix(caseSpec));
  // (Stopping short of the frame's front.)
  const depth = Math.min(BUTTON_SCREW_DEPTH, dm.frameHeight(caseSpec) - 1.5);
  for (const [[px, py], [dx, dy]] of buttonPositions(caseSpec)) {
    const ends = [Part.makeCylinder(r, BUTTON_THICKNESS, [px, py, z]),
      Part.makeCylinder(r, BUTTON_THICKNESS, [px + dx * reach, py + dy * reach, z])];
    buttons.push(Part.hull(ends).cut(Part.makeCylinder(BUTTON_SCREW / 2.0 + 0.2, BUTTON_THICKNESS + 2.0, [px, py, z - 1.0])));
    // The screw's pilot hole, up into the frame from its back.
    const hole = Part.makeCylinder(0.4 * BUTTON_SCREW, depth + 0.01, [px, py, -caseSpec.base_thickness - 0.01]);
    holes.push(hole.transformed(toFrame));
  }
  return [Part.compound(buttons), Part.compound(holes)];
}

export const STYLES = { Square, MusicBox, Round, Rounded, Bevelled, Frame };

/** A Box for a design CaseSpec. Its own screw holes are left out: the
builder adds retaining screws with nut sockets instead (see screwParts()). */
export function makeBox(caseSpec) {
  const Cls = STYLES[caseSpec.style];
  const extra = Cls.prototype instanceof EdgedBox ? { edge: caseSpec.edge } : {};
  if (Cls === Frame) {
    Object.assign(extra, { edge: caseSpec.edge, frame_type: caseSpec.frame_type, frame_width: caseSpec.frame_width, frame_lip: caseSpec.frame_lip,
      frame_front: caseSpec.frame_front, frame_profile: caseSpec.frame_profile });
  }
  // The step in the base's walls is as deep as the lid's skirt, so the whole
  // skirt wraps over it and the lid sits down on the walls - at the top of
  // the case, or join_drop below it, the lid's sides coming down that far.
  const box = new Cls({
    base_side_height: dm.joinHeight(caseSpec), lid_side_height: caseSpec.join_drop + caseSpec.lid_height,
    wall_thickness: caseSpec.wall_thickness,
    base_thickness: caseSpec.base_thickness, lid_thickness: caseSpec.lid_thickness, screw_type: BaseScrewType.NO_SCREWS,
    fit_gap: dm.FIT_GAP, lid_inset_height: caseSpec.lid_height, ...extra,
  });
  box.width = caseSpec.width;
  box.depth = caseSpec.depth;
  box.square_inside = caseSpec.panels;
  return box;
}

/** The snap fit's shapes, in the case frame: [the ridges round the inside of
the lid's skirt, [[side, its groove round the base's wall]...]]. */
export function snapParts(caseSpec) {
  const ridges = [];
  const grooves = [];
  for (const run of dm.snapRuns(caseSpec)) {
    const rod = (radius, across, [a, b]) => {
      const at = run.axis === 0 ? [a, across, run.z] : [across, a, run.z];
      return Part.makeCylinder(radius, b - a, at, run.axis === 0 ? [1, 0, 0] : [0, 1, 0]);
    };
    if (run.ridgeRun[1] > run.ridgeRun[0]) ridges.push(rod(dm.SNAP_RADIUS, run.ridge, run.ridgeRun));
    if (run.grooveRun[1] > run.grooveRun[0]) grooves.push([run.side, rod(dm.SNAP_RADIUS + dm.SNAP_GAP / 2.0, run.groove, run.grooveRun)]);
  }
  return [ridges.length ? Part.compound(ridges) : null, grooves];
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
  const top = dm.joinHeight(caseSpec) - dm.NUT_TOP_MARGIN / 2.0;
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
