// ============================================================
// LDraw Parser – OBJ / MTL exporter
// ============================================================
//
// Generates Wavefront OBJ + MTL pairs from a FlatGeometry.
// No external dependencies.
// ============================================================

import type { FlatGeometry, LDrawColor } from "./types";
import type { SmoothGeometry } from "./normals";
import { computeSmoothNormals } from "./normals";
import { transformGeometry, lduToUnitScale, type LengthUnit } from "./postprocess";

// ── Options ───────────────────────────────────────────────────

export interface ObjExportOptions {
  /** Base name used for the MTL filename (default: "model") */
  name?: string;
  /** Output unit (default: "m") */
  unit?: LengthUnit;
  /** Include normals (default: true) */
  normals?: boolean;
  /** Include UV coordinates for textured meshes (default: true) */
  uvs?: boolean;
  /** Smooth normals crease angle in degrees (default: 45) */
  creaseAngle?: number;
  /** Include edge geometry as OBJ lines (default: false) */
  edges?: boolean;
}

// ── MTL material builder ──────────────────────────────────────

function colorToMtl(color: LDrawColor): string {
  const [r, g, b, a] = color.rgba;
  const lines: string[] = [];

  lines.push(`newmtl ${sanitizeName(color.name)}_${color.code}`);
  lines.push(`Kd ${r!.toFixed(6)} ${g!.toFixed(6)} ${b!.toFixed(6)}`);
  lines.push(`Ka 0.100000 0.100000 0.100000`);

  // Specular based on finish
  switch (color.finish) {
    case "CHROME":
      lines.push("Ks 0.900000 0.900000 0.900000");
      lines.push("Ns 500.000000");
      break;
    case "METAL":
      lines.push("Ks 0.700000 0.700000 0.700000");
      lines.push("Ns 250.000000");
      break;
    case "PEARLESCENT":
      lines.push("Ks 0.400000 0.400000 0.400000");
      lines.push("Ns 80.000000");
      break;
    case "RUBBER":
      lines.push("Ks 0.010000 0.010000 0.010000");
      lines.push("Ns 5.000000");
      break;
    default:
      lines.push("Ks 0.050000 0.050000 0.050000");
      lines.push("Ns 20.000000");
  }

  // Transparency
  if (color.isTransparent) {
    const alpha = a ?? 1;
    lines.push(`d ${alpha.toFixed(6)}`);
    lines.push("illum 9"); // ray-trace glass
  } else {
    lines.push("d 1.000000");
    lines.push("illum 2");
  }

  // Emissive for luminous parts
  if (color.luminance > 0) {
    const e = (color.luminance / 255).toFixed(6);
    lines.push(`Ke ${parseFloat(e) * r!} ${parseFloat(e) * g!} ${parseFloat(e) * b!}`);
  }

  // Texture map (TEXMAP)
  lines.push("");
  return lines.join("\n");
}

// ── Sanitize names ────────────────────────────────────────────

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

// ── Main exporter ─────────────────────────────────────────────

export interface ObjExportResult {
  /** Content of the .obj file */
  obj: string;
  /** Content of the .mtl file */
  mtl: string;
  /** MTL filename (reference included in the .obj header) */
  mtlFileName: string;
}

/**
 * Export a FlatGeometry to OBJ + MTL strings.
 *
 * The OBJ uses 1-based indices and groups faces by material.
 * If `normals` is true, per-vertex smooth normals are computed.
 */
export function generateObj(
  geometry: FlatGeometry,
  options: ObjExportOptions = {},
): ObjExportResult {
  const name        = options.name        ?? "model";
  const unit        = options.unit        ?? "m";
  const incNormals  = options.normals     ?? true;
  const incUvs      = options.uvs         ?? true;
  const creaseAngle = (options.creaseAngle ?? 45) * (Math.PI / 180);
  const incEdges    = options.edges       ?? false;

  // Apply coordinate transform (LDU → target unit, Y-up)
  const scale       = lduToUnitScale(unit);
  const transformed = transformGeometry(geometry, scale, true);

  // Smooth normals
  let smooth: SmoothGeometry | null = null;
  if (incNormals) {
    smooth = computeSmoothNormals(transformed, creaseAngle);
  }

  // ── Collect unique positions, normals, UVs ───────────────

  const positions:   number[][] = []; // [x,y,z]
  const normals_:    number[][] = []; // [nx,ny,nz]
  const uvCoords:    number[][] = []; // [u,v]

  // Maps for deduplication
  const posMap = new Map<string, number>();  // "x,y,z" → 1-based index
  const normMap = new Map<string, number>(); // "nx,ny,nz" → 1-based index
  const uvMap  = new Map<string, number>(); // "u,v" → 1-based index

  function addPos(x: number, y: number, z: number): number {
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    let idx = posMap.get(key);
    if (idx === undefined) {
      positions.push([x, y, z]);
      idx = positions.length; // 1-based
      posMap.set(key, idx);
    }
    return idx;
  }

  function addNorm(nx: number, ny: number, nz: number): number {
    const key = `${nx.toFixed(5)},${ny.toFixed(5)},${nz.toFixed(5)}`;
    let idx = normMap.get(key);
    if (idx === undefined) {
      normals_.push([nx, ny, nz]);
      idx = normals_.length;
      normMap.set(key, idx);
    }
    return idx;
  }

  function addUv(u: number, v: number): number {
    const key = `${u.toFixed(6)},${v.toFixed(6)}`;
    let idx = uvMap.get(key);
    if (idx === undefined) {
      uvCoords.push([u, v]);
      idx = uvCoords.length;
      uvMap.set(key, idx);
    }
    return idx;
  }

  // ── Face data ────────────────────────────────────────────

  interface ObjFace {
    verts: Array<{ pi: number; ni?: number; ui?: number }>;
    materialName: string;
  }

  const faces: ObjFace[] = [];
  const usedColors = new Map<number, LDrawColor>();

  const meshes = smooth ? smooth.meshes : transformed.meshes;

  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi]!;
    // const flatMesh = transformed.meshes[mi]!;
    usedColors.set(mesh.colorCode, mesh.color);
    const matName = `${sanitizeName(mesh.color.name)}_${mesh.colorCode}`;

    for (const tri of mesh.triangles) {
      const verts: ObjFace["verts"] = [];
      const triVerts = [tri.a, tri.b, tri.c] as const;

      for (const v of triVerts) {
        const pi = addPos(v.position.x, v.position.y, v.position.z);
        const ni = incNormals && "normal" in v
          ? addNorm((v as typeof v & { normal: { x: number; y: number; z: number } }).normal.x,
                    (v as typeof v & { normal: { x: number; y: number; z: number } }).normal.y,
                    (v as typeof v & { normal: { x: number; y: number; z: number } }).normal.z)
          : undefined;
        const ui = incUvs && v.uv
          ? addUv(v.uv.u, v.uv.v)
          : undefined;
        verts.push({ pi, ni, ui });
      }

      faces.push({ verts, materialName: matName });
    }
  }

  // ── Edge lines ───────────────────────────────────────────

  interface ObjLine {
    pi1: number;
    pi2: number;
  }
  const lines_: ObjLine[] = [];

  if (incEdges) {
    for (const eg of transformed.edges) {
      for (const seg of eg.segments) {
        const pi1 = addPos(seg.start.x, seg.start.y, seg.start.z);
        const pi2 = addPos(seg.end.x,   seg.end.y,   seg.end.z);
        lines_.push({ pi1, pi2 });
      }
    }
  }

  // ── Assemble MTL ─────────────────────────────────────────

  const mtlFileName = `${name}.mtl`;
  const mtlParts: string[] = [
    `# Generated by ldraw-parser`,
    `# https://github.com/you/ldraw-parser`,
    ``,
  ];
  for (const color of usedColors.values()) {
    mtlParts.push(colorToMtl(color));
  }
  const mtl = mtlParts.join("\n");

  // ── Assemble OBJ ─────────────────────────────────────────

  const obj: string[] = [];
  obj.push(`# Generated by ldraw-parser`);
  obj.push(`# Unit: ${unit}`);
  obj.push(`mtllib ${mtlFileName}`);
  obj.push(`o ${sanitizeName(name)}`);
  obj.push(``);

  // Vertices
  for (const [x, y, z] of positions) {
    obj.push(`v ${x!.toFixed(6)} ${y!.toFixed(6)} ${z!.toFixed(6)}`);
  }
  obj.push(``);

  // Texture coordinates
  if (uvCoords.length > 0) {
    for (const [u, v] of uvCoords) {
      obj.push(`vt ${u!.toFixed(6)} ${v!.toFixed(6)}`);
    }
    obj.push(``);
  }

  // Normals
  if (normals_.length > 0) {
    for (const [nx, ny, nz] of normals_) {
      obj.push(`vn ${nx!.toFixed(6)} ${ny!.toFixed(6)} ${nz!.toFixed(6)}`);
    }
    obj.push(``);
  }

  // Faces grouped by material
  const facesByMat = new Map<string, ObjFace[]>();
  for (const face of faces) {
    const arr = facesByMat.get(face.materialName) ?? [];
    arr.push(face);
    facesByMat.set(face.materialName, arr);
  }

  for (const [matName, matFaces] of facesByMat) {
    obj.push(`usemtl ${matName}`);
    for (const face of matFaces) {
      const vertStr = face.verts.map((v) => {
        const parts: string[] = [String(v.pi)];
        if (v.ui !== undefined || v.ni !== undefined) {
          parts.push(v.ui !== undefined ? String(v.ui) : "");
        }
        if (v.ni !== undefined) {
          parts.push(String(v.ni));
        }
        return parts.join("/");
      });
      obj.push(`f ${vertStr.join(" ")}`);
    }
    obj.push(``);
  }

  // Edge lines
  if (lines_.length > 0) {
    obj.push(`# Edge lines`);
    for (const l of lines_) {
      obj.push(`l ${l.pi1} ${l.pi2}`);
    }
  }

  return {
    obj: obj.join("\n"),
    mtl,
    mtlFileName,
  };
}
