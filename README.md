# thingmaker (web)

Design 3D-printable enclosures for electronics by placing devices on the
surfaces of cases, in a web browser. This is a Node.js port of the Python
thingmaker: a server that holds the design model and the
geometry kernel, and a page that shows the real, printable parts as you work
and writes them out as STL files. Designs are kept as JSON files on the
server's disk.

**The design files are the Python thingmaker's.** Either program opens and
saves the other's designs, and a design saved by one is byte-for-byte the
file the other would write. Subassembly folders are shared too. See
[Compatibility](#compatibility).

## Setup

- Node.js 18 or later, then `npm install`.

Everything else is JavaScript, or WebAssembly: solids are built with
[manifold-3d](https://github.com/elalish/manifold) (the same library, and the
same version, the Python thingmaker uses), text with opentype.js, and the
editor draws with three.js.

## Use

```
node server.js designs/cyberdeck.json      # the editor, with a design open (or none, for a new one)
node server.js output/cyberdeck/print      # just look at some STL files (kept up to date as they change)
node build.js designs/cyberdeck.json       # build from the command line
node template.js designs/cyberdeck.json    # device templates (see below)
npm test                                   # tests
npm run parity -- ../thingmaker            # check this against the Python thingmaker
```

The server prints its address (http://127.0.0.1:8484/ unless that's taken)
and opens it in your browser; `--no-open` stops that, `--port` picks
another port. It only listens on this computer unless you give it
`--host 0.0.0.0` - and then anyone who can reach it can read and write files
where the editor's file dialogs go, so only do that on a network you trust.

Where things are kept:

- **Designs**: `designs/`, or set `THINGMAKER_DESIGNS`. The Open and Save
  dialogs browse the server's disk, so a design can be anywhere.
- **Subassemblies**: `subassemblies/`, or set `THINGMAKER_SUBASSEMBLIES` -
  point it at the Python thingmaker's `subassemblies/` to share them.
- **Pictures** for decorations: anywhere on disk; the Browse dialog can also
  upload one from the computer the browser is on into `images/`.
- **Build output**: `output/<design file name>/`.

### The editor

The toolbar has the File menu (New, Open, Save, Save As, Open STL files, New
and Edit subassembly), Undo and Redo, Add case / hinge / device /
subassembly, Delete, **Build (F5)**, the **Design** and **Print parts**
views, and the view options **Layout**, **Lids** and **Built model**.

- **Click a surface** to select it. The face you click decides inside or
  outside. Turn off **Lids** to reach the inside of a case.
- **Right-click a surface** to add a device or a subassembly where you
  clicked; right-click a device to rotate it, stick it to sides, save its
  template or delete it.
- **Drag a device** to slide it across its surface. Drag elsewhere to turn
  the view; Shift-drag or right-drag pans, the wheel zooms. Arrow keys nudge
  the selected device 1mm (10mm with Shift), **R** rotates it, **Delete**
  removes it and **F** fits the view.
- The panel on the right shows the design tree (untick an item to hide it
  in the view), the selected thing's settings, and the problems list (click
  a problem to select what it's about).
- The real parts are rebuilt a moment after every change, and shown in
  place of the layout (with see-through lids). **Build** writes the STL
  files; the build log shows each step and the button becomes **Stop
  build** while it runs. The status bar says whether the STL files match
  the design.
- **Print parts** shows the printable parts side by side - this design's,
  or any STL file or folder chosen with **File > Open STL files**, reloaded
  when the files change.

Build output goes to `output/<design file name>/`:

- `print/<part>.stl` holds each part in its printing orientation.
- `assembled/<part>.stl` holds each part where it sits in the assembled design.
- `design.json` is the design as built; `manifest.json` records each part's
  solid count, volume and validity, and the hinge check.

## What a design holds

A design is a JSON file that lists:

- **cases**: boxes with lids. Each case is printed as two parts,
  `<case>.base` and `<case>.lid`. A case's width and depth are worked out
  from what's placed in it (see Layout); its height, wall thicknesses and
  optional `min_width`/`min_depth` are set by hand. The `style` sets its
  shape: `MusicBox` (rounded upright corners, the default), `Square`,
  `RoundBottom` (the two back corners rounded), `Rounded` (every outside
  edge rounded, radius `edge`) or `Bevelled` (every outside edge bevelled
  at 45 degrees, `edge` in from each face). On Rounded and Bevelled cases
  the joint between base and lid stays square, and the problems list warns
  if the edges leave less than 1mm of wall.
- **hinges**: knuckle hinges joining two cases along an edge. The second
  case is positioned by the hinge at its open angle.
- **devices**: boards and modules built into thingmaker (`lib/devices.js`),
  each placed on one surface of a case - `bottom`, `top` (the lid), `front`,
  `back`, `left` or `right` - mounted `inside` or `outside`, at an `x`/`y`
  position, with a `rotation` of 0/90/180/270, optionally stuck to one or
  two sides of the case (`"stick": ["right", "back"]`).
- **subassemblies**: things made from STL files, such as a keyboard (see
  Subassemblies). Once placed they're handled exactly like devices.

### Layout

The design is laid out again after every change.

- **Margins and footprints:** a device's footprint is the device plus a
  margin on each of the four sides next to its surface, named after the
  side of the case it faces (`margin_left`, `margin_front` ...; 0.5mm by
  default). They stay with those sides when the device is turned.
- **Case sizes:** every case gets the same width and depth: the largest any
  case needs for its devices' footprints, or the largest
  `min_width`/`min_depth`. Heights aren't changed; a device too tall for its
  case is reported. A case with its own position keeps its centre where it
  was as it grows or shrinks; a hinged case follows its hinge.
- **Sticky devices** go against the side(s) they stick to; their margin on
  that side is how far the device itself is from it. Moving a stuck device
  towards or away from that side changes the margin instead.
- **Unstuck devices** on a surface stay together, centred in the space left
  between the devices stuck to either side beside them.
- **No overlaps:** devices on the same surface that are apart are kept from
  overlapping as a case shrinks.

Each device adds **fusers** (pillars, say) to the surface it's on, cuts
**cutters** (bolt holes) from it, and has **connector cuts**: each row of its
connector table becomes an opening - the connector's body grown by
`connectorClearance` and extended `connectorReach` past the board - cut from
whole parts once the design is assembled (the LCD panel's viewing hole in
the lid above it, a Pi's HDMI slot in a wall). Each cut is switched on and off
on its own (`"connector_cuts": {"hdmi": true, "audio": false}`); by default
they apply to both parts of the device's case (`"connector_cut_targets":
null`).

**Hole** is a device that cuts a round hole of its `diameter` through the
surface it's on.

### Recessed devices

Any device or subassembly can be sunk into its surface (`recess_depth`, as a
negative number), either as a **cut** pocket with its own floor or as a
**plate**: an open well with a separate baseplate (`<id>.baseplate`) screwed
up into pillars round it. `recess_width`/`recess_height` set the opening's
size, `recess_radius` its corners, and `recess_hole` a cable hole through
the floor or baseplate. A recess going into the lid, or a baseplate fitted
from inside, is kept clear of the hinge rail and the retaining screws' nut
blocks so it can be lowered in past them.

### Battery compartments

**Battery compartment** is let into the outside of a case. Its cover
(`<id>.cover`) sits flush in the face, held by tabs at one end and a
countersunk screw at the other; its back is part of the case (`back:
recess`) or a separate plate (`back: plate`, `<id>.back`) screwed into
pillars. A decoration on the face carries on across the cover.

### Hinges

The pivot lies on the cases' shared rear top edge, so they swing from 0 to
180 degrees without touching. Settings: `margin` (from each end of the
edge), `knuckles`, `knuckle_gap`, `clearance`, the pin holes
(`pin_grip_diameter`, `pin_turn_diameter`, or `pin_inner_diameter` to bolt
into the innermost knuckle), `gap` (holds the shut cases apart), `cable_gap`
(and `cable_cover`) for a ribbon cable through the middle, `open_limit` (stop
wedges), and `bolt_head_diameter`/`bolt_head_height` (slots in the lids for
the bolts' heads). Every build swings each hinge through its range and
reports any overlap.

### Retaining screws

Square, MusicBox, Rounded and Bevelled cases have four M3 retaining screws
holding the lid on, into nuts in sockets on the inside of the base's wall;
the lid needs to be at least about 5mm tall for them.

### Decorations: engraved text and pictures

Each outside face of a case can carry text and a picture, engraved into it
and optionally inlaid in other colours (`inlay`): select a surface and tick
**Text** and/or **Picture**. In the file they're the case's `decorations`:

```json
"decorations": {"top": {"text": {"text": "thingmaker", "font": "arialbd", "size": 12},
                        "image": {"file": "C:/pictures/camera.jpg", "style": "mosaic"}}}
```

Text uses any installed TrueType or OpenType font, by its file's name. A
picture (PNG, JPEG, GIF or BMP) is drawn as an `outline` (its dark parts), a
`mosaic`, `dots` or `lines` grid of a few colours, or `vector` lines traced
round (`trace: outlines`) or along (`trace: centre`) its patches of colour.
Each inlay is a part of its own, `<part>.deco.<surface>.<layer>.stl`, in the
same frame as the part, for loading into the slicer together as one object.

### Device templates

A template is a 0.5mm plate for checking a device's fixings and openings
before printing a case: right-click a device and choose **Save template...**,
or run `node template.js DESIGN.json [PLACEMENT ...] [-o OUTPUT_DIR]`.

### Subassemblies

A subassembly is made from STL files, all drawn in the same frame: a
**mock** (its shape), **cutouts** (closed meshes cut out exactly as drawn,
each switched on and off like a connector cut), and fixings and holes for
mounting it on **top** of a surface or **underneath** one. Make one with
**File > New subassembly...** (the STLs can be on the server's disk or
uploaded from the browser's computer); it's saved as
`subassemblies/<Name>/` with a `subassembly.json`, the same as the Python
thingmaker's.

## Compatibility

Both programs read and write the same files:

- A design loaded and saved by either is written byte-for-byte as the other
  would write it - Python's `json.dump(indent=2)` layout, its float
  formatting and round-half-to-even rounding are reproduced exactly.
- The layout, the problems list and the build agree: `npm run parity`
  checks every design in a folder against the Python thingmaker. On the
  example designs every part has the same number of solids and the same
  volume. Pictures are traced with ports of the exact Pillow and OpenCV
  algorithms the Python version uses (resizing, colour reduction, k-means,
  line simplification), so they agree too, to within a fraction of a percent
  for `vector` pictures.
- Text outlines come from opentype.js rather than FreeType, so engraved text
  can differ from the Python version's by a few microns.
- The mosaic `dither` setting is accepted but does nothing - as in the
  Python thingmaker, where Pillow ignores it.
- TIFF pictures aren't supported.
- Builds take up to two or three times as long as the Python version's on a
  big design, as the WebAssembly kernel uses one processor core. The live
  model is rebuilt on a worker thread, so the editor carries on meanwhile.

## Layout of the code

| File | Role |
| --- | --- |
| `server.js` | The editor's web server and API |
| `build.js`, `template.js` | Command-line builds and templates |
| `public/` | The editor page: `js/app.js` (state and commands), `js/scene.js` (the 3D view), `js/props.js` (the properties panel), `js/dialogs.js` |
| `lib/design.js` | The JSON model, frames, layout and problems |
| `lib/edits.js`, `lib/view.js` | The editor's edits, and what the page draws |
| `lib/devices.js`, `lib/subassemblies.js`, `lib/catalogue.js` | Devices and subassemblies |
| `lib/cases.js`, `lib/hinges.js` | Case and hinge solids |
| `lib/builder.js`, `lib/worker.js` | Building and checking parts (and the live build's worker thread) |
| `lib/decoration.js`, `lib/engraving.js`, `lib/imaging.js` | Decorations, text and picture outlines |
| `lib/kernel.js`, `lib/geom.js`, `lib/stl.js`, `lib/meshes.js` | The geometry kernel and maths |
| `lib/py.js` | The Python behaviours the files depend on |
| `tools/parity.mjs` | Checks this against the Python thingmaker |
