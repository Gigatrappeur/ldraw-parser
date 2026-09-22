// ============================================================
// LDraw Parser – Type definitions
// ============================================================

import type { LDrawColor } from "./colors";

// ── Matrix / Geometry ────────────────────────────────────────

/** Column-major 4×4 matrix (same convention as Three.js / glTF) */
export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];


export interface Vec2 {
  u: number;
  v: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}



// ── TEXMAP ───────────────────────────────────────────────────

export type TexmapProjection = "PLANAR" | "CYLINDRICAL" | "SPHERICAL";

export interface TexmapPlanar {
  projection: "PLANAR";
  point1: Vec3;
  point2: Vec3;
  point3: Vec3;
  texture: string;
  glossmap?: string;
}

export interface TexmapCylindrical {
  projection: "CYLINDRICAL";
  point1: Vec3;
  point2: Vec3;
  point3: Vec3;
  angle: number;
  texture: string;
  glossmap?: string;
}

export interface TexmapSpherical {
  projection: "SPHERICAL";
  point1: Vec3;
  point2: Vec3;
  point3: Vec3;
  angle1: number;
  angle2: number;
  texture: string;
  glossmap?: string;
}

export type TexmapDefinition =
  | TexmapPlanar
  | TexmapCylindrical
  | TexmapSpherical;



// ── Flat geometry (output for GLB / SVG consumers) ───────────

export interface GeometryVertex {
  position: Vec3;
  /** UV coordinates (present when texmap is active) */
  uv?: Vec2;
}

export interface GeometryMesh {
  /** Unique color code of this mesh group — resolve via FlatGeometry.colorTable */
  colorCode: number;
  triangles: Array<{
	a: GeometryVertex;
	b: GeometryVertex;
	c: GeometryVertex;
  }>;
  /** Texmap applied to this batch */
  texmap?: TexmapDefinition;
}

export interface GeometryEdges {
  colorCode: number;
  segments: Array<{ start: Vec3; end: Vec3 }>;
}

export interface FlatGeometry {
  meshes: GeometryMesh[];
  edges: GeometryEdges[];
  /** Color lookup table — resolves any mesh/edge colorCode back to LDrawColor */
  colorTable?: Map<number, LDrawColor>;
  /** Axis-aligned bounding box in LDraw units */
  aabb: {
	min: Vec3;
	max: Vec3;
	center: Vec3;
	size: Vec3;
	radius: number;
  };
}
