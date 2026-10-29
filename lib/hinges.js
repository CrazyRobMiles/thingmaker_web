/* EdgeHinge: a knuckle hinge whose pivot axis lies exactly on the shared
rear top edge of two closed cases. (The Python thingmaker also keeps the
custard-cream-case Hinge and HingeSpacer classes for reference; they aren't
used, so they aren't ported.)

Local frame (design.edgeFrame()): the pivot axis runs along X, centred on
the origin; Y points out of the back of the case and Z up, so the case
itself occupies Y <= 0, Z <= 0. The other case, folded shut on top, occupies
Y <= 0, Z >= 0 and swings open through Y >= 0, so nothing either case owns
ever enters the other's quadrant between 0 and 180 degrees.

The hinge length is split into an odd number of equal knuckles that
alternate between the two cases (side 0 owns both end knuckles). Each
case's base owns an anchor block along the whole back top edge, which
carries its knuckles and holds clearance grooves for the other case's; the
lid gives that strip up. See the Python thingmaker's hinges.py for the full
story of the pin holes, cable gap, cable cover, stop wedges and bolt
heads. */
import * as Part from "./kernel.js";
import { degrees, radians, roundInt } from "./py.js";


export class EdgeHinge {
  // Cable cover: wall thickness, how much bigger than the knuckles the outer
  // tube is, and the opening it allows.
  static COVER_WALL = 1.2;
  static COVER_EXTRA = 1.5;
  static COVER_OPEN_LIMIT = 135.0;
  // The widest the cable slot fans out (degrees, down from straight forward).
  static SLOT_SPREAD = 45.0;
  // How far the stop wedges reach out from the knuckles (mm).
  static STOP_SIZE = 5.0;

  constructor(length, { radius = 4.0, knuckles = 0, knuckle_gap = 0.5, clearance = 0.4, anchor = 4.0, pin_grip_diameter = 2.4,
    pin_turn_diameter = 2.9, target_knuckle_length = 12.0, cable_gap = 0.0, cable_cover = true, open_limit = 110.0,
    pin_inner_diameter = 0.0, bolt_head_diameter = 5.0, bolt_head_height = 3.0 } = {}) {
    this.length = length;
    this.radius = radius;
    this.cable_gap = cable_gap;
    this.cable_cover = cable_cover;
    this.open_limit = open_limit;
    this.pin_inner_diameter = pin_inner_diameter;
    this.bolt_head_diameter = bolt_head_diameter;
    this.bolt_head_height = bolt_head_height;
    if (cable_gap > 0) {
      // Two halves, each an even number of knuckles (2 or more).
      const half = (length - cable_gap) / 2.0;
      let perHalf = knuckles ? roundInt(knuckles / 2.0) : roundInt(half / target_knuckle_length);
      perHalf = Math.max(2, perHalf + (((perHalf % 2) + 2) % 2));
      knuckles = 2 * perHalf;
    } else {
      if (!knuckles) {
        knuckles = Math.max(3, roundInt(length / target_knuckle_length));
        if (knuckles % 2 === 0) knuckles += 1;
      }
      if (knuckles < 3 || knuckles % 2 === 0) throw new Error(`an EdgeHinge needs an odd number (3 or more) of knuckles, not ${knuckles}`);
    }
    this.knuckles = knuckles;
    this.knuckle_gap = knuckle_gap;
    this.clearance = clearance;
    this.anchor = anchor;
    this.pin_grip_diameter = pin_grip_diameter;
    this.pin_turn_diameter = pin_turn_diameter;
  }

  /** [x0, x1] of each knuckle slot owned by `side` (0 or 1), gaps included. */
  ranges(side) {
    if (this.cable_gap > 0) {
      // Counted inwards from each end, so side 0 has both outer ends.
      const perHalf = Math.floor(this.knuckles / 2);
      const step = (this.length - this.cable_gap) / 2.0 / perHalf;
      const end = this.length / 2.0;
      const out = [];
      for (let i = side; i < perHalf; i += 2) {
        out.push([-end + i * step, -end + (i + 1) * step]);
        out.push([end - (i + 1) * step, end - i * step]);
      }
      return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }
    const step = this.length / this.knuckles;
    const x = -this.length / 2.0;
    const out = [];
    for (let i = 0; i < this.knuckles; i++) if (i % 2 === side) out.push([x + i * step, x + (i + 1) * step]);
    return out;
  }

  _cylinder(radius, x0, x1) {
    return Part.makeCylinder(radius, x1 - x0, [x0, 0, 0], [1, 0, 0]);
  }

  static _anchor_box(x0, x1, depth, drop, grow = 0.0) {
    depth += grow;
    drop += grow;
    return Part.makeBox(x1 - x0, depth, drop, [x0, -depth, -drop]);
  }

  _union(shapes) {
    let result = shapes[0];
    for (const s of shapes.slice(1)) result = result.fuse(s);
    return result;
  }

  /** The block each case's base gets along its whole back top edge. Its
  underside slopes back down to the case's back face at 45 degrees, so it
  prints without support. */
  anchor_shape(depth, drop) {
    const x0 = -this.length / 2.0;
    const x1 = this.length / 2.0;
    // (Y, Z) profile: top, front, then the 45 degree slope to the back face.
    const profile = [[0.0, 0.0], [-depth, 0.0], [-depth, -drop], [0.0, -drop - depth]];
    return Part.makePrism(profile, x1 - x0).transformed([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
  }

  _at_end(x) {
    return Math.abs(Math.abs(x) - this.length / 2.0) < 1e-9;
  }

  _at_cable_gap(x) {
    return this.cable_gap > 0 && Math.abs(Math.abs(x) - this.cable_gap / 2.0) < 1e-9;
  }

  /** `side`'s own knuckles, each shortened by half the knuckle gap where it
  meets the next knuckle (or the cable gap) - but not at the hinge's ends. */
  knuckles_shape(side) {
    const g = this.knuckle_gap / 2.0;
    return this._union(this.ranges(side).map(([x0, x1]) =>
      this._cylinder(this.radius, this._at_end(x0) ? x0 : x0 + g, this._at_end(x1) ? x1 : x1 - g)));
  }

  /** The strip a lid gives up to its base's anchor block - box shaped, so the
  lid still drops straight on. */
  lid_clearance(depth, drop) {
    return EdgeHinge._anchor_box(-this.length / 2.0 - 1.0, this.length / 2.0 + 1.0, depth, drop, this.clearance);
  }

  /** Room in `side`'s base and lid for the other side's knuckles. */
  other_clearance(side) {
    const g = this.knuckle_gap / 2.0;
    return this._union(this.ranges(1 - side).map(([x0, x1]) => this._cylinder(this.radius + this.clearance,
      this._at_cable_gap(x0) ? x0 : x0 - g, this._at_cable_gap(x1) ? x1 : x1 + g)));
  }

  // -- stop --

  /** This side's stop wedge, in its own edge frame (both sides' are the
  same), or null. `below` is how far the case reaches below the pivot. */
  stop_shape(below) {
    if (!(this.open_limit > 0 && this.open_limit < 180)) return null;
    const half = (180.0 - this.open_limit) / 2.0; // each wedge's angle
    let inner = this.radius + this.clearance;
    if (this.cable_gap > 0 && this.cable_cover) inner = this._cover_radii()[0][1] + 2 * this.clearance;
    // Far enough out that the straight inner edge clears `inner`.
    const start = inner / Math.cos(radians(half / 2.0));
    const reach = start + EdgeHinge.STOP_SIZE;
    const s = Math.sin(radians(half));
    const c = Math.cos(radians(half));
    const points = [[0.0, -start], [start * s, -start * c], [reach * s, -reach * c], [0.0, -reach * (c + s)]];
    const x0 = -this.length / 2.0;
    const x1 = this.length / 2.0;
    let wedge = Part.makePrism(points, x1 - x0).transformed([[0, 0, 1, x0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]);
    // Overlap the case's back face a little so they fuse, and stay above the
    // bottom of the case.
    wedge = wedge.fuse(Part.makeBox(x1 - x0, 0.2, reach * (c + s) - start, [x0, -0.2, -reach * (c + s)]));
    return wedge.common(Part.makeBox(x1 - x0, 100.0, below, [x0, -1.0, -below]));
  }

  // -- cable gap --

  _tube_sector(inner, outer, start, end, x0, x1) {
    const tube = this._cylinder(outer, x0, x1).cut(this._cylinder(inner, x0, x1));
    return tube.common(Part.makeWedge(outer + 1.0, start, end, x0, x1));
  }

  /** [[inner, outer] of side 0's tube, [inner, outer] of side 1's]. */
  _cover_radii() {
    const outer = this.radius + EdgeHinge.COVER_EXTRA;
    const w = EdgeHinge.COVER_WALL;
    const c = this.clearance;
    return [[outer - w, outer], [outer - 2 * w - c, outer - w - c]];
  }

  /** x range reaching to side 1's knuckles beside the gap. */
  _gap_span() {
    const g = this.cable_gap / 2.0 + this.knuckle_gap / 2.0;
    return [-g, g];
  }

  /** `side`'s half of the cable cover (to fuse onto its base), or null. */
  cable_cover_shape(side) {
    if (!(this.cable_gap > 0 && this.cable_cover)) return null;
    const [[i0, o0], [i1, o1]] = this._cover_radii();
    if (side === 0) {
      const g = this.cable_gap / 2.0;
      return this._tube_sector(i0, o0, -100.0, 0.0, -g, g);
    }
    const [x0, x1] = this._gap_span();
    return this._tube_sector(i1, o1, -90.0, 0.0, x0 - 0.5, x1 + 0.5);
  }

  /** [start, end] angles of the cable slot (YZ plane, from +Y towards +Z). */
  slot_angles() {
    let spread = EdgeHinge.SLOT_SPREAD;
    if (this.cable_gap > 0 && this.cable_cover) {
      const h = this._cover_radii()[1][1]; // just past the inner tube
      const room = this._cover_radii()[0][1] + this.clearance;
      spread = Math.min(spread, degrees(Math.atan2(h, Math.sqrt(room * room - h * h))) - 5.0);
    }
    return [-180.0, -180.0 + spread];
  }

  /** What `side`'s base loses in the gap (or null): room round the axis for
  the cable and for the other side's half of the cover, and the slot through
  the anchor block into the case. */
  cable_cut(side, depth, drop) {
    if (!(this.cable_gap > 0)) return null;
    const [x0, x1] = this._gap_span();
    const g = this.cable_gap / 2.0;
    let room;
    if (!this.cable_cover) room = this._cylinder(this.radius + this.clearance, x0, x1);
    else if (side === 0) room = this._cylinder(this._cover_radii()[0][0], x0, x1);
    else {
      room = this._cylinder(this._cover_radii()[0][1] + this.clearance, x0, x1);
      room = room.cut(this.cable_cover_shape(1));
    }
    const reach = (depth * depth + drop * drop) ** 0.5 + 1.0;
    const [a, b] = this.slot_angles();
    const slot = Part.makeWedge(reach, a, b, -g, g).common(Part.makeBox(2 * g, depth + 1.0, drop, [-g, -depth - 1.0, -drop]));
    return room.fuse(slot);
  }

  /** The innermost knuckle slot(s): the middle one, or with a cable gap the
  one beside the gap in each half. */
  inner_slots() {
    const slots = [...this.ranges(0), ...this.ranges(1)].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (this.cable_gap > 0) return slots.filter((s) => this._at_cable_gap(s[0]) || this._at_cable_gap(s[1]));
    return [slots[Math.floor(slots.length / 2)]];
  }

  // -- bolt heads --

  _head_spans() {
    const out = this.bolt_head_height + this.clearance;
    const end = this.length / 2.0;
    return [[end - 0.01, end + out], [-end - out, -end + 0.01]];
  }

  /** Room for the bolt heads round the axis (or null) - for a base. */
  bolt_head_pocket() {
    if (this.bolt_head_diameter <= 0) return null;
    const r = this.bolt_head_diameter / 2.0 + this.clearance;
    return this._union(this._head_spans().map(([x0, x1]) => this._cylinder(r, x0, x1)));
  }

  /** Room for the bolt heads in a lid (or null): round over the head and
  straight down from there `drop` below the axis. */
  bolt_head_slot(drop) {
    if (this.bolt_head_diameter <= 0) return null;
    const r = this.bolt_head_diameter / 2.0 + this.clearance;
    const shapes = [];
    for (const [x0, x1] of this._head_spans()) {
      shapes.push(this._cylinder(r, x0, x1));
      shapes.push(Part.makeBox(x1 - x0, 2 * r, drop, [x0, -r, -drop]));
    }
    return this._union(shapes);
  }

  pin_hole(side) {
    const extra = 1.0;
    const x0 = -this.length / 2.0 - extra;
    const x1 = this.length / 2.0 + extra;
    if (!this.pin_inner_diameter) {
      const d = side === 0 ? this.pin_grip_diameter : this.pin_turn_diameter;
      return this._cylinder(d / 2.0, x0, x1);
    }
    // Turning holes the whole length, but the bolt's own size in the
    // innermost knuckle(s), which the bolts screw into.
    const own = this.ranges(side);
    const inner = this.inner_slots().filter(([a, b]) => own.some(([p, q]) => p === a && q === b))
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const pieces = [];
    let at = x0;
    for (const [a, b] of inner) {
      pieces.push(this._cylinder(this.pin_turn_diameter / 2.0, at, a));
      pieces.push(this._cylinder(this.pin_inner_diameter / 2.0, a, b));
      at = b;
    }
    pieces.push(this._cylinder(this.pin_turn_diameter / 2.0, at, x1));
    return this._union(pieces);
  }
}
