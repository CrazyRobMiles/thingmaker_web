/* The design model: what a thingmaker JSON file contains, and where every
case, part, surface, hinge and placement (a placed device or subassembly)
ends up in space. No geometry kernel and no GUI, so the editor and the
builder share exactly the same placement maths.

The files it reads and writes are the Python thingmaker's design files,
written the way Python's json.dump writes them, so either program can open
and save the other's designs.

Frames
------
world      The assembled design. Root cases are placed by their own
           position/rotation; a case on the far side of a hinge is placed by
           that hinge (see case_matrices()).
case       A case's own frame: the cavity is X 0..width, Y 0..depth,
           Z 0..height, the floor is below Z=0. "front" is the Y=0 wall,
           "back" the Y=depth wall, "left" the X=0 wall and "right" the
           X=width wall.
part       Each case is printed as two physical parts, "<case>.base" and
           "<case>.lid", each in the frame its geometry is built (and
           printed) in. The base's part frame is the case frame; the lid is
           printed open side up and flipped onto the base by lidMatrix().
surface    Each case has six surfaces things can be placed on. A surface
           frame has its origin at one corner of the surface, u (X) and v
           (Y) running across it and n (Z) pointing away from the material.
           "inside" mounts put the bulk in the cavity; "outside" mounts put
           it outside the case. Seen from the side the bulk is on, u runs
           left to right and v runs upwards.
placement  A placed device's or subassembly's own frame (see
           lib/devices.js). Its position on a surface is the minimum corner
           of its (rotated) footprint. */
import * as files from "#files";
import * as geom from "./geom.js";
import * as catalogue from "./catalogue.js";
import * as decoration from "./decoration.js";
import { deepCopy, dumps, fmtF, fmtG, mod, pyCompare, pyFloat, pyRound, repr, sorted } from "./py.js";

export const FORMAT = "thingmaker-design";
export const VERSION = 2;

export const SURFACES = ["bottom", "top", "front", "back", "left", "right"];
export const MOUNTS = ["inside", "outside"];
export const EDGES = ["back", "front", "left", "right"];
export const ROTATIONS = [0, 90, 180, 270];
// Case styles the editor offers ("Round" walls aren't flat surfaces).
export const CASE_STYLES = ["MusicBox", "Square", "RoundBottom", "Rounded", "Bevelled"];
// Styles whose outside edges are all shaped, by the case's `edge`.
export const EDGE_STYLES = ["Rounded", "Bevelled"];
// The thinnest the shaped edges may leave the walls before it's a problem.
export const MIN_EDGE_WALL = 1.0;

// The six sides of a case: which case axis (0 = X/width, 1 = Y/depth,
// 2 = Z/height) each lies across, and whether it's that axis's low or high
// end. A surface is named after the side it's on.
export const SIDE_AXIS = {
  left: [0, "low"], right: [0, "high"], front: [1, "low"], back: [1, "high"], bottom: [2, "low"], top: [2, "high"],
};
export const OPPOSITE_SIDE = { left: "right", right: "left", front: "back", back: "front", bottom: "top", top: "bottom" };

/** The sides a placement on `surfaceName` can stick to: the four next to
that surface. */
export function stickSides(surfaceName) {
  const axis = SIDE_AXIS[surfaceName][0];
  return ["left", "right", "front", "back", "bottom", "top"].filter((side) => SIDE_AXIS[side][0] !== axis);
}

export class DesignError extends Error {}

const surfaceSidesCache = new Map();

/** {side: [direction, end]} for the four case sides next to a surface: which
way across the surface each lies ("u" across, "v" up, as seen from the side
a placement is on) and at which end ("low" or "high"). */
export function surfaceSides(surfaceName, mount = "inside") {
  const key = `${surfaceName}|${mount}`;
  if (!surfaceSidesCache.has(key)) {
    const probe = new CaseSpec("probe", { width: 100.0, depth: 80.0, height: 60.0 });
    const m = surface(probe, surfaceName, mount).case_matrix;
    const out = {};
    for (const side of stickSides(surfaceName)) {
      const [axis, end] = SIDE_AXIS[side];
      for (const [col, direction] of [[0, "u"], [1, "v"]]) {
        if (Math.abs(m[axis][col]) > 0.5) out[side] = [direction, m[axis][col] > 0 ? end : end === "low" ? "high" : "low"];
      }
    }
    surfaceSidesCache.set(key, out);
  }
  return surfaceSidesCache.get(key);
}

/** Which way the device's own X and Y run across its surface when it's
turned by `rotation`: [[direction, positive], [direction, positive]]. */
export function deviceAxes(rotation) {
  const m = footprintMatrix(rotation, 1.0, 1.0);
  return [[1, 0, 0], [0, 1, 0]].map((vec) => {
    const [du, dv] = geom.applyVector(m, vec);
    return Math.abs(du) > 0.5 ? ["u", du > 0] : ["v", dv > 0];
  });
}

function num(value, name) {
  try {
    return pyFloat(value);
  } catch (e) {
    throw new DesignError(`${name} must be a number (got ${repr(value)})`);
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A box-style case: a base and a lid. width/depth/height are the INSIDE
dimensions of the cavity; lid_height is the lid's skirt. width and depth
are worked out by Design.relayout(). decorations: {surface: {text: {...},
image: {...}}}, see lib/decoration.js. */
export class CaseSpec {
  static FIELDS = [
    // name, default, description
    ["style", "MusicBox", "Case style"],
    ["width", 100.0, "Inside width, X (mm)"],
    ["depth", 80.0, "Inside depth, Y (mm)"],
    ["height", 30.0, "Inside height, floor to lid (mm)"],
    ["lid_height", 5.0, "Lid skirt height (mm)"],
    ["wall_thickness", 3.0, "Wall thickness (mm)"],
    ["base_thickness", 3.0, "Floor thickness (mm)"],
    ["lid_thickness", 3.0, "Lid thickness (mm)"],
    ["edge", 3.0, "Rounded: radius of the outside edges; Bevelled: how far in from each face the bevel goes (mm)"],
    ["min_width", 0.0, "Minimum inside width (mm); 0 = just fit what's placed in it"],
    ["min_depth", 0.0, "Minimum inside depth (mm); 0 = just fit what's placed in it"],
  ];

  static MINIMUMS = ["min_width", "min_depth"];

  constructor(id, kwargs = {}) {
    const rest = { ...kwargs };
    this.id = id;
    for (const [name, dflt] of CaseSpec.FIELDS) {
      this[name] = name in rest ? rest[name] : dflt;
      delete rest[name];
    }
    this.position = "position" in rest ? Array.from(rest.position) : [0.0, 0.0, 0.0];
    delete rest.position;
    this.rotation = "rotation" in rest ? rest.rotation : 0.0;
    delete rest.rotation;
    this.decorations = rest.decorations || {};
    delete rest.decorations;
    const unknown = Object.keys(rest);
    if (unknown.length) throw new DesignError(`Case ${repr(id)} has unknown field(s): ${sorted(unknown).join(", ")}`);
    this.normalise();
  }

  normalise() {
    if (!CASE_STYLES.includes(this.style)) {
      throw new DesignError(`Case ${repr(this.id)}: unknown style ${repr(this.style)} (known: ${CASE_STYLES.join(", ")})`);
    }
    for (const [name] of CaseSpec.FIELDS.slice(1)) {
      const value = num(this[name], `case ${this.id}.${name}`);
      if (CaseSpec.MINIMUMS.includes(name)) {
        if (value < 0) throw new DesignError(`case ${this.id}.${name} can't be negative`);
      } else if (!(value > 0)) {
        throw new DesignError(`case ${this.id}.${name} must be positive`);
      }
      this[name] = value;
    }
    if (!Array.isArray(this.position) || this.position.length !== 3) throw new DesignError(`case ${this.id}.position must be [x, y, z]`);
    this.position = this.position.map((v) => num(v, `case ${this.id}.position`));
    this.rotation = num(this.rotation, `case ${this.id}.rotation`);
    try {
      this.decorations = decoration.normalise(this.id, this.decorations);
    } catch (e) {
      if (e instanceof decoration.DecorationError) throw new DesignError(e.message);
      throw e;
    }
  }

  get base_part() {
    return this.id + ".base";
  }

  get lid_part() {
    return this.id + ".lid";
  }

  get parts() {
    return [this.base_part, this.lid_part];
  }

  to_dict() {
    const d = { id: this.id };
    for (const [name] of CaseSpec.FIELDS) d[name] = this[name];
    d.position = [...this.position];
    d.rotation = this.rotation;
    if (Object.keys(this.decorations).length) d.decorations = decoration.compact(this.decorations);
    return d;
  }

  static from_dict(d) {
    const { id, ...rest } = d;
    return new CaseSpec(id, rest);
  }
}

/** A knuckle hinge joining two cases along one edge of each, with its pivot
on the cases' shared rear top edge. cases[0] keeps its own placement;
cases[1] is positioned by the hinge, folded open by open_angle degrees
(0 = shut face to face on top of cases[0], upside down; 180 = opened out
flat behind it). */
export class HingeSpec {
  static FIELDS = [
    ["edge", "back", "Edge of both cases the hinge runs along"],
    ["open_angle", 110.0, "Opening angle for the assembled view (degrees)"],
    ["margin", 10.0, "Distance from each end of the case's outside edge to the hinge (mm)"],
    ["outer_radius", 4.0, "Knuckle radius (mm)"],
    ["knuckles", 0, "Number of knuckles (odd); 0 = about one per 12mm"],
    ["knuckle_gap", 0.5, "Gap between neighbouring knuckles (mm)"],
    ["clearance", 0.4, "Radial clearance round the other case's knuckles (mm)"],
    ["anchor", 4.0, "How far each knuckle's mounting block reaches into the case (mm)"],
    ["pin_grip_diameter", 2.4, "Pin hole in the fixed case's knuckles (mm)"],
    ["pin_turn_diameter", 2.9, "Pin hole in the hinged case's knuckles (mm)"],
    ["pin_inner_diameter", 0.0, "Hole in the innermost knuckle(s), for bolts screwed into it from each end (mm); 0 = off"],
    ["gap", 0.0, "Space between the two cases' lids when the hinge is shut (mm)"],
    ["cable_gap", 0.0, "Gap in the middle of the hinge for a ribbon cable (mm); 0 = none"],
    ["cable_cover", true, "Cover the back of the cable gap"],
    ["open_limit", 110.0, "Angle the hinge stops opening at (degrees); 0 = no stop"],
    ["bolt_head_diameter", 5.0, "Diameter of the heads of the bolts in the ends of the hinge (mm); 0 = none - the lids " +
      "get slots to fit over them"],
    ["bolt_head_height", 3.0, "How far those bolt heads stand out from the ends of the hinge (mm)"],
  ];

  constructor(id, cases, kwargs = {}) {
    const rest = { ...kwargs };
    this.id = id;
    this.cases = Array.from(cases || []);
    for (const [name, dflt] of HingeSpec.FIELDS) {
      this[name] = name in rest ? rest[name] : dflt;
      delete rest[name];
    }
    const unknown = Object.keys(rest);
    if (unknown.length) throw new DesignError(`Hinge ${repr(id)} has unknown field(s): ${sorted(unknown).join(", ")}`);
    this.normalise();
  }

  normalise() {
    if (this.cases.length !== 2 || this.cases[0] === this.cases[1]) throw new DesignError(`Hinge ${repr(this.id)} must join two different cases`);
    if (!EDGES.includes(this.edge)) throw new DesignError(`Hinge ${repr(this.id)}: edge must be one of ${EDGES.join(", ")}`);
    for (const [name, dflt] of HingeSpec.FIELDS.slice(1)) {
      if (typeof dflt === "boolean") {
        if (typeof this[name] !== "boolean") throw new DesignError(`hinge ${this.id}.${name} must be true or false`);
        continue;
      }
      this[name] = num(this[name], `hinge ${this.id}.${name}`);
    }
    this.knuckles = Math.trunc(this.knuckles);
    const id = repr(this.id);
    if (this.gap < 0) throw new DesignError(`Hinge ${id}: gap can't be negative`);
    if (this.margin < 0) throw new DesignError(`Hinge ${id}: margin can't be negative`);
    if (this.cable_gap < 0) throw new DesignError(`Hinge ${id}: cable gap can't be negative`);
    if (this.open_limit && !(this.open_limit > 0 && this.open_limit < 180)) {
      throw new DesignError(`Hinge ${id}: the stop angle must be between 0 and 180 degrees (0 = no stop)`);
    }
    if (this.knuckles && !this.cable_gap && (this.knuckles < 3 || mod(this.knuckles, 2) === 0)) {
      throw new DesignError(`Hinge ${id}: knuckles must be an odd number, 3 or more (or 0 for automatic)`);
    }
  }

  to_dict() {
    const d = { id: this.id, cases: [...this.cases] };
    for (const [name] of HingeSpec.FIELDS) d[name] = this[name];
    return d;
  }

  static from_dict(d) {
    const { id, cases, ...rest } = d;
    return new HingeSpec(id, cases, rest);
  }
}

const PLACEMENT_FIELDS = ["surface", "mount", "x", "y", "rotation", "params", "connector_cuts", "connector_cut_targets", "stick"];

/** One device or subassembly from the catalogue placed on a case surface.
The two are handled in exactly the same way - `kind` says which it is.

connector_cuts: {cut name: true/false} for every connector cut (or
subassembly cutout) it has; any left out of a design file are on.
connector_cut_targets: part ids the connector cuts are applied to (null =
both parts of the case it's in). stick: up to two sides of the case it goes
against. */
export class Placement {
  constructor(id, type, kase, { surface = "bottom", mount = "inside", x = 0.0, y = 0.0, rotation = 0, params = null,
    connector_cuts = null, connector_cut_targets = null, stick = null } = {}) {
    this.id = id;
    this.type = type;
    this.case = kase;
    this.surface = surface;
    this.mount = mount;
    this.x = x;
    this.y = y;
    this.rotation = rotation;
    this.params = { ...(params || {}) };
    this.connector_cuts = connector_cuts;
    this.connector_cut_targets = connector_cut_targets === null || connector_cut_targets === undefined ? null : [...connector_cut_targets];
    this.stick = [...(stick || [])];
    this.normalise();
  }

  normalise() {
    if (!(this.type in catalogue.CATALOG)) {
      throw new DesignError(`${repr(this.id)}: no device or subassembly called ${repr(this.type)} (known: ${sorted(Object.keys(catalogue.CATALOG)).join(", ")})`);
    }
    if (!SURFACES.includes(this.surface)) throw new DesignError(`${repr(this.id)}: surface must be one of ${SURFACES.join(", ")}`);
    if (!MOUNTS.includes(this.mount)) throw new DesignError(`${repr(this.id)}: mount must be one of ${MOUNTS.join(", ")}`);
    this.x = num(this.x, `${this.id}.x`);
    this.y = num(this.y, `${this.id}.y`);
    this.rotation = mod(Math.trunc(num(this.rotation, `${this.id}.rotation`)), 360);
    if (!ROTATIONS.includes(this.rotation)) throw new DesignError(`${repr(this.id)}: rotation must be one of (${ROTATIONS.join(", ")})`);
    this.connector_cuts = this._normalise_cuts(this.connector_cuts);
    const allowed = stickSides(this.surface);
    const bad = this.stick.filter((s) => !allowed.includes(s));
    if (bad.length) {
      throw new DesignError(`${repr(this.id)} on the ${this.surface} can only stick to ${allowed.join(", ")} (not ${bad.join(", ")})`);
    }
    if (new Set(this.stick).size !== this.stick.length || this.stick.length > 2) {
      throw new DesignError(`${repr(this.id)} can stick to at most two different sides`);
    }
    if (this.stick.length === 2 && OPPOSITE_SIDE[this.stick[0]] === this.stick[1]) {
      throw new DesignError(`${repr(this.id)} can't stick to two opposite sides (${this.stick.join(" and ")})`);
    }
  }

  /** A full {name: bool} map of this placement's connector cuts - any not
  given (or all of them, for null) are on. */
  _normalise_cuts(cuts) {
    const names = this.make().connector_cuts().map((cc) => cc.name);
    if (cuts === null || cuts === undefined) cuts = {};
    else if (!isPlainObject(cuts)) throw new DesignError(`${repr(this.id)}: connector_cuts must map cut names to true/false`);
    const unknown = sorted(Object.keys(cuts).filter((c) => !names.includes(c)));
    if (unknown.length) {
      throw new DesignError(`${repr(this.id)} (${this.type}) has no connector cut or cutout ${unknown.join(", ")} (it has: ${names.join(", ") || "none"})`);
    }
    const out = {};
    for (const name of names) out[name] = name in cuts ? Boolean(cuts[name]) : true;
    return out;
  }

  /** "device" for a built-in device, "subassembly" for one made from STL files. */
  get kind() {
    return catalogue.kindOf(this.type);
  }

  /** {side: margin} for the four sides next to its surface. */
  margins() {
    const defaults = catalogue.CATALOG[this.type].all_params();
    const out = {};
    for (const side of stickSides(this.surface)) {
      const key = `margin_${side}`;
      out[side] = key in this.params ? this.params[key] : defaults[key][0];
    }
    return out;
  }

  /** A fresh instance of the device or subassembly class, with this
  placement's parameter overrides - its side margins and recess size turned
  into its own frame for the way round it is on its surface. */
  make() {
    const known = this.type in catalogue.CATALOG;
    const across = {};
    const margins = known ? this.margins() : null;
    for (const [side, [direction, end]] of Object.entries(surfaceSides(this.surface, this.mount))) {
      across[`${direction}|${end}`] = known ? margins[side] : 0.5;
    }
    const recess = { u: this.params.recess_width ?? 0.0, v: this.params.recess_height ?? 0.0 };
    const hole = { u: this.params.recess_hole_across ?? 0.0, v: this.params.recess_hole_up ?? 0.0 };
    const ms = [];
    const well = [];
    const holeOffset = [];
    for (const [direction, positive] of deviceAxes(this.rotation)) {
      const low = across[`${direction}|low`];
      const high = across[`${direction}|high`];
      ms.push(...(positive ? [low, high] : [high, low]));
      well.push(recess[direction]);
      holeOffset.push(positive ? hole[direction] : -hole[direction]);
    }
    try {
      return catalogue.make(this.type, this.id, this.params, { margins: ms, well, holeOffset });
    } catch (e) {
      if (e instanceof DesignError) throw e;
      throw new DesignError(`${repr(this.id)}: ${e.message}`);
    }
  }

  to_dict() {
    return {
      id: this.id, type: this.type, case: this.case, surface: this.surface, mount: this.mount, x: this.x, y: this.y,
      rotation: this.rotation, params: { ...this.params }, connector_cuts: { ...this.connector_cuts },
      connector_cut_targets: this.connector_cut_targets, stick: [...this.stick],
    };
  }

  static from_dict(d) {
    const unknown = sorted(Object.keys(d).filter((k) => !PLACEMENT_FIELDS.includes(k) && !["id", "type", "case"].includes(k)));
    if (unknown.length) throw new DesignError(`${repr(d.id ?? null)} has unknown field(s): ${unknown.join(", ")}`);
    const { id, type, case: kase, ...rest } = d;
    return new Placement(id, type, kase, rest);
  }
}

/** A placed surface: which part it belongs to, its frame within that part
(part_matrix) and within the case (case_matrix), its extent (u 0..width,
v 0..height) and the material thickness placements mount through. */
export class Surface {
  constructor(kase, name, mount, partId, caseMatrix, partMatrix, width, height, thickness) {
    this.case = kase;
    this.name = name;
    this.mount = mount;
    this.part_id = partId;
    this.case_matrix = caseMatrix;
    this.part_matrix = partMatrix;
    this.width = width;
    this.height = height;
    this.thickness = thickness;
  }
}

/** Lid part frame -> case frame: flip the lid (printed open side up) over
about X and sit its plate's inner face on top of the walls. */
export function lidMatrix(kase) {
  return geom.mul(geom.translate(0, kase.depth, kase.height), geom.rotX(180));
}

export function partInCaseMatrix(kase, partId) {
  if (partId === kase.base_part) return geom.identity();
  if (partId === kase.lid_part) return lidMatrix(kase);
  throw new DesignError(`Part ${repr(partId)} does not belong to case ${repr(kase.id)}`);
}

/** The Surface `name` of `kase` (see the top of this file). */
export function surface(kase, name, mount = "inside") {
  const W = kase.width, D = kase.depth, H = kase.height;
  const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
  const nX = [-1, 0, 0], nY = [0, -1, 0], nZ = [0, 0, -1];
  // name: [u, v, n, origin, extent u, extent v, thickness, part]
  const table = {
    bottom: [X, Y, Z, [0, 0, 0], W, D, kase.base_thickness, kase.base_part],
    top: [X, nY, nZ, [0, D, H], W, D, kase.lid_thickness, kase.lid_part],
    front: [nX, Z, Y, [W, 0, 0], W, H, kase.wall_thickness, kase.base_part],
    back: [X, Z, nY, [0, D, 0], W, H, kase.wall_thickness, kase.base_part],
    left: [Y, Z, X, [0, 0, 0], D, H, kase.wall_thickness, kase.base_part],
    right: [nY, Z, nX, [W, D, 0], D, H, kase.wall_thickness, kase.base_part],
  };
  if (!(name in table)) throw new DesignError(`Unknown surface ${repr(name)}`);
  const [u, v, n, origin, width, height, thickness, partId] = table[name];
  let m = geom.fromAxes(u, v, n, origin);
  if (mount === "outside") {
    // Turn the frame over about its own v axis so n points out of the case,
    // with the origin moved onto the outer face of the material.
    m = geom.mul(m, geom.translate(width, 0, -thickness), geom.rotY(180));
  } else if (mount !== "inside") {
    throw new DesignError(`Unknown mount ${repr(mount)}`);
  }
  const partM = geom.mul(geom.inverseRigid(partInCaseMatrix(kase, partId)), m);
  return new Surface(kase, name, mount, partId, m, partM, width, height, thickness);
}

/** Turn a placement about its own Z by `rotation` and bring its footprint's
minimum corner back to the origin. */
export function footprintMatrix(rotation, nativeWidth, nativeDepth) {
  const shift = { 0: [0, 0], 90: [nativeDepth, 0], 180: [nativeWidth, nativeDepth], 270: [0, nativeWidth] }[rotation];
  return geom.mul(geom.translate(shift[0], shift[1], 0), geom.rotZ(rotation));
}

export function renderedSize(rotation, nativeWidth, nativeDepth) {
  return rotation === 90 || rotation === 270 ? [nativeDepth, nativeWidth] : [nativeWidth, nativeDepth];
}

/** A hinge's pivot frame on one edge of a case, in the case frame: the
origin is the middle of the pivot axis, X runs along the edge, Y points out
of the case and Z up. The pivot lies in line with the outside of the wall,
half the hinge's `gap` above the top of the closed lid. */
export function edgeFrame(kase, edge, gap = 0.0) {
  const W = kase.width, D = kase.depth, h = kase.height + kase.lid_thickness + gap / 2.0;
  const off = kase.wall_thickness;
  if (edge === "back") return geom.fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [W / 2.0, D + off, h]);
  if (edge === "front") return geom.fromAxes([-1, 0, 0], [0, -1, 0], [0, 0, 1], [W / 2.0, -off, h]);
  if (edge === "left") return geom.fromAxes([0, 1, 0], [-1, 0, 0], [0, 0, 1], [-off, D / 2.0, h]);
  if (edge === "right") return geom.fromAxes([0, -1, 0], [1, 0, 0], [0, 0, 1], [W + off, D / 2.0, h]);
  throw new DesignError(`Unknown edge ${repr(edge)}`);
}

// Shorter than this (three knuckles' worth) and a hinge isn't built.
export const MIN_HINGE_LENGTH = 6.0;
// How far a hinge with a cable cover can open before the cover starts to
// pinch the cable.
export const COVER_OPEN_LIMIT = 135.0;
// Retaining screws: M3 bolts in from outside, through the lid's skirt and
// the base's wall, into nuts held in sockets on the inside of the base's
// wall.
export const SCREW_STYLES = ["Square", "MusicBox", "Rounded", "Bevelled"];
export const SCREW_HOLE = 3.2;
export const NUT_ACROSS_FLATS = 5.6;
export const NUT_THICKNESS = 2.7;
export const NUT_TOP_MARGIN = 0.4; // nut socket's top below the base's rim
export const NUT_BLOCK_WALL = 1.2;
export const SCREW_INSET = 5.0;

/** Height (case frame) of the retaining screws' axis. */
export function screwHeight(kase) {
  return kase.height - NUT_TOP_MARGIN - NUT_ACROSS_FLATS / 2.0;
}

/** Half the width of the block holding a nut (along its wall). */
export function nutBlockHalfWidth() {
  return NUT_ACROSS_FLATS / 3 ** 0.5 + NUT_BLOCK_WALL;
}

// Clearance between a lid's skirt and the step in the base's walls it fits over.
export const FIT_GAP = 0.15;
// Room left between a recess (or a battery compartment) and the walls of the
// case it goes into, and anything that stands in from them above it.
export const PASS_CLEARANCE = 0.5;

/** How far down the base's walls are stepped for the lid's skirt. */
export function lidFitDepth(kase) {
  return kase.lid_height + FIT_GAP;
}

/** How far along each wall from the inside corner a Rounded or Bevelled
case's corner shaping reaches. */
export function insideCorner(kase) {
  if (kase.style === "Rounded") return Math.max(0.0, kase.edge - kase.wall_thickness);
  if (kase.style === "Bevelled") return Math.max(0.0, kase.edge - (2.0 - 2 ** 0.5) * kase.wall_thickness);
  return 0.0;
}

/** How thick a Rounded or Bevelled case is left across the edge between a
wall and the floor or the lid's plate. */
export function edgeWall(kase, endThickness) {
  const t = kase.wall_thickness, e = kase.edge;
  if (kase.style === "Rounded") {
    if (e <= Math.min(t, endThickness)) return Math.min(t, endThickness);
    const dx = Math.max(0.0, e - t), dz = Math.max(0.0, e - endThickness);
    return Math.min(t, endThickness, e - (dx * dx + dz * dz) ** 0.5);
  }
  if (kase.style === "Bevelled") return Math.min(t, endThickness, (t + endThickness - e) / 2 ** 0.5);
  return Math.min(t, endThickness);
}

/** [depth into the case, drop below the pivot] of a hinge's anchor block. */
export function anchorSize(kase, hinge) {
  const lt = kase.lid_thickness;
  const depth = Math.max(hinge.outer_radius, kase.wall_thickness + hinge.anchor);
  const belowLidTop = Math.max(Math.max(hinge.outer_radius, lt) + hinge.anchor, lt + lidFitDepth(kase));
  return [depth, belowLidTop + hinge.gap / 2.0];
}

/** The inside length of a case edge. */
export function edgeLength(kase, edge) {
  return edge === "back" || edge === "front" ? kase.width : kase.depth;
}

export function outerEdgeLength(kase, edge) {
  return edgeLength(kase, edge) + 2 * kase.wall_thickness;
}

/** Case-1 edge frame -> case-0 edge frame: shut and then swung open. */
export function hingeFoldMatrix(openAngle) {
  return geom.mul(geom.rotX(-openAngle), geom.rotY(180));
}

function argmaxFirst(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function sameState(a, b) {
  return a.length === b.length && a.every((x, i) => x.length === b[i].length && x.every((v, j) =>
    Array.isArray(v) ? v.every((w, k) => w === b[i][j][k]) : v === b[i][j]));
}

export class Design {
  constructor({ name = "Untitled", cases = null, hinges = null, placements = null } = {}) {
    this.name = name;
    this.cases = [...(cases || [])];
    this.hinges = [...(hinges || [])];
    this.placements = [...(placements || [])];
  }

  // -- persistence --

  to_dict() {
    // Devices and subassemblies are placed and handled identically, but the
    // file lists them separately.
    return {
      format: FORMAT, version: VERSION, name: this.name,
      cases: this.cases.map((c) => c.to_dict()),
      hinges: this.hinges.map((h) => h.to_dict()),
      devices: this.placements.filter((d) => d.kind === "device").map((d) => d.to_dict()),
      subassemblies: this.placements.filter((d) => d.kind === "subassembly").map((d) => d.to_dict()),
    };
  }

  static from_dict(d) {
    if (!isPlainObject(d)) throw new DesignError("Not a thingmaker design");
    if ((d.format ?? FORMAT) !== FORMAT) throw new DesignError(`Not a thingmaker design (format ${repr(d.format)})`);
    if ((d.version ?? VERSION) > VERSION) {
      throw new DesignError(`Design file version ${repr(d.version)} is newer than this thingmaker (${VERSION})`);
    }
    const placed = [];
    for (const [key, kind] of [["devices", "device"], ["subassemblies", "subassembly"]]) {
      for (const x of d[key] || []) {
        const spec = Placement.from_dict(x);
        if (spec.kind !== kind) {
          throw new DesignError(`${repr(spec.id)} is a ${spec.kind}, so it belongs in the design's ` +
            `${spec.kind === "device" ? "devices" : "subassemblies"} list, not ${key}`);
        }
        placed.push(spec);
      }
    }
    const design = new Design({
      name: d.name ?? "Untitled",
      cases: (d.cases || []).map((c) => CaseSpec.from_dict(c)),
      hinges: (d.hinges || []).map((h) => HingeSpec.from_dict(h)),
      placements: placed,
    });
    design.check_references();
    design.relayout();
    return design;
  }

  static load(file) {
    let data;
    try {
      data = JSON.parse(files.readText(file));
    } catch (e) {
      if (e instanceof SyntaxError) throw new DesignError(`${file} isn't a JSON file: ${e.message}`);
      throw e;
    }
    return Design.from_dict(data);
  }

  /** The design file's text, as the Python thingmaker writes it. */
  dumps() {
    return dumpDesign(this.to_dict());
  }

  save(file) {
    files.writeFile(file, this.dumps() + "\n");
  }

  copy() {
    return Design.from_dict(deepCopy(this.to_dict()));
  }

  // -- lookup --

  case(caseId) {
    const c = this.cases.find((x) => x.id === caseId);
    if (!c) throw new DesignError(`No case ${repr(caseId)}`);
    return c;
  }

  hinge(hingeId) {
    const h = this.hinges.find((x) => x.id === hingeId);
    if (!h) throw new DesignError(`No hinge ${repr(hingeId)}`);
    return h;
  }

  placement(placementId) {
    const p = this.placements.find((x) => x.id === placementId);
    if (!p) throw new DesignError(`No device or subassembly ${repr(placementId)}`);
    return p;
  }

  part_ids() {
    return this.cases.flatMap((c) => c.parts);
  }

  case_of_part(partId) {
    const c = this.cases.find((x) => x.parts.includes(partId));
    if (!c) throw new DesignError(`No part ${repr(partId)}`);
    return c;
  }

  _taken() {
    return new Set([...this.cases.map((c) => c.id), ...this.hinges.map((h) => h.id), ...this.placements.map((d) => d.id)]);
  }

  unique_id(prefix) {
    const taken = this._taken();
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  }

  /** "case", "hinge" or "placement". */
  kind_of(itemId) {
    for (const [kind, items] of [["case", this.cases], ["hinge", this.hinges], ["placement", this.placements]]) {
      if (items.some((i) => i.id === itemId)) return kind;
    }
    throw new DesignError(`No case, hinge, device or subassembly ${repr(itemId)}`);
  }

  /** Rename a case, hinge or placement, updating everything that refers to it. */
  rename(old, name) {
    const next = String(name).trim();
    if (!next || next === old) return;
    if (this._taken().has(next)) throw new DesignError(`The id ${repr(next)} is already in use`);
    const kind = this.kind_of(old);
    if (kind === "case") {
      if (next.includes(".")) throw new DesignError("Case ids can't contain '.'");
      this.case(old).id = next;
      for (const h of this.hinges) h.cases = h.cases.map((c) => (c === old ? next : c));
      for (const d of this.placements) {
        if (d.case === old) d.case = next;
        if (d.connector_cut_targets && d.connector_cut_targets.length) {
          d.connector_cut_targets = d.connector_cut_targets.map((t) => (t.split(".")[0] === old ? next + t.slice(old.length) : t));
        }
      }
    } else if (kind === "hinge") {
      this.hinge(old).id = next;
    } else {
      this.placement(old).id = next;
    }
  }

  /** Remove a case (with its placements and hinges), hinge or placement. */
  remove(itemId) {
    const kind = this.kind_of(itemId);
    if (kind === "case") {
      const parts = new Set(this.case(itemId).parts);
      this.cases = this.cases.filter((c) => c.id !== itemId);
      this.hinges = this.hinges.filter((h) => !h.cases.includes(itemId));
      this.placements = this.placements.filter((d) => d.case !== itemId);
      for (const d of this.placements) {
        if (d.connector_cut_targets && d.connector_cut_targets.length) {
          d.connector_cut_targets = d.connector_cut_targets.filter((t) => !parts.has(t));
        }
      }
    } else if (kind === "hinge") {
      this.hinges = this.hinges.filter((h) => h.id !== itemId);
    } else {
      this.placements = this.placements.filter((d) => d.id !== itemId);
    }
  }

  check_references() {
    const ids = [...this.cases.map((c) => c.id), ...this.hinges.map((h) => h.id), ...this.placements.map((d) => d.id)];
    const dupes = sorted(new Set(ids.filter((i) => ids.indexOf(i) !== ids.lastIndexOf(i))));
    if (dupes.length) throw new DesignError(`Duplicate id(s): ${dupes.join(", ")}`);
    for (const c of this.cases) {
      if (!c.id || String(c.id).includes(".")) throw new DesignError(`Case id ${repr(c.id)} must be non-empty and contain no '.'`);
    }
    for (const h of this.hinges) for (const cid of h.cases) this.case(cid);
    for (const d of this.placements) {
      this.case(d.case);
      for (const partId of d.connector_cut_targets || []) this.case_of_part(partId);
    }
    this.case_matrices();
  }

  // -- placement --

  /** {case id: case frame -> world matrix}. Cases that aren't the second case
  of a hinge are placed by their own position and rotation (about Z); the
  rest are hung off their hinge. */
  case_matrices() {
    const placed = {};
    const drivenBy = new Map();
    for (const h of this.hinges) {
      if (drivenBy.has(h.cases[1])) throw new DesignError(`Case ${repr(h.cases[1])} is the second case of more than one hinge`);
      drivenBy.set(h.cases[1], h);
    }
    for (const c of this.cases) {
      if (!drivenBy.has(c.id)) placed[c.id] = geom.mul(geom.translate(...c.position), geom.rotZ(c.rotation));
    }
    let progress = true;
    while (progress && Object.keys(placed).length < this.cases.length) {
      progress = false;
      for (const [cid, h] of drivenBy) {
        if (cid in placed || !(h.cases[0] in placed)) continue;
        const a = this.case(h.cases[0]);
        const b = this.case(cid);
        const ea = edgeFrame(a, h.edge, h.gap);
        const eb = edgeFrame(b, h.edge, h.gap);
        placed[cid] = geom.mul(placed[a.id], ea, hingeFoldMatrix(h.open_angle), geom.inverseRigid(eb));
        progress = true;
      }
    }
    if (Object.keys(placed).length < this.cases.length) {
      throw new DesignError(`Hinges form a loop: ${sorted(this.cases.map((c) => c.id).filter((id) => !(id in placed))).join(", ")}`);
    }
    return placed;
  }

  /** Part frame -> world. */
  part_matrix(partId, caseMatrices = null) {
    const kase = this.case_of_part(partId);
    const cms = caseMatrices || this.case_matrices();
    return geom.mul(cms[kase.id], partInCaseMatrix(kase, partId));
  }

  placement_surface(spec) {
    return surface(this.case(spec.case), spec.surface, spec.mount);
  }

  /** Is this placement sunk into its surface? */
  recessed(spec, item = null) {
    return (item || spec.make()).recessed;
  }

  /** Recess frame -> the placement's frame at its surface (before
  _recess_drop()). */
  recess_frame(spec, item) {
    if (spec.mount === "outside") return geom.identity();
    const thickness = this.placement_surface(spec).thickness;
    return geom.mul(geom.translate(0, item.depth, -thickness), geom.rotX(180));
  }

  /** Device frame -> the placement's frame at its surface. A recessed
  device sits on its baseplate. */
  _recess_drop(spec, item) {
    if (!this.recessed(spec, item)) return geom.identity();
    if (spec.mount === "outside") return geom.translate(0, 0, item.recess_depth);
    return geom.translate(0, 0, -item.recess_depth);
  }

  /** [placement -> part matrix, placement -> world matrix, Surface]. */
  placement_matrices(spec, item = null, caseMatrices = null) {
    item = item || spec.make();
    const surf = this.placement_surface(spec);
    const place = geom.mul(geom.translate(spec.x, spec.y, 0), footprintMatrix(spec.rotation, item.width, item.depth),
      this._recess_drop(spec, item));
    const inPart = geom.mul(surf.part_matrix, place);
    const world = geom.mul(this.part_matrix(surf.part_id, caseMatrices), inPart);
    return [inPart, world, surf];
  }

  /** Placement -> case frame (of the case it's placed in). */
  placement_case_matrix(spec, item = null) {
    item = item || spec.make();
    const surf = this.placement_surface(spec);
    const place = geom.mul(geom.translate(spec.x, spec.y, 0), footprintMatrix(spec.rotation, item.width, item.depth),
      this._recess_drop(spec, item));
    return geom.mul(surf.case_matrix, place);
  }

  // -- editing helpers --

  /** Change some of a placement's parameters ({name: value}; a value equal to
  the default removes the override). The board stays where it was and the
  footprint grows or shrinks round it, and then the design is laid out
  again. */
  set_placement_params(placementId, updates) {
    const spec = this.placement(placementId);
    const allowed = catalogue.CATALOG[spec.type].all_params();
    const before = spec.make();
    for (const [name, value] of Object.entries(updates)) {
      if (!(name in allowed)) throw new DesignError(`${repr(placementId)} (${spec.type}) has no parameter ${repr(name)}`);
      const dflt = allowed[name][0];
      let same;
      if (typeof dflt === "string") same = value === dflt;
      else {
        if (typeof value !== "number" || Number.isNaN(value)) throw new DesignError(`${repr(placementId)}: ${name} must be a number`);
        same = Math.abs(value - dflt) < 1e-9;
      }
      if (same) delete spec.params[name];
      else spec.params[name] = value;
    }
    const after = spec.make();
    const boardCentre = (item) => {
      const core = item.board_frame();
      const place = geom.mul(geom.translate(spec.x, spec.y, 0), footprintMatrix(spec.rotation, item.width, item.depth));
      return geom.applyPoint(place, [core[0] + core[3] / 2.0, core[1] + core[4] / 2.0, 0]);
    };
    const b0 = boardCentre(before);
    const b1 = boardCentre(after);
    spec.x += b0[0] - b1[0];
    spec.y += b0[1] - b1[1];
    this.relayout();
  }

  /** Turn the gap between a placement and each side it's stuck to into that
  side's margin, keeping the device where it is. */
  take_up_stuck_gaps(placementId) {
    const spec = this.placement(placementId);
    if (!spec.stick.length) return;
    const kase = this.case(spec.case);
    const item = this._layout_items(kase).find((it) => it.spec === spec);
    const size = [kase.width, kase.depth, kase.height];
    const margins = spec.margins();
    const updates = {};
    for (const side of spec.stick) {
      const [axis, end] = SIDE_AXIS[side];
      const keep = item.keep[axis][end === "low" ? 0 : 1];
      const gap = end === "low" ? item.lo[axis] - keep : size[axis] - item.hi[axis] - keep;
      if (Math.abs(gap) > 1e-6) updates[`margin_${side}`] = pyRound(Math.max(0.0, margins[side] + gap), 6);
    }
    if (Object.keys(updates).length) this.set_placement_params(placementId, updates);
  }

  // -- layout --

  _layout_items(kase) {
    const items = [];
    let obstacles = null;
    for (const spec of this.placements) {
      if (spec.case !== kase.id) continue;
      const item = spec.make();
      const surf = this.placement_surface(spec);
      const axes = [0, 1].map((col) => argmaxFirst([0, 1, 2].map((i) => Math.abs(surf.case_matrix[i][col]))));
      const b = new geom.Box3(0, 0, 0, item.width, item.depth, 0).transformedBounds(this.placement_case_matrix(spec, item));
      if (obstacles === null) obstacles = this.wall_obstacles(kase);
      items.push({
        spec, size: renderedSize(spec.rotation, item.width, item.depth), axes,
        lo: [b[0], b[2], b[4]], hi: [b[1], b[3], b[5]], group: `${spec.surface}|${spec.mount}`,
        keep: this._keep(spec, item, obstacles),
      });
    }
    return items;
  }

  /** The centred groups along `axis`: for each surface (and mount), its
  placements not stuck along this axis, and how far in from each end the
  placements stuck to that end reach. */
  static _groups(items, axis) {
    const lowSide = Object.keys(SIDE_AXIS).find((s) => SIDE_AXIS[s][0] === axis && SIDE_AXIS[s][1] === "low");
    const highSide = OPPOSITE_SIDE[lowSide];
    const spanning = items.filter((it) => it.axes.includes(axis));
    const groups = new Map();
    for (const it of spanning) {
      if (!it.spec.stick.includes(lowSide) && !it.spec.stick.includes(highSide)) {
        if (!groups.has(it.group)) groups.set(it.group, { lo: Infinity, hi: -Infinity, members: [], low: 0.0, high: 0.0 });
        const g = groups.get(it.group);
        g.lo = Math.min(g.lo, it.lo[axis]);
        g.hi = Math.max(g.hi, it.hi[axis]);
        g.members.push(it);
        g.low = Math.max(g.low, it.keep[axis][0]);
        g.high = Math.max(g.high, it.keep[axis][1]);
      }
    }
    const eps = 1e-6;
    for (const it of spanning) {
      const g = groups.get(it.group);
      const stuckLow = it.spec.stick.includes(lowSide);
      const stuckHigh = it.spec.stick.includes(highSide);
      if (!g || !(stuckLow || stuckHigh)) continue;
      const other = it.axes.find((k) => k !== axis);
      if (!g.members.some((m) => it.lo[other] < m.hi[other] - eps && m.lo[other] < it.hi[other] - eps)) continue;
      const size = it.hi[axis] - it.lo[axis] + it.keep[axis][stuckLow ? 0 : 1];
      const key = stuckLow ? "low" : "high";
      g[key] = Math.max(g[key], size);
    }
    return groups;
  }

  /** For each item spanning `axis`, [alpha, beta] such that its new low edge
  along the axis is alpha + beta * S for a case S long. */
  static _anchors(items, axis) {
    const lowSide = Object.keys(SIDE_AXIS).find((s) => SIDE_AXIS[s][0] === axis && SIDE_AXIS[s][1] === "low");
    const highSide = OPPOSITE_SIDE[lowSide];
    const spanning = items.filter((it) => it.axes.includes(axis));
    const anchors = {};
    if (!spanning.length) return anchors;
    const groups = Design._groups(items, axis);
    for (const it of spanning) {
      const lo = it.lo[axis], hi = it.hi[axis];
      const size = hi - lo;
      const [keepLow, keepHigh] = it.keep[axis];
      if (it.spec.stick.includes(lowSide)) anchors[it.spec.id] = [keepLow, 0.0];
      else if (it.spec.stick.includes(highSide)) anchors[it.spec.id] = [-size - keepHigh, 1.0];
      else {
        const g = groups.get(it.group);
        anchors[it.spec.id] = [(lo - g.lo) - (g.hi - g.lo) / 2.0 + (g.low - g.high) / 2.0, 0.5];
      }
    }
    return anchors;
  }

  /** The smallest S that keeps every placement spanning `axis` inside the
  case and keeps placements on the same surface that are currently apart
  along this axis from overlapping. */
  static _required_size(items, axis, anchors) {
    let need = 0.0;
    for (const g of Design._groups(items, axis).values()) need = Math.max(need, g.low + (g.hi - g.lo) + g.high);
    const spanning = items.filter((it) => it.spec.id in anchors);
    for (const it of spanning) {
      const [alpha, beta] = anchors[it.spec.id];
      const size = it.hi[axis] - it.lo[axis];
      if (beta > 0) need = Math.max(need, -alpha / beta);
      if (beta < 1) need = Math.max(need, (alpha + size) / (1.0 - beta));
    }
    const eps = 1e-6;
    for (const a of spanning) {
      for (const b of spanning) {
        if (a === b || a.group !== b.group || a.hi[axis] > b.lo[axis] + eps) continue;
        const other = a.axes.find((k) => k !== axis);
        if (a.hi[other] <= b.lo[other] + eps || b.hi[other] <= a.lo[other] + eps) continue;
        const [aa, ab] = anchors[a.spec.id];
        const [ba, bb] = anchors[b.spec.id];
        const sizeA = a.hi[axis] - a.lo[axis];
        if (ab - bb < 0) need = Math.max(need, (ba - aa - sizeA) / (ab - bb));
      }
    }
    return need;
  }

  /** Lay every case and placement out again after a change (see the Python
  thingmaker's Design.relayout() for the rules). */
  relayout() {
    for (let i = 0; i < 4; i++) {
      const before = this._layout_state();
      this._relayout_once();
      if (sameState(this._layout_state(), before)) break;
    }
  }

  _layout_state() {
    return [...this.cases.map((c) => [c.width, c.depth, [...c.position]]), ...this.placements.map((p) => [p.x, p.y])];
  }

  _relayout_once() {
    const layouts = {};
    const need = [0.0, 0.0];
    for (const kase of this.cases) {
      const items = this._layout_items(kase);
      const old = [kase.width, kase.depth, kase.height];
      const anchors = [0, 1, 2].map((axis) => Design._anchors(items, axis));
      layouts[kase.id] = [items, old, anchors];
      for (const [axis, minimum] of [[0, kase.min_width], [1, kase.min_depth]]) {
        need[axis] = Math.max(need[axis], minimum, Design._required_size(items, axis, anchors[axis]));
      }
    }
    for (const kase of this.cases) {
      const [items, old, anchors] = layouts[kase.id];
      const next = [need[0] > 0 ? need[0] : old[0], need[1] > 0 ? need[1] : old[1], old[2]];
      kase.width = pyRound(next[0], 6);
      kase.depth = pyRound(next[1], 6);
      for (const it of items) {
        const spec = it.spec;
        const centre = [0, 1, 2].map((k) => (it.lo[k] + it.hi[k]) / 2.0);
        for (const axis of it.axes) {
          const [alpha, beta] = anchors[axis][spec.id];
          centre[axis] = alpha + beta * next[axis] + (it.hi[axis] - it.lo[axis]) / 2.0;
        }
        const [u, v] = geom.applyPoint(geom.inverseRigid(this.placement_surface(spec).case_matrix), centre);
        const [w, d] = it.size;
        spec.x = pyRound(u - w / 2.0, 6);
        spec.y = pyRound(v - d / 2.0, 6);
      }
      if (!this.hinges.some((h) => h.cases[1] === kase.id)) {
        const grow = [(next[0] - old[0]) / 2.0, (next[1] - old[1]) / 2.0, 0.0];
        const shift = geom.applyVector(geom.rotZ(kase.rotation), grow);
        kase.position = [0, 1, 2].map((i) => pyRound(kase.position[i] - shift[i], 6));
      }
    }
  }

  enabled_connector_cuts(spec, item = null) {
    item = item || spec.make();
    return item.connector_cuts().filter((cc) => spec.connector_cuts[cc.name] ?? true);
  }

  connector_cut_targets(spec) {
    if (spec.connector_cut_targets === null) return [...this.case(spec.case).parts];
    return [...spec.connector_cut_targets];
  }

  /** [[world matrix, length]] - enough to draw the hinge's barrel: cylinders
  along each matrix's X axis, centred on its origin. Two of them, either
  side of a cable gap. */
  hinge_barrel(hinge, caseMatrices = null) {
    const cms = caseMatrices || this.case_matrices();
    const a = this.case(hinge.cases[0]);
    const frame = geom.mul(cms[a.id], edgeFrame(a, hinge.edge, hinge.gap));
    const length = this.hinge_length(hinge);
    if (!hinge.cable_gap) return [[frame, length]];
    const half = (length - hinge.cable_gap) / 2.0;
    const offset = (hinge.cable_gap + half) / 2.0;
    return [[geom.mul(frame, geom.translate(-offset, 0, 0)), half], [geom.mul(frame, geom.translate(offset, 0, 0)), half]];
  }

  /** [[world matrix of a case's edge frame, Box3 in that frame]] - the block
  along each case's back top edge that carries its knuckles. */
  hinge_rails(hinge, caseMatrices = null) {
    const cms = caseMatrices || this.case_matrices();
    const length = this.hinge_length(hinge);
    return hinge.cases.map((caseId) => {
      const kase = this.case(caseId);
      const [depth, drop] = anchorSize(kase, hinge);
      const frame = geom.mul(cms[caseId], edgeFrame(kase, hinge.edge, hinge.gap));
      return [frame, new geom.Box3(-length / 2.0, -depth, -drop, length, depth, drop, "hinge rail")];
    });
  }

  /** Where a case's retaining screws go: a frame for each, its origin on the
  inside face of the base's wall at the screw, X pointing into the case
  along the screw, Z up (case frame). */
  case_screw_frames(kase) {
    if (!SCREW_STYLES.includes(kase.style)) return [];
    const rails = {};
    for (const h of this.hinges) if (h.cases.includes(kase.id)) rails[h.edge] = anchorSize(kase, h)[0];
    const half = nutBlockHalfWidth();
    // Clear of the curve or bevel in each inside corner, too.
    let corner = SCREW_INSET;
    if (EDGE_STYLES.includes(kase.style)) corner = Math.max(SCREW_INSET, insideCorner(kase) + half + 0.5);
    const inset = (edge) => {
      if (!(edge in rails)) return corner;
      return Math.max(corner, rails[edge] - kase.wall_thickness + half + 0.5);
    };
    const W = kase.width, D = kase.depth;
    const frames = [];
    if (!("left" in rails || "right" in rails)) {
      for (const y of [inset("front"), D - inset("back")]) {
        frames.push(geom.fromAxes([1, 0, 0], [0, 1, 0], [0, 0, 1], [0.0, y, 0.0]));
        frames.push(geom.fromAxes([-1, 0, 0], [0, -1, 0], [0, 0, 1], [W, y, 0.0]));
      }
    } else if (!("front" in rails || "back" in rails)) {
      for (const x of [inset("left"), W - inset("right")]) {
        frames.push(geom.fromAxes([0, 1, 0], [-1, 0, 0], [0, 0, 1], [x, 0.0, 0.0]));
        frames.push(geom.fromAxes([0, -1, 0], [1, 0, 0], [0, 0, 1], [x, D, 0.0]));
      }
    }
    return frames;
  }

  /** What stands in from a case's walls inside it: [[side, reach, bottom,
  top, start, end along the wall, what it is]] (case frame). */
  wall_obstacles(kase) {
    const out = [];
    const size = [kase.width, kase.depth];
    for (const h of this.hinges) {
      if (!h.cases.includes(kase.id) || this.hinge_length(h) < MIN_HINGE_LENGTH) continue;
      const [depth, drop] = anchorSize(kase, h);
      const length = this.hinge_length(h);
      const b = new geom.Box3(-length / 2.0, -depth, -drop - depth, length, depth, drop + depth).transformedBounds(
        edgeFrame(kase, h.edge, h.gap));
      const [axis, end] = SIDE_AXIS[h.edge];
      const reach = end === "low" ? b[2 * axis + 1] : size[axis] - b[2 * axis];
      const along = 1 - axis;
      out.push([h.edge, reach, b[4], b[5], b[2 * along], b[2 * along + 1], `the ${h.edge} hinge rail`]);
    }
    for (const frame of this.case_screw_frames(kase)) {
      const [dx, dy] = geom.applyVector(frame, [1, 0, 0]);
      const side = Math.abs(dx) > 0.5 ? (dx > 0 ? "left" : "right") : dy > 0 ? "front" : "back";
      const bottom = screwHeight(kase) - NUT_ACROSS_FLATS / 2.0 - NUT_BLOCK_WALL - NUT_THICKNESS - 0.2;
      const at = Math.abs(dx) > 0.5 ? frame[1][3] : frame[0][3];
      const half = nutBlockHalfWidth();
      out.push([side, NUT_THICKNESS, bottom, kase.height, at - half, at + half, `the ${side} retaining screws' nut blocks`]);
    }
    return out;
  }

  /** wall_obstacles() as [[side, what it is, bounds in the case frame]]. */
  wall_obstacle_bounds(kase) {
    const size = [kase.width, kase.depth];
    return this.wall_obstacles(kase).map(([side, reach, bottom, top, start, end, what]) => {
      const [axis, lowHigh] = SIDE_AXIS[side];
      const lo = [0.0, 0.0, bottom];
      const hi = [0.0, 0.0, top];
      [lo[axis], hi[axis]] = lowHigh === "low" ? [0.0, reach] : [size[axis] - reach, size[axis]];
      [lo[1 - axis], hi[1 - axis]] = [start, end];
      return [side, what, [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]]];
    });
  }

  /** Bounds (case frame) of what a placement puts inside its case besides the
  device itself: a recess's well, pillars and baseplate, or a battery
  compartment. */
  inside_bounds(spec, item = null) {
    item = item || spec.make();
    const surf = this.placement_surface(spec);
    const toCase = this.placement_case_matrix(spec, item);
    const out = item.inside_boxes(surf.thickness).map((b) => b.transformedBounds(toCase));
    if (this.recessed(spec, item)) {
      const inRecess = geom.mul(geom.inverseRigid(this.recess_frame(spec, item)), this._recess_drop(spec, item));
      const atSurface = geom.mul(toCase, geom.inverseRigid(inRecess));
      out.push(item.recess_box(surf.thickness).transformedBounds(atSurface));
    }
    return out;
  }

  /** How far a placement keeps from each side of its case (case axes: [[low,
  high] x 3]) so what it puts inside the case can go in from the top past
  the obstacles on the walls. */
  _keep(spec, item, obstacles) {
    const keep = [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0]];
    const surf = this.placement_surface(spec);
    if (surf.part_id !== this.case(spec.case).lid_part && !item.fitted_from_inside()) return keep;
    const inside = this.inside_bounds(spec, item);
    if (!inside.length) return keep;
    keep[0] = [PASS_CLEARANCE, PASS_CLEARANCE];
    keep[1] = [PASS_CLEARANCE, PASS_CLEARANCE];
    const bottom = Math.min(...inside.map((b) => b[4]));
    for (const [side, reach, , top, start, endAlong] of obstacles) {
      if (top <= bottom + 1e-6) continue;
      const [axis, end] = SIDE_AXIS[side];
      const along = 1 - axis;
      const lo = Math.min(...inside.map((b) => b[2 * along]));
      const hi = Math.max(...inside.map((b) => b[2 * along + 1]));
      if (hi <= start - PASS_CLEARANCE + 1e-6 || lo >= endAlong + PASS_CLEARANCE - 1e-6) continue;
      const i = end === "low" ? 0 : 1;
      keep[axis][i] = Math.max(keep[axis][i], reach + PASS_CLEARANCE);
    }
    return keep;
  }

  /** The outside edge of the hinge's first case, less its margin at each end. */
  hinge_length(hinge) {
    return outerEdgeLength(this.case(hinge.cases[0]), hinge.edge) - 2 * hinge.margin;
  }

  /** Surface frame -> world. */
  surface_world_matrix(caseId, name, mount, caseMatrices = null) {
    const cms = caseMatrices || this.case_matrices();
    return geom.mul(cms[caseId], surface(this.case(caseId), name, mount).case_matrix);
  }

  /** The surface a clicked world point lies on, judged by position and by
  which way the clicked face points: [case id, surface, mount, [u, v]] or
  null. */
  surface_at(point, normal, tolerance = 0.75, caseMatrices = null) {
    const cms = caseMatrices || this.case_matrices();
    let best = null;
    for (const kase of this.cases) {
      for (const name of SURFACES) {
        for (const mount of MOUNTS) {
          const s = surface(kase, name, mount);
          const inv = geom.inverseRigid(geom.mul(cms[kase.id], s.case_matrix));
          const p = geom.applyPoint(inv, point);
          const n = geom.applyVector(inv, normal);
          if (Math.abs(p[2]) <= tolerance && n[2] > 0.5 && p[0] >= -tolerance && p[0] <= s.width + tolerance &&
            p[1] >= -tolerance && p[1] <= s.height + tolerance) {
            if (best === null || Math.abs(p[2]) < best[0]) best = [Math.abs(p[2]), [kase.id, name, mount, [p[0], p[1]]]];
          }
        }
      }
    }
    return best ? best[1] : null;
  }

  // -- checks --

  /** Human-readable problems that don't stop a build but probably aren't
  what was intended. */
  warnings() {
    return this.problems().map(([message]) => message);
  }

  /** warnings() as [[message, [ids of the hinges/placements involved]]]. */
  problems() {
    const out = [];
    for (const kase of this.cases) {
      for (const [name, layers] of sorted(Object.entries(kase.decorations), (e) => e[0])) {
        for (const problem of decoration.faceLayers(kase, surface(kase, name, "outside"), layers)[1]) {
          out.push([`Case ${kase.id} ${name} face: ${problem}`, [kase.id]]);
        }
      }
      if (EDGE_STYLES.includes(kase.style)) {
        for (const [end, thickness] of [["floor", kase.base_thickness], ["lid", kase.lid_thickness]]) {
          const left = edgeWall(kase, thickness);
          if (left < MIN_EDGE_WALL) {
            out.push([`Case ${kase.id}: its ${fmtG(kase.edge)}mm edges leave only ${fmtF(Math.max(0.0, left), 1)}mm of wall ` +
              `where the sides meet the ${end}; make the edge smaller, or the walls and ${end} thicker`, [kase.id]]);
          }
        }
      }
      if (this.case_screw_frames(kase).length) {
        const lowest = screwHeight(kase) - SCREW_HOLE / 2.0;
        if (lowest < kase.height - kase.lid_height + 0.2 - 1e-6) {
          const need = kase.height - lowest + 0.2;
          out.push([`Case ${kase.id}: its lid's sides (lid height ${fmtG(kase.lid_height)}) are too short for the retaining ` +
            `screws, which notch their bottom edge; make it at least ${fmtF(need, 1)}`, [kase.id]]);
        }
      }
    }
    for (const h of this.hinges) {
      const a = this.case(h.cases[0]);
      const b = this.case(h.cases[1]);
      const la = edgeLength(a, h.edge);
      const lb = edgeLength(b, h.edge);
      if (Math.abs(la - lb) > 1e-6) {
        out.push([`Hinge ${h.id}: the ${h.edge} edges of ${a.id} (${fmtG(la)}) and ${b.id} (${fmtG(lb)}) differ in length`, [h.id]]);
      }
      if (this.hinge_length(h) > Math.min(outerEdgeLength(a, h.edge), outerEdgeLength(b, h.edge)) + 1e-6) {
        out.push([`Hinge ${h.id} is longer than the edge it is on`, [h.id]]);
      }
      if (this.hinge_length(h) < MIN_HINGE_LENGTH) {
        out.push([`Hinge ${h.id}: its ${fmtG(h.margin)}mm margins leave only ${fmtF(Math.max(0.0, this.hinge_length(h)), 1)}mm of hinge`, [h.id]]);
      } else if (h.cable_gap && (this.hinge_length(h) - h.cable_gap) / 2.0 < MIN_HINGE_LENGTH) {
        out.push([`Hinge ${h.id}: its ${fmtG(h.cable_gap)}mm cable gap leaves too little hinge either side of it`, [h.id]]);
      }
      if (h.open_limit && h.open_angle > h.open_limit + 1e-6) {
        out.push([`Hinge ${h.id}: its open angle (${fmtG(h.open_angle)}) is past its stop (${fmtG(h.open_limit)})`, [h.id]]);
      }
      if (h.cable_gap && h.cable_cover && h.open_angle > COVER_OPEN_LIMIT) {
        out.push([`Hinge ${h.id}: opened past ${fmtG(COVER_OPEN_LIMIT)} degrees its cable cover pinches the cable`, [h.id]]);
      }
    }

    const placed = [];
    const obstacles = {};
    for (const spec of this.placements) {
      const item = spec.make();
      const surf = this.placement_surface(spec);
      const [rw, rd] = renderedSize(spec.rotation, item.width, item.depth);
      if (spec.x < -1e-6 || spec.y < -1e-6 || spec.x + rw > surf.width + 1e-6 || spec.y + rd > surf.height + 1e-6) {
        out.push([`${spec.id} overhangs the edge of ${spec.case}'s ${spec.surface} surface`, [spec.id]]);
      }
      const toCase = this.placement_case_matrix(spec, item);
      const bodies = item.body_boxes().map((b) => b.transformedBounds(toCase));
      const kase = this.case(spec.case);
      if (item.problem) out.push([`${spec.id}: ${item.problem}`, [spec.id]]);
      if (item.OUTSIDE_ONLY && spec.mount !== "outside") out.push([`${spec.id} can only be let into the outside of a case`, [spec.id]]);
      // What a device mounted outside puts inside the case has to fit in it,
      // and keep clear of the rest.
      const inside = item.inside_boxes(surf.thickness).map((b) => b.transformedBounds(toCase));
      if (spec.mount === "outside" && inside.length) {
        const interior = [0, kase.width, 0, kase.depth, 0, kase.height];
        if (inside.some((b) => [0, 1, 2].some((i) => b[2 * i] < interior[2 * i] - 0.01 || b[2 * i + 1] > interior[2 * i + 1] + 0.01))) {
          out.push([`${spec.id} doesn't fit inside ${kase.id}`, [spec.id]]);
        }
      }
      bodies.push(...inside);
      if (item.recess_too_small) {
        out.push([`${spec.id}: its recess width/height is smaller than it and its margins, so the recess is made to fit them ` +
          "instead", [spec.id]]);
      }
      if (this.recessed(spec, item)) {
        const inRecess = geom.mul(geom.inverseRigid(this.recess_frame(spec, item)), this._recess_drop(spec, item));
        const top = Math.max(...item.body_boxes().map((b) => b.transformedBounds(inRecess)[5]));
        if (top > 1e-6) out.push([`${spec.id} stands ${fmtF(top, 1)}mm proud of its recess`, [spec.id]]);
        // The well, pillars and baseplate take room inside the case.
        const atSurface = geom.mul(toCase, geom.inverseRigid(inRecess));
        bodies.push(item.recess_box(surf.thickness).transformedBounds(atSurface));
      }
      if (spec.mount === "inside") {
        const interior = [0, kase.width, 0, kase.depth, 0, kase.height];
        // Body parts a connector cut makes room for are meant to leave the cavity.
        const cutBoxes = this.enabled_connector_cuts(spec, item).flatMap((cc) => cc.boxes);
        const boxes = item.body_boxes();
        for (let k = 0; k < Math.min(boxes.length, bodies.length); k++) {
          const box = boxes[k];
          const b = bodies[k];
          if (cutBoxes.some((cb) => contains(cb, box))) continue;
          if ([0, 1, 2].some((i) => b[2 * i] < interior[2 * i] - 0.01 || b[2 * i + 1] > interior[2 * i + 1] + 0.01)) {
            out.push([`${spec.id} sticks out of ${kase.id}'s cavity`, [spec.id]]);
            break;
          }
        }
      }
      // What stands in from the walls isn't kept clear of ordinary devices by
      // the layout, so say if one's in the way, and what margin would clear it.
      if (!(kase.id in obstacles)) obstacles[kase.id] = this.wall_obstacle_bounds(kase);
      const clashes = new Map(); // "side|what" -> [side, what, how far in it reaches past them]
      for (const [side, what, ob] of obstacles[kase.id]) {
        const hits = bodies.filter((b) => geom.boundsOverlap(b, ob));
        if (!hits.length) continue;
        const [axis, lowHigh] = SIDE_AXIS[side];
        const need = lowHigh === "low" ? ob[2 * axis + 1] - Math.min(...hits.map((b) => b[2 * axis]))
          : Math.max(...hits.map((b) => b[2 * axis + 1])) - ob[2 * axis];
        const key = `${side}|${what}`;
        const prev = clashes.get(key);
        clashes.set(key, [side, what, Math.max(prev ? prev[2] : 0.0, need)]);
      }
      for (const [side, what, need] of [...clashes.values()].sort((p, q) => pyCompare([p[0], p[1]], [q[0], q[1]]))) {
        let advice = "";
        if (stickSides(spec.surface).includes(side)) {
          advice = ` - about ${fmtF(need + PASS_CLEARANCE, 1)}mm more on its ${side} margin would clear it`;
        }
        out.push([`${spec.id} runs into ${what}${advice}`, [spec.id]]);
      }
      for (const [otherId, otherCase, otherBodies] of placed) {
        if (otherCase === spec.case && bodies.some((a) => otherBodies.some((b) => geom.boundsOverlap(a, b)))) {
          out.push([`${spec.id} collides with ${otherId}`, [spec.id, otherId]]);
        }
      }
      placed.push([spec.id, spec.case, bodies]);
    }
    return out;
  }
}

/** True if Box3 `inner` lies within Box3 `outer` (same frame). */
function contains(outer, inner, tolerance = 1e-6) {
  return outer.x - tolerance <= inner.x && inner.x + inner.w <= outer.x + outer.w + tolerance &&
    outer.y - tolerance <= inner.y && inner.y + inner.d <= outer.y + outer.d + tolerance &&
    outer.z - tolerance <= inner.z && inner.z + inner.h <= outer.z + outer.h + tolerance;
}

/** A design's dict (Design.to_dict()) as the design file's text, written as
Python's json.dump(..., indent=2) writes it: every number a float except
the version, hinges' knuckles and placements' rotations. */
export function dumpDesign(d) {
  return dumps(d, (p) => (p.length === 1 && p[0] === "version") ||
    (p.length === 3 && p[0] === "hinges" && p[2] === "knuckles") ||
    (p.length === 3 && (p[0] === "devices" || p[0] === "subassemblies") && p[2] === "rotation"));
}

/** A Placement of catalogue type `typeName`, centred on `centre` ([u, v] on
the surface) or on the middle of the surface. A subassembly that can be
mounted either way gets the mounting that faces it out of the case. */
export function newPlacement(design, typeName, caseId, surfaceName, mount = "inside", centre = null, rotation = 0) {
  const surf = surface(design.case(caseId), surfaceName, mount);
  const params = {};
  const cls = catalogue.CATALOG[typeName];
  const mountings = (cls && cls.SPEC && cls.SPEC.mountings) || {};
  if (mount === "inside" && "underneath" in mountings) params.mounting = "underneath";
  else if (mount === "outside" && "top" in mountings && "underneath" in mountings) params.mounting = "top";
  const probe = catalogue.make(typeName, "probe", params);
  const [rw, rd] = renderedSize(rotation, probe.width, probe.depth);
  const [cu, cv] = centre !== null && centre !== undefined ? centre : [surf.width / 2.0, surf.height / 2.0];
  const prefix = typeName.toLowerCase();
  const spec = new Placement(design.unique_id(prefix), typeName, caseId, {
    surface: surfaceName, mount, x: pyRound(cu - rw / 2.0, 1), y: pyRound(cv - rd / 2.0, 1), rotation,
  });
  // Only when it differs from the default, so the file stays tidy.
  const dflt = (cls.all_params().mounting || [null])[0];
  for (const [k, v] of Object.entries(params)) if (v !== dflt) spec.params[k] = v;
  return spec;
}
