/* Templates: a thin flat plate for each device, printed to check that its
fixings and openings are in the right places before printing a case.

The template is drawn in the device's own frame, looking down on the
surface it's mounted on. It is THICKNESS thick:

- cut right through: the fixing holes, the recess's cable hole, and each
  enabled connector's opening as seen from above. An opening that would
  swallow a fixing hole (a screen the size of its panel, say) is marked
  instead.
- marked by a groove MARK_DEPTH deep, just outside the line: the board's
  outline, each pillar or fixing, and those swallowed openings.

The plate reaches BORDER past the board, its fixings and any opening marked
on it. */
import path from "node:path";
import * as devices from "./devices.js";
import * as kernel from "./kernel.js";
import { Section } from "./kernel.js";
import * as meshes from "./meshes.js";

export const THICKNESS = 0.5;
export const MARK_DEPTH = 0.25;
export const MARK_WIDTH = 0.6;
export const BORDER = 4.0;
// The surface thickness the device's fixings are made for: deep enough that
// counterbores at the far side of the surface miss the template.
export const SURFACE = 20.0;
const PROBE = 0.05;

function rect(x0, y0, x1, y1) {
  return Section.square(x1 - x0, y1 - y0).translate(x0, y0);
}

function union(sections) {
  let result = new Section();
  for (const s of sections) result = result.add(s);
  return result;
}

/** A MARK_WIDTH line just outside `s`. */
function outline(s) {
  if (s.isEmpty()) return s;
  return s.offset(MARK_WIDTH, "Miter").subtract(s);
}

function sections(shape, heights) {
  if (!shape) return new Section();
  return union(heights.map((z) => shape.slice(z)));
}

/** The template for `item` (a device from catalogue.make()) as a kernel
Shape, z 0..THICKNESS. `cuts` is the list of ConnectorCuts to show (default:
all of them). */
export function deviceTemplate(item, cuts = null) {
  const [fuser, cutter] = devices.buildGeometry(item, 0, 0, SURFACE);
  // Holes through the surface, and holes in the pillars standing on it.
  let holes = sections(cutter, [-THICKNESS / 2.0, PROBE]);
  const cable = item.recess_cable_hole(SURFACE);
  if (cable) holes = holes.add(sections(cable, [-THICKNESS / 2.0]));
  const fixings = sections(fuser, [PROBE]);
  const [bx, by, , bw, bd] = item.board_frame();
  const board = rect(bx, by, bx + bw, by + bd);
  const through = [holes];
  const marked = [board, fixings];
  for (const cc of cuts === null ? item.connector_cuts() : cuts) {
    let opening;
    if (cc.mesh) {
      const [file, matrix] = cc.mesh;
      opening = meshes.meshSolid(file).transformed(matrix).projection();
    } else {
      opening = union(cc.boxes.map((b) => rect(b.x, b.y, b.x + b.w, b.y + b.d)));
    }
    const swallows = holes.subtract(opening).area() < holes.area() - 1e-6;
    (swallows ? marked : through).push(opening);
  }
  // The plate covers everything marked on it.
  const [x0, y0, x1, y1] = union(marked).add(holes).bounds();
  const plate = rect(x0 - BORDER, y0 - BORDER, x1 + BORDER, y1 + BORDER);
  const throughAll = union(through);
  const marks = union(marked.map(outline)).subtract(throughAll);
  let shape = kernel.extrudeSection(plate.subtract(throughAll), THICKNESS);
  if (!marks.isEmpty()) shape = shape.cut(kernel.extrudeSection(marks, MARK_DEPTH + 1.0, THICKNESS - MARK_DEPTH));
  // Openings next to each other leave loose scraps between them; only the
  // plate itself is kept.
  return shape.Solids.reduce((a, b) => (b.Volume > a.Volume ? b : a));
}

/** The template for one of a design's placements, with its settings and only
the connector cuts the design has switched on. */
export function placementTemplate(design, spec) {
  const item = spec.make();
  return deviceTemplate(item, design.enabled_connector_cuts(spec, item));
}

export function templatePath(outDir, spec) {
  return path.join(outDir, `${spec.id}.template.stl`);
}
