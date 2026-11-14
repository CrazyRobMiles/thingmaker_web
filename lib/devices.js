/* Device library: the built-in devices, ported from custard-cream-case's
devices.py by way of the Python thingmaker, and the classes they're built
from. (Subassemblies - things made from STL files - are built on these same
classes, see lib/subassemblies.js; lib/catalogue.js looks both kinds up.)

Each device describes itself for the editor and builder with body_boxes()
(a simple box model used for the on-screen preview and collision checks)
and a CONNECTORS_TABLE of the openings it needs in its case. Each
connector becomes a connector cut (connector_cuts()), which the builder
cuts out of whole parts once the design is assembled.

Device-local frame: the footprint occupies X 0..width, Y 0..depth (width/
depth include the margins: the board starts at xMargin, yMargin, and the
far margins are whatever's left beyond it), Z=0 is the mounting face, the
material being mounted through occupies Z -baseHeight..0, and the device's
bulk projects towards +Z.

Method and attribute names follow the Python, so the two can be read side
by side. */
import * as geom from "./geom.js";
import { Box3 } from "./geom.js";
import * as stl from "./stl.js";
import * as Part from "./kernel.js";

/** Class attributes, as Python has them: readable from the class (static)
and from each instance (the prototype), where an instance can override
them. */
export function classAttrs(cls, attrs) {
  for (const [name, value] of Object.entries(attrs)) {
    Object.defineProperty(cls, name, { value, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(cls.prototype, name, { value, writable: true, configurable: true, enumerable: false });
  }
  return cls;
}

export const Orientation = { LANDSCAPE: 1, PORTRAIT: 2, DONTCHANGE: 3 };
export const VerticalAlignment = { TOP: 1, CENTRE: 2, BOTTOM: 3 };
export const HorizontalAlignment = { LEFT: "left", CENTRE: "centre", RIGHT: "right" };
/** How far a pillar's screw hole goes on above its top. */
export const PILLAR_HOLE_OVERRUN = 0.5;

export const PillarType = { NUT_AND_BOLT: 1, BOLT_ONLY: 2, DEFAULT: 2, SOLID: 3 };

/** Fold a list of shapes into one via repeated fuse(). null if the list is
empty (after dropping any null entries). */
export function union(shapes) {
  const list = shapes.filter((s) => s !== null && s !== undefined);
  if (!list.length) return null;
  let result = list[0];
  for (const s of list.slice(1)) result = result.fuse(s);
  return result;
}

/** leaves: [[device, x, y]...] - typically the result of Device.layout().
Returns [fuser or null, cutter or null]. */
export function geometryFromLeaves(leaves, baseHeight) {
  const fusers = leaves.map(([d, lx, ly]) => d.get_fuser(lx, ly, baseHeight));
  const cutters = leaves.map(([d, lx, ly]) => d.get_cutter(lx, ly, baseHeight));
  return [union(fusers), union(cutters)];
}

/** Lay a single device (and any grid children it has) out at (x, y) and
collect its combined cutter/fuser geometry. Returns [fuser, cutter]. */
export function buildGeometry(device, x, y, baseHeight) {
  return geometryFromLeaves(device.layout(x, y), baseHeight);
}

/** Fuse then cut (in that order, so holes correctly cut through
freshly-fused pillars rather than being plugged by them). */
export function applyFuserCutter(shape, fuser, cutter) {
  if (fuser) shape = shape.fuse(fuser);
  if (cutter) shape = shape.cut(cutter);
  return shape;
}

/** A geom.Box3 as a solid, in the same frame. */
export function boxToShape(box) {
  return Part.makeBox(box.w, box.d, box.h, [box.x, box.y, box.z]);
}

/** One opening a device needs in its case - a socket, a screen, a card
slot - as a row of the device's CONNECTORS_TABLE.

The connector's body is a box in the BOARD's frame: x 0..boardWidth,
y 0..boardDepth across the board as seen from above, and z measured from
the top surface of the board. `faces` is the way the opening points:
"bottom", "top", "left" or "right" for a connector on that edge of the
board (as seen from above), or "up" for one facing away from the mounting
surface, like a screen. A connector can also be an STL mesh
(Connector.fromMesh()), drawn in the device's mesh frame and cut exactly
as drawn. */
export class Connector {
  static FACES = ["bottom", "top", "left", "right", "up", "mesh"];

  constructor(description, x, y, z, width, depth, height, faces, mesh = null) {
    if (!Connector.FACES.includes(faces)) {
      throw new Error(`faces must be one of ${Connector.FACES.join(", ")} (got '${faces}')`);
    }
    this.description = description;
    this.x = x;
    this.y = y;
    this.z = z;
    this.width = width;
    this.depth = depth;
    this.height = height;
    this.faces = faces;
    this.mesh = mesh;
  }

  /** A connector whose opening is the closed STL mesh at `path`, in the
  device's mesh frame. */
  static fromMesh(description, path) {
    const b = stl.bounds(path);
    return new Connector(description, b[0], b[2], b[4], b[1] - b[0], b[3] - b[2], b[5] - b[4], "mesh", path);
  }

  /** A connector on one edge of a boardWidth x boardDepth board: `width`
  along the edge, centred `centre` along it (bottom and top edges measure
  from the left-hand end, left and right edges from the bottom end),
  `height` above the board (starting `z` above its top surface), reaching
  `depth` in from the edge and `overhang` out past it. */
  static onEdge(description, edge, boardWidth, boardDepth, { width, centre, height, depth, overhang, z = 0.0 }) {
    const reach = depth + overhang;
    if (edge === "bottom") return new Connector(description, centre - width / 2.0, -overhang, z, width, reach, height, edge);
    if (edge === "top") return new Connector(description, centre - width / 2.0, boardDepth - depth, z, width, reach, height, edge);
    if (edge === "left") return new Connector(description, -overhang, centre - width / 2.0, z, reach, width, height, edge);
    if (edge === "right") return new Connector(description, boardWidth - depth, centre - width / 2.0, z, reach, width, height, edge);
    throw new Error(`edge must be bottom, top, left or right (got '${edge}')`);
  }
}

/** A connector's opening as the builder cuts it: a named region (a list of
Box3s in the device-local frame) cut out of whole parts once the design is
assembled. mesh: for a mesh connector, [STL path, 4x4 matrix]. */
export class ConnectorCut {
  constructor(name, description, boxes, mesh = null) {
    this.name = name;
    this.description = description;
    this.boxes = boxes;
    this.mesh = mesh;
  }
}

const MARGIN_SIDES = ["left", "right", "front", "back", "bottom", "top"];

export class Device {
  /** This class's own settings (PARAMS, plus the connector-cut settings if
  it has any connectors), as {name: [default, description, choices?]}. */
  static device_params() {
    const params = { ...this.PARAMS };
    // Mesh connectors are cut as drawn, so only the others need these.
    if (Object.values(this.CONNECTORS_TABLE).some((c) => c.faces !== "mesh")) {
      for (const [name, description] of Object.entries(this.CONNECTOR_PARAMS)) params[name] = [this[name], description];
    }
    return params;
  }

  /** COMMON_PARAMS plus device_params() - everything a design file may set
  for this device. */
  static all_params() {
    const params = { ...this.COMMON_PARAMS };
    if (!this.RECESSABLE) for (const name of this.RECESS_PARAMS) delete params[name];
    return Object.assign(params, this.device_params());
  }

  constructor(partType, partName, width, depth, {
    xMargin = 0.5, yMargin = 0.5, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE, componentHeight = 8.0, componentDepth = 4.0,
    innerGridXOffset = 0, innerGridYOffset = 0, scrunchX = 0, scrunchY = 0, cutHeight = 5.0, connectors = null,
    grid = [], rotation = 0,
  } = {}) {
    if (![0, 90, 180, 270].includes(rotation)) throw new Error(`rotation must be one of 0, 90, 180, 270 (got ${rotation})`);
    this.rotation = rotation;
    this.partType = partType;
    this.partName = partName;
    this.width = width + xMargin * 2;
    this.depth = depth + yMargin * 2;
    this.xMargin = xMargin;
    this.yMargin = yMargin;
    this.scrunchX = scrunchX;
    this.scrunchY = scrunchY;
    this.horizontalAlignment = horizontalAlignment;
    this.verticalAlignment = verticalAlignment;
    this.componentHeight = componentHeight;
    this.componentDepth = componentDepth;
    this.innerGridXOffset = innerGridXOffset;
    this.innerGridYOffset = innerGridYOffset;
    this.cutHeight = cutHeight;
    this.connectors = connectors;
    this.grid = grid;
    this.gridWidth = 0;
    this.componentDepth = 0;
    this.componentHeight = 0;
    this.no_of_rows = 0;
    this.gridDepth = 0;
    for (const row of grid) {
      this.no_of_rows += 1;
      let rowWidth = 0;
      let rowDepth = 0;
      for (const part of row) {
        rowWidth += part.width;
        if (part.depth > rowDepth) rowDepth = part.depth;
        if (part.componentDepth > this.componentDepth) this.componentDepth = part.componentDepth;
        if (part.componentHeight > this.componentHeight) this.componentHeight = part.componentHeight;
      }
      if (rowWidth > this.gridWidth) this.gridWidth = rowWidth;
      this.gridDepth += rowDepth;
    }
    this.gridDepth = this.gridDepth + 2 * this.innerGridYOffset;
    this.gridWidth = this.gridWidth + 2 * this.innerGridXOffset;
    if (this.gridDepth > 0 || this.gridWidth > 0) {
      if (this.gridWidth > this.width) this.width = this.gridWidth;
      if (this.gridDepth > this.depth) this.depth = this.gridDepth;
    }
  }

  /** Recursively resolve positions for self and any grid children. Returns
  a flat list of [device, x, y]. */
  layout(x, y) {
    this.xPos = x;
    this.yPos = y;
    const result = [[this, x, y]];
    let xOffset = x + this.innerGridXOffset;
    let yOffset = y + this.innerGridYOffset;
    if (this.gridDepth < this.depth) yOffset += (this.depth - this.gridDepth) / 2.0;
    if (this.gridWidth < this.width) xOffset += (this.width - this.gridWidth) / 2.0;
    let rowCount = 0;
    let placeY = yOffset;
    for (const row of this.grid) {
      rowCount += 1;
      let thisRowWidth = 0.0;
      let thisRowDepth = 0.0;
      let partCount = 0;
      for (const part of row) {
        thisRowWidth += part.width;
        partCount += 1;
        if (part.depth > thisRowDepth) thisRowDepth = part.depth;
      }
      const spareWidth = this.width - thisRowWidth;
      const xSpacing = spareWidth / partCount;
      let placeX = xOffset;
      let ypos = 0;
      let last = null;
      for (const part of row) {
        if (part.verticalAlignment === VerticalAlignment.BOTTOM) ypos = 0;
        if (part.verticalAlignment === VerticalAlignment.CENTRE) ypos = placeY + (thisRowDepth - part.depth) / 2;
        if (part.verticalAlignment === VerticalAlignment.TOP) {
          ypos = rowCount === this.no_of_rows ? this.depth - part.depth : placeY + (thisRowDepth - part.depth);
        }
        result.push(...part.layout(placeX, ypos));
        placeX = placeX + part.width + xSpacing;
        last = part;
      }
      placeY = placeY + last.depth;
    }
    return result;
  }

  enabled_connectors() {
    if (this.connectors === null) return [...this.CONNECTORS];
    return this.CONNECTORS.filter((c) => this.connectors.includes(c));
  }

  connector_cutter(name, x, y, baseHeight) {
    return null;
  }

  get_connector_cutters(x, y, baseHeight) {
    return union(this.enabled_connectors().map((n) => this.connector_cutter(n, x, y, baseHeight)));
  }

  /** Simplest-form cutter: a box the device's own width x depth, cutHeight
  tall (Z). */
  get_footprint_cutter(x, y, baseHeight) {
    return Part.makeBox(this.width, this.depth, this.cutHeight, [x, y, 0]);
  }

  /** Solid (already positioned at x, y), or null, to subtract from whatever
  case this device ends up applied to. */
  get_cutter(x, y, baseHeight) {
    return union([this.get_footprint_cutter(x, y, baseHeight), this.get_connector_cutters(x, y, baseHeight)]);
  }

  /** Solid (already positioned at x, y), or null, to fuse onto whatever case
  this device ends up applied to. */
  get_fuser(x, y, baseHeight) {
    return null;
  }

  /** {name: shape in the device frame} of parts this device makes of its
  own, besides what it adds to or cuts from the case. */
  extra_parts(baseHeight) {
    return {};
  }

  /** Box3s (device frame) of what a device mounted outside puts inside the
  case. */
  inside_boxes(baseHeight) {
    return [];
  }

  /** Does it have a part of its own that's fitted inside the case (a
  recess's baseplate)? */
  fitted_from_inside() {
    return this.recessed && this.recess_style === "plate";
  }

  // -- recess --

  /** Grow the footprint by a margin on each side, in the device's own frame
  (the board moves in by xLow, yLow). Called once, on a device built with
  no margins (catalogue.make()). */
  apply_margins(xLow, xHigh, yLow, yHigh) {
    this.core_size = [this.width, this.depth];
    this.xMargin += xLow;
    this.yMargin += yLow;
    this.width += xLow + xHigh;
    this.depth += yLow + yHigh;
  }

  /** Sink this device's mounting into its surface (depth < 0) - see the
  Python thingmaker's Device.apply_recess() for the two styles. The opening
  is the device and its margins, `extraWidth` and `extraDepth` wider and
  deeper (half on each side). */
  apply_recess(depth, radius, extraWidth = 0.0, extraDepth = 0.0, style = "plate", hole = 0.0, holeOffset = [0.0, 0.0]) {
    if (!this.RECESS_STYLES.includes(style)) {
      throw new Error(`recess_style must be one of ${this.RECESS_STYLES.join(", ")} (got '${style}')`);
    }
    this.recess_depth = depth;
    this.recess_radius = radius;
    this.recess_style = style;
    this.recess_hole = hole;
    this.recess_hole_offset = [...holeOffset];
    if (depth < 0) {
      let ring = this.RECESS_WALL;
      if (style === "plate") ring += this.RECESS_PILLAR_DIAMETER + this.RECESS_EDGE;
      this.recess_ring = ring;
      const extraX = Math.max(0.0, extraWidth) / 2.0 + ring;
      const extraY = Math.max(0.0, extraDepth) / 2.0 + ring;
      this.xMargin += extraX;
      this.yMargin += extraY;
      this.width += 2 * extraX;
      this.depth += 2 * extraY;
    }
  }

  get recessed() {
    return this.recess_depth < 0;
  }

  /** [opening's inset from the footprint edge, its corner radius, the inset
  of the corner arcs' centres]. */
  _recess_layout() {
    const inset = this.recess_ring;
    const w = this.width - 2 * inset;
    const d = this.depth - 2 * inset;
    const radius = Math.max(0.0, Math.min(this.recess_radius, Math.min(w, d) / 2.0 - 0.01));
    return [inset, radius, inset + radius];
  }

  /** A round-cornered box: [x0, x1] x [y0, y1] x [z0, z1], corners of radius r. */
  static _rounded(x0, y0, x1, y1, r, z0, z1) {
    const h = z1 - z0;
    if (r <= 0) return Part.makeBox(x1 - x0, y1 - y0, h, [x0, y0, z0]);
    const shapes = [Part.makeBox(x1 - x0 - 2 * r, y1 - y0, h, [x0 + r, y0, z0]),
      Part.makeBox(x1 - x0, y1 - y0 - 2 * r, h, [x0, y0 + r, z0])];
    for (const x of [x0 + r, x1 - r]) for (const y of [y0 + r, y1 - r]) shapes.push(Part.makeCylinder(r, h, [x, y, z0]));
    return union(shapes);
  }

  _rounded(...args) {
    return Device._rounded(...args);
  }

  /** [x, y] of each pillar, in the device frame: one on each corner arc, and
  more along any edge longer than RECESS_PILLAR_SPACING. */
  recess_pillar_positions() {
    const [, radius, centre] = this._recess_layout();
    const ring = radius + this.RECESS_WALL + this.RECESS_PILLAR_DIAMETER / 2.0 - 0.2;
    const line = centre - ring;
    const diag = ring / 2 ** 0.5;
    const W = this.width;
    const D = this.depth;
    const corners = [[centre - diag, centre - diag], [W - centre + diag, centre - diag],
      [W - centre + diag, D - centre + diag], [centre - diag, D - centre + diag]];
    const out = corners.map((c) => [...c]);
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i];
      const [bx, by] = corners[(i + 1) % 4];
      const length = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
      const gaps = Math.max(1, Math.trunc(-Math.floor(-length / this.RECESS_PILLAR_SPACING)));
      for (let k = 1; k < gaps; k++) {
        const t = k / gaps;
        let x = ax + (bx - ax) * t;
        let y = ay + (by - ay) * t;
        if (Math.abs(by - ay) < 1e-9) y = ay < D / 2.0 ? line : D - line;
        else x = ax < W / 2.0 ? line : W - line;
        out.push([x, y]);
      }
    }
    return out;
  }

  /** What the recess adds to the surface's part, in the recess frame. */
  recess_material(floor = 0.0) {
    const [inset, radius] = this._recess_layout();
    const w = this.RECESS_WALL;
    const depth = this.recess_depth;
    if (this.recess_style === "cut") {
      return this._rounded(inset - w, inset - w, this.width - inset + w, this.depth - inset + w, radius + w, depth - floor, 0.0);
    }
    const walls = this._rounded(inset - w, inset - w, this.width - inset + w, this.depth - inset + w, radius + w, depth, 0.0);
    const pillars = this.recess_pillar_positions().map(([x, y]) =>
      Part.makeCylinder(this.RECESS_PILLAR_DIAMETER / 2.0, -depth, [x, y, depth]));
    return union([walls, ...pillars]);
  }

  /** What the recess cuts from the surface's part, in the recess frame. */
  recess_cut(skin = 0.8) {
    const [inset, radius] = this._recess_layout();
    if (this.recess_style === "cut") {
      return this._rounded(inset, inset, this.width - inset, this.depth - inset, radius, this.recess_depth, 1.0);
    }
    const opening = this._rounded(inset, inset, this.width - inset, this.depth - inset, radius, this.recess_depth - 0.01, 1.0);
    const holes = this.recess_pillar_positions().map(([x, y]) =>
      Part.makeCylinder(this.RECESS_PILOT_DIAMETER / 2.0, -this.recess_depth - skin + 0.01, [x, y, this.recess_depth - 0.01]));
    return union([opening, ...holes]);
  }

  /** The baseplate, in the device's frame (moved to the baseplate). */
  recess_baseplate(plate) {
    const [, , centre] = this._recess_layout();
    const shape = this._rounded(0.0, 0.0, this.width, this.depth, centre, -plate, 0.0);
    const holes = this.recess_pillar_positions().map(([x, y]) =>
      Part.makeCylinder(this.RECESS_SCREW_HOLE / 2.0, plate + 0.02, [x, y, -plate - 0.01]));
    return shape.cut(union(holes));
  }

  /** The cable hole (or null), in the device's frame. */
  recess_cable_hole(plate) {
    if (!(this.recessed && this.recess_hole > 0)) return null;
    const [bx, by, , bw, bd] = this.board_frame();
    const cx = bx + bw / 2.0 + this.recess_hole_offset[0];
    const cy = by + bd / 2.0 + this.recess_hole_offset[1];
    return Part.makeCylinder(this.recess_hole / 2.0, plate + 2.0, [cx, cy, -plate - 1.0]);
  }

  /** Everything the recess puts inside the case, as one Box3 in the recess
  frame (z = 0 the outside face), for collision checks. */
  recess_box(plate) {
    const bottom = this.recess_depth - plate - (this.recess_style === "plate" ? this.RECESS_SCREW_HEAD : 0.0);
    return new Box3(0, 0, bottom, this.width, this.depth, -bottom, "recess");
  }

  // -- for the editor and the layout (no solids) --

  /** The device's physical volume as a list of Box3s in the device-local
  frame. */
  body_boxes() {
    return [new Box3(0, 0, 0, this.width, this.depth, this.cutHeight, "body")];
  }

  /** [x, y, z, board width, board depth] of the board CONNECTORS_TABLE is
  measured against: its corner and top surface in the device frame, and its
  size. */
  board_frame() {
    const z = (this.pillarHeight ?? 0.0) + (this.boardThickness ?? 0.0);
    const core = this.core_size ?? [this.width - 2 * this.xMargin, this.depth - 2 * this.yMargin];
    return [this.xMargin, this.yMargin, z, this.boardWidth ?? core[0], this.boardDepth ?? core[1]];
  }

  /** The 4x4 transform taking the frame its STL meshes (mock, mesh
  connectors) are drawn in to the device frame. */
  mesh_matrix() {
    const [bx, by, bz] = this.board_frame();
    return geom.translate(bx, by, bz);
  }

  /** [STL path, 4x4 matrix into the device frame] for each mesh the editor
  should draw instead of a box preview. */
  preview_meshes() {
    return [];
  }

  /** The body of connector `name`, as a Box3 in the device frame. */
  connector_box(name) {
    const c = this.CONNECTORS_TABLE[name];
    if (c.faces === "mesh") {
      const b = new Box3(c.x, c.y, c.z, c.width, c.depth, c.height).transformedBounds(this.mesh_matrix());
      return new Box3(b[0], b[2], b[4], b[1] - b[0], b[3] - b[2], b[5] - b[4], name);
    }
    const [bx, by, bz] = this.board_frame();
    return new Box3(bx + c.x, by + c.y, bz + c.z, c.width, c.depth, c.height, name);
  }

  /** Every connector's body, for body_boxes() to include. */
  connector_body_boxes() {
    return Object.keys(this.CONNECTORS_TABLE).map((name) => this.connector_box(name));
  }

  /** Connector `name`'s opening: its body grown by connectorClearance all
  round, then extended connectorReach past the board in the direction it
  faces. */
  connector_cut_box(name) {
    const c = this.CONNECTORS_TABLE[name];
    const b = this.connector_box(name);
    if (c.faces === "mesh") return b;
    const g = this.connectorClearance;
    let x0 = b.x - g, y0 = b.y - g, z0 = b.z - g;
    let x1 = b.x + b.w + g, y1 = b.y + b.d + g, z1 = b.z + b.h + g;
    const [bx, by, , bw, bd] = this.board_frame();
    const r = this.connectorReach;
    if (c.faces === "bottom") y0 = Math.min(y0, by - r);
    else if (c.faces === "top") y1 = Math.max(y1, by + bd + r);
    else if (c.faces === "left") x0 = Math.min(x0, bx - r);
    else if (c.faces === "right") x1 = Math.max(x1, bx + bw + r);
    else z1 = z1 + r;
    return new Box3(x0, y0, z0, x1 - x0, y1 - y0, z1 - z0, name);
  }

  /** One ConnectorCut per row of CONNECTORS_TABLE, in table order. */
  connector_cuts() {
    return Object.entries(this.CONNECTORS_TABLE).map(([name, c]) =>
      new ConnectorCut(name, c.description, [this.connector_cut_box(name)], c.mesh ? [c.mesh, this.mesh_matrix()] : null));
  }
}

const COMMON_PARAMS = {};
for (const side of MARGIN_SIDES) COMMON_PARAMS[`margin_${side}`] = [0.5, `Space between it and the case's ${side} side (mm)`];
Object.assign(COMMON_PARAMS, {
  recess_depth: [0.0, "Sink its mounting this far below the case's outside surface (mm, negative; 0 = no recess)"],
  recess_style: ["plate", "plate: an open well and a separate baseplate bolted up into pillars round it; cut: a " +
    "pocket cut into the surface, with its own floor", ["plate", "cut"]],
  recess_radius: [3.0, "Radius of the recess's corners (mm)"],
  recess_width: [0.0, "Extra space across the recess's opening, beyond the device and its margins - half on each side (mm)"],
  recess_height: [0.0, "Extra space up the recess's opening, beyond the device and its margins - half on each side (mm)"],
  recess_hole: [0.0, "Diameter of a hole through the recess's floor or baseplate, for cables (mm); 0 = none"],
  recess_hole_across: [0.0, "Where the cable hole is, across the surface from the device's middle (mm)"],
  recess_hole_up: [0.0, "Where the cable hole is, up the surface from the device's middle (mm)"],
});

classAttrs(Device, {
  CONNECTORS: [],
  DISPLAY_NAME: null,
  DESCRIPTION: "",
  // What sort of thing it is, for grouping the editor's lists (see
  // catalogue.CATEGORIES).
  CATEGORY: "other",
  PARAMS: {},
  MARGIN_SIDES,
  COMMON_PARAMS,
  MARGIN_PARAMS: MARGIN_SIDES.map((s) => `margin_${s}`),
  RECESS_PARAMS: ["recess_depth", "recess_style", "recess_radius", "recess_width", "recess_height", "recess_hole",
    "recess_hole_across", "recess_hole_up"],
  RECESS_STYLES: ["plate", "cut"],
  RECESSABLE: true,
  // Does it cut through the surface it's on? On a wall, it then keeps below
  // the step at the wall's top that the lid's skirt fits over.
  CUTS_THROUGH: false,
  OUTSIDE_ONLY: false,
  INSIDE_ONLY: false,
  // Parts of its own that are meant to be in several pieces (the middles of
  // letters cut right through a surface), so not a problem.
  LOOSE_PARTS: [],
  // Which side of a surface a new one goes on, whichever was clicked:
  // "inside", "outside", or null for the side that was clicked.
  DEFAULT_MOUNT: "inside",
  DECORATED_PARTS: [],
  RECESS_WALL: 2.0,
  RECESS_PILLAR_DIAMETER: 7.0,
  RECESS_PILOT_DIAMETER: 2.5,
  RECESS_SCREW_HOLE: 3.4,
  RECESS_EDGE: 1.0,
  RECESS_PILLAR_SPACING: 80.0,
  RECESS_SCREW_HEAD: 3.0,
  recess_depth: 0.0,
  recess_style: "plate",
  recess_hole: 0.0,
  recess_hole_offset: [0.0, 0.0],
  recess_radius: 3.0,
  recess_ring: 0.0,
  CONNECTORS_TABLE: {},
  connectorClearance: 1.0,
  connectorReach: 10.0,
  CONNECTOR_PARAMS: {
    connectorClearance: "Gap left round each connector in its cut (mm)",
    connectorReach: "How far each connector cut extends past the board (mm)",
  },
});

export class PillarSupportedDevice extends Device {
  constructor(partType, partName, width, depth, {
    pillarType = PillarType.NUT_AND_BOLT, pillarRadius = 1.5, pillarHeight = 3, holeRadius = 1,
    holeCounterSinkHeight = 1.0, holeCounterSinkRadius = 3.0, innerGridXOffset = 5, innerGridYOffset = 5, ...rest
  } = {}) {
    super(partType, partName, width, depth, { innerGridXOffset, innerGridYOffset, ...rest });
    this.pillarType = pillarType;
    this.pillarRadius = pillarRadius;
    this.pillarHeight = pillarHeight;
    this.holeRadius = holeRadius;
    this.holeCounterSinkHeight = holeCounterSinkHeight;
    this.holeCounterSinkRadius = holeCounterSinkRadius;
  }

  /** A solid standoff (box, no hole) centred at (x, y). */
  postFuser(width, depth, height, x, y) {
    return Part.makeBox(width, depth, height, [x - width / 2.0, y - depth / 2.0, 0]);
  }

  pillarFuserSized(radius, height, x, y, baseHeight) {
    return Part.makeCylinder(radius, height + baseHeight, [x, y, -baseHeight]);
  }

  /** A pillar's screw hole. It goes on PAST the pillar's top
  (PILLAR_HOLE_OVERRUN): ending exactly at it, the kernel can leave the top
  face over the hole, sealing it into a bubble the builder then fills. */
  pillarCutterSized(radius, height, holeRadius, x, y, baseHeight) {
    height += PILLAR_HOLE_OVERRUN;
    if (this.pillarType === PillarType.NUT_AND_BOLT) {
      const hole = Part.makeCylinder(holeRadius, height + baseHeight, [x, y, -baseHeight]);
      const inset = Part.makeCylinder(this.holeCounterSinkRadius, this.holeCounterSinkHeight, [x, y, -baseHeight]);
      return hole.fuse(inset);
    }
    if (this.pillarType === PillarType.BOLT_ONLY) return Part.makeCylinder(holeRadius, height, [x, y, 0]);
    return null;
  }

  pillarFuser(x, y, baseHeight) {
    return this.pillarFuserSized(this.pillarRadius, this.pillarHeight, x, y, baseHeight);
  }

  pillarCutter(x, y, baseHeight) {
    return this.pillarCutterSized(this.pillarRadius, this.pillarHeight, this.holeRadius, x, y, baseHeight);
  }

  /** The bottom-left / top-left / top-right / bottom-right mounting-hole
  layout shared by most of the boards. */
  _fourCornerPositions(x0, y0, xSpacing, ySpacing) {
    const y1 = y0 + ySpacing;
    const x1 = x0 + xSpacing;
    return [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
  }

  /** Square stand-ins for each pillar, for the editor preview. */
  pillar_boxes() {
    if (typeof this._pillarPositions !== "function") return [];
    const r = this.pillarRadius;
    return this._pillarPositions(0, 0).map(([px, py]) => new Box3(px - r, py - r, 0, 2 * r, 2 * r, this.pillarHeight, "pillar"));
  }

  /** The usual pillars: one fuser and one cutter at each of _pillarPositions(). */
  get_fuser(x, y, baseHeight) {
    if (typeof this._pillarPositions !== "function") return super.get_fuser(x, y, baseHeight);
    return union(this._pillarPositions(x, y).map(([px, py]) => this.pillarFuser(px, py, baseHeight)));
  }

  get_cutter(x, y, baseHeight) {
    if (typeof this._pillarPositions !== "function") return super.get_cutter(x, y, baseHeight);
    return union(this._pillarPositions(x, y).map(([px, py]) => this.pillarCutter(px, py, baseHeight)));
  }
}

/** Raspberry Pi 4 with its long edge running along Y. The USB/Ethernet
connector stack is at the low-Y edge and the SD card at the high-Y edge. */
export class PI4Landscape extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, scrunchX = 0, scrunchY = 0,
    verticalAlignment = VerticalAlignment.CENTRE, horizontalAlignment = HorizontalAlignment.CENTRE } = {}) {
    super("PI4", partName, PI4Landscape.boardWidth, PI4Landscape.boardDepth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 3.0, pillarHeight: 4, holeRadius: 1, holeCounterSinkHeight: 1.0, holeCounterSinkRadius: 3.0,
    });
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.holeXInset;
    const y0 = y + this.yMargin + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  makeDummy() {
    let dummy = Part.makeBox(this.dummyWidth, this.dummyDepth, this.boardThickness);
    const connectorX = (this.dummyWidth - this.connectorWidth) / 2.0;
    const connectors = Part.makeBox(this.connectorWidth, this.connectorDepth, this.connectorHeight,
      [connectorX, -this.connectorOverhang, this.boardThickness - 2.0]);
    dummy = dummy.fuse(connectors);
    const holeX = (this.dummyWidth - this.holeXSpacing) / 2.0;
    const holeY = this.dummyDepth - this.holeIndent;
    dummy = dummy.cut(Part.makeCylinder(2.7 / 2.0, this.boardThickness, [holeX, holeY, 0]));
    const simslot = Part.makeBox(this.simSlotWidth, this.simSlotDepth, this.simSlotHeight,
      [(this.dummyWidth - this.simSlotWidth) / 2.0, this.dummyDepth, -this.simSlotHeight + 2]);
    return dummy.fuse(simslot);
  }

  /** Where makeDummy()'s board corner is in the device frame. */
  _board_origin() {
    const x = this.xMargin + this.holeXInset - (this.dummyWidth - this.holeXSpacing) / 2.0;
    const y = this.yMargin + this.holeYInset + this.holeYSpacing - (this.dummyDepth - this.holeIndent);
    return [x, y];
  }

  board_frame() {
    const [bx, by] = this._board_origin();
    return [bx, by, this.pillarHeight + this.boardThickness, this.dummyWidth, this.dummyDepth];
  }

  body_boxes() {
    const [bx, by] = this._board_origin();
    return [...this.pillar_boxes(),
      new Box3(bx, by, this.pillarHeight, this.dummyWidth, this.dummyDepth, this.boardThickness, "board"),
      ...this.connector_body_boxes()];
  }
}
{
  const a = {
    DISPLAY_NAME: "Raspberry Pi 4 (landscape)", CATEGORY: "cpu",
    DESCRIPTION: "Pi 4 on four pillars; USB/Ethernet stack at the device's front (low Y) edge.",
    boardDepth: 89.0, boardWidth: 60.0, holeXSpacing: 49.0, holeYSpacing: 58.0, holeXInset: 5.5, holeYInset: 25.0,
    connectorWidth: 55.0, connectorDepth: 21.0, connectorHeight: 21.0, connectorOverhang: 5.0, boardThickness: 3.0,
    holeIndent: 3.5, dummyDepth: 85.0, dummyWidth: 56.0, simSlotWidth: 13.0, simSlotHeight: 8.0, simSlotDepth: 20.0,
    connectorReach: 30.0,
  };
  a.CONNECTORS_TABLE = {
    usb_ethernet: Connector.onEdge("USB and Ethernet sockets", "bottom", a.dummyWidth, a.dummyDepth, {
      width: a.connectorWidth, centre: a.dummyWidth / 2.0, height: a.connectorHeight,
      depth: a.connectorDepth - a.connectorOverhang, overhang: a.connectorOverhang, z: -2.0,
    }),
  };
  classAttrs(PI4Landscape, a);
}

/** A compact UPS HAT-style board on 4 corner pillars. bodyHeight is an
ESTIMATE of the board plus its cells, used only for the editor preview and
collision warnings. */
export class SmallUPS extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 10.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE, grid = [], bodyHeight = 20.0 } = {}) {
    super("SmallUPS", partName, SmallUPS.boardWidth, SmallUPS.boardDepth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 2.5, pillarHeight, holeRadius: 1, holeCounterSinkHeight: 1.0, holeCounterSinkRadius: 3.0, grid,
    });
    this.bodyHeight = bodyHeight;
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.holeXInset;
    const y0 = y + this.yMargin + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  body_boxes() {
    return [...this.pillar_boxes(),
      new Box3(this.xMargin, this.yMargin, this.pillarHeight, this.boardWidth, this.boardDepth, this.bodyHeight, "board + cells")];
  }
}
classAttrs(SmallUPS, {
  DISPLAY_NAME: "Small UPS", CATEGORY: "power",
  DESCRIPTION: "Compact UPS board on four pillars.",
  PARAMS: { pillarHeight: [10.0, "Pillar height (mm)"], bodyHeight: [20.0, "Board + cells height above the pillars (mm, estimate)"] },
  boardWidth: 89.0, boardDepth: 42.0, holeXSpacing: 82.0, holeYSpacing: 36.0,
  holeXInset: (89.0 - 82.0) / 2.0, holeYInset: (42.0 - 36.0) / 2.0,
});

/** A large LCD module (outer 166x103) mounted on 4 pillars at its inner pin
positions, bolted with M2.5 bolts through the pillars. Its "screen"
connector cut makes the viewing hole above it. */
export class LCDPanel extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.NUT_AND_BOLT, pillarHeight = 5.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE, grid = [] } = {}) {
    super("LCDPanel", partName, LCDPanel.boardWidth, LCDPanel.boardDepth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 3.0, pillarHeight, holeRadius: 1.4, holeCounterSinkHeight: 0.5, holeCounterSinkRadius: 3.5,
      cutHeight: LCDPanel.boardThickness, grid,
    });
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + (this.boardWidth - this.pinXSpacing) / 2.0;
    const y0 = y + this.yMargin + (this.boardDepth - this.pinYMarginTop - this.pinYSpacing);
    return this._fourCornerPositions(x0, y0, this.pinXSpacing, this.pinYSpacing);
  }

  /** A pillar standing pillarHeight tall from the mounting surface itself. */
  _pillarFuser(x, y) {
    return Part.makeCylinder(this.pillarRadius, this.pillarHeight, [x, y, 0]);
  }

  get_fuser(x, y, baseHeight) {
    return union(this._pillarPositions(x, y).map(([px, py]) => this._pillarFuser(px, py)));
  }

  get_fake_board(x, y) {
    return Part.makeBox(this.boardWidth, this.boardDepth, this.boardThickness,
      [x + this.xMargin, y + this.yMargin, this.pillarHeight]);
  }

  body_boxes() {
    // The screen connector is the panel itself, so it isn't added again.
    return [...this.pillar_boxes(),
      new Box3(this.xMargin, this.yMargin, this.pillarHeight, this.boardWidth, this.boardDepth, this.boardThickness, "panel")];
  }
}
{
  const a = {
    DISPLAY_NAME: "LCD panel (166 x 103)", CATEGORY: "display",
    DESCRIPTION: "Large LCD module on four pillars; its screen cut makes the viewing hole above it.",
    PARAMS: { pillarHeight: [7.0, "Pillar height (mm)"] },
    boardWidth: 166.0, boardDepth: 103.0, screenClearance: 2.0,
  };
  a.heightOfBackPillarOnBoard = 4.0 + 0.2;
  a.boardThickness = 8.88 + 0.2;
  a.boardPillarToFront = a.heightOfBackPillarOnBoard + a.boardThickness;
  a.boardPillarHeight = 4.0;
  a.boardThickness = a.boardPillarHeight + a.boardPillarToFront + a.screenClearance;
  a.connectorClearance = 0.0;
  a.connectorReach = 100.0;
  a.CONNECTORS_TABLE = {
    screen: new Connector("Viewing hole above the panel", 0.0, 0.0, -a.boardThickness, a.boardWidth, a.boardDepth,
      a.boardThickness, "up"),
  };
  Object.assign(a, { pinXSpacing: 154.9, pinYSpacing: 92.0, pinYMarginTop: 5.0 });
  classAttrs(LCDPanel, a);
}

/** Raspberry Pi 3 Model A+, viewed from above with its long (65mm) edge
along X: power, HDMI and audio on the bottom edge, USB on the right. */
export class Pi3APlus extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 4.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE } = {}) {
    super("Pi3APlus", partName, Pi3APlus.boardWidth, Pi3APlus.boardDepth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 2.5, pillarHeight, holeRadius: 1, holeCounterSinkHeight: 1.0, holeCounterSinkRadius: 3.0,
    });
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.holeXInset;
    const y0 = y + this.yMargin + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  body_boxes() {
    const z = this.pillarHeight;
    const boardTop = z + this.boardThickness;
    const headerY = this.yMargin + this.boardDepth - this.headerInsetTop - this.headerDepth;
    return [...this.pillar_boxes(),
      new Box3(this.xMargin, this.yMargin, z, this.boardWidth, this.boardDepth, this.boardThickness, "board"),
      new Box3(this.xMargin + this.headerX, headerY, boardTop, this.headerWidth, this.headerDepth, this.headerHeight, "gpio header"),
      ...this.connector_body_boxes()];
  }
}
{
  const a = {
    DISPLAY_NAME: "Raspberry Pi 3A+", CATEGORY: "cpu",
    DESCRIPTION: "Pi 3A+ on four pillars; power, HDMI and audio on the bottom edge, USB on the right.",
    PARAMS: { pillarHeight: [4.0, "Pillar height (mm)"] },
    boardWidth: 65.0, boardDepth: 56.0, boardThickness: 1.6, holeXSpacing: 58.0, holeYSpacing: 49.0,
    headerX: 7.1, headerWidth: 51.0, headerDepth: 5.0, headerInsetTop: 1.0, headerHeight: 8.5,
  };
  a.holeXInset = (a.boardWidth - a.holeXSpacing) / 2.0;
  a.holeYInset = (a.boardDepth - a.holeYSpacing) / 2.0;
  const W = a.boardWidth;
  const D = a.boardDepth;
  a.CONNECTORS_TABLE = {
    power: Connector.onEdge("Micro-USB power socket", "bottom", W, D, { width: 10.0, centre: 10.6, height: 3.2, depth: 5.6, overhang: 1.0 }),
    hdmi: Connector.onEdge("HDMI socket", "bottom", W, D, { width: 20.0, centre: 33.0, height: 6.5, depth: 11.5, overhang: 1.0 }),
    audio: Connector.onEdge("3.5mm audio socket", "bottom", W, D, { width: 8.0, centre: W - 11.5, height: 6.0, depth: 12.0, overhang: 0.5 }),
    usb: Connector.onEdge("USB-A socket", "right", W, D, { width: 15.0, centre: 31.45, height: 7.5, depth: 14.0, overhang: 2.5 }),
  };
  classAttrs(Pi3APlus, a);
}

/** Raspberry Pi Zero (also the Zero W and Zero 2 W), viewed from above with
its long (65mm) edge along X. */
export class PiZero extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 4.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE, partType = "PiZero", width = PiZero.boardWidth,
    depth = PiZero.boardDepth } = {}) {
    super(partType, partName, width, depth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 2.5, pillarHeight, holeRadius: 1, holeCounterSinkHeight: 1.0, holeCounterSinkRadius: 3.0,
    });
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.piX + this.holeXInset;
    const y0 = y + this.yMargin + this.piY + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  board_frame() {
    const z = this.pillarHeight + this.boardThickness;
    return [this.xMargin + this.piX, this.yMargin + this.piY, z, this.boardWidth, this.boardDepth];
  }

  body_boxes() {
    const [bx, by, boardTop] = this.board_frame();
    const z = this.pillarHeight;
    const headerY = by + this.boardDepth - this.headerInsetTop - this.headerDepth;
    return [...this.pillar_boxes(),
      new Box3(bx, by, z, this.boardWidth, this.boardDepth, this.boardThickness, "board"),
      new Box3(bx + this.headerX, headerY, boardTop, this.headerWidth, this.headerDepth, this.headerHeight, "gpio header"),
      ...this.connector_body_boxes()];
  }
}
{
  const a = {
    DISPLAY_NAME: "Raspberry Pi Zero", CATEGORY: "cpu",
    DESCRIPTION: "Pi Zero / Zero W / Zero 2 W on four pillars; HDMI and USB on the bottom edge, SD card on the left.",
    PARAMS: { pillarHeight: [4.0, "Pillar height (mm)"] },
    boardWidth: 65.0, boardDepth: 30.0, boardThickness: 1.4, holeXSpacing: 58.0, holeYSpacing: 23.0, piX: 0.0, piY: 0.0,
    headerX: 7.0, headerWidth: 51.0, headerDepth: 5.0, headerInsetTop: 1.0, headerHeight: 8.5,
  };
  a.holeXInset = (a.boardWidth - a.holeXSpacing) / 2.0;
  a.holeYInset = (a.boardDepth - a.holeYSpacing) / 2.0;
  const W = a.boardWidth;
  const D = a.boardDepth;
  a.CONNECTORS_TABLE = {
    hdmi: Connector.onEdge("Mini-HDMI socket", "bottom", W, D, { width: 11.2, centre: 12.4, height: 3.4, depth: 7.5, overhang: 0.5 }),
    usb: Connector.onEdge("Micro-USB data socket", "bottom", W, D, { width: 8.0, centre: 41.4, height: 2.9, depth: 5.0, overhang: 1.0 }),
    power: Connector.onEdge("Micro-USB power socket", "bottom", W, D, { width: 8.0, centre: 54.0, height: 2.9, depth: 5.0, overhang: 1.0 }),
    sd_card: Connector.onEdge("Micro-SD card slot", "left", W, D, { width: 12.0, centre: 16.9, height: 1.4, depth: 12.0, overhang: 2.5 }),
    camera: Connector.onEdge("Camera connector", "right", W, D, { width: 17.0, centre: 15.0, height: 1.3, depth: 4.0, overhang: 0.5 }),
  };
  classAttrs(PiZero, a);
}

/** A Pi Zero's CONNECTORS_TABLE plus a "screen" cut over a display on its
HAT. */
export function piDisplayConnectors(displayWidth, displayDepth, unitHeight, piX, piY, left, right, top, bottom) {
  const table = { ...PiZero.CONNECTORS_TABLE };
  table.screen = new Connector("Viewing hole above the screen", left - piX, bottom - piY,
    unitHeight - PiZero.boardThickness - 1.0, displayWidth - left - right, displayDepth - top - bottom, 1.0, "up");
  return table;
}

/** A Pi Zero with a small LCD on its HAT: the display (88 x 57mm) lines up
with the Pi's top and left edges (viewed from above) and overhangs it to
the right and below. */
export class PiZero_small_lcd extends PiZero {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 4.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE } = {}) {
    const cls = new.target;
    super(partName, { xMargin, yMargin, pillarType, pillarHeight, scrunchX, scrunchY, verticalAlignment,
      horizontalAlignment, partType: cls.name, width: cls.displayWidth, depth: cls.displayDepth });
  }

  /** The screen: exactly its own size (no clearance), going straight up.
  The Pi's connectors: as usual, but reaching on out past the display's
  edges too. */
  connector_cut_box(name) {
    if (name === "screen") {
      const b = this.connector_box(name);
      return new Box3(b.x, b.y, b.z, b.w, b.d, b.h + this.screenReach, name);
    }
    const b = super.connector_cut_box(name);
    let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.d;
    const r = this.connectorReach;
    const faces = this.CONNECTORS_TABLE[name].faces;
    if (faces === "bottom") y0 = Math.min(y0, this.yMargin - r);
    else if (faces === "top") y1 = Math.max(y1, this.yMargin + this.displayDepth + r);
    else if (faces === "left") x0 = Math.min(x0, this.xMargin - r);
    else if (faces === "right") x1 = Math.max(x1, this.xMargin + this.displayWidth + r);
    return new Box3(x0, y0, b.z, x1 - x0, y1 - y0, b.h, name);
  }

  body_boxes() {
    const boxes = super.body_boxes().filter((b) => b.label !== "screen");
    const [, , boardTop] = this.board_frame();
    const bottom = boardTop + this.headerHeight;
    const top = this.pillarHeight + this.unitHeight;
    return [...boxes, new Box3(this.xMargin, this.yMargin, bottom, this.displayWidth, this.displayDepth, top - bottom, "display")];
  }
}
{
  const a = {
    DISPLAY_NAME: "Raspberry Pi Zero with small LCD", CATEGORY: "cpu",
    DESCRIPTION: "Pi Zero with an 88 x 57mm LCD on its HAT, lined up with the Pi's top and left edges.",
    displayWidth: 88.0, displayDepth: 57.0, unitHeight: 26.0, piX: 0.0,
    screenLeft: 4.0, screenRight: 8.0, screenTop: 2.0, screenBottom: 2.0, screenReach: 100.0,
  };
  a.piY = a.displayDepth - PiZero.boardDepth;
  a.CONNECTORS_TABLE = piDisplayConnectors(a.displayWidth, a.displayDepth, a.unitHeight, a.piX, a.piY,
    a.screenLeft, a.screenRight, a.screenTop, a.screenBottom);
  classAttrs(PiZero_small_lcd, a);
}

/** A Pi Zero with a smaller LCD on its HAT: the panel is 66 x 49mm, the
screen 58 x 44mm. Otherwise as PiZero_small_lcd. */
export class PiZero_smaller_lcd extends PiZero_small_lcd {}
{
  const a = {
    DISPLAY_NAME: "Raspberry Pi Zero with smaller LCD", CATEGORY: "cpu",
    DESCRIPTION: "Pi Zero with a 66 x 49mm LCD on its HAT, lined up with the Pi's top and left edges.",
    displayWidth: 66.0, displayDepth: 49.0, unitHeight: PiZero.boardThickness + 15.0, piX: 0.0,
    screenWidth: 58.0, screenDepth: 44.0, screenLeft: 1.7, screenTop: 2.4,
  };
  a.piY = a.displayDepth - PiZero.boardDepth;
  a.screenRight = a.displayWidth - a.screenLeft - a.screenWidth;
  a.screenBottom = a.displayDepth - a.screenTop - a.screenDepth;
  a.CONNECTORS_TABLE = piDisplayConnectors(a.displayWidth, a.displayDepth, a.unitHeight, a.piX, a.piY,
    a.screenLeft, a.screenRight, a.screenTop, a.screenBottom);
  classAttrs(PiZero_smaller_lcd, a);
}

/** M5Stack keyboard KB2 on four pillars, viewed from above with its long
(84.7mm) edge along X. Two connectors on the left-hand edge. */
export class M5StackKB2 extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 4.0,
    scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
    horizontalAlignment = HorizontalAlignment.CENTRE } = {}) {
    super("M5StackKB2", partName, M5StackKB2.boardWidth, M5StackKB2.boardDepth, {
      verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
      pillarRadius: 2.5, pillarHeight, holeRadius: 1, holeCounterSinkHeight: 1.0, holeCounterSinkRadius: 3.0,
    });
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.holeXInset;
    const y0 = y + this.yMargin + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  body_boxes() {
    const z = this.pillarHeight;
    return [...this.pillar_boxes(),
      new Box3(this.xMargin, this.yMargin, z, this.boardWidth, this.boardDepth, this.boardThickness, "board"),
      new Box3(this.xMargin, this.yMargin, z + this.boardThickness, this.boardWidth, this.boardDepth, this.keyHeight, "keys"),
      ...this.connector_body_boxes()];
  }
}
{
  const a = {
    DISPLAY_NAME: "M5Stack keyboard KB2", CATEGORY: "button",
    DESCRIPTION: "M5Stack KB2 keyboard on four pillars; two connectors on the left-hand edge.",
    PARAMS: { pillarHeight: [4.0, "Pillar height (mm)"] },
    boardWidth: 84.7, boardDepth: 54.3, boardThickness: 1.6, keyHeight: 6.0, holeXSpacing: 78.0, holeYSpacing: 48.0,
  };
  a.holeXInset = (a.boardWidth - a.holeXSpacing) / 2.0;
  a.holeYInset = (a.boardDepth - a.holeYSpacing) / 2.0;
  const W = a.boardWidth;
  const D = a.boardDepth;
  a.CONNECTORS_TABLE = {
    connector1: Connector.onEdge("Connector 1 (5-18mm up the left edge)", "left", W, D,
      { width: 13.0, centre: 5.0 + 13.0 / 2.0, height: 6.0, depth: 8.0, overhang: 1.0 }),
    connector2: Connector.onEdge("Connector 2 (22-33mm up the left edge)", "left", W, D,
      { width: 11.0, centre: 22.0 + 11.0 / 2.0, height: 6.0, depth: 8.0, overhang: 1.0 }),
  };
  classAttrs(M5StackKB2, a);
}

/** A small power pack, 96 x 63mm and 16.5mm tall, with its long edge along
X. It has no fixings of its own. Two connections on its right-hand end. */
export class SmallPowerpack extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5 } = {}) {
    super("small_powerpack", partName, SmallPowerpack.boardWidth, SmallPowerpack.boardDepth,
      { xMargin, yMargin, cutHeight: SmallPowerpack.packHeight });
  }

  get_cutter(x, y, baseHeight) {
    return null; // nothing through the surface it sits on - its openings are the connector cuts
  }

  body_boxes() {
    return [new Box3(this.xMargin, this.yMargin, 0.0, this.boardWidth, this.boardDepth, this.packHeight, "pack"),
      ...this.connector_body_boxes()];
  }
}
{
  const a = {
    DISPLAY_NAME: "Small power pack (96 x 63)", CATEGORY: "power",
    DESCRIPTION: "Power pack box with two connections on one end; no fixings.",
    boardWidth: 96.0, boardDepth: 63.0, packHeight: 16.5,
  };
  a.CONNECTORS_TABLE = {
    connection1: Connector.onEdge("Connection 1 (9mm in from the front corner)", "right", a.boardWidth, a.boardDepth,
      { width: 10.0, centre: 9.0 + 10.0 / 2.0, height: 5.0, depth: 1.0, overhang: 0.0, z: (a.packHeight - 5.0) / 2.0 }),
    connection2: Connector.onEdge("Connection 2 (centred on the end)", "right", a.boardWidth, a.boardDepth,
      { width: 15.0, centre: a.boardDepth / 2.0, height: 7.0, depth: 1.0, overhang: 0.0, z: (a.packHeight - 7.0) / 2.0 }),
  };
  classAttrs(SmallPowerpack, a);
}

/** A 32 x 8 LED array, 33 x 129mm with its long edge along Y, on four
pillars at 20 x 122mm centres. */
export class Pixel32x8 extends PillarSupportedDevice {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = 4.0,
    deviceHeight = 15.0 } = {}) {
    super("Pixel32x8", partName, Pixel32x8.boardWidth, Pixel32x8.boardDepth, {
      xMargin, yMargin, pillarType, pillarRadius: 2.5, pillarHeight, holeRadius: 1, holeCounterSinkHeight: 1.0,
      holeCounterSinkRadius: 3.0,
    });
    this.deviceHeight = deviceHeight;
  }

  _pillarPositions(x, y) {
    const x0 = x + this.xMargin + this.holeXInset;
    const y0 = y + this.yMargin + this.holeYInset;
    return this._fourCornerPositions(x0, y0, this.holeXSpacing, this.holeYSpacing);
  }

  body_boxes() {
    return [...this.pillar_boxes(),
      new Box3(this.xMargin, this.yMargin, this.pillarHeight, this.boardWidth, this.boardDepth, this.deviceHeight, "board")];
  }
}
{
  const a = {
    DISPLAY_NAME: "LED array 32x8", CATEGORY: "light",
    DESCRIPTION: "32 x 8 LED array, 33 x 129mm, on four pillars.",
    PARAMS: { pillarHeight: [4.0, "Pillar height (mm)"], deviceHeight: [15.0, "Height of the array itself, above the pillars (mm)"] },
    boardWidth: 130, boardDepth: 34.0, holeXSpacing: 122.0, holeYSpacing: 20.0,
  };
  a.holeXInset = (a.boardWidth - a.holeXSpacing) / 2.0;
  a.holeYInset = (a.boardDepth - a.holeYSpacing) / 2.0;
  classAttrs(Pixel32x8, a);
}

/** A round hole straight through whatever it's placed on - a wall, the
floor or a lid. */
export class Hole extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, diameter = 5.0 } = {}) {
    if (diameter <= 0) throw new Error(`a hole's diameter must be more than 0 (got ${diameter})`);
    super("Hole", partName, diameter, diameter, { xMargin, yMargin, cutHeight: 0.0 });
    this.diameter = diameter;
  }

  _centre(x, y) {
    const r = this.diameter / 2.0;
    return [x + this.xMargin + r, y + this.yMargin + r];
  }

  /** Right through the surface (Z -baseHeight..0), with a little to spare
  each side. */
  get_cutter(x, y, baseHeight) {
    const [cx, cy] = this._centre(x, y);
    return Part.makeCylinder(this.diameter / 2.0, baseHeight + 2.0, [cx, cy, -baseHeight - 1.0]);
  }

  body_boxes() {
    return [new Box3(this.xMargin, this.yMargin, 0, this.diameter, this.diameter, 0.5, "hole")];
  }
}
classAttrs(Hole, {
  DISPLAY_NAME: "Hole",
  DESCRIPTION: "A round hole through the surface it's on.",
  PARAMS: { diameter: [5.0, "Diameter of the hole (mm)"] },
  CUTS_THROUGH: true,
});

/** A battery compartment let into the outside of a case, with a lid (the
"cover", a part of its own) flush with the outside face. Two tabs on one
end of the cover slide under the edge of the opening, and a countersunk
self-tapping screw holds the other end down.

Mounted outside, in the device frame z = 0 is the outside face and the
compartment goes down (-z) into the case. The tab end is at low y, the
screw end at high y. */
export class BatteryCompartment extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, inner_width = 40.0, inner_length = 70.0, inner_depth = 20.0,
    back = "recess", wall = 2.0, clearance = 0.8, screw_diameter = 2.9, screw_length = 10.0, wire_hole = 4.0 } = {}) {
    const cls = BatteryCompartment;
    if (!cls.BACK_STYLES.includes(back)) throw new Error(`back must be one of ${cls.BACK_STYLES.join(", ")} (got '${back}')`);
    for (const [name, value] of [["inner_width", inner_width], ["inner_length", inner_length], ["inner_depth", inner_depth],
      ["wall", wall], ["screw_diameter", screw_diameter], ["screw_length", screw_length]]) {
      if (value <= 0) throw new Error(`a battery compartment's ${name} must be more than 0 (got ${value})`);
    }
    const c = Math.max(0.0, clearance);
    const pillar = back === "plate" ? cls.RECESS_PILLAR_DIAMETER / 2.0 : 0.0;
    const ledge = cls.LEDGE;
    const lidX0 = pillar + wall + c;
    const lidY0 = pillar + wall + c + cls.TAB_REACH;
    const lidX1 = lidX0 + inner_width + 2 * ledge;
    const cavity = [lidX0 + ledge, lidY0 + ledge, lidX1 - ledge, lidY0 + ledge + inner_length];
    const lidY1 = cavity[3] + cls.BOSS;
    const block = [pillar, pillar, lidX1 + c + wall, lidY1 + c + wall];
    super("BatteryCompartment", partName, block[2] + pillar, block[3] + pillar, { xMargin, yMargin, cutHeight: 0.0 });
    Object.assign(this, {
      inner_width, inner_length, inner_depth, back, wall, clearance: c, screw_diameter, screw_length,
      wire_hole: Math.max(0.0, wire_hole), pillar, lid_x0: lidX0, lid_y0: lidY0, lid_x1: lidX1, cavity, lid_y1: lidY1, block,
    });
  }

  _at(x, y) {
    return [x + this.xMargin, y + this.yMargin];
  }

  _box(x0, y0, x1, y1, z0, z1, r = 0.0) {
    const [ax, ay] = this._at(x0, y0);
    const [bx, by] = this._at(x1, y1);
    return this._rounded(ax, ay, bx, by, r, z0, z1);
  }

  /** The bottom of the space for the batteries. */
  _floor(t) {
    return -t - this.inner_depth;
  }

  /** The underside of the compartment's back (the back plate's too). */
  _bottom(t) {
    return this._floor(t) - t;
  }

  screw_position() {
    return this._at((this.lid_x0 + this.lid_x1) / 2.0, this.cavity[3] + this.BOSS / 2.0);
  }

  /** x of the middle of each tab. */
  tab_positions() {
    const x0 = this.lid_x0;
    const x1 = this.lid_x1;
    const width = x1 - x0;
    const xs = width >= 4 * this.TAB_WIDTH ? [x0 + width / 4.0, x0 + (3 * width) / 4.0] : [(x0 + x1) / 2.0];
    return xs.map((x) => x + this.xMargin);
  }

  pillar_positions() {
    if (this.back !== "plate") return [];
    const [x0, y0, x1, y1] = this.block;
    const out = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) out.push(this._at(x, y));
    return out;
  }

  wire_position() {
    const [cx0, , cx1, cy1] = this.cavity;
    return this._at((cx0 + cx1) / 2.0, cy1 - this.wire_hole / 2.0 - 2.0);
  }

  /** The compartment's walls (and back, or pillars), up to the outside face. */
  get_fuser(x, y, t) {
    const [x0, y0, x1, y1] = this.block;
    const r = this.LID_RADIUS + this.clearance + this.wall;
    if (this.back === "recess") return this._box(x0, y0, x1, y1, this._bottom(t), 0.0, r);
    const floor = this._floor(t);
    const pillars = this.pillar_positions().map(([px, py]) => Part.makeCylinder(this.pillar, -floor, [px, py, floor]));
    return union([this._box(x0, y0, x1, y1, floor, 0.0, r), ...pillars]);
  }

  /** The lid's opening, the space for the batteries, pockets for the lid's
  tabs, the pilot hole for its screw, and the wire hole (or, with a back
  plate, the pillars' screw holes). */
  get_cutter(x, y, t) {
    const c = this.clearance;
    const [cx0, cy0, cx1, cy1] = this.cavity;
    const floor = this._floor(t);
    const opening = this._box(this.lid_x0 - c, this.lid_y0 - c, this.lid_x1 + c, this.lid_y1 + c, -t, 1.0, this.LID_RADIUS + c);
    const cavity = this._box(cx0, cy0, cx1, cy1, floor - (this.back === "plate" ? 1.0 : 0.0), -t + 0.01, 1.0);
    const cuts = [opening, cavity];
    const half = this.TAB_WIDTH / 2.0 + c;
    // (The pockets reach TAB_SPARE further than the gap, for the tabs to go
    // well in as the lid goes down.)
    const y0 = this.lid_y0 - this.TAB_REACH - c - this.TAB_SPARE + this.yMargin;
    const deep = this.TAB_THICKNESS + this.TAB_DROP;
    for (const tx of this.tab_positions()) {
      cuts.push(Part.makeBox(2 * half, cy0 + this.yMargin + 0.01 - y0, deep + 0.01, [tx - half, y0, -t - deep]));
    }
    const [sx, sy] = this.screw_position();
    const bottom = this.back === "recess" ? this._bottom(t) : floor;
    const reach = Math.min(this.screw_length - t + 1.0, -t - bottom - this.SKIN);
    cuts.push(Part.makeCylinder(0.4 * this.screw_diameter, reach + 0.01, [sx, sy, -t - reach]));
    if (this.back === "recess" && this.wire_hole > 0) {
      const [wx, wy] = this.wire_position();
      cuts.push(Part.makeCylinder(this.wire_hole / 2.0, t + 2.0, [wx, wy, floor - t - 1.0]));
    }
    for (const [px, py] of this.pillar_positions()) {
      cuts.push(Part.makeCylinder(this.RECESS_PILOT_DIAMETER / 2.0, -floor - this.SKIN + 0.01, [px, py, floor - 0.01]));
    }
    return union(cuts);
  }

  /** The lid: flush with the outside face, its tabs underneath at the low-y
  end, and a countersunk hole for the screw at the other end. */
  cover(t) {
    const cy0 = this.cavity[1];
    const lid = this._box(this.lid_x0, this.lid_y0, this.lid_x1, this.lid_y1, -t, 0.0, this.LID_RADIUS);
    const tabs = [];
    for (const tx of this.tab_positions()) {
      const x0 = tx - this.TAB_WIDTH / 2.0;
      tabs.push(Part.makeBox(this.TAB_WIDTH, this.TAB_REACH + (cy0 - this.lid_y0), this.TAB_THICKNESS,
        [x0, this.lid_y0 - this.TAB_REACH + this.yMargin, -t - this.TAB_THICKNESS]));
      tabs.push(Part.makeBox(this.TAB_WIDTH, cy0 - this.lid_y0 - 0.5, this.TAB_THICKNESS + 0.5,
        [x0, this.lid_y0 + 0.5 + this.yMargin, -t - this.TAB_THICKNESS]));
    }
    const [sx, sy] = this.screw_position();
    const hole = this.screw_diameter / 2.0 + 0.2;
    const head = this.screw_diameter; // radius: a countersunk head is about twice the screw's diameter
    const sink = head - hole; // 90 degrees
    const screw = union([Part.makeCylinder(hole, t + 2.0, [sx, sy, -t - 1.0]),
      Part.makeCone(hole, head + 0.01, sink + 0.01, [sx, sy, -sink]),
      Part.makeCylinder(head + 0.01, 1.0, [sx, sy, 0.0])]);
    return union([lid, ...tabs]).cut(screw);
  }

  /** The back plate (back = "plate"). */
  back_plate(t) {
    const [x0, y0, x1, y1] = this.block;
    const p = this.pillar;
    const top = this._floor(t);
    // (Its corners are rounded round the pillars, so the plate goes all the
    // way round each screw hole.)
    const plate = this._box(x0 - p, y0 - p, x1 + p, y1 + p, top - t, top, p);
    const holes = this.pillar_positions().map(([px, py]) =>
      Part.makeCylinder(this.RECESS_SCREW_HOLE / 2.0, t + 2.0, [px, py, top - t - 1.0]));
    if (this.wire_hole > 0) {
      const [wx, wy] = this.wire_position();
      holes.push(Part.makeCylinder(this.wire_hole / 2.0, t + 2.0, [wx, wy, top - t - 1.0]));
    }
    return plate.cut(union(holes));
  }

  extra_parts(t) {
    const parts = { cover: this.cover(t) };
    if (this.back === "plate") parts.back = this.back_plate(t);
    return parts;
  }

  fitted_from_inside() {
    return this.back === "plate";
  }

  inside_boxes(t) {
    const [bx0, by0, bx1, by1] = this.block;
    const p = this.pillar;
    const [x0, y0] = this._at(bx0 - p, by0 - p);
    const [x1, y1] = this._at(bx1 + p, by1 + p);
    const bottom = this._bottom(t) - (this.back === "plate" ? this.RECESS_SCREW_HEAD : 0.0);
    return [new Box3(x0, y0, bottom, x1 - x0, y1 - y0, -t - bottom, "compartment")];
  }

  /** The lid, flush with the outside face. */
  body_boxes() {
    const [x0, y0] = this._at(this.lid_x0, this.lid_y0);
    const [x1, y1] = this._at(this.lid_x1, this.lid_y1);
    return [new Box3(x0, y0, -0.5, x1 - x0, y1 - y0, 0.5, "lid")];
  }
}
{
  const BACK_STYLES = ["recess", "plate"];
  classAttrs(BatteryCompartment, {
    DISPLAY_NAME: "Battery compartment", CATEGORY: "power",
    DESCRIPTION: "A compartment let into the outside of a case, its lid held by tabs at one end and a screw at the other.",
    BACK_STYLES,
    PARAMS: {
      inner_width: [40.0, "Width of the space for the batteries, across the lid (mm)"],
      inner_length: [70.0, "Length of the space for the batteries, from the tabs to the screw (mm)"],
      inner_depth: [20.0, "Depth of the space for the batteries, under the lid (mm)"],
      back: ["recess", "recess: its back is part of the case; plate: its back is a separate plate screwed on, so the " +
        "case prints without bridging over the compartment", BACK_STYLES],
      wall: [2.0, "Thickness of the compartment's walls (mm)"],
      clearance: [0.8, "Gap round the lid and its tabs (mm)"],
      screw_diameter: [2.9, "Diameter of the self-tapping screw holding the lid down (mm)"],
      screw_length: [10.0, "Length of that screw (mm)"],
      wire_hole: [4.0, "Diameter of a hole in the back, by the screw end, for the wires (mm); 0 = none"],
    },
    RECESSABLE: false,
    OUTSIDE_ONLY: true,
    DEFAULT_MOUNT: "outside",
    DECORATED_PARTS: ["cover"],
    LEDGE: 2.0, BOSS: 8.0, LID_RADIUS: 2.0, TAB_WIDTH: 8.0, TAB_REACH: 3.0, TAB_SPARE: 0.5, TAB_THICKNESS: 1.5, TAB_DROP: 2.0, SKIN: 0.8,
  });
}

/** A vent: a pattern of openings through the surface it's on - lines
(horizontal or vertical, with rounded or straight ends), a grid of round
holes, or round holes in rings filling an ellipse (as the speaker's grille
is made) - with fans behind it if it's given any.

Without fans, the pattern fills width x height. With them, the fans set the
size: they sit side by side, each with its four screw holes through the
surface, and the pattern is cut in the round opening in front of each fan's
blades, clear of the screws. Device frame: z = 0 is the surface's face on
the vent's side, and the fans stand on it (mounted inside, they're in the
case). */
export class Vent extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, pattern = "horizontal lines", ends = "rounded", width = 40.0,
    height = 30.0, line_width = 2.0, hole_diameter = 3.0, gap = 2.0, fans = 0, fan_size = "large" } = {}) {
    const cls = Vent;
    if (!cls.PATTERNS.includes(pattern)) throw new Error(`pattern must be one of ${cls.PATTERNS.join(", ")} (got '${pattern}')`);
    if (!cls.ENDS.includes(ends)) throw new Error(`ends must be one of ${cls.ENDS.join(", ")} (got '${ends}')`);
    if (!(fan_size in cls.FANS)) throw new Error(`fan_size must be one of ${Object.keys(cls.FANS).join(", ")} (got '${fan_size}')`);
    for (const [name, value] of [["width", width], ["height", height], ["line_width", line_width], ["hole_diameter", hole_diameter]]) {
      if (!(value > 0)) throw new Error(`a vent's ${name} must be more than 0 (got ${value})`);
    }
    if (!(gap >= 0)) throw new Error(`a vent's gap can't be negative (got ${gap})`);
    const count = Math.round(fans);
    if (!(count >= 0 && count <= 20)) throw new Error(`a vent can have 0 to 20 fans (got ${fans})`);
    const fan = cls.FANS[fan_size];
    const size = count ? [count * fan.size + (count - 1) * cls.FAN_GAP, fan.size] : [width, height];
    super("Vent", partName, size[0], size[1], { xMargin, yMargin, cutHeight: 0.0 });
    Object.assign(this, { pattern, ends, ventWidth: size[0], ventHeight: size[1], line_width, hole_diameter, gap, fans: count,
      fan_size, fan });
  }

  /** Each fan's middle, in the vent's own frame (its corner at 0, 0). */
  fanCentres() {
    const { size } = this.fan;
    return Array.from({ length: this.fans }, (_, i) => [size / 2.0 + i * (size + Vent.FAN_GAP), size / 2.0]);
  }

  /** The openings in an area w x h centred on cx, cy - kept inside a circle
  of radius `within` round its middle, if that's given: [{circle: [x, y, r]}
  | {slot: [x0, y0, x1, y1, r, rounded]}] (a slot runs between the centres
  of its ends). */
  openings(cx, cy, w, h, within = null) {
    const out = [];
    const { gap } = this;
    if (this.pattern.endsWith("lines")) {
      const t = this.line_width;
      const up = this.pattern === "vertical lines";
      const [long, short] = up ? [h, w] : [w, h];
      const n = Math.max(1, Math.floor((short + gap) / (t + gap)));
      const start = -((n - 1) * (t + gap)) / 2.0;
      for (let i = 0; i < n; i++) {
        const off = start + i * (t + gap);
        // A line's length: the area's, or the circle's chord where it is.
        let half = long / 2.0;
        if (within !== null) {
          const reach = within ** 2 - (Math.abs(off) + t / 2.0) ** 2;
          if (reach <= 0) continue;
          half = Math.min(half, Math.sqrt(reach));
        }
        half -= t / 2.0; // (less its ends)
        if (half < 0) continue;
        const rounded = this.ends === "rounded";
        out.push({ slot: up ? [cx + off, cy - half, cx + off, cy + half, t / 2.0, rounded]
          : [cx - half, cy + off, cx + half, cy + off, t / 2.0, rounded] });
      }
    } else if (this.pattern === "grid of holes") {
      const r = this.hole_diameter / 2.0;
      const pitch = this.hole_diameter + gap;
      const nx = Math.max(1, Math.floor((w + gap) / pitch));
      const ny = Math.max(1, Math.floor((h + gap) / pitch));
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < ny; j++) {
          const x = (i - (nx - 1) / 2.0) * pitch;
          const y = (j - (ny - 1) / 2.0) * pitch;
          if (within !== null && Math.hypot(x, y) + r > within + 1e-9) continue;
          out.push({ circle: [cx + x, cy + y, r] });
        }
      }
    } else {
      // Rings of holes, from the outside in, their holes spread evenly round
      // each - each ring in far enough that its holes are a pitch from the
      // last one's (round an ellipse, a pitch in at its ends isn't enough
      // where it's flatter) - and one in the middle if there's room for it.
      const r = this.hole_diameter / 2.0;
      const pitch = this.hole_diameter + gap;
      let a = (within !== null ? within : w / 2.0) - r;
      let b = (within !== null ? within : h / 2.0) - r;
      const apart = (ps, qs) => ps.every(([x, y]) => qs.every(([u, v]) => Math.hypot(x - u, y - v) >= pitch - 1e-6));
      let last = null;
      while (Math.min(a, b) >= pitch - 1e-9) {
        let ring = Vent.aroundEllipse(a, b, pitch);
        while (last && !apart(ring, last) && Math.min(a, b) >= pitch) {
          a -= 0.1;
          b -= 0.1;
          ring = Vent.aroundEllipse(a, b, pitch);
        }
        if (Math.min(a, b) < pitch - 1e-9) break;
        for (const [x, y] of ring) out.push({ circle: [cx + x, cy + y, r] });
        last = ring;
        a -= pitch;
        b -= pitch;
      }
      if (Math.min(a, b) >= -1e-9 && (!last || apart([[0, 0]], last))) out.push({ circle: [cx, cy, r] });
    }
    return out;
  }

  /** Points spread evenly round an ellipse (semi-axes a, b), `pitch` apart
  or a little more, the first at its right-hand end. */
  static aroundEllipse(a, b, pitch) {
    const steps = 720;
    const at = (t) => [a * Math.cos(t), b * Math.sin(t)];
    const lengths = [0];
    for (let i = 1; i <= steps; i++) {
      const [x0, y0] = at(((i - 1) / steps) * 2 * Math.PI);
      const [x1, y1] = at((i / steps) * 2 * Math.PI);
      lengths.push(lengths[i - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    const perimeter = lengths[steps];
    const spread = (n) => {
      const points = [];
      let i = 0;
      for (let k = 0; k < n; k++) {
        const want = (k * perimeter) / n;
        while (lengths[i + 1] < want) i++;
        const f = (want - lengths[i]) / (lengths[i + 1] - lengths[i] || 1);
        points.push(at(((i + f) / steps) * 2 * Math.PI));
      }
      return points;
    };
    // Evenly round the curve, but where it bends sharply neighbours are
    // closer than that across it: one fewer until they're far enough apart.
    for (let n = Math.floor(perimeter / pitch); n >= 2; n--) {
      const points = spread(n);
      if (points.every((p, k) => Math.hypot(...p.map((v, j) => v - points[(k + 1) % n][j])) >= pitch - 1e-9)) return points;
    }
    return perimeter >= pitch ? [at(0)] : [];
  }

  /** Every opening, in the vent's own frame. */
  allOpenings() {
    if (!this.fans) return this.openings(this.ventWidth / 2.0, this.ventHeight / 2.0, this.ventWidth, this.ventHeight);
    const { size, opening } = this.fan;
    return this.fanCentres().flatMap(([cx, cy]) => this.openings(cx, cy, size, size, opening / 2.0));
  }

  /** The fans' screw holes, in the vent's own frame: [[x, y]...]. */
  screwHoles() {
    const h = this.fan.spacing / 2.0;
    return this.fanCentres().flatMap(([cx, cy]) => [[cx - h, cy - h], [cx + h, cy - h], [cx + h, cy + h], [cx - h, cy + h]]);
  }

  /** Right through the surface (Z -baseHeight..0), with a little to spare
  each side. */
  get_cutter(x, y, baseHeight) {
    const ox = x + this.xMargin;
    const oy = y + this.yMargin;
    const z = -baseHeight - 1.0;
    const tall = baseHeight + 2.0;
    const shapes = this.allOpenings().map((o) => {
      if (o.circle) return Part.makeCylinder(o.circle[2], tall, [ox + o.circle[0], oy + o.circle[1], z]);
      const [x0, y0, x1, y1, r, rounded] = o.slot;
      if (rounded) {
        return Part.hull([Part.makeCylinder(r, tall, [ox + x0, oy + y0, z]), Part.makeCylinder(r, tall, [ox + x1, oy + y1, z])]);
      }
      // Straight ends, as far out as the rounded ones would reach.
      return Part.makeBox(Math.abs(x1 - x0) + 2 * r, Math.abs(y1 - y0) + 2 * r, tall,
        [ox + Math.min(x0, x1) - r, oy + Math.min(y0, y1) - r, z]);
    });
    for (const [sx, sy] of this.screwHoles()) shapes.push(Part.makeCylinder(this.fan.screw / 2.0, tall, [ox + sx, oy + sy, z]));
    return shapes.length ? Part.compound(shapes) : null;
  }

  body_boxes() {
    const boxes = [new Box3(this.xMargin, this.yMargin, 0, this.ventWidth, this.ventHeight, 0.5, "vent")];
    const { size, thickness } = this.fan;
    for (const [cx, cy] of this.fanCentres()) {
      boxes.push(new Box3(this.xMargin + cx - size / 2.0, this.yMargin + cy - size / 2.0, 0, size, size, thickness, "fan"));
    }
    return boxes;
  }
}
{
  const PATTERNS = ["horizontal lines", "vertical lines", "grid of holes", "ellipse of holes"];
  const ENDS = ["rounded", "straight"];
  // size: the fan's square; spacing: between its screw holes; screw: the
  // holes for its screws; opening: the round opening in front of its
  // blades; thickness: how far it stands from the surface.
  const FANS = {
    large: { size: 40.0, spacing: 32.0, screw: 3.4, opening: 38.0, thickness: 10.0 },
    small: { size: 25.0, spacing: 20.0, screw: 2.4, opening: 23.0, thickness: 10.0 },
  };
  classAttrs(Vent, {
    DISPLAY_NAME: "Vent", CATEGORY: "vent",
    DESCRIPTION: "Ventilation through the surface it's on: lines, a grid of holes or an ellipse of holes, with fans behind it if wanted.",
    PATTERNS, ENDS, FANS, FAN_GAP: 1.0, CUTS_THROUGH: true,
    PARAMS: {
      pattern: ["horizontal lines", "What the openings are: lines across or up the vent, a grid of round holes, or round " +
        "holes in rings filling an ellipse", PATTERNS],
      ends: ["rounded", "Lines: rounded or straight ends", ENDS],
      width: [40.0, "Width of the vent (mm) - with fans, the fans set its size"],
      height: [30.0, "Height of the vent (mm) - with fans, the fans set its size"],
      line_width: [2.0, "Lines: how wide each one is (mm)"],
      hole_diameter: [3.0, "Holes: their diameter (mm)"],
      gap: [2.0, "Space between neighbouring lines or holes (mm)"],
      fans: [0, "Number of fans behind the vent, side by side (0 = none)"],
      fan_size: ["large", "large: 40mm fans, screw holes 32mm apart; small: 25mm fans, screw holes 20mm apart", Object.keys(FANS)],
    },
    RECESSABLE: false,
  });
}

// The built-in devices, by their "type" string.
export const BUILT_IN = {
  PI4Landscape,
  Pi3APlus,
  PiZero,
  PiZero_small_lcd,
  PiZero_smaller_lcd,
  M5StackKB2,
  small_powerpack: SmallPowerpack,
  SmallUPS,
  LCDPanel,
  Pixel32x8,
  Hole,
  BatteryCompartment,
  Vent,
};
