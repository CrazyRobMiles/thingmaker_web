/* A stamp: text and a picture, engraved into the outside of a case in a
rectangle of its own - placed, turned and stuck to the sides like any other
device, so there can be several on a face, wherever they're wanted.

Its text and picture have the same settings as a case's decorations
(lib/decoration.js), drawn by the same code, so whatever pictures and text
can do, a stamp can too. They're its device parameters, named after the
decoration settings with "text_" or "picture_" in front: text_text,
text_font ... picture_file, picture_style ... The picture is fitted to the
stamp's stamp_width x stamp_height; each is inlaid, as a decoration is, in
parts of their own: <part>.stamp.<stamp>.<layer>.

Where a stamp and a case's decoration are on the same part of a face, the
stamp is on top: the decoration's left out wherever the stamp's text and
picture are. (lib/builder.js does that.)

Mounted outside, in the device frame z = 0 is the outside face, -z into the
case. */
import * as decoration from "./decoration.js";
import { BUILT_IN, Device, classAttrs } from "./devices.js";
import { Box3 } from "./geom.js";

// A stamp's parameter names for its text's and its picture's settings.
export const PREFIXES = { text: "text_", image: "picture_" };

/** {parameter name: [default, description, choices?]} of a stamp's text and
picture. */
function layerParams() {
  const out = {};
  for (const [kind, prefix] of Object.entries(PREFIXES)) {
    for (const [name, dflt, label, choices] of decoration.FIELDS[kind]) {
      out[prefix + name] = choices ? [dflt, label, choices] : [dflt, label];
    }
  }
  return out;
}

export class Stamp extends Device {
  constructor(partName, { xMargin = 0.5, yMargin = 0.5, stamp_width = 40.0, stamp_height = 30.0, ...rest } = {}) {
    for (const [name, value] of [["stamp_width", stamp_width], ["stamp_height", stamp_height]]) {
      if (!(Number(value) > 0)) throw new Error(`a stamp's ${name} must be more than 0 (got ${value})`);
    }
    super("Stamp", partName, Number(stamp_width), Number(stamp_height), { xMargin, yMargin, cutHeight: 0.0 });
    this.stamp_width = Number(stamp_width);
    this.stamp_height = Number(stamp_height);
    // Its text's and its picture's settings, as a decoration's.
    this.settings = {};
    for (const [kind, prefix] of Object.entries(PREFIXES)) {
      const given = {};
      for (const [name, value] of Object.entries(rest)) if (name.startsWith(prefix)) given[name.slice(prefix.length)] = value;
      try {
        this.settings[kind] = decoration.normaliseLayer(kind, given, `stamp ${partName} ${kind === "text" ? "text" : "picture"}`);
      } catch (e) {
        throw new Error(e.message);
      }
    }
  }

  /** {text, image}: what it has to draw (text if it says something, a
  picture if it has a file). */
  layers() {
    const out = {};
    if (this.settings.text.text.trim()) out.text = this.settings.text;
    if (this.settings.image.file) out.image = this.settings.image;
    return out;
  }

  /** [u0, v0, u1, v1] of the stamp in its own frame. */
  rect() {
    return [this.xMargin, this.yMargin, this.xMargin + this.stamp_width, this.yMargin + this.stamp_height];
  }

  /** decoration.drawLayers()'s [[[layer, rgb, section, depth, inlay]...],
  problems], in its own frame: turned `turned` degrees (180 on a case's top,
  so it reads the right way up from the front, as decorations do). The
  sections are made in the current kernel scope. */
  draw(turned = 0.0) {
    return decoration.drawLayers(this.rect(), this.rect(), this.layers(), turned);
  }

  // (What it cuts is drawn, and inlaid, by the builder, as decorations are.)
  get_cutter() {
    return null;
  }

  get_fuser() {
    return null;
  }

  /** The stamp's rectangle, on the outside face. */
  body_boxes() {
    return [new Box3(this.xMargin, this.yMargin, 0.0, this.stamp_width, this.stamp_height, 0.2, "engraving")];
  }
}
classAttrs(Stamp, {
  DISPLAY_NAME: "Stamp", CATEGORY: "other",
  DESCRIPTION: "Text and a picture engraved into the outside of the case in a rectangle of its own, with the same " +
    "settings as a face's decoration, inlaid in other colours. It's drawn on top of the face's decoration.",
  PARAMS: {
    stamp_width: [40.0, "Width of the stamp (mm): the picture is fitted to it"],
    stamp_height: [30.0, "Height of the stamp (mm)"],
    ...layerParams(),
  },
  RECESSABLE: false,
  OUTSIDE_ONLY: true,
  DEFAULT_MOUNT: "outside",
  STAMP: true,
});

Object.assign(BUILT_IN, { Stamp });
