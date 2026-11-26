/* A cold shoe foot: what slides into a camera's accessory shoe (one without
electrical contacts, a "cold" shoe), so the case can be fixed to a camera,
or to anything else with a shoe.

The foot is a part of its own, a T in section: a neck standing on the case,
and on it the plate that slides under the shoe's rails. It's screwed to the
case by two countersunk self-tapping screws, through the plate and the neck
(their heads flush with the plate's face, which slides along the shoe's
floor) into pilot holes in the case, each in a boss inside the case so the
screw has more than the case's skin to hold in.

Mounted outside, in the device frame z = 0 is the outside face: the foot
stands on it, up +z, and the bosses go down -z into the case. It slides
into the shoe along y, the plate's width across x.

The foot is built in the same frame as the part it's screwed to, as every
device's own parts are. On a part printed lying on its outside face (the
floor, the lid, a panel wall) that puts its plate on the bed: it prints
without supports. On the wall of a one-piece case it stands on its end,
sliding upright, every layer a whole T: that prints without supports too,
and is the stronger way round - but turned to slide across the wall, it
would be on its side, and is better laid on its plate in the slicer.

The sizes are ISO 518's (an 18mm square plate 2mm thick, the shoe's
opening 12.5mm across), a little under for printing: settings, to fit a
particular camera. */
import { BUILT_IN, Device, classAttrs, union } from "./devices.js";
import { Box3 } from "./geom.js";
import * as Part from "./kernel.js";

export class ColdShoe extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, plate_width = 17.8, plate_thickness = 1.9, length = 18.0,
    neck_width = 12.0, neck_height = 3.0, lead_in = 2.0, screw_diameter = 2.9, screw_length = 10.0, boss_height = 4.0 } = {}) {
    for (const [name, value] of [["plate_width", plate_width], ["plate_thickness", plate_thickness], ["length", length],
      ["neck_width", neck_width], ["neck_height", neck_height], ["screw_diameter", screw_diameter], ["screw_length", screw_length]]) {
      if (!(value > 0)) throw new Error(`a cold shoe's ${name} must be more than 0 (got ${value})`);
    }
    if (neck_width > plate_width) throw new Error(`a cold shoe's neck (${neck_width}mm) can't be wider than its plate (${plate_width}mm)`);
    if (screw_diameter + 2.0 > neck_width) {
      throw new Error(`a cold shoe's screws (${screw_diameter}mm) need a neck at least 2mm wider (it's ${neck_width}mm)`);
    }
    // (The corners come off the plate only, so no further in than it reaches past the neck.)
    const overhang = (plate_width - neck_width) / 2.0;
    if (lead_in > overhang + 1e-9) {
      throw new Error(`a cold shoe's lead-in (${lead_in}mm) can't be more than its plate reaches past the neck (${overhang}mm)`);
    }
    super("ColdShoe", partName, plate_width, length, { xMargin, yMargin, cutHeight: 0.0 });
    Object.assign(this, { plate_width, plate_thickness, length, neck_width, neck_height, lead_in: Math.max(0.0, lead_in),
      screw_diameter, screw_length, boss_height: Math.max(0.0, boss_height) });
  }

  /** The middle of the foot, across. */
  _middle() {
    return this.xMargin + this.plate_width / 2.0;
  }

  /** Where the screws go: on the middle line, a quarter of the way in from
  each end. */
  screw_positions() {
    const x = this._middle();
    return [0.25, 0.75].map((f) => [x, this.yMargin + f * this.length]);
  }

  /** How far a screw goes on past the foot, into the case. */
  _into_case() {
    return this.screw_length - this.neck_height - this.plate_thickness;
  }

  /** Bosses inside the case for the screws to hold in (from the outside
  face in, as pillars are, so they're one with the surface). */
  get_fuser(x, y, t) {
    if (this.boss_height <= 0) return null;
    return union(this.screw_positions().map(([sx, sy]) =>
      Part.makeCylinder(this.BOSS_RADIUS, t + this.boss_height, [sx, sy, -t - this.boss_height])));
  }

  /** The screws' pilot holes, from the outside face into the case (stopping
  short of the bosses' ends). */
  get_cutter(x, y, t) {
    const deepest = t + this.boss_height - this.SKIN;
    const depth = Math.min(this._into_case() + 1.0, deepest);
    if (depth <= 0) return null;
    return union(this.screw_positions().map(([sx, sy]) =>
      Part.makeCylinder(0.4 * this.screw_diameter, depth + 0.01, [sx, sy, -depth])));
  }

  /** The plate's outline: a rectangle, its corners at the low-y end (the
  end that goes into the shoe first) cut off at 45 degrees, lead_in each
  way, to guide it in between the rails. */
  plate_outline() {
    const [x0, y0] = [this.xMargin, this.yMargin];
    const [x1, y1] = [x0 + this.plate_width, y0 + this.length];
    const c = this.lead_in;
    if (c <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1], [x0, y1], [x0, y0 + c]];
  }

  /** The foot: the neck, the plate on it, and the countersunk screw holes. */
  foot() {
    const top = this.neck_height + this.plate_thickness;
    const neck = Part.makeBox(this.neck_width, this.length, this.neck_height + 0.01,
      [this._middle() - this.neck_width / 2.0, this.yMargin, 0.0]);
    const plate = Part.makePrism(this.plate_outline(), this.plate_thickness).translate([0, 0, this.neck_height]);
    const hole = this.screw_diameter / 2.0 + 0.2;
    const head = this.screw_diameter; // radius: a countersunk head is about twice the screw's diameter
    const sink = Math.min(head - hole, this.plate_thickness - 0.3); // 90 degrees
    const screws = this.screw_positions().map(([sx, sy]) => union([
      Part.makeCylinder(hole, top + 2.0, [sx, sy, -1.0]),
      Part.makeCone(hole, hole + sink + 0.01, sink + 0.01, [sx, sy, top - sink]),
      Part.makeCylinder(hole + sink + 0.01, 1.0, [sx, sy, top])]));
    return union([neck, plate]).cut(union(screws));
  }

  extra_parts(t) {
    return { foot: this.foot() };
  }

  /** The bosses, inside the case. */
  inside_boxes(t) {
    if (this.boss_height <= 0) return [];
    const r = this.BOSS_RADIUS;
    return this.screw_positions().map(([sx, sy]) => new Box3(sx - r, sy - r, -t - this.boss_height, 2 * r, 2 * r,
      this.boss_height, "screw boss"));
  }

  /** The foot, standing on the outside face. */
  body_boxes() {
    return [new Box3(this.xMargin, this.yMargin, 0.0, this.plate_width, this.length, this.neck_height + this.plate_thickness,
      "cold shoe foot")];
  }
}
classAttrs(ColdShoe, {
  DISPLAY_NAME: "Cold shoe foot", CATEGORY: "other",
  DESCRIPTION: "A foot that slides into a camera's accessory shoe (a cold shoe: no contacts), screwed to the outside of " +
    "the case. It slides in along the foot's length.",
  PARAMS: {
    plate_width: [17.8, "Width of the plate that slides under the shoe's rails (mm; ISO 518's is 18)"],
    plate_thickness: [1.9, "Thickness of that plate (mm; ISO 518's is 2)"],
    length: [18.0, "Length of the foot, the way it slides in (mm)"],
    neck_width: [12.0, "Width of the neck between the plate and the case (mm; the shoe's opening is 12.5)"],
    neck_height: [3.0, "Height of the neck: the gap between the plate and the case, for the shoe's rails (mm)"],
    lead_in: [2.0, "How much is cut off each corner at the plate's leading end, at 45 degrees, to guide it in (mm); 0 = none"],
    screw_diameter: [2.9, "Diameter of the two countersunk self-tapping screws (mm)"],
    screw_length: [10.0, "Length of those screws (mm)"],
    boss_height: [4.0, "Height of the bosses inside the case that the screws go into (mm); 0 = none"],
  },
  RECESSABLE: false,
  OUTSIDE_ONLY: true,
  DEFAULT_MOUNT: "outside",
  BOSS_RADIUS: 3.5,
  SKIN: 0.8,
});

Object.assign(BUILT_IN, { ColdShoe });
