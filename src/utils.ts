// ============================================================
// LDraw Parser – Matrix / geometry utilities
// ============================================================


import type { TexmapDefinition, Matrix4, Vec3, Vec2 } from "./types";

// ── Matrix helpers ────────────────────────────────────────────

/** Identity matrix (column-major) */
export const IDENTITY: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/**
 * Build a column-major 4×4 from the 12 values in a type-1 LDraw line:
 *   x y z  a b c  d e f  g h i
 *
 * LDraw uses a row-major rotation matrix:
 *   [ a b c ]
 *   [ d e f ]   (top-left 3×3 of the 4×4)
 *   [ g h i ]
 *
 * We store it column-major for WebGL / glTF:
 *   col0 = [a, d, g, 0]
 *   col1 = [b, e, h, 0]
 *   col2 = [c, f, i, 0]
 *   col3 = [x, y, z, 1]
 */
export function buildMatrix(
  x: number, y: number, z: number,
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, i: number,
): Matrix4 {
  return [
    a, d, g, 0,
    b, e, h, 0,
    c, f, i, 0,
    x, y, z, 1,
  ];
}

/** Multiply two column-major 4×4 matrices: result = a * b */
export function multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
  const out: number[] = new Array(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out as Matrix4;
}

/** Apply a column-major 4×4 to a Vec3 (w=1) */
export function transformPoint(m: Matrix4, v: Vec3): Vec3 {
  const x = m[0] * v.x + m[4] * v.y + m[8]  * v.z + m[12];
  const y = m[1] * v.x + m[5] * v.y + m[9]  * v.z + m[13];
  const z = m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14];
  return { x, y, z };
}

/** Apply only the rotation/scale part of a column-major 4×4 to a Vec3 (w=0) */
export function transformVector(m: Matrix4, v: Vec3): Vec3 {
  return {
    x: m[0] * v.x + m[4] * v.y + m[8]  * v.z,
    y: m[1] * v.x + m[5] * v.y + m[9]  * v.z,
    z: m[2] * v.x + m[6] * v.y + m[10] * v.z,
  };
}

/**
 * Return the determinant of the 3×3 rotation sub-matrix.
 * Negative determinant means the matrix includes a reflection → invert winding.
 */
export function matrixDeterminant3(m: Matrix4): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6]  - m[5] * m[2])
  );
}

// ── Vec3 helpers ──────────────────────────────────────────────

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3LengthSq(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(vec3LengthSq(v));
}

export function vec3Normalize(v: Vec3): Vec3 {
  const l = vec3Length(v);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

// ── AABB ──────────────────────────────────────────────────────

export interface AABB {
  min: Vec3;
  max: Vec3;
}

export function aabbEmpty(): AABB {
  return {
    min: { x: Infinity,  y: Infinity,  z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

export function aabbExpand(box: AABB, p: Vec3): void {
  if (p.x < box.min.x) box.min.x = p.x;
  if (p.y < box.min.y) box.min.y = p.y;
  if (p.z < box.min.z) box.min.z = p.z;
  if (p.x > box.max.x) box.max.x = p.x;
  if (p.y > box.max.y) box.max.y = p.y;
  if (p.z > box.max.z) box.max.z = p.z;
}

export function aabbFinalize(box: AABB) {
  if (!isFinite(box.min.x)) {
    box.min = { x: 0, y: 0, z: 0 };
    box.max = { x: 0, y: 0, z: 0 };
  }
  const center: Vec3 = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
  };
  const size: Vec3 = {
    x: box.max.x - box.min.x,
    y: box.max.y - box.min.y,
    z: box.max.z - box.min.z,
  };
  const radius = Math.sqrt(
    (size.x / 2) ** 2 + (size.y / 2) ** 2 + (size.z / 2) ** 2,
  );
  return { ...box, center, size, radius };
}

// ── TEXMAP UV projection ──────────────────────────────────────

/** Project a world-space point onto UV coordinates using the TEXMAP definition */
export function projectTexmap(
  def: TexmapDefinition,
  point: Vec3,
): Vec2 {
  if (def.projection === "PLANAR") {
    const { point1, point2, point3 } = def;
    const u_vec = vec3Sub(point2, point1);
    const v_vec = vec3Sub(point3, point1);
    const rel   = vec3Sub(point, point1);
    const u = vec3Dot(rel, u_vec) / vec3LengthSq(u_vec);
    const v = vec3Dot(rel, v_vec) / vec3LengthSq(v_vec);
    return { u, v };
  }

  if (def.projection === "CYLINDRICAL") {
    const { point1, point2, point3, angle } = def;
    const axis = vec3Normalize(vec3Sub(point2, point1));
    const ref  = vec3Normalize(vec3Sub(point3, point1));
    const rel  = vec3Sub(point, point1);
    const v    = vec3Dot(rel, axis) / vec3Length(vec3Sub(point2, point1));
    const proj = vec3Sub(rel, { x: axis.x * v, y: axis.y * v, z: axis.z * v });
    let theta  = Math.atan2(vec3Dot(proj, vec3Cross(axis, ref)), vec3Dot(proj, ref));
    if (theta < 0) theta += 2 * Math.PI;
    const u = theta / ((angle * Math.PI) / 180);
    return { u, v };
  }

  // SPHERICAL
  const { point1, point2, point3, angle1, angle2 } = def as { point1: Vec3; point2: Vec3; point3: Vec3; angle1: number; angle2: number; texture: string };
  const axis = vec3Normalize(vec3Sub(point2, point1));
  const ref  = vec3Normalize(vec3Sub(point3, point1));
  const rel  = vec3Normalize(vec3Sub(point, point1));
  const phi  = Math.acos(Math.max(-1, Math.min(1, vec3Dot(rel, axis))));
  const side = vec3Sub(rel, { x: axis.x * vec3Dot(rel, axis), y: axis.y * vec3Dot(rel, axis), z: axis.z * vec3Dot(rel, axis) });
  let theta  = Math.atan2(vec3Dot(side, vec3Cross(axis, ref)), vec3Dot(side, ref));
  if (theta < 0) theta += 2 * Math.PI;
  const u = theta / ((angle1 * Math.PI) / 180);
  const v = phi   / ((angle2 * Math.PI) / 180);
  return { u, v };
}

// ── Normalise file names for resolution ──────────────────────

/** Normalise backslashes to forward slashes and lowercase */
export function normalizeFileName(name: string): string {
  return name.replace(/\\/g, "/").toLowerCase().trim();
}
