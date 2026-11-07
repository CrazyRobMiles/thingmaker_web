# thingmaker (web)

Design 3D-printable enclosures for electronics by placing devices on the
surfaces of cases, in a web browser. This is a JavaScript port of the Python
thingmaker, the editor showing the real, printable parts as you work and
writing them out as STL files. It comes two ways, sharing all the same code:

- **The Node version**: a server (`node server.js`) holding the design model
  and the geometry kernel, with designs kept on the server's disk.
- **The web version**: a static site (for GitHub Pages, say) that runs
  everything in the browser - Chrome or Edge - working in a folder on the
  computer the browser's on. See [The web version](#the-web-version).

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
- **Pictures** for decorations: anywhere on disk, though `images/` is the
  place for them; the Browse dialog can also upload one from the computer
  the browser is on into `images/`. See "Picture paths" below.
- **Fonts** for engraved text: the ones installed on the computer, and any
  in `fonts/`. That has the free Liberation Sans, Serif and Mono (SIL Open
  Font License, `fonts/LICENSE-Liberation.txt`), which stand in for Arial,
  Times New Roman and Courier New where those aren't installed - on a
  Raspberry Pi, say, or in the web version. They have the same widths,
  letter for letter, so text lays out the same, though the letters' shapes
  differ a little (engraved text's volume is within a couple of percent).
  Design files still name `arial`, so they're unchanged.
- **Build output**: `output/<design file name>/`.

### The editor

The toolbar has the File menu (New, Open, Save, Save As, Open STL files, New
and Edit subassembly), Undo and Redo, Add case / hinge / device /
subassembly, Delete, **Build (F5)**, the **Design** and **Print parts**
views, and the view options **Layout**, **Lids** and **Built model**.

- **Click a surface** to select it. Turn off **Lids** to reach the inside of
  a case.
- **Right-click a surface** to add a device or a subassembly where you
  clicked; right-click a device to rotate it, stick it to sides, save its
  template or delete it. A device goes on its own side of the surface,
  whichever face you clicked: inside the case, apart from the battery
  compartment, which goes outside. (A device in `lib/library/` can say
  otherwise with `mount`.) A subassembly goes on the face you clicked.
  **Add device...** starts with the device's side too, and its **Inside or
  outside** can still change it.
- **Devices are listed by what they are** - processors, displays, sound,
  lights, buttons and keys, power, other - in the Add menus and lists. A
  device's `CATEGORY` (or a definition's `category` in `lib/library/`, or a
  subassembly's `"category"` in its `subassembly.json`) says which.
- **A surface's panel** lists what's on that surface, inside and out -
  click one to select it - and adds devices and subassemblies to it.
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
- **Getting work back:** the design is saved in the browser a moment after
  every change, so if the tab is closed or the browser crashes with changes
  unsaved, they're offered back next time. Every Save also keeps a copy:
  **File > Earlier versions...** goes back to one (as unsaved changes, so
  undo returns to what was there). The last 50 saves of each design are
  kept. This is a safety net beside the design files, not instead of them -
  it lives in this browser only. Keeping your designs folder in git is the
  best backup of all.

Build output goes to `output/<design file name>/`:

- `print/<part>.stl` holds each part in its printing orientation.
- `assembled/<part>.stl` holds each part where it sits in the assembled design.
- `design.json` is the design as built; `manifest.json` records each part's
  solid count, volume and validity, and the hinge check.

## The web version

The same editor, as a static site with no server: everything - the design
model, the geometry kernel, the live model and Build - runs in the browser,
in Web Workers. It needs **Chrome or Edge** (desktop, including Chromium on
a Raspberry Pi), which let a page work in a folder on the computer.

### Deploying it

The site is built from this repository into `site/`, which isn't kept in
git - build it wherever you clone the repository. Building needs Node.js 18
or later (the GitHub Pages build uses 22); running it needs only a static web
server and the browser.

```
npm ci                    # once, after cloning (or when package.json changes)
npm run build:static      # builds it into site/ (about 27 MB)
npm run serve:static      # serves site/ at http://localhost:8600/ - Ctrl+C stops it
```

Build again after changing the code or the examples; the browser picks up
the new version when the page is reloaded.

**Browsers only let a page work in a folder if the page is secure:** served
over `https://`, or from `localhost` on the same computer. A page from
another computer on your network over plain `http://`
(`http://192.168.1.20:8600`, say) can't open folders - thingmaker says so
when it starts. So serve the site on the computer that's using it, or over
https.

**On this computer:** `npm run serve:static` and open
http://localhost:8600/ in Chrome or Edge. (It only answers this computer.
`node tools/serve-static.mjs --port 9000` picks another port.) VS Code's
Live Server (Go Live) works too: open `site/index.html` and Go Live. It
reloads the page whenever a file in the workspace changes, so if your
thingmaker folder is inside the workspace, set
`"liveServer.settings.ignoreFiles"` to leave out `designs/**`, `output/**`
and the rest, or every Save and Build reloads the page.

**On a Raspberry Pi (4 or 5, Raspberry Pi OS desktop):**

```
sudo apt install nodejs npm      # or Node 20 from nodesource.com, if apt's is older than 18
git clone <this repository> thingmaker_web
cd thingmaker_web
npm ci
npm run build:static
npm run serve:static
```

Then open http://localhost:8600/ in Chromium, and choose the cloned
repository as thingmaker's folder - it has `designs/`, `subassemblies/`,
`images/` and `fonts/` already, and builds go to `output/`, which git
ignores. (Without Node on the Pi: build on another computer, copy `site/`
across, and serve it with `python3 -m http.server 8600` in that folder.)

**For testing from another computer on your network**, without https: on
the computer with the browser, open
`chrome://flags/#unsafely-treat-insecure-origin-as-secure` (`edge://flags/...`
in Edge), add the site's address (`http://192.168.1.20:8600`), enable it and
relaunch the browser. That address is then treated as secure. (The server
has to answer the network for this: `python3 -m http.server 8600` in
`site/` does, `npm run serve:static` doesn't.) Use this for testing only.

**On GitHub Pages**, over https, for any computer:

1. Push this repository to GitHub.
2. In the repository's **Settings > Pages**, set **Source** to **GitHub
   Actions**.
3. Every push to `main` then runs `.github/workflows/pages.yml`: it
   installs, runs the tests, builds `site/` and publishes it. (**Actions >
   Publish the web version > Run workflow** runs it by hand.) The
   repository's **Actions** tab shows how it went; a failing test stops
   it publishing.
4. The site is at `https://<you>.github.io/<repository>/` (the Pages
   settings show the address).

Pages sites are public even when the repository is private (unless your
GitHub plan has private Pages), but there's nothing private in the site -
your designs stay in your folder, on your computer.

**On any other web server:** copy the contents of `site/` there. It must be
served over https, and `.wasm` files must be served as `application/wasm`
(most servers do). It needs no special headers and no server code, and
works from a sub-folder (`https://example.com/thingmaker/`).

Each address the site is served from (localhost:8600, Live Server's port,
GitHub Pages) is a separate site to the browser: it asks for the folder
again, and keeps its own autosaves and earlier versions.

**Its folder:** the first time, it asks you to choose your thingmaker
folder, laid out as the Python thingmaker's is - `designs/`,
`subassemblies/`, `images/`, `fonts/` and `output/`. Your thingmaker
repository is just right; choose an empty folder and it's set up with the
examples. The browser asks to let the site see and change the files in that
folder (and nothing else); it's remembered, and Chrome and Edge can be told
to allow it on every visit. **File > Change folder...** picks another one.
Designs, built STLs and templates are ordinary files in that folder, so the
Python thingmaker and the Node version can work on the same ones.

- **Fonts** are the ones in the folder's `fonts/` (a web page can't read
  the system's fonts folder) and the free ones the site comes with (below).
  To engrave with the very fonts the Python version uses, **File >
  Fonts...** copies this computer's into `fonts/`: Chrome and Edge ask to
  let the site see the installed fonts, then copy the ones you tick, named
  as Windows names their files (`arial.ttf`, `arialbd.ttf`), as design
  files name them. Fonts that are added are used once thingmaker starts
  again (it offers to).
- **Pictures** are found and named as in the other versions (see "Picture
  paths" below), in the folder.
- **Bringing things in from elsewhere:** the site can only see its folder,
  so anything from elsewhere on the computer is copied into it, and named
  where it's been copied to, so it's found from then on (and on any
  computer, in any version):
  - **File > Import design...** picks a design file from anywhere. It lists
    the pictures and subassemblies the design uses that aren't in the
    folder: choose each picture, and each subassembly's folder, from
    wherever they are. The design goes in `designs/` (not over one of the
    same name: it's `name_2.json`), its pictures in `images/`, its
    subassemblies in `subassemblies/<name>/`, and the design names the
    copies (`images/x.png`). Then it opens.
  - **File > Import subassembly...** copies in a subassembly's folder - or
    every subassembly in a folder of them, someone's `subassemblies/` say.
    One that's there already, the same, is left be; a different one of the
    same name is replaced only if you say so.
  - A picture's **Browse...** and the STL fields of **New subassembly**
    take files from anywhere, with **Upload from this computer...**:
    pictures go in `images/`, STLs into the subassembly's folder when it's
    saved. The same picture brought in twice is kept once.

  Picking a folder to bring in from asks the browser only to *read* it,
  once; the site can't change it, or see it again.
- **Recovery** is as in the Node version (autosave and earlier versions),
  in this browser.
- **Security:** the site can read and change everything in the folder you
  give it, so give it just your thingmaker folder, keep that in git, and
  publish the site from a place only you can change. All the site's pages
  share the browser's permission: on GitHub Pages every repository under
  `you.github.io` is the same site, so a custom domain (or an account of its
  own) keeps thingmaker's apart from anything else you publish there.
- **Speed:** builds run on one processor core, as in the Node version.

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
  `min_width`/`min_depth`. A case with its own position keeps its centre
  where it was as it grows or shrinks; a hinged case follows its hinge.
- **Case heights** stay as they're set, and a device too tall for its case
  is reported - unless the case is set to **Fit height to what's in it**
  (`"fit_height": true`). Then its height is worked out too, each case its
  own:
  - Devices on its walls get their footprints up the wall, laid out as
    width and depth are, with their `margin_bottom`/`margin_top` - but
    each centred in the height it has, unless it's over or under another,
    and kept 1mm clear of what's on the floor or lid below or above it
    and 0.5mm clear of the retaining screws' nut blocks at the top.
  - What stands on its floor or hangs from its lid gets 1mm clear of the
    lid or floor - a connector going out through a wall (a Pi's USB stack)
    counts, one going up through the lid (a screen) doesn't.
  - Something on the floor clears what's over it on the lid by 1mm too.

  Things on walls that meet side by side in a corner aren't moved apart
  (as they aren't across the width and depth either): the problems list
  says so. `fit_height` is only written to a design when it's on.
- **Sticky devices** go against the side(s) they stick to; their margin on
  that side is how far the device itself is from it. Moving a stuck device
  towards or away from that side changes the margin instead.
- **Unstuck devices** on a surface stay together, centred in the space left
  between the devices stuck to either side beside them.
- **No overlaps:** devices on the same surface that are apart are kept from
  overlapping as a case shrinks. One put on top of another - added there,
  or dragged onto it - is moved off it, along whichever way across the
  surface makes the case grow least (and not along a side it's stuck to,
  if the other can move instead).

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
                        "image": {"file": "images/camera.jpg", "style": "mosaic"}}}
```

**Picture paths:** a picture's `file` is best given relative to the
thingmaker folder - the one with `designs/` and `images/` in it - as
`images/camera.jpg`, and that's how thingmaker writes the path of a picture
you choose from that folder. Then the design works on any computer, in all
three versions (the Python thingmaker is run from that folder, so finds
them there). A full path (`C:/pictures/camera.jpg`) works too, on the
computer it's on. If a picture isn't where the design says, the Node and
web versions look in the thingmaker folder: at the end of the path
(`D:\GitHub\thingmaker\images\overhead.png` is `images/overhead.png`
there), or in `images/`. The example designs' pictures are in `images/`.

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

### Devices from boxmaker

Devices can also be described as data - a board, the pillars it stands on,
what it cuts through the surface it's on, and the openings its connectors
need in the case - in `lib/library/`, one file each, listed in
`lib/library.js` (which says what a definition holds). They're ported from
boxmaker, an older FreeCAD macro whose devices place themselves on a case's
base with `placeComponent()`:

1. **Record** what boxmaker's devices do. FreeCAD isn't needed: the script
   stands in for it, records every shape each device adds to or cuts from
   the case, and writes them all to one file:

   ```
   python tools/boxmaker/extract.py PATH/TO/boxmaker.py boxmaker-devices.json
   ```

2. **Draft** a device from its record:

   ```
   node tools/boxmaker/draft.mjs boxmaker-devices.json PICO --type Pico
   ```

   This writes `lib/library/pico.js` with the board, its pillars and the
   openings it cuts through the surface it's on, and keeps the record in
   `tools/boxmaker/records/`. Its notes list the classes that go with it in
   boxmaker:
   - lid placeholders (they only keep a space in the lid's grid) are left
     out;
   - landscape copies are left out, as a placement can be turned;
   - cutout devices - a hole in the lid above a sensor, say - become the
     device's own connectors (`up`), or openings if it's mounted on the lid
     itself.

   The notes also list anything the draft didn't understand.
3. **Finish it by hand.** Give it its name and description, board thickness
   and what stands on it (for the preview and the collision checks). Add its
   **connectors**: boxmaker cut these into the walls by hand in its box
   functions (`PICOBox` cuts the Pico's USB hole), which the notes name.
   Then add it to `DEFINITIONS` in `lib/library.js`.
4. **Check it:** `npm test` builds every definition into a case and checks
   that its pillars and openings are still boxmaker's.

So far: the Raspberry Pi Pico (`Pico`), a pixel ring with light pipes
(`PixelRingLightPipes`) and a small speaker (`SmallSpeaker`).

## Compatibility

This version is taking over from the Python thingmaker, which isn't being
developed any more. It opens every Python design and builds the same parts,
but has things the Python version doesn't (devices on walls, devices from
boxmaker, fitting a case's height, ...): a design that uses them only opens
here. For designs from the Python version:

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
| `server.js` | The Node version's web server |
| `build.js`, `template.js` | Command-line builds and templates |
| `public/` | The editor page (both versions): `js/app.js` (state and commands), `js/scene.js` (the 3D view), `js/props.js` (the properties panel), `js/dialogs.js`, `js/recovery.js` (autosave and earlier versions), `js/api.js` (talking to the server) |
| `static/` | The web version's own parts: `api.js` (in place of `public/js/api.js`), `folder.js` (choosing the folder), `engine-worker.js` and `build-worker.js` |
| `lib/api.js` | The editor's requests, answered by the server or the web version's engine worker |
| `lib/files-node.js`, `lib/files-browser.js` | File access (imported as `#files`): Node's, or the web version's copy of its folder |
| `lib/design.js` | The JSON model, frames, layout and problems |
| `lib/edits.js`, `lib/view.js` | The editor's edits, and what the page draws |
| `lib/devices.js`, `lib/subassemblies.js`, `lib/catalogue.js` | Devices and subassemblies |
| `lib/library.js`, `lib/library/` | Devices described as data (ported from boxmaker) |
| `tools/boxmaker/` | Recording boxmaker's devices and drafting definitions from them |
| `lib/cases.js`, `lib/hinges.js` | Case and hinge solids |
| `lib/builder.js`, `lib/worker.js` | Building and checking parts (and the live build's worker thread) |
| `lib/decoration.js`, `lib/engraving.js`, `lib/imaging.js` | Decorations, text and picture outlines |
| `lib/kernel.js`, `lib/geom.js`, `lib/stl.js`, `lib/meshes.js` | The geometry kernel and maths |
| `lib/py.js` | The Python behaviours the files depend on |
| `tools/parity.mjs` | Checks this against the Python thingmaker |
| `tools/build-static.mjs`, `tools/serve-static.mjs` | Build the web version into `site/`, and serve it locally |
