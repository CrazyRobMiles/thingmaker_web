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
  board: {width, depth, thickness} - thickness 0 for a device with no board
    of its own to show (a holder, say: what it holds is one of its parts)
  pillars: {radius, height, holeRadius, countersinkRadius, countersinkHeight,
    holeBelow, at: [[x, y], ...]} - what it stands on, screwed into
    (pillarType says how: through, from underneath, or into the pillar only;
    holeBelow: how far a screw hole into the pillar goes on into the surface)
  openings: [{description, circle: [x, y, r]}, {description, box: [x, y, w,
    d]}, {description, ring: [cx, cy, radius, count, r], angle} (count
    holes of radius r round a circle, the first at angle degrees) or
    {description, grid: [x0, y0, dx, dy, nx, ny, r]} (nx by ny holes of
    radius r, the first at x0, y0), with skin: mm left at the outside face
    (0 = right through) or depth: how far it goes into the inside face (a
    pocket, not a hole), throughPillars: true for one that goes on up to
    the pillars' tops, cutting away any part of them over it, and pipe: {height, wall} for a tube that stands
    round a round one to height above the surface (a light pipe)] - holes
    through the surface it's mounted on. byHand: why, on one that isn't
    boxmaker's (the tests leave it out when they compare)
  blocks: [{x, y, w, d, h}] - plain supports standing on the surface, with
    no screw
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
import alpha14Seg from "./library/alpha14seg.js";
import audioAmplifier from "./library/audioamplifier.js";
import bigButton from "./library/bigbutton.js";
import bme280 from "./library/bme280.js";
import ccs811 from "./library/ccs811.js";
import dcToDc from "./library/dctodc.js";
import dfPlayer from "./library/dfplayer.js";
import doitEsp32 from "./library/doitesp32.js";
import hugeButton from "./library/hugebutton.js";
import joystick from "./library/joystick.js";
import leonardo from "./library/leonardo.js";
import mediumButton from "./library/mediumbutton.js";
import neoPixel8x8LightPipes from "./library/neopixel8x8lightpipes.js";
import pico from "./library/pico.js";
import pirSensor from "./library/pirsensor.js";
import pixelRingLightPipes from "./library/pixelringlightpipes.js";
import rfidSensor from "./library/rfidsensor.js";
import rotaryPot from "./library/rotarypot.js";
import smallNeoPixel8x8LightPipes from "./library/smallneopixel8x8lightpipes.js";
import smallOled from "./library/smalloled.js";
import smallOledWindow from "./library/smalloledwindow.js";
import smallPirSensor from "./library/smallpirsensor.js";
import smallSpeaker from "./library/smallspeaker.js";
import wemos from "./library/wemos.js";

/** The definitions (the editor sorts them). */
export const DEFINITIONS = [
  alpha14Seg, audioAmplifier, bigButton, bme280, ccs811, dcToDc, dfPlayer, doitEsp32, hugeButton, joystick, leonardo, mediumButton, neoPixel8x8LightPipes, pico, pirSensor, pixelRingLightPipes, rfidSensor, rotaryPot, smallNeoPixel8x8LightPipes, smallOled, smallOledWindow, smallPirSensor, smallSpeaker, wemos,
];

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
    if (o.grid) {
      const { grid: [x0, y0, dx, dy, nx, ny, r], ...rest } = o;
      return Array.from({ length: nx * ny }, (_, k) => ({ ...rest, circle: [x0 + (k % nx) * dx, y0 + Math.floor(k / nx) * dy, r] }));
    }
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
  const blocks = def.blocks || [];
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
      // (from the outside face up, as pillars are, so they're one with the surface)
      const supports = blocks.map((b) => Part.makeBox(b.w, b.d, b.h + baseHeight, [bx + b.x, by + b.y, -baseHeight]));
      return union([pillars.at.length ? super.get_fuser(x, y, baseHeight) : null, ...pipes, ...supports]);
    }

    /** The pillars' holes, and the openings through the surface it's on
    (inside any pipe round them: cut after the pipe's added, a pipe's
    opening is its inside). */
    get_cutter(x, y, baseHeight) {
      const bx = x + this.xMargin;
      const by = y + this.yMargin;
      const holes = openings.map((o) => {
        const z0 = o.depth ? -o.depth : o.skin ? -baseHeight + o.skin : -baseHeight - 1.0;
        const h = (o.pipe ? o.pipe.height + 0.5 : o.throughPillars ? this.pillarHeight + 0.5 : 1.0) - z0;
        if (o.circle) return Part.makeCylinder(o.circle[2] - (o.pipe ? o.pipe.wall : 0.0), h, [bx + o.circle[0], by + o.circle[1], z0]);
        return Part.makeBox(o.box[2], o.box[3], h, [bx + o.box[0], by + o.box[1], z0]);
      });
      return union([pillars.at.length ? super.get_cutter(x, y, baseHeight) : null, ...holes]);
    }

    body_boxes() {
      const [bx, by, top] = this.board_frame();
      return [...this.pillar_boxes(),
        ...(this.boardThickness > 0 ? [new Box3(bx, by, this.pillarHeight, this.boardWidth, this.boardDepth, this.boardThickness, "board")] : []),
        ...(def.parts || []).map((p) => new Box3(bx + p.x, by + p.y, top + (p.z ?? 0.0), p.w, p.d, p.h, p.label)),
        ...openings.filter((o) => o.pipe).map((o) => new Box3(bx + o.circle[0] - o.circle[2], by + o.circle[1] - o.circle[2], 0.0,
          2 * o.circle[2], 2 * o.circle[2], o.pipe.height, "light pipe")),
        ...blocks.map((b) => new Box3(bx + b.x, by + b.y, 0.0, b.w, b.d, b.h, "support")),
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
