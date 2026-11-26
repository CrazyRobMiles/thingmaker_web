/* A band round a case's walls, for a decoration that carries on round the
corners (the case's "around" decoration).

The band is the outside of the walls unrolled: s runs along it, round the
case anticlockwise seen from above (left to right across the front, as seen
from outside), from -length/2 at the middle of the back, through 0 at the
middle of the front, to length/2 back at the middle of the back; v is the
case's own z. Its picture and text are drawn in (s, v) as a face's are
(decoration.drawLayers()), then what's cut, and the inlays, are made in (s,
v, w) - w out of the case, 0 on its outside - and put round the case:
moved into place along each wall and bevel, bent round each rounded corner.

The upright corners are parts of cylinders (MusicBox, Rounded) or flat
(Bevelled, Square), so the band unrolls exactly - nothing's stretched. The
outline's the case's outside at its walls: [-t, W + t] x [-t, D + t], its
corners shaped as the case's style shapes them. */
import * as geom from "./geom.js";
import { Section, extrudeSection } from "./kernel.js";

/** [kind, size] of a case's outside upright corners: ["round", radius],
["bevel", how far along each side] or ["square", 0]. */
export function outsideCorner(kase) {
  const t = kase.wall_thickness;
  const most = (Math.min(kase.width, kase.depth) + 2 * t) / 2.0 - 0.01;
  // (As cases.js shapes them; a panel case's outside is its one-piece base's.)
  if (kase.style === "MusicBox") return ["round", Math.min(5.0, most)];
  if (kase.style === "Rounded" && kase.edge > 0) return ["round", Math.min(kase.edge, most)];
  if (kase.style === "Bevelled" && kase.edge > 0) return ["bevel", Math.min(kase.edge, most)];
  return ["square", 0.0];
}

/** The band round `kase`: {length, height: [v0, v1], segments: [{from, to
(in s), kind: "line" | "arc", side: the wall a line's along (or null), and
for a line: start [x, y], direction [dx, dy]; for an arc: centre [x, y],
radius, start (its angle in radians at \`from\`)}]}. */
export function bandPath(kase) {
  const t = kase.wall_thickness;
  const [x0, y0, x1, y1] = [-t, -t, kase.width + t, kase.depth + t];
  const [kind, c] = outsideCorner(kase);
  const xm = (x0 + x1) / 2.0;
  const raw = [];
  const line = (a, b, side) => raw.push({ kind: "line", start: a, end: b, side });
  const corner = (centre, angle, a, b) => {
    if (kind === "round") raw.push({ kind: "arc", centre, radius: c, angle });
    else if (kind === "bevel") line(a, b, null);
  };
  // Anticlockwise from the middle of the back.
  line([xm, y1], [x0 + c, y1], "back");
  corner([x0 + c, y1 - c], Math.PI / 2, [x0 + c, y1], [x0, y1 - c]);
  line([x0, y1 - c], [x0, y0 + c], "left");
  corner([x0 + c, y0 + c], Math.PI, [x0, y0 + c], [x0 + c, y0]);
  line([x0 + c, y0], [x1 - c, y0], "front");
  corner([x1 - c, y0 + c], -Math.PI / 2, [x1 - c, y0], [x1, y0 + c]);
  line([x1, y0 + c], [x1, y1 - c], "right");
  corner([x1 - c, y1 - c], 0.0, [x1, y1 - c], [x1 - c, y1]);
  line([x1 - c, y1], [xm, y1], "back");
  const segments = [];
  let s = 0.0;
  for (const r of raw) {
    let length;
    if (r.kind === "arc") {
      length = (r.radius * Math.PI) / 2.0;
      segments.push({ from: s, to: s + length, kind: "arc", side: null, centre: r.centre, radius: r.radius, start: r.angle });
    } else {
      length = Math.hypot(r.end[0] - r.start[0], r.end[1] - r.start[1]);
      if (length < 1e-9) continue;
      segments.push({ from: s, to: s + length, kind: "line", side: r.side, start: r.start,
        direction: [(r.end[0] - r.start[0]) / length, (r.end[1] - r.start[1]) / length] });
    }
    s += length;
  }
  // With 0 at the middle of the front.
  const front = segments.find((g) => g.side === "front");
  const zero = front.from + (xm - front.start[0]);
  for (const g of segments) {
    g.from -= zero;
    g.to -= zero;
  }
  return { length: s, height: [-kase.base_thickness, kase.height + kase.lid_thickness], segments };
}

const OVERLAP = 0.02;

/** The 4x4 matrix taking a line segment's band frame (s, v, w) into the case. */
function lineMatrix(g) {
  const [dx, dy] = g.direction;
  // (Out of the case: the direction turned a quarter clockwise.)
  const out = [dy, -dx, 0];
  const origin = [g.start[0] - g.from * dx, g.start[1] - g.from * dy, 0];
  return geom.fromAxes([dx, dy, 0], [0, 0, 1], out, origin);
}

/** Where the band point (s, v, w) is in the case, on segment `g`. */
function onSegment(g, [s, v, w]) {
  if (g.kind === "line") {
    const [dx, dy] = g.direction;
    const along = s - g.from;
    return [g.start[0] + along * dx + w * dy, g.start[1] + along * dy - w * dx, v];
  }
  const angle = g.start + (s - g.from) / g.radius;
  const r = g.radius + w;
  return [g.centre[0] + r * Math.cos(angle), g.centre[1] + r * Math.sin(angle), v];
}

/** Where the band point (s, v, w) is in the case: on the segment it's in -
past a corner's ends, the wall's on either side (so a corner's piece, which
reaches a hair past them, meets its neighbours exactly). */
function onPath(path, p) {
  const s = p[0];
  const segments = path.segments;
  let g = segments.find((x) => x.kind === "line" ? s >= x.from - OVERLAP && s <= x.to + OVERLAP : s >= x.from && s <= x.to);
  if (!g) g = s < segments[0].from ? segments[0] : segments[segments.length - 1];
  return onSegment(g, p);
}

/** A solid made from `section` (in the band's (s, v)), from w0 to w1 out of
the case, put round it (in the case frame): moved into place along the
walls and bevels, bent round the rounded corners. null if it's empty. */
export function bandSolid(kase, section, w0, w1, path = null) {
  path = path || bandPath(kase);
  const pieces = [];
  const [v0, v1] = path.height;
  for (const g of path.segments) {
    // (A corner's piece reaches a hair into its neighbours, so they're one
    // solid: bent, its faces at the ends don't meet theirs triangle for
    // triangle.)
    const lap = g.kind === "arc" ? OVERLAP : 0.0;
    const strip = Section.square(g.to - g.from + 2 * lap, v1 - v0 + 200.0).translate(g.from - lap, v0 - 100.0);
    const piece = section.intersect(strip);
    if (piece.isEmpty()) continue;
    // (Every piece put in place by the same sum, so where they overlap
    // they're the same.)
    const solid = extrude(piece, w0, w1);
    pieces.push(solid.bent((p) => onPath(path, p), g.kind === "arc" ? Math.max(0.1, g.radius / 16.0) : 0));
  }
  if (!pieces.length) return null;
  return pieces[0].fuse(pieces.slice(1));
}

function extrude(section, w0, w1) {
  return extrudeSection(section, w1 - w0, w0);
}

/** [[wall, [from, to] (in s), 4x4 matrix]...]: each stretch of the band
along a wall (the back's in two halves), and the matrix taking it (s, v, 0)
to that wall's outside face's own frame, as decorations and stamps on the
face are drawn - for moving what's drawn on one onto the other.
`faceFrame(wall)` gives the face's case_matrix. */
export function wallStretches(kase, faceFrame, path = null) {
  path = path || bandPath(kase);
  return path.segments.filter((g) => g.kind === "line" && g.side)
    .map((g) => [g.side, [g.from, g.to], geom.mul(geom.inverseRigid(faceFrame(g.side)), lineMatrix(g))]);
}
