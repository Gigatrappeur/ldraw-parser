// ============================================================
// LDraw Parser – Post-processing helpers
// ============================================================
//
// Utilities to transform FlatGeometry before GLB/SVG export:
//   - Unit conversion  (LDU → mm / cm / inches / studs)
//   - Axis remapping   (LDraw Y-down → glTF Y-up)
//   - Mesh merging     (combine meshes by color for fewer draw calls)
//   - Geometry stats
//   - Color palette extraction
// ============================================================

import type {
  FlatGeometry,
  GeometryMesh,
  GeometryEdges,
  LDrawColor,
  Vec3,
} from "./types";
import { aabbEmpty, aabbExpand, aabbFinalize } from "./utils";

// ── Unit conversion ───────────────────────────────────────────

/**
 * One LDraw Unit (LDU) = 0.4 mm  (one stud = 20 LDU = 8 mm).
 * Reference: https://www.ldraw.org/article/218.html
 */
export const LDU_PER_MM     = 2.5;   // 1 mm = 2.5 LDU
export const MM_PER_LDU     = 0.4;   // 1 LDU = 0.4 mm
export const STUDS_PER_LDU  = 1 / 20; // 1 stud = 20 LDU

export type LengthUnit = "ldu" | "mm" | "cm" | "m" | "in" | "studs";

const SCALE_TO_METERS: Record<LengthUnit, number> = {
  ldu:   MM_PER_LDU / 1000,
  mm:    1 / 1000,
  cm:    1 / 100,
  m:     1,
  in:    0.0254,
  studs: (20 * MM_PER_LDU) / 1000,
};

/**
 * Scale factor to convert from LDU to any supported unit.
 * Multiply LDU coordinates by this value.
 */
export function lduToUnitScale(unit: LengthUnit): number {
  return SCALE_TO_METERS["ldu"]! / SCALE_TO_METERS[unit]!;
}

// ── Axis conventions ──────────────────────────────────────────

/**
 * LDraw uses a right-handed coordinate system with Y pointing DOWN.
 * glTF 2.0, Three.js, and most 3D engines use Y pointing UP.
 *
 * This function remaps vertices in-place:
 *   LDraw (x,  y,  z) → Y-up (x, -y, -z)
 *
 * The Z flip is needed to maintain handedness.
 */
function flipYUp(v: Vec3): Vec3 {
  return { x: v.x, y: -v.y, z: -v.z };
}

// ── Transform geometry ────────────────────────────────────────

/**
 * Apply a scale factor and optional Y-up remapping to all vertex
 * positions in a FlatGeometry.  Returns a new FlatGeometry.
 *
 * @param geometry   Source geometry (not mutated)
 * @param scale      Multiply every coordinate by this value (default: 1)
 * @param yUp        Remap Y-down → Y-up (default: true for GLB export)
 */
export function transformGeometry(
  geometry: FlatGeometry,
  scale = 1,
  yUp  = true,
): FlatGeometry {
  const transformVec = (v: Vec3): Vec3 => {
    const s = yUp ? flipYUp(v) : v;
    return { x: s.x * scale, y: s.y * scale, z: s.z * scale };
  };

  const meshes: GeometryMesh[] = geometry.meshes.map((mesh) => ({
    ...mesh,
    triangles: mesh.triangles.map((tri) => ({
      a: { ...tri.a, position: transformVec(tri.a.position) },
      b: { ...tri.b, position: transformVec(tri.b.position) },
      c: { ...tri.c, position: transformVec(tri.c.position) },
    })),
  }));

  const edges: GeometryEdges[] = geometry.edges.map((eg) => ({
    ...eg,
    segments: eg.segments.map((seg) => ({
      start: transformVec(seg.start),
      end:   transformVec(seg.end),
    })),
  }));

  // Recompute AABB
  const box = aabbEmpty();
  for (const mesh of meshes) {
    for (const tri of mesh.triangles) {
      aabbExpand(box, tri.a.position);
      aabbExpand(box, tri.b.position);
      aabbExpand(box, tri.c.position);
    }
  }

  return { ...geometry, meshes, edges, aabb: aabbFinalize(box) };
}

// ── Mesh merging ──────────────────────────────────────────────

/**
 * Merge all GeometryMesh entries that share the same colorCode into a
 * single entry per color.  Reduces the number of primitives in GLB
 * exports and speeds up rendering.
 *
 * Meshes with a TEXMAP are kept separate (they differ by texture even
 * when the color code is the same).
 */
export function mergeMeshesByColor(geometry: FlatGeometry): FlatGeometry {
  const merged = new Map<string, GeometryMesh>();

  for (const mesh of geometry.meshes) {
    const key = mesh.texmap
      ? `${mesh.colorCode}::${mesh.texmap.texture}`
      : `${mesh.colorCode}`;

    const existing = merged.get(key);
    if (existing) {
      existing.triangles.push(...mesh.triangles);
    } else {
      merged.set(key, { ...mesh, triangles: [...mesh.triangles] });
    }
  }

  return { ...geometry, meshes: [...merged.values()] };
}

/**
 * Merge all GeometryEdges entries that share the same colorCode.
 */
export function mergeEdgesByColor(geometry: FlatGeometry): FlatGeometry {
  const merged = new Map<number, GeometryEdges>();

  for (const eg of geometry.edges) {
    const existing = merged.get(eg.colorCode);
    if (existing) {
      existing.segments.push(...eg.segments);
    } else {
      merged.set(eg.colorCode, { ...eg, segments: [...eg.segments] });
    }
  }

  return { ...geometry, edges: [...merged.values()] };
}

/**
 * Full merge pass: combines both meshes and edges by color.
 */
export function mergeGeometry(geometry: FlatGeometry): FlatGeometry {
  return mergeEdgesByColor(mergeMeshesByColor(geometry));
}

// ── Color palette ─────────────────────────────────────────────

export interface ColorUsage {
  color:         LDrawColor;
  triangleCount: number;
  edgeCount:     number;
  isTransparent: boolean;
}

/**
 * Extract the list of colors actually used in the geometry, sorted by
 * triangle count descending (most-used first).
 */
export function extractColorPalette(geometry: FlatGeometry): ColorUsage[] {
  const map = new Map<number, ColorUsage>();

  for (const mesh of geometry.meshes) {
    const existing = map.get(mesh.colorCode);
    if (existing) {
      existing.triangleCount += mesh.triangles.length;
    } else {
      const color = geometry.colorTable?.get(mesh.colorCode);
      map.set(mesh.colorCode, {
        color:         color!,
        triangleCount: mesh.triangles.length,
        edgeCount:     0,
        isTransparent: color?.isTransparent ?? false,
      });
    }
  }

  for (const eg of geometry.edges) {
    const existing = map.get(eg.colorCode);
    if (existing) {
      existing.edgeCount += eg.segments.length;
    } else {
      const color = geometry.colorTable?.get(eg.colorCode);
      map.set(eg.colorCode, {
        color:         color!,
        triangleCount: 0,
        edgeCount:     eg.segments.length,
        isTransparent: color?.isTransparent ?? false,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.triangleCount - a.triangleCount);
}

// ── Geometry statistics ───────────────────────────────────────

export interface GeometryStats {
  triangleCount:     number;
  vertexCount:       number;
  edgeCount:         number;
  meshCount:         number;
  colorCount:        number;
  transparentMeshes: number;
  texturedMeshes:    number;
  aabb: FlatGeometry["aabb"];
  /** Approximate memory usage in bytes for all vertex data */
  estimatedBytes: number;
}

export function computeStats(geometry: FlatGeometry): GeometryStats {
  let triangleCount = 0;
  let transparentMeshes = 0;
  let texturedMeshes = 0;

  for (const mesh of geometry.meshes) {
    triangleCount += mesh.triangles.length;
    if (geometry.colorTable?.get(mesh.colorCode)?.isTransparent) transparentMeshes++;
    if (mesh.texmap) texturedMeshes++;
  }

  let edgeCount = 0;
  for (const eg of geometry.edges) edgeCount += eg.segments.length;

  const vertexCount = triangleCount * 3;
  const colorCount  = new Set(geometry.meshes.map((m) => m.colorCode)).size;
  // 3 floats position + 3 floats normal + 2 floats UV = 32 bytes/vertex
  const estimatedBytes = vertexCount * 32 + edgeCount * 2 * 12;

  return {
    triangleCount,
    vertexCount,
    edgeCount,
    meshCount:    geometry.meshes.length,
    colorCount,
    transparentMeshes,
    texturedMeshes,
    aabb:         geometry.aabb,
    estimatedBytes,
  };
}

// ── LOD / decimation (simple distance-based culling) ─────────

/**
 * Remove triangles whose projected screen-area (in LDU²) falls below
 * `minArea`.  Useful for generating lower-LOD thumbnails quickly.
 *
 * This is a very simple heuristic – it removes degenerate and micro
 * triangles.  For production LOD use a proper mesh decimation library.
 */
export function cullSmallTriangles(
  geometry: FlatGeometry,
  minArea: number,
): FlatGeometry {
  const meshes = geometry.meshes.map((mesh) => ({
    ...mesh,
    triangles: mesh.triangles.filter((tri) => {
      const ab = {
        x: tri.b.position.x - tri.a.position.x,
        y: tri.b.position.y - tri.a.position.y,
        z: tri.b.position.z - tri.a.position.z,
      };
      const ac = {
        x: tri.c.position.x - tri.a.position.x,
        y: tri.c.position.y - tri.a.position.y,
        z: tri.c.position.z - tri.a.position.z,
      };
      // |cross(ab, ac)| / 2
      const cx = ab.y * ac.z - ab.z * ac.y;
      const cy = ab.z * ac.x - ab.x * ac.z;
      const cz = ab.x * ac.y - ab.y * ac.x;
      const area2 = cx * cx + cy * cy + cz * cz;
      return area2 > minArea * minArea * 4;
    }),
  })).filter((m) => m.triangles.length > 0);

  return { ...geometry, meshes };
}

// ── Texture manifest ──────────────────────────────────────────

/**
 * Collect all unique texture file names referenced via TEXMAP across
 * the geometry.  Useful for knowing which image files to load.
 */
export function collectTextures(geometry: FlatGeometry): string[] {
  const set = new Set<string>();
  for (const mesh of geometry.meshes) {
    if (mesh.texmap?.texture) set.add(mesh.texmap.texture);
    if (mesh.texmap && "glossmap" in mesh.texmap && mesh.texmap.glossmap) {
      set.add(mesh.texmap.glossmap);
    }
  }
  return [...set];
}

// ── Color overrides ───────────────────────────────────────────


/**
 * Replace colors in a FlatGeometry without re-parsing.
 *
 * `overrides` maps an LDraw color code → replacement LDrawColor.
 * The replacement is injected into a cloned colorTable so that
 * all meshes/edges using that colorCode resolve to the new colour.
 */
export function applyColorOverrides(
  geometry: FlatGeometry,
  overrides: Map<number, LDrawColor>,
): FlatGeometry {
  if (overrides.size === 0) return geometry;

  const colorTable = new Map(geometry.colorTable);
  for (const [code, replacement] of overrides) {
    colorTable.set(code, replacement);
  }

  return { ...geometry, colorTable };
}
