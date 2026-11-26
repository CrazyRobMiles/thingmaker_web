/* A keyhole hanger: a keyhole slot in the outside of a case - a picture
frame's back, mostly - to hang it on a screw in a wall. The screw's head
goes in through the round hole, and the case drops so the screw's shank
slides up the slot, the head held behind its edges in a channel (the
undercut) as wide as the hole.

Mounted outside, in the device frame z = 0 is the outside face and -z goes
into the case. The slot runs from the hole towards +y: the way that's up
when the case hangs. On a frame's back (its bottom, seen from outside) +y is
the frame's top edge - the top of its picture.

The keyhole needs more depth than a frame's back has, so it's cut into a
boss inside the case (`boss_height` of it, or as much as it needs). */
import { BUILT_IN, Device, classAttrs, union } from "./devices.js";
import { Box3 } from "./geom.js";
import * as Part from "./kernel.js";

export class KeyholeHanger extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, head_diameter = 9.0, shank_width = 4.5, slot_length = 10.0,
    lip = 1.6, head_depth = 3.0 } = {}) {
    for (const [name, value] of [["head_diameter", head_diameter], ["shank_width", shank_width], ["slot_length", slot_length],
      ["lip", lip], ["head_depth", head_depth]]) {
      if (!(value > 0)) throw new Error(`a keyhole hanger's ${name} must be more than 0 (got ${value})`);
    }
    if (shank_width >= head_diameter) {
      throw new Error(`a keyhole hanger's slot (${shank_width}mm) must be narrower than its hole (${head_diameter}mm)`);
    }
    const wall = KeyholeHanger.prototype.WALL;
    super("KeyholeHanger", partName, head_diameter + 2 * wall, head_diameter + slot_length + 2 * wall,
      { xMargin, yMargin, cutHeight: 0.0 });
    Object.assign(this, { head_diameter, shank_width, slot_length, lip, head_depth });
  }

  /** [x, y] of the hole's middle, and of the top of the slot (where the
  screw ends up). */
  _ends() {
    const x = this.xMargin + this.head_diameter / 2.0 + this.WALL;
    const y = this.yMargin + this.head_diameter / 2.0 + this.WALL;
    return [[x, y], [x, y + this.slot_length]];
  }

  /** How deep the keyhole goes into the case. */
  _depth() {
    return this.lip + this.head_depth;
  }

  /** How much of a boss inside the case it needs, for a surface `t` thick. */
  _boss(t) {
    return Math.max(0.0, this._depth() + this.SKIN - t);
  }

  get_fuser(x, y, t) {
    const boss = this._boss(t);
    if (boss <= 0) return null;
    return Part.makeBox(this.width - 2 * this.xMargin, this.depth - 2 * this.yMargin, t + boss,
      [this.xMargin, this.yMargin, -t - boss]);
  }

  get_cutter(x, y, t) {
    const [[hx, hy], [sx, sy]] = this._ends();
    const r = this.head_diameter / 2.0;
    const lip = this.lip;
    const bottom = -this._depth();
    const along = (radius, z0, z1) => Part.hull([Part.makeCylinder(radius, z1 - z0, [hx, hy, z0]),
      Part.makeCylinder(radius, z1 - z0, [sx, sy, z0])]);
    return union([
      Part.makeCylinder(r, -bottom + 0.01, [hx, hy, bottom]), // the hole the head goes in through
      along(this.shank_width / 2.0, -lip - 0.01, 0.01), // the slot the shank slides up
      along(r, bottom, -lip), // the channel behind it, holding the head
    ]);
  }

  /** The boss, inside the case. */
  inside_boxes(t) {
    const boss = this._boss(t);
    if (boss <= 0) return [];
    return [new Box3(this.xMargin, this.yMargin, -t - boss, this.width - 2 * this.xMargin, this.depth - 2 * this.yMargin, boss,
      "keyhole boss")];
  }

  /** The keyhole, on the outside face (nothing stands out from it). */
  body_boxes() {
    const [[hx, hy]] = this._ends();
    const r = this.head_diameter / 2.0;
    return [new Box3(hx - r, hy - r, 0.0, 2 * r, 2 * r + this.slot_length, 0.2, "engraving")];
  }
}
classAttrs(KeyholeHanger, {
  DISPLAY_NAME: "Keyhole hanger", CATEGORY: "other",
  DESCRIPTION: "A keyhole slot in the outside of the case (a picture frame's back), to hang it on a screw in a wall. " +
    "The slot runs up from the hole: towards the top of a frame's picture.",
  PARAMS: {
    head_diameter: [9.0, "Diameter of the hole the screw's head goes in through (mm): a little more than the head's"],
    shank_width: [4.5, "Width of the slot the screw's shank slides up (mm): a little more than the screw's"],
    slot_length: [10.0, "How far the screw slides up the slot from the hole (mm)"],
    lip: [1.6, "Thickness of the edges of the slot, in front of the screw's head (mm)"],
    head_depth: [3.0, "Depth of the channel behind them that holds the head (mm)"],
  },
  RECESSABLE: false,
  OUTSIDE_ONLY: true,
  DEFAULT_MOUNT: "outside",
  WALL: 2.5,
  SKIN: 1.0,
});

Object.assign(BUILT_IN, { KeyholeHanger });
