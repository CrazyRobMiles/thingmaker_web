/* Minimal rigid-transform maths, shared by the design model, the geometry
kernel, the builder and the editor.

Matrices are 4x4 row-major nested arrays acting on column vectors, so
mul(A, B) applied to a point means "apply B first, then A". Only rotations
and translations are ever built here (no scaling, no mirroring), so every
matrix is rigid and inverseRigid() is exact. */
import { radians } from "./py.js";

export function identity() {
  return [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
  ];
}

/** Compose matrices left to right: mul(A, B, C) == A @ B @ C, so C is
applied to a point first. */
export function mul(...matrices) {
  let result = identity();
  for (const m of matrices) {
    const next = [];
    for (let i = 0; i < 4; i++) {
      const row = [];
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += result[i][k] * m[k][j];
        row.push(s);
      }
      next.push(row);
    }
    result = next;
  }
  return result;
}

export function translate(x, y, z) {
  const m = identity();
  m[0][3] = Number(x);
  m[1][3] = Number(y);
  m[2][3] = Number(z);
  return m;
}

/** cos/sin that are exact for multiples of 90 degrees, so 0/90/180/270
rotations don't leave 1e-16 noise in coordinates that end up in JSON or
in booleans. */
export function cosSin(degrees) {
  let d = degrees % 360.0;
  if (d < 0) d += 360.0;
  if (d === 0) return [1.0, 0.0];
  if (d === 90) return [0.0, 1.0];
  if (d === 180) return [-1.0, 0.0];
  if (d === 270) return [0.0, -1.0];
  const r = radians(degrees);
  return [Math.cos(r), Math.sin(r)];
}

export function rotX(degrees) {
  const [c, s] = cosSin(degrees);
  return [[1.0, 0.0, 0.0, 0.0], [0.0, c, -s, 0.0], [0.0, s, c, 0.0], [0.0, 0.0, 0.0, 1.0]];
}

export function rotY(degrees) {
  const [c, s] = cosSin(degrees);
  return [[c, 0.0, s, 0.0], [0.0, 1.0, 0.0, 0.0], [-s, 0.0, c, 0.0], [0.0, 0.0, 0.0, 1.0]];
}

export function rotZ(degrees) {
  const [c, s] = cosSin(degrees);
  return [[c, -s, 0.0, 0.0], [s, c, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
}

/** The frame whose local X/Y/Z axes are u/v/n and whose local origin is
`origin`, all expressed in the parent frame. */
export function fromAxes(u, v, n, origin) {
  return [
    [u[0], v[0], n[0], origin[0]],
    [u[1], v[1], n[1], origin[1]],
    [u[2], v[2], n[2], origin[2]],
    [0.0, 0.0, 0.0, 1.0],
  ];
}

/** Inverse of a rotation+translation matrix: R^T, -R^T t. */
export function inverseRigid(m) {
  const result = identity();
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) result[i][j] = m[j][i];
    result[i][3] = -(m[0][i] * m[0][3] + m[1][i] * m[1][3] + m[2][i] * m[2][3]);
  }
  return result;
}

export function applyPoint(m, p) {
  return [0, 1, 2].map((i) => m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3]);
}

/** Rotate a direction (no translation). */
export function applyVector(m, v) {
  return [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
}

/** Row-major 16-array. */
export function flatten(m) {
  return [].concat(...m);
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** An axis-aligned box in some local frame: min corner (x, y, z) and size
(w, d, h). Used for device preview bodies and connector cuts, so the editor
(which draws them) and the builder (which turns connector cuts into solids)
work from exactly the same numbers. */
export class Box3 {
  constructor(x, y, z, w, d, h, label = "") {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
    this.w = Number(w);
    this.d = Number(d);
    this.h = Number(h);
    this.label = label;
  }

  corners() {
    const out = [];
    for (const dx of [0, 1]) {
      for (const dy of [0, 1]) {
        for (const dz of [0, 1]) out.push([this.x + dx * this.w, this.y + dy * this.d, this.z + dz * this.h]);
      }
    }
    return out;
  }

  /** Axis-aligned bounds [xmin, xmax, ymin, ymax, zmin, zmax] of this box
  after transforming it by m. */
  transformedBounds(m) {
    const pts = this.corners().map((c) => applyPoint(m, c));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const zs = pts.map((p) => p[2]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys), Math.min(...zs), Math.max(...zs)];
  }

  toJSON() {
    return { x: this.x, y: this.y, z: this.z, w: this.w, d: this.d, h: this.h, label: this.label };
  }
}

/** True if two [xmin, xmax, ymin, ymax, zmin, zmax] bounds share any volume
(merely touching faces doesn't count). */
export function boundsOverlap(a, b, tolerance = 1e-6) {
  for (let i = 0; i < 3; i++) {
    if (!(a[2 * i] < b[2 * i + 1] - tolerance && b[2 * i] < a[2 * i + 1] - tolerance)) return false;
  }
  return true;
}
