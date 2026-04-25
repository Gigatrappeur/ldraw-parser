// ============================================================
// LDraw Parser – Type definitions
// ============================================================

// ── Colour ──────────────────────────────────────────────────

export type LDrawColorFinish =
  | "CHROME"
  | "PEARLESCENT"
  | "RUBBER"
  | "MATTE_METALLIC"
  | "METAL"
  | "MATERIAL"
  | "GLITTER"
  | "SPECKLE"
  | "NORMAL";

export interface LDrawMaterial {
  type: "GLITTER" | "SPECKLE";
  value: string;           // hex colour of the particles
  alpha?: number;          // 0-255
  luminance?: number;      // 0-255
  fraction: number;        // 0-1
  vfraction: number;       // volume fraction 0-1
  size?: number;
  minsize?: number;
  maxsize?: number;
}

export interface LDrawColor {
  code: number;
  name: string;
  /** 0xRRGGBB */
  value: number;
  /** 0xRRGGBB */
  edge: number;
  /** 0-255 – 255 = fully opaque */
  alpha: number;
  luminance: number;
  finish: LDrawColorFinish;
  material?: LDrawMaterial;
  /** Derived from alpha < 255 */
  isTransparent: boolean;
  /** Convenience RGBA tuple, each 0-1 */
  rgba: [number, number, number, number];
  /** Edge RGBA tuple, each 0-1 */
  edgeRgba: [number, number, number, number];
  hex: string
}

// ── Matrix / Geometry ────────────────────────────────────────

/** Column-major 4×4 matrix (same convention as Three.js / glTF) */
export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  u: number;
  v: number;
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

// ── Line types ───────────────────────────────────────────────

export interface LDrawComment {
  type: 0;
  raw: string;
  /** Parsed META command, e.g. "FILE", "COLOUR", "TEXMAP" … */
  meta?: string;
}

export interface LDrawSubFileRef {
  type: 1;
  colorCode: number;
  /** The resolved LDrawColor (if colour table is loaded) */
  color?: LDrawColor;
  transform: Matrix4;
  /** As written in the file, e.g. "stud.dat" */
  file: string;
  /** Absolute / resolved path after file resolution */
  resolvedPath?: string;
  /** BFC invert flag set by parent */
  inverted?: boolean;
  texmap?: TexmapDefinition;
}

export interface LDrawLine {
  type: 2;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3];
}

export interface LDrawTriangle {
  type: 3;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3, Vec3];
  /** Normal direction after BFC winding (true = outward with CCW front) */
  winding?: "CW" | "CCW";
  texmap?: TexmapDefinition;
}

export interface LDrawQuad {
  type: 4;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3, Vec3, Vec3];
  winding?: "CW" | "CCW";
  texmap?: TexmapDefinition;
}

export interface LDrawOptionalLine {
  type: 5;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3];
  controlPoints: [Vec3, Vec3];
}

export type LDrawCommand =
  | LDrawComment
  | LDrawSubFileRef
  | LDrawLine
  | LDrawTriangle
  | LDrawQuad
  | LDrawOptionalLine;

// ── BFC ──────────────────────────────────────────────────────

export type BFCStatement =
  | "CERTIFY CW"
  | "CERTIFY CCW"
  | "NOCERTIFY"
  | "CW"
  | "CCW"
  | "INVERTNEXT"
  | "CLIP"
  | "NOCLIP";

// ── File metadata ────────────────────────────────────────────

export type LDrawFileType = "Model" | "Unofficial_Model" | "Subpart" | "Shortcut" | "Part" | "Unofficial_Part" | "Unofficial_Subpart" | "Unofficial_Shortcut" | "Primitive" | "Unofficial_Primitive" | "8_Primitive" | "48_Primitive";

export interface LDrawFileMeta {
  /** First comment line – human readable description */
  description?: string;
  /** 0 Name: ... */
  name?: string;
  /** 0 Author: ... */
  author?: string;
  /** 0 !LDRAW_ORG ... */
  fileType?: LDrawFileType;
  /** 0 !LICENSE ... */
  license?: string;
  /** 0 !HELP lines */
  help?: string[];
  /** 0 !CATEGORY ... */
  category?: string;
  /** 0 !KEYWORDS ... (merged from multiple lines, deduplicated) */
  keywords?: string[];
  /** 0 !CMDLINE ... */
  cmdline?: string;
  /** 0 !HISTORY entries */
  history?: Array<{ date: string; author: string; description: string }>;
  /** File-level colour definitions (0 !COLOUR) */
  colors?: LDrawColor[];
  /** BFC certification of this file */
  bfcCertified?: boolean;
  bfcWinding?: "CW" | "CCW";
}

// ── Parsed file ───────────────────────────────────────────────

export interface LDrawFile {
  /** File name as declared by "0 FILE <name>" or the source path */
  name: string;
  meta: LDrawFileMeta;
  commands: LDrawCommand[];
  /** Sub-files embedded in an MPD (only at root level) */
  subFiles?: Map<string, LDrawFile>;
  /** Raw lines for debugging */
  rawLines?: string[];
}

// ── Flat geometry (output for GLB / SVG consumers) ───────────

export interface GeometryVertex {
  position: Vec3;
  /** UV coordinates (present when texmap is active) */
  uv?: Vec2;
}

export interface GeometryMesh {
  /** Unique color code of this mesh group */
  colorCode: number;
  color: LDrawColor;
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
  color: LDrawColor;
  segments: Array<{ start: Vec3; end: Vec3 }>;
}

export interface FlatGeometry {
  meshes: GeometryMesh[];
  edges: GeometryEdges[];
  /** Axis-aligned bounding box in LDraw units */
  aabb: {
    min: Vec3;
    max: Vec3;
    center: Vec3;
    size: Vec3;
    radius: number;
  };
}

// ── Parser options ────────────────────────────────────────────

export interface LDrawParserOptions {
  /**
   * Resolve sub-file content.
   * Called with the raw file name as written in the type-1 command.
   * Return null / undefined if the file cannot be found.
   */
  resolveFile?: (name: string) => Promise<string | null | undefined>;

  /** Pre-loaded colour table (LDConfig.ldr). Parsed automatically if omitted. */
  colorTable?: Map<number, LDrawColor>;

  /** Decode BFC winding and propagate to triangles/quads (default: true) */
  processBFC?: boolean;

  /** Inline sub-files recursively into a single FlatGeometry (default: true) */
  flatten?: boolean;

  /** Keep raw line strings on each LDrawFile (default: false) */
  keepRawLines?: boolean;

  /** Maximum recursion depth for sub-file references (default: 64) */
  maxDepth?: number;

  /**
   * Default color used for geometry that inherits from a parent (code 16)
   * when there is no parent — i.e. when parsing a standalone part file (.dat).
   *
   * Accepts any LDrawColor. Common choices:
   *   - table.get(71)  Light Bluish Grey  (LDraw viewer default)
   *   - table.get(15)  White
   *   - table.get(4)   Red
   *
   * Defaults to Light Bluish Grey (code 71) if omitted.
   */
  defaultColor?: LDrawColor;
}

// ── Resolver context ──────────────────────────────────────────

export interface ResolverContext {
  colorTable: Map<number, LDrawColor>;
  resolveFile: (name: string) => Promise<string | null | undefined>;
  processBFC: boolean;
  maxDepth: number;
  /** Cache: resolved name → parsed LDrawFile */
  cache: Map<string, LDrawFile>;
  /**
   * Top-level default color for code 16 when there is no parent.
   * Light Bluish Grey (71) by default.
   */
  defaultColor: LDrawColor;
}
