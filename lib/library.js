/* Devices described as data: a board on pillars, what it cuts through the
surface it's mounted on, and the openings its connectors need in the case.
One generic class (defineDevice()) makes a catalogue device of each, so a
new device is a definition in lib/library/ and nothing more. They're ported
from boxmaker.py (a FreeCAD macro) with tools/boxmaker/ - see the README's
"Devices from boxmaker" - and can be written by hand just as well.

A definition, everything in mm, measured in the BOARD's frame (x 0..width,
y 0..depth across the board as seen from above, the board's corner at its
footprint's corner and the mounting surface at z = 0):

  type, displayName, description - its name in designs, and in the editor
  source - where it came from (for people, not used)
  board: {width, depth, thickness}
  pillars: {radius, height, holeRadius, countersinkRadius, countersinkHeight,
    holeBelow, at: [[x, y], ...]} - what it stands on, screwed into
    (pillarType says how: through, from underneath, or into the pillar only;
    holeBelow: how far a screw hole into the pillar goes on into the surface)
  openings: [{description, circle: [x, y, r]}, {description, box: [x, y, w,
    d]} or {description, ring: [cx, cy, radius, count, r], angle} (count
    holes of radius r round a circle, the first at angle degrees), with
    skin: mm left at the outside face (0 = right through), and pipe:
    {height, wall} for a tube that stands round a round one to height above
    the surface (a light pipe)] - holes through the surface it's mounted on
  parts: [{label, x, y, z, w, d, h}] - what stands on the board, z from its
    top, for the editor's preview and the collision checks
  connectors: {name: {description, edge: "bottom" | "top" | "left" | "right",
    width, centre, height, depth, overhang, z}, or {description, up: [x, y,
    w, d], z, height}} - openings it needs in the case (Connector.onEdge(),
    or a "up" opening above it, through whatever's there)
  settings: {connectorClearance, connectorReach, ...} - its own values for
    the devices' settings
  category: what sort of thing it is, for grouping the editor's lists - one
    of catalogue.CATEGORIES ("cpu", "sound", "light", "button" ...)
  mount: "inside" (the default), "outside", or null - which side of a
    surface a new one goes on, whichever side was clicked (null: that one) */
import { BUILT_IN, classAttrs, Connector, HorizontalAlignment, PillarSupportedDevice, PillarType, union,
  VerticalAlignment } from "./devices.js";
import { Box3 } from "./geom.js";
import * as Part from "./kernel.js";
import pico from "./library/pico.js";
import pixelRingLightPipes from "./library/pixelringlightpipes.js";
import smallSpeaker from "./library/smallspeaker.js";

/** The definitions, in the order the editor lists them (it sorts them). */
export const DEFINITIONS = [pico, pixelRingLightPipes, smallSpeaker];

function connectorsOf(def) {
  const table = {};
  for (const [name, c] of Object.entries(def.connectors || {})) {
    if (c.edge) {
      table[name] = Connector.onEdge(c.description || name, c.edge, def.board.width, def.board.depth,
        { width: c.width, centre: c.centre, height: c.height, depth: c.depth, overhang: c.overhang ?? 0.0, z: c.z ?? 0.0 });
    } else if (c.up) {
      const [x, y, w, d] = c.up;
      table[name] = new Connector(c.description || name, x, y, c.z ?? 0.0, w, d, c.height ?? 1.0, "up");
    } else throw new Error(`${def.type}'s connector ${name} has neither an edge nor "up"`);
  }
  return table;
}

/** A definition's openings with its rings made into their holes. */
export function expandOpenings(openings = []) {
  return openings.flatMap((o) => {
    if (!o.ring) return [o];
    const [cx, cy, radius, count, r] = o.ring;
    const { ring, angle = 0.0, ...rest } = o;
    return Array.from({ length: count }, (_, i) => {
      const a = ((angle + (i * 360) / count) * Math.PI) / 180;
      return { ...rest, circle: [cx + radius * Math.cos(a), cy + radius * Math.sin(a), r] };
    });
  });
}

/** The catalogue device class a definition describes. */
export function defineDevice(def) {
  const pillars = def.pillars || { at: [] };
  const openings = expandOpenings(def.openings);
  const cls = class extends PillarSupportedDevice {
    constructor(partName, { xMargin = 0.5, yMargin = 0.5, pillarType = PillarType.DEFAULT, pillarHeight = pillars.height ?? 0.0,
      scrunchX = 0, scrunchY = 0, verticalAlignment = VerticalAlignment.CENTRE,
      horizontalAlignment = HorizontalAlignment.CENTRE } = {}) {
      super(def.type, partName, def.board.width, def.board.depth, {
        verticalAlignment, horizontalAlignment, xMargin, yMargin, pillarType, scrunchX, scrunchY,
        pillarRadius: pillars.radius ?? 2.5, pillarHeight, holeRadius: pillars.holeRadius ?? 1.0,
        holeCounterSinkHeight: pillars.countersinkHeight ?? 1.0, holeCounterSinkRadius: pillars.countersinkRadius ?? 3.0,
      });
    }

    _pillarPositions(x, y) {
      return pillars.at.map(([px, py]) => [x + this.xMargin + px, y + this.yMargin + py]);
    }

    /** A screw hole into the pillar, going on holeBelow into the surface. */
    pillarCutter(x, y, baseHeight) {
      const below = pillars.holeBelow ?? 0.0;
      if (below > 0 && this.pillarType === PillarType.BOLT_ONLY) {
        return Part.makeCylinder(this.holeRadius, this.pillarHeight + below, [x, y, -below]);
      }
      return super.pillarCutter(x, y, baseHeight);
    }

    /** The pillars, and the light pipes. */
    get_fuser(x, y, baseHeight) {
      const bx = x + this.xMargin;
      const by = y + this.yMargin;
      const pipes = openings.filter((o) => o.pipe).map((o) => {
        const z0 = -baseHeight + (o.skin ?? 0.0);
        return Part.makeCylinder(o.circle[2], o.pipe.height - z0, [bx + o.circle[0], by + o.circle[1], z0]);
      });
      return union([pillars.at.length ? super.get_fuser(x, y, baseHeight) : null, ...pipes]);
    }

    /** The pillars' holes, and the openings through the surface it's on
    (inside any pipe round them: cut after the pipe's added, a pipe's
    opening is its inside). */
    get_cutter(x, y, baseHeight) {
      const bx = x + this.xMargin;
      const by = y + this.yMargin;
      const holes = openings.map((o) => {
        const z0 = o.skin ? -baseHeight + o.skin : -baseHeight - 1.0;
        const h = (o.pipe ? o.pipe.height + 0.5 : 1.0) - z0;
        if (o.circle) return Part.makeCylinder(o.circle[2] - (o.pipe ? o.pipe.wall : 0.0), h, [bx + o.circle[0], by + o.circle[1], z0]);
        return Part.makeBox(o.box[2], o.box[3], h, [bx + o.box[0], by + o.box[1], z0]);
      });
      return union([pillars.at.length ? super.get_cutter(x, y, baseHeight) : null, ...holes]);
    }

    body_boxes() {
      const [bx, by, top] = this.board_frame();
      return [...this.pillar_boxes(),
        new Box3(bx, by, this.pillarHeight, this.boardWidth, this.boardDepth, this.boardThickness, "board"),
        ...(def.parts || []).map((p) => new Box3(bx + p.x, by + p.y, top + (p.z ?? 0.0), p.w, p.d, p.h, p.label)),
        ...openings.filter((o) => o.pipe).map((o) => new Box3(bx + o.circle[0] - o.circle[2], by + o.circle[1] - o.circle[2], 0.0,
          2 * o.circle[2], 2 * o.circle[2], o.pipe.height, "light pipe")),
        ...this.connector_body_boxes()];
    }
  };
  Object.defineProperty(cls, "name", { value: def.type });
  classAttrs(cls, {
    DISPLAY_NAME: def.displayName || def.type,
    DESCRIPTION: def.description || "",
    DEFINITION: def,
    PARAMS: pillars.at.length ? { pillarHeight: [pillars.height, "Pillar height (mm)"] } : {},
    boardWidth: def.board.width,
    boardDepth: def.board.depth,
    boardThickness: def.board.thickness ?? 1.6,
    CONNECTORS_TABLE: connectorsOf(def),
    DEFAULT_MOUNT: def.mount === undefined ? "inside" : def.mount,
    CATEGORY: def.category || "other",
    ...(def.settings || {}),
  });
  return cls;
}

/** {type: class} for every definition - added to the built-in devices. */
export const LIBRARY = {};
for (const def of DEFINITIONS) {
  if (def.type in BUILT_IN) throw new Error(`there are two devices called ${def.type}`);
  LIBRARY[def.type] = defineDevice(def);
}
Object.assign(BUILT_IN, LIBRARY);
