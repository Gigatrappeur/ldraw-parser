// ============================================================
// LDraw Parser – Smooth normal computation
// ============================================================
//
// After geometry flattening every triangle has flat normals.
// This module computes per-vertex normals by averaging the
// normals of all triangles that share the same world position.
//
// The result is a SmoothGeometry where each vertex in a triangle
// carries its own smooth normal, ready for GLB export.
// ============================================================

import type { FlatGeometry, GeometryMesh, Vec3 } from "./types";
import { vec3Cross, vec3Sub, vec3Normalize, vec3Add } from "./utils";

// ── Types ─────────────────────────────────────────────────────

export interface VertexWithNormal {
  position: Vec3;
  normal:   Vec3;
  uv?:      { u: number; v: number };
}

export interface SmoothTriangle {
  a: VertexWithNormal;
  b: VertexWithNormal;
  c: VertexWithNormal;
}

export interface SmoothMesh {
  colorCode:  number;
  color:      GeometryMesh["color"];
  triangles:  SmoothTriangle[];
  texmap?:    GeometryMesh["texmap"];
}

export interface SmoothGeometry {
  meshes: SmoothMesh[];
  edges:  FlatGeometry["edges"];
  aabb:   FlatGeometry["aabb"];
}

// ── Helpers ───────────────────────────────────────────────────

/** Encode a Vec3 to a compact string key (rounded to avoid float noise) */
function posKey(v: Vec3, precision = 4): string {
  const f = 10 ** precision;
  return `${Math.round(v.x * f)},${Math.round(v.y * f)},${Math.round(v.z * f)}`;
}

/** Compute the un-normalised face normal (length = 2× triangle area) */
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return vec3Cross(vec3Sub(b, a), vec3Sub(c, a));
}

// ── Per-mesh smooth normals ───────────────────────────────────

/**
 * Compute smooth normals for a single GeometryMesh.
 *
 * @param mesh          Source mesh
 * @param creaseAngle   Angle threshold in radians above which an edge is
 *                      considered a hard crease and normals are NOT blended
 *                      across it (default π/4 = 45°).  Set to 0 to get
 *                      fully flat normals; set to Math.PI to get fully smooth.
 */
export function smoothMeshNormals(
  mesh: GeometryMesh,
  creaseAngle = Math.PI / 4,
): SmoothMesh {
  const cosCrease = Math.cos(creaseAngle);

  // 1. Compute flat normal for each triangle
  const flatNormals: Vec3[] = mesh.triangles.map((tri) =>
    faceNormal(tri.a.position, tri.b.position, tri.c.position),
  );

  // 2. Build an accumulator map: posKey → { sumNormal, contributing triangle normals }
  //    We store the face normals per position so we can apply the crease test.
  type NormalEntry = { sum: Vec3; contributions: Vec3[] };
  const accumulator = new Map<string, NormalEntry>();

  for (let ti = 0; ti < mesh.triangles.length; ti++) {
    const tri   = mesh.triangles[ti]!;
    const fnorm = flatNormals[ti]!;
    const fnLen = Math.sqrt(fnorm.x ** 2 + fnorm.y ** 2 + fnorm.z ** 2);
    if (fnLen === 0) continue;
    const fn = { x: fnorm.x / fnLen, y: fnorm.y / fnLen, z: fnorm.z / fnLen };

    for (const vert of [tri.a, tri.b, tri.c]) {
      const key = posKey(vert.position);
      const entry = accumulator.get(key);
      if (entry) {
        entry.contributions.push(fn);
      } else {
        accumulator.set(key, { sum: { x: 0, y: 0, z: 0 }, contributions: [fn] });
      }
    }
  }

  // 3. For each position, blend only contributions within creaseAngle
  //    (relative to the FIRST contribution for that vertex).
  //    We pre-compute a blended normal per (position × reference normal) pair.
  const blendedNormals = new Map<string, Vec3>();

  for (const [key, entry] of accumulator) {
    const ref = entry.contributions[0]!;
    let sum: Vec3 = { x: 0, y: 0, z: 0 };
    for (const c of entry.contributions) {
      const dot = ref.x * c.x + ref.y * c.y + ref.z * c.z;
      if (dot >= cosCrease) {
        sum = vec3Add(sum, c);
      }
    }
    blendedNormals.set(key, vec3Normalize(sum));
  }

  // 4. Assign blended normals to vertices
  const smoothTriangles: SmoothTriangle[] = [];

  for (let ti = 0; ti < mesh.triangles.length; ti++) {
    const tri   = mesh.triangles[ti]!;
    const fnorm = flatNormals[ti]!;
    const fnLen = Math.sqrt(fnorm.x ** 2 + fnorm.y ** 2 + fnorm.z ** 2);
    const flatN = fnLen > 0
      ? { x: fnorm.x / fnLen, y: fnorm.y / fnLen, z: fnorm.z / fnLen }
      : { x: 0, y: 1, z: 0 };

    const verts: [typeof tri.a, typeof tri.b, typeof tri.c] = [tri.a, tri.b, tri.c];
    const smoothVerts = verts.map((vert): VertexWithNormal => {
      const key = posKey(vert.position);
      const blended = blendedNormals.get(key);

      // Use blended if it points roughly the same way as the face (crease guard)
      let normal = flatN;
      if (blended) {
        const dot = blended.x * flatN.x + blended.y * flatN.y + blended.z * flatN.z;
        if (dot >= cosCrease) normal = blended;
      }

      return { position: vert.position, normal, uv: vert.uv };
    });

    smoothTriangles.push({
      a: smoothVerts[0]!,
      b: smoothVerts[1]!,
      c: smoothVerts[2]!,
    });
  }

  return {
    colorCode: mesh.colorCode,
    color:     mesh.color,
    triangles: smoothTriangles,
    texmap:    mesh.texmap,
  };
}

// ── Full geometry smooth ──────────────────────────────────────

/**
 * Compute smooth normals for every mesh in a FlatGeometry.
 * Transparent meshes get a lower crease angle (they tend to be smooth shapes).
 */
export function computeSmoothNormals(
  geometry: FlatGeometry,
  creaseAngle?: number,
): SmoothGeometry {
  const defaultCrease = creaseAngle ?? Math.PI / 4; // 45°

  const meshes = geometry.meshes.map((mesh) => {
    // Transparent / special-finish parts often are smoother
    const angle = mesh.color.isTransparent
      ? Math.min(defaultCrease * 1.5, Math.PI)
      : defaultCrease;
    return smoothMeshNormals(mesh, angle);
  });

  return {
    meshes,
    edges: geometry.edges,
    aabb:  geometry.aabb,
  };
}
