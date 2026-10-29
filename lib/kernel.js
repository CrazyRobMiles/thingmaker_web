/* thingmaker's geometry kernel: the handful of solid-modelling operations
the project needs, built on manifold-3d (the WASM build of the same
Manifold library the Python thingmaker uses).

It offers the names the FreeCAD-era code uses - makeBox(), makeCylinder(),
Vector, and shapes with fuse()/cut()/common()/translate()/rotate()/Volume/
Solids/isValid() - so the device, case and hinge code reads as it did.

Shapes are triangle meshes that are always closed and manifold. Curved
surfaces are polygons: each circle gets enough sides to stay within
TOLERANCE of the true curve. STL files load straight in as shapes
(loadStl()) and finished parts write straight out (writeStl()).

Memory: WASM objects have to be freed by hand. Everything the kernel makes
is noted in the current arena (see scope()), and freed when that scope
ends, so a long-running server doesn't leak. Things kept between builds (a
cache of STL solids, say) are taken out of the arena with persist(). */
import fs from "node:fs";
import Module from "manifold-3d";
import * as geom from "./geom.js";
import { degrees, radians } from "./py.js";

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection, Mesh } = wasm;

// Largest distance (mm) a polygon may stray from the circle it stands for.
export const TOLERANCE = 0.02;

// -- memory --

const arenas = [];

function track(obj) {
  if (arenas.length) arenas[arenas.length - 1].push(obj);
  return obj;
}

/** Run fn(), then free every WASM object made while it ran. Whatever fn()
returns must be plain data (or persist()ed shapes). */
export function scope(fn) {
  const arena = [];
  arenas.push(arena);
  try {
    return fn();
  } finally {
    arenas.pop();
    for (const obj of arena) {
      if (!obj.__kept) {
        try {
          obj.delete();
        } catch (e) {
          // already freed
        }
      }
    }
  }
}

/** Keep a shape (or section) beyond the scope it was made in. */
export function persist(item) {
  const obj = item instanceof Shape ? item._m : item instanceof Section ? item._cs : item;
  obj.__kept = true;
  return item;
}

/** Free a shape now rather than at the end of its scope - for big
intermediate results nothing else refers to. */
export function release(item) {
  const obj = item instanceof Shape ? item._m : item instanceof Section ? item._cs : item;
  if (obj && !obj.__kept && !obj.__freed) {
    obj.__freed = true;
    try {
      obj.delete();
    } catch (e) {
      // already freed
    }
    for (const arena of arenas) {
      const i = arena.indexOf(obj);
      if (i >= 0) arena.splice(i, 1);
    }
  }
}

/** Sides for a circle of `radius`: enough to stay within TOLERANCE of it,
rounded up to a multiple of 4 so it's symmetric about both axes. */
export function circleSegments(radius) {
  if (radius <= TOLERANCE) return 8;
  const n = Math.ceil(Math.PI / Math.acos(1.0 - TOLERANCE / radius));
  return Math.trunc(Math.min(512, Math.max(12, 4 * Math.ceil(n / 4.0))));
}

/** A 3D point or direction - FreeCAD's Base.Vector, as far as thingmaker
uses it. Also usable as a plain [x, y, z] array. */
export class Vector extends Array {
  constructor(x = 0.0, y = 0.0, z = 0.0) {
    super(3);
    this[0] = Number(x);
    this[1] = Number(y);
    this[2] = Number(z);
  }

  static get [Symbol.species]() {
    return Array;
  }

  get x() {
    return this[0];
  }

  get y() {
    return this[1];
  }

  get z() {
    return this[2];
  }

  add(o) {
    return new Vector(this[0] + o[0], this[1] + o[1], this[2] + o[2]);
  }

  sub(o) {
    return new Vector(this[0] - o[0], this[1] - o[1], this[2] - o[2]);
  }
}

export const Base = { Vector };

function vec(v) {
  return v === null || v === undefined ? [0.0, 0.0, 0.0] : [Number(v[0]), Number(v[1]), Number(v[2])];
}

/** A geom 4x4 rigid matrix as manifold's column-major Mat4. */
function mat4(m) {
  return [m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0,
    m[0][3], m[1][3], m[2][3], 1];
}

/** A solid (possibly several separate pieces). Like FreeCAD's shapes,
translate() and rotate() move it in place; everything else returns a new
shape. */
export class Shape {
  constructor(manifold = null) {
    this._m = manifold || track(new Manifold(new Mesh({ numProp: 3, vertProperties: new Float32Array(0),
      triVerts: new Uint32Array(0) })));
  }

  // -- booleans --

  static _parts(other) {
    const items = Array.isArray(other) ? other : [other];
    return items.filter((o) => o !== null && o !== undefined).map((o) => o._m);
  }

  fuse(other) {
    const parts = Shape._parts(other);
    return parts.length ? new Shape(track(Manifold.union([this._m, ...parts]))) : this.copy();
  }

  cut(other) {
    const parts = Shape._parts(other);
    return parts.length ? new Shape(track(Manifold.difference([this._m, ...parts]))) : this.copy();
  }

  common(other) {
    let result = this._m;
    for (const p of Shape._parts(other)) result = track(result.intersect(p));
    return new Shape(result);
  }

  // -- moving --

  translate(v) {
    this._m = track(this._m.translate(vec(v)));
    return this;
  }

  /** Turn about the line through `center` along `axis`. */
  rotate(center, axis, deg) {
    const c = vec(center);
    const m = geom.mul(geom.translate(...c), axisRotation(vec(axis), deg), geom.translate(-c[0], -c[1], -c[2]));
    this._m = track(this._m.transform(mat4(m)));
    return this;
  }

  /** A copy moved by the geom 4x4 rigid matrix m. */
  transformed(m) {
    return new Shape(track(this._m.transform(mat4(m))));
  }

  copy() {
    return new Shape(this._m);
  }

  removeSplitter() {
    return this;
  }

  // -- measuring --

  get Volume() {
    return this._m.volume();
  }

  /** Each separate piece. */
  get Solids() {
    return this._m.decompose().map((p) => new Shape(track(p)));
  }

  get triangles() {
    return this._m.numTri();
  }

  isValid() {
    return this._m.status() === "NoError" && !this._m.isEmpty();
  }

  isNull() {
    return this._m.isEmpty();
  }

  /** [xmin, xmax, ymin, ymax, zmin, zmax] */
  bounds() {
    const b = this._m.boundingBox();
    return [b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]];
  }

  // -- slicing --

  /** This shape fused with roots: its cross-section just above z=0,
  carried straight down to z=-depth (see subassemblies' fixings). */
  rooted(depth, probe = 0.05) {
    const section = track(this._m.slice(probe));
    if (section.isEmpty()) return this.copy();
    const roots = track(track(Manifold.extrude(section, depth + probe)).translate([0.0, 0.0, -depth]));
    return new Shape(track(Manifold.union([this._m, roots])));
  }

  /** Its cross-section at height z. */
  slice(z) {
    return new Section(track(this._m.slice(Number(z))));
  }

  /** Its outline seen from above. */
  projection() {
    const p = track(this._m.project());
    return new Section(track(new CrossSection(p.toPolygons(), "Positive")));
  }

  // -- meshes --

  /** {vertices: Float32Array (x, y, z each), triangles: Uint32Array}. */
  arrays() {
    const mesh = this._m.getMesh();
    const n = mesh.numProp;
    let verts = mesh.vertProperties;
    if (n !== 3) {
      const count = verts.length / n;
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        out[3 * i] = verts[n * i];
        out[3 * i + 1] = verts[n * i + 1];
        out[3 * i + 2] = verts[n * i + 2];
      }
      verts = out;
    } else {
      verts = new Float32Array(verts);
    }
    return { vertices: verts, triangles: new Uint32Array(mesh.triVerts) };
  }
}

/** geom 4x4 rotation of `deg` degrees about `axis` (through the origin). */
export function axisRotation(axis, deg) {
  let [x, y, z] = axis;
  const n = Math.sqrt(x * x + y * y + z * z);
  x /= n;
  y /= n;
  z /= n;
  const a = radians(deg);
  let c = Math.cos(a);
  let s = Math.sin(a);
  let t = 1 - Math.cos(a);
  for (const exact of [0, 90, 180, 270]) {
    const d = (((deg - exact) % 360) + 360) % 360;
    if (Math.abs(d) < 1e-12) {
      [c, s] = geom.cosSin(exact);
      t = 1 - c;
    }
  }
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0.0],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0.0],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0.0],
    [0.0, 0.0, 0.0, 1.0],
  ];
}

/** geom 4x4 rotation taking +Z onto `direction`. */
function zTo(direction) {
  let d = vec(direction);
  const n = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  d = d.map((v) => v / n);
  if (Math.abs(d[0]) < 1e-12 && Math.abs(d[1]) < 1e-12) return d[2] > 0 ? geom.identity() : geom.rotX(180);
  const axis = [-d[1], d[0], 0.0];
  const angle = degrees(Math.acos(Math.max(-1.0, Math.min(1.0, d[2]))));
  return axisRotation(axis, angle);
}

/** A box width x depth x height with its minimum corner at `pnt`. */
export function makeBox(width, depth, height, pnt = null) {
  const m = track(Manifold.cube([Number(width), Number(depth), Number(height)]));
  return new Shape(track(m.translate(vec(pnt))));
}

/** A cylinder of `radius` and `height`, its base centred on `pnt` and its
axis along `dir` (default +Z). */
export function makeCylinder(radius, height, pnt = null, dir = null) {
  let m = track(Manifold.cylinder(Number(height), Number(radius), Number(radius), circleSegments(radius)));
  if (dir) m = track(m.transform(mat4(zTo(dir))));
  return new Shape(track(m.translate(vec(pnt))));
}

/** A cone (or a cone's frustum) up +Z from `pnt`: `radius1` at its base,
`radius2` at its top. */
export function makeCone(radius1, radius2, height, pnt = null) {
  const m = track(Manifold.cylinder(Number(height), Number(radius1), Number(radius2),
    circleSegments(Math.max(radius1, radius2))));
  return new Shape(track(m.translate(vec(pnt))));
}

/** A ball of `radius` centred on the origin. */
export function makeSphere(radius) {
  return new Shape(track(Manifold.sphere(Number(radius), circleSegments(radius))));
}

/** A wedge round the X axis from x0 to x1: the pie slice of `radius`
between angles `start` and `end` (degrees, measured in the YZ plane from
+Y towards +Z, end - start at most 180). */
export function makeWedge(radius, start, end, x0, x1) {
  if (!(end - start > 0 && end - start <= 180)) throw new Error("a wedge spans more than 0 and at most 180 degrees");
  const steps = Math.max(2, Math.trunc(Math.ceil((end - start) / 15.0)));
  const rad = radians;
  const reach = radius / Math.cos(rad((end - start) / (2.0 * steps)));
  const points = [[0.0, 0.0]];
  for (let i = 0; i <= steps; i++) {
    const a = rad(start + ((end - start) * i) / steps);
    points.push([reach * Math.cos(a), reach * Math.sin(a)]);
  }
  const section = track(new CrossSection([points], "Positive"));
  const m = track(Manifold.extrude(section, Number(x1 - x0)));
  // Extruded along Z in (Y, Z, X) order: turn it to run along X.
  return new Shape(track(m.transform(mat4([[0, 0, 1, Number(x0)], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]))));
}

function signedArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area;
}

/** The polygon `points` ([[x, y]...], either way round) on the XY plane,
extruded `height` up Z. */
export function makePrism(points, height) {
  let pts = points.map(([x, y]) => [Number(x), Number(y)]);
  if (signedArea(pts) < 0) pts = pts.reverse();
  const section = track(new CrossSection([pts], "Positive"));
  return new Shape(track(Manifold.extrude(section, Number(height))));
}

/** Closed rings of [x, y] points - outlines, with any holes as further
rings, filled by the even-odd rule - extruded from z0 up by `height`. */
export function makeOutline(rings, height, z0 = 0.0) {
  const rs = rings.filter((r) => r.length > 2).map((r) => r.map(([x, y]) => [Number(x), Number(y)]));
  if (!rs.length) return new Shape();
  const section = track(new CrossSection(rs, "EvenOdd"));
  return new Shape(track(track(Manifold.extrude(section, Number(height))).translate([0, 0, Number(z0)])));
}

/** A Section extruded from z0 up by `height`. */
export function extrudeSection(section, height, z0 = 0.0) {
  if (section.isEmpty()) return new Shape();
  const m = track(Manifold.extrude(section._cs, Number(height)));
  return new Shape(track(m.translate([0.0, 0.0, Number(z0)])));
}

/** The convex hull of several shapes. */
export function hull(shapes) {
  return new Shape(track(Manifold.hull(shapes.map((s) => s._m))));
}

/** One shape holding all of `shapes` (joined where they touch). */
export function compound(shapes) {
  const list = shapes.filter((s) => s !== null && s !== undefined);
  if (!list.length) return new Shape();
  return list[0].fuse(list.slice(1));
}

// -- 2D sections --

/** A 2D region (manifold's CrossSection), with the operators the Python
code uses on manifold3d's CrossSection: + (add), - (subtract), ^
(intersect). */
export class Section {
  constructor(cs = null) {
    this._cs = cs || track(CrossSection.compose([]));
  }

  /** Closed rings of [x, y] points, filled by `fillRule` ("EvenOdd",
  "Positive", "NonZero" or "Negative"). */
  static fromRings(rings, fillRule = "Positive") {
    const rs = rings.filter((r) => r.length > 0).map((r) => r.map(([x, y]) => [Number(x), Number(y)]));
    if (!rs.length) return new Section();
    return new Section(track(new CrossSection(rs, fillRule)));
  }

  static square(w, h) {
    return new Section(track(CrossSection.square([Number(w), Number(h)])));
  }

  static circle(radius, segments = 0) {
    return new Section(track(CrossSection.circle(Number(radius), segments)));
  }

  static union(sections) {
    const list = sections.filter((s) => s && !s.isEmpty());
    if (!list.length) return new Section();
    if (list.length === 1) return list[0];
    return new Section(track(CrossSection.union(list.map((s) => s._cs))));
  }

  translate(x, y) {
    return new Section(track(this._cs.translate([Number(x), Number(y)])));
  }

  rotate(deg) {
    return new Section(track(this._cs.rotate(Number(deg))));
  }

  /** Grown (or, negative, shrunk) by delta; joinType "Round", "Miter" or
  "Square". */
  offset(delta, joinType = "Square", miterLimit = 2.0, circularSegments = 0) {
    return new Section(track(this._cs.offset(Number(delta), joinType, miterLimit, circularSegments)));
  }

  add(other) {
    return new Section(track(this._cs.add(other._cs)));
  }

  subtract(other) {
    return new Section(track(this._cs.subtract(other._cs)));
  }

  intersect(other) {
    return new Section(track(this._cs.intersect(other._cs)));
  }

  isEmpty() {
    return this._cs.isEmpty();
  }

  area() {
    return this._cs.area();
  }

  /** [xmin, ymin, xmax, ymax] */
  bounds() {
    const b = this._cs.bounds();
    return [b.min[0], b.min[1], b.max[0], b.max[1]];
  }

  /** [[[x, y]...]...] */
  toPolygons() {
    return this._cs.toPolygons().map((ring) => ring.map((p) => [p[0], p[1]]));
  }
}

// -- STL files --

/** Float64Array of an STL file's triangle corners (x, y, z each). */
export function stlTriangles(path) {
  const data = fs.readFileSync(path);
  if (data.length >= 84) {
    const count = data.readUInt32LE(80);
    if (data.length === 84 + 50 * count) {
      const out = new Float64Array(count * 9);
      for (let i = 0; i < count; i++) {
        const base = 84 + 50 * i + 12;
        for (let k = 0; k < 9; k++) out[9 * i + k] = data.readFloatLE(base + 4 * k);
      }
      return out;
    }
  }
  const text = data.toString("latin1");
  const re = /vertex\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  const values = [];
  let match;
  while ((match = re.exec(text)) !== null) values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  return Float64Array.from(values);
}

/** An STL file as a Shape. STL stores every triangle separately, so corners
closer than `weld` mm are joined first; the result must then be a closed
mesh (several separate pieces are fine). */
export function loadStl(path, weld = 1e-5) {
  const corners = stlTriangles(path);
  if (corners.length === 0) throw new Error(`${path} has no triangles in it`);
  const index = new Map();
  const verts = [];
  const ids = new Uint32Array(corners.length / 3);
  for (let i = 0; i < corners.length / 3; i++) {
    const key = `${Math.round(corners[3 * i] / weld)},${Math.round(corners[3 * i + 1] / weld)},${Math.round(corners[3 * i + 2] / weld)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      index.set(key, id);
      verts.push(corners[3 * i], corners[3 * i + 1], corners[3 * i + 2]);
    }
    ids[i] = id;
  }
  // Drop triangles that welding collapsed to a line or a point.
  const tris = [];
  for (let t = 0; t < ids.length / 3; t++) {
    const a = ids[3 * t];
    const b = ids[3 * t + 1];
    const c = ids[3 * t + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  const mesh = new Mesh({ numProp: 3, vertProperties: Float32Array.from(verts), triVerts: Uint32Array.from(tris) });
  const m = track(new Manifold(mesh));
  if (m.status() !== "NoError") {
    throw new Error(`${path} isn't made of closed meshes, so it can't be made into a solid (${m.status()})`);
  }
  return new Shape(m);
}

/** A shape as binary STL bytes. */
export function stlBytes(shape) {
  const { vertices: v, triangles: t } = shape.arrays();
  const count = t.length / 3;
  const buf = Buffer.alloc(84 + 50 * count);
  buf.write("thingmaker".padEnd(80, " "), 0, "latin1");
  buf.writeUInt32LE(count, 80);
  let o = 84;
  for (let i = 0; i < count; i++) {
    const a = 3 * t[3 * i];
    const b = 3 * t[3 * i + 1];
    const c = 3 * t[3 * i + 2];
    // Corners as float32, as written; the normal worked out from them.
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b] - ax, by = v[b + 1] - ay, bz = v[b + 2] - az;
    const cx = v[c] - ax, cy = v[c + 1] - ay, cz = v[c + 2] - az;
    let nx = Math.fround(Math.fround(by * cz) - Math.fround(bz * cy));
    let ny = Math.fround(Math.fround(bz * cx) - Math.fround(bx * cz));
    let nz = Math.fround(Math.fround(bx * cy) - Math.fround(by * cx));
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = ny = nz = 0;
    }
    buf.writeFloatLE(nx, o);
    buf.writeFloatLE(ny, o + 4);
    buf.writeFloatLE(nz, o + 8);
    for (const [k, p] of [[0, a], [1, b], [2, c]]) {
      buf.writeFloatLE(v[p], o + 12 + 12 * k);
      buf.writeFloatLE(v[p + 1], o + 16 + 12 * k);
      buf.writeFloatLE(v[p + 2], o + 20 + 12 * k);
    }
    buf.writeUInt16LE(0, o + 48);
    o += 50;
  }
  return buf;
}

/** Write a shape as a binary STL file. */
export function writeStl(shape, path) {
  fs.writeFileSync(path, stlBytes(shape));
}
