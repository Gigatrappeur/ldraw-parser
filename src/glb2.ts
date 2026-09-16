// ============================================================
// LDraw Parser – GLTF/GLB generator
//   • Indexed geometry (vertex welding)
//   • Smooth OR flat normals
//   • PNG/JPEG texture embedding (TEXMAP)
//   • Physically based materials per LDraw finish
//   • KHR_materials_transmission for transparent parts
// ============================================================

import type { FlatGeometry, GeometryMesh, LDrawColor } from "./types";
import {
  weldGeometry,
  mergeWeldedMeshes,
  type WeldOptions,
  type WeldedMesh,
} from "./weld";

// ── glTF constants ────────────────────────────────────────────

const GLTF_MAGIC   = 0x46546c67;
const GLTF_VERSION = 2;
const CHUNK_JSON   = 0x4e4f534a;
const CHUNK_BIN    = 0x004e4942;
const FLOAT        = 5126;
const UINT16       = 5123;
const UINT32       = 5125;
const ARRAY_BUF    = 34962;
const ELEMENT_BUF  = 34963;
const TRIANGLES    = 4;

// ── Options ───────────────────────────────────────────────────

export interface GlbOptionsV2 {
  /** Vertex welding options. Set to `false` to skip welding (flat normals). */
  weld?: WeldOptions | false;
  /** Include vertex normals (default: true) */
  normals?: boolean;
  /** Include UV coords (default: true) */
  uvs?: boolean;
  /** Scene name (default: "LDrawModel") */
  name?: string;
  /**
   * Async texture loader. Return PNG/JPEG bytes to embed, null to skip.
   * The name passed is exactly as written in the TEXMAP directive.
   */
  loadTexture?: (name: string) => Promise<Uint8Array | null | undefined>;
  /**
    * Use KHR_materials_transmission for transparent parts (default: false).
    * Produces glass-like refraction in Babylon.js, three.js, model-viewer, etc.
    */
  transmission?: boolean;
  /**
   * Flip Y axis (Y-up to Y-down conversion). Use when LDraw parts appear
   * upside-down in viewers that expect Y-down coordinates. (default: false)
   */
  flipY?: boolean;
}

// ── Utilities ─────────────────────────────────────────────────

function align4(n: number) { return Math.ceil(n / 4) * 4; }

function computeFlat(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const l  = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext === "jpg" || ext === "jpeg") ? "image/jpeg" : "image/png";
}

// ── Non-indexed → WeldedMesh adapter (flat normals path) ──────

function flatToWelded(mesh: GeometryMesh): WeldedMesh {
  const n   = mesh.triangles.length * 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const hasUV = n > 0 && mesh.triangles[0]?.a.uv !== undefined;
  const uvs = hasUV ? new Float32Array(n * 2) : null;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  let vi = 0, ui = 0;
  for (const tri of mesh.triangles) {
    const [nx, ny, nz] = computeFlat(
      tri.a.position.x, tri.a.position.y, tri.a.position.z,
      tri.b.position.x, tri.b.position.y, tri.b.position.z,
      tri.c.position.x, tri.c.position.y, tri.c.position.z,
    );
    for (const v of [tri.a, tri.b, tri.c] as const) {
      pos[vi * 3] = v.position.x; pos[vi * 3 + 1] = v.position.y; pos[vi * 3 + 2] = v.position.z;
      nor[vi * 3] = nx;           nor[vi * 3 + 1] = ny;           nor[vi * 3 + 2] = nz;
      if (uvs) { uvs[ui++] = v.uv?.u ?? 0; uvs[ui++] = v.uv?.v ?? 0; }
      idx[vi] = vi; vi++;
    }
  }
  return { colorCode: mesh.colorCode, positions: pos, normals: nor, uvs, indices: idx, texmapTexture: mesh.texmap?.texture, texmapKey: mesh.texmap ? texmapKeyString(mesh.texmap) : undefined };
}

function texmapKeyString(t: { projection: string; texture: string; point1: {x:number;y:number;z:number}; point2: {x:number;y:number;z:number}; point3: {x:number;y:number;z:number}; angle?: number; angle1?: number; angle2?: number }): string {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const p = (v: {x:number;y:number;z:number}) => `${r(v.x)},${r(v.y)},${r(v.z)}`;
  let k = `${t.projection}::${t.texture}::${p(t.point1)}::${p(t.point2)}::${p(t.point3)}`;
  if (t.angle    !== undefined) k += `::${t.angle}`;
  if (t.angle1 !== undefined) k += `::${t.angle1}::${t.angle2}`;
  return k;
}

// ── Material builder ──────────────────────────────────────────
interface MaterialType {
  name: string
  pbrMetallicRoughness: {
    baseColorFactor: number[]
    metallicFactor: number
    roughnessFactor: number
    baseColorTexture?: {
      index: number
    }
  }
  doubleSided: boolean
  emissiveFactor?: number[]
  extensions?: {
    KHR_materials_transmission?: {
      transmissionFactor: number
    }
  }
  alphaMode?: string
  alphaCutoff?: number
}
function buildMaterial(color: LDrawColor, textureIndex: number | null, opts: GlbOptionsV2): MaterialType {
  const r = color.rgba[0] ?? 0, g = color.rgba[1] ?? 0, b = color.rgba[2] ?? 0, a = color.rgba[3] ?? 1;
  const pbr: { baseColorFactor: number[]; metallicFactor: number; roughnessFactor: number; baseColorTexture?: { index: number } } = { baseColorFactor: [r, g, b, a], metallicFactor: 0, roughnessFactor: 0.8 };
  if (textureIndex !== null) pbr.baseColorTexture = { index: textureIndex };
  switch (color.finish) {
    case "CHROME":        pbr.metallicFactor = 1.0; pbr.roughnessFactor = 0.03; break;
    case "METAL":         pbr.metallicFactor = 1.0; pbr.roughnessFactor = 0.25; break;
    case "PEARLESCENT":   pbr.metallicFactor = 0.4; pbr.roughnessFactor = 0.30; break;
    case "RUBBER":        pbr.metallicFactor = 0.0; pbr.roughnessFactor = 0.95; break;
    case "MATTE_METALLIC":pbr.metallicFactor = 0.8; pbr.roughnessFactor = 0.60; break;
  }
  const mat: MaterialType = { name: 'LDRAW-' + color.code + '-' + color.name, pbrMetallicRoughness: pbr, doubleSided: true };
  if (color.luminance > 0) {
    const lf = color.luminance / 255;
    mat.emissiveFactor = [r * lf, g * lf, b * lf];
  }
  if (color.isTransparent) {
    if (opts.transmission) {
      mat.extensions = { KHR_materials_transmission: { transmissionFactor: 1 - a } };
    } else {
      mat.alphaMode = a < 0.99 ? "BLEND" : "MASK";
      mat.alphaCutoff = 0.5;
    }
  }
  return mat;
}

// ── Binary buffer manager ─────────────────────────────────────

interface Bin { chunks: Uint8Array[]; total: number; }
const newBin = (): Bin => ({ chunks: [], total: 0 });

function pushBin(bin: Bin, data: Uint8Array): number {
  const off = bin.total;
  const p = align4(data.byteLength);
  const c = new Uint8Array(p); c.set(data);
  bin.chunks.push(c); bin.total += p;
  return off;
}

function flatBin(bin: Bin): Uint8Array {
  const out = new Uint8Array(bin.total); let o = 0;
  for (const c of bin.chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}

// ── glTF state ────────────────────────────────────────────────

interface Ctx {
  bin: Bin;
  accessors: unknown[]; bufferViews: unknown[];
  materials: unknown[]; textures: unknown[];
  images: unknown[]; samplers: unknown[];
  primitives: unknown[]; exts: Set<string>;
}

function addBV(ctx: Ctx, data: Uint8Array, target: number): number {
  const byteOffset = pushBin(ctx.bin, data);
  const i = ctx.bufferViews.length;
  ctx.bufferViews.push({ buffer: 0, byteOffset, byteLength: data.byteLength, target });
  return i;
}

function addAcc(ctx: Ctx, bv: number, ct: number, count: number, type: string, min?: number[], max?: number[]): number {
  const i = ctx.accessors.length;
  const a: Record<string, unknown> = { bufferView: bv, componentType: ct, count, type };
  if (min) (a as Record<string, unknown>)["min"] = min; if (max) (a as Record<string, unknown>)["max"] = max;
  ctx.accessors.push(a); return i;
}

// ── glTF payload shared by GLB and GLTF ───────────────────────

export interface GltfPayload {
  json: Record<string, unknown>;
  binaryChunks: Uint8Array[];
  textures: Array<{ name: string; bytes: Uint8Array; mimeType: string }>;
}

/**
 * Build the full glTF payload: the JSON dictionary, the binary buffer chunks,
 * and any embedded texture bytes. Shared by both `exportGltf` (JSON text) and
 * `generateGlbV2` (binary container).
 */
export async function buildGltfPayload(
  geometry: FlatGeometry, opts: GlbOptionsV2 = {},
): Promise<GltfPayload> {
  const name    = opts.name    ?? "LDrawModel";
  const normals = opts.normals ?? true;
  const uvs     = opts.uvs     ?? true;
  const wOpts   = opts.weld !== false ? (opts.weld ?? {}) : null;

  const ctx: Ctx = {
    bin: newBin(), accessors: [], bufferViews: [],
    materials: [], textures: [], images: [], samplers: [],
    primitives: [], exts: new Set(),
  };

  // Weld or convert
  const welded: WeldedMesh[] = wOpts !== null
    ? mergeWeldedMeshes(weldGeometry(geometry.meshes, wOpts))
    : geometry.meshes.map(flatToWelded);

  // Flip Y axis if requested
  if (opts.flipY) {
    for (const m of welded) {
      for (let i = 1; i < m.positions.length; i += 3) {
        m.positions[i] = -m.positions[i]!;
      }
    }
  }

  // Load textures
  const texMap = new Map<string, number>();
  const textures: GltfPayload["textures"] = [];
  if (opts.loadTexture) {
    ctx.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
    const names = new Set(welded.map((m) => m.texmapTexture).filter((n): n is string => n !== undefined));
    for (const n of names) {
      const bytes = await opts.loadTexture(n);
      if (!bytes) continue;
      const bv = addBV(ctx, bytes, 0);
      ctx.images.push({ bufferView: bv, mimeType: guessMime(n) });
      ctx.textures.push({ sampler: 0, source: ctx.images.length - 1 });
      texMap.set(n, ctx.textures.length - 1);
      textures.push({ name: n, bytes, mimeType: guessMime(n) });
    }
  }

  // Build materials (one per colorCode)
  const colMatMap = new Map<number, number>();
  for (const mesh of geometry.meshes) {
    if (colMatMap.has(mesh.colorCode)) continue;
    const texIdx = mesh.texmap?.texture ? (texMap.get(mesh.texmap.texture) ?? null) : null;
    const color = geometry.colorTable?.get(mesh.colorCode);
    const mat = buildMaterial(color!, texIdx, opts);
    const ext = mat.extensions;
    if (ext) for (const k of Object.keys(ext)) ctx.exts.add(k);
    colMatMap.set(mesh.colorCode, ctx.materials.length);
    ctx.materials.push(mat);
  }

  // Build primitives
  for (const wm of welded) {
    if (wm.indices.length === 0) continue;
    const vc = wm.positions.length / 3;
    const u32 = wm.indices instanceof Uint32Array;

    // AABB
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < wm.positions.length; i += 3) {
      const x = wm.positions[i] ?? 0, y = wm.positions[i+1] ?? 0, z = wm.positions[i+2] ?? 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }

    const posBV  = addBV(ctx, new Uint8Array(wm.positions.buffer, wm.positions.byteOffset, wm.positions.byteLength), ARRAY_BUF);
    const posAcc = addAcc(ctx, posBV, FLOAT, vc, "VEC3", [x0,y0,z0], [x1,y1,z1]);
    const idxBV  = addBV(ctx, new Uint8Array(wm.indices.buffer, wm.indices.byteOffset, wm.indices.byteLength), ELEMENT_BUF);
    const idxAcc = addAcc(ctx, idxBV, u32 ? UINT32 : UINT16, wm.indices.length, "SCALAR");

    const attr: Record<string, number> = { POSITION: posAcc };
    if (normals) {
      const bv = addBV(ctx, new Uint8Array(wm.normals.buffer, wm.normals.byteOffset, wm.normals.byteLength), ARRAY_BUF);
      attr["NORMAL"] = addAcc(ctx, bv, FLOAT, vc, "VEC3");
    }
    if (uvs && wm.uvs) {
      const bv = addBV(ctx, new Uint8Array(wm.uvs.buffer, wm.uvs.byteOffset, wm.uvs.byteLength), ARRAY_BUF);
      attr["TEXCOORD_0"] = addAcc(ctx, bv, FLOAT, vc, "VEC2");
    }
    ctx.primitives.push({ attributes: attr, indices: idxAcc, material: colMatMap.get(wm.colorCode) ?? 0, mode: TRIANGLES });
  }

  // JSON chunk
  const binData = flatBin(ctx.bin);
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "ldraw-parser" },
    scene: 0,
    scenes: [{ name: 'SCENE', nodes: [0] }],
    nodes: [{ mesh: 0, name: 'LDRAW-' + name, userData: { ldrawCode: name} }],
    meshes: [{ name: 'mesh_' + name, primitives: ctx.primitives }],
    materials: ctx.materials, accessors: ctx.accessors, bufferViews: ctx.bufferViews,
    buffers: [{ byteLength: binData.byteLength }],
  };
  if (ctx.textures.length) gltf["textures"] = ctx.textures;
  if (ctx.images.length)   gltf["images"]   = ctx.images;
  if (ctx.samplers.length) gltf["samplers"] = ctx.samplers;
  if (ctx.exts.size)       gltf["extensionsUsed"] = [...ctx.exts];

  return { json: gltf, binaryChunks: ctx.bin.chunks, textures };
}

// ── Main function: binary GLB ─────────────────────────────────

/**
 * Generate a GLB file with indexed geometry and optional embedded textures.
 */
export async function generateGlbV2(geometry: FlatGeometry, opts: GlbOptionsV2 = {}): Promise<Uint8Array> {
  const { json, binaryChunks } = await buildGltfPayload(geometry, opts);
  const binData = flatBin({ chunks: binaryChunks, total: binaryChunks.reduce((s, c) => s + c.byteLength, 0) });
  const jb  = new TextEncoder().encode(JSON.stringify(json));
  const jp  = align4(jb.length);
  const jc  = new Uint8Array(jp);
  jc.fill(0x20);
  jc.set(jb);
  const bp  = align4(binData.byteLength);
  const bc  = new Uint8Array(bp);
  bc.set(binData);
  const has = binData.byteLength > 0;
  const tot = 12 + 8 + jp + (has ? 8 + bp : 0);
  const glb = new Uint8Array(tot);
  const dv  = new DataView(glb.buffer);
  dv.setUint32(0, GLTF_MAGIC, true);
  dv.setUint32(4, GLTF_VERSION, true);
  dv.setUint32(8, tot, true);
  dv.setUint32(12, jp, true);
  dv.setUint32(16, CHUNK_JSON, true);
  glb.set(jc, 20);
  if (has) {
    dv.setUint32(20+jp, bp, true);
    dv.setUint32(24+jp, CHUNK_BIN, true);
    glb.set(bc, 28+jp);
  }
  return glb;
}

// ── Main function: JSON GLTF ──────────────────────────────────

/**
 * Options for `exportGltf`.
 */
export interface GltfExportOptions {
  /**
   * Embed images as base64 `data:` URIs in the JSON (default: true).
   * Set to `false` to write the texture files to disk and reference them
   * as relative paths alongside the `.gltf` file.
   */
  inlineImages?: boolean;
}

/**
 * Export a `.gltf` file (plain JSON + optional external images).
 *
 * Returns an object with:
 *   - `gltf`: the JSON string to write as `name.gltf`
 *   - `images`: map of texture name → bytes (only when `inlineImages: false`)
 */
export async function exportGltf(
  geometry: FlatGeometry, opts: GlbOptionsV2 & GltfExportOptions = {},
): Promise<{ gltf: string; images: Map<string, Uint8Array> }> {
  const inline = opts.inlineImages !== false;
  const { json, textures } = await buildGltfPayload(geometry, opts);

  if (inline && textures.length > 0) {
    // Embed each texture as a base64 data URI in the glTF JSON
    const imagesArr = json["images"] as Record<string, unknown>[];
    const texturesArr = json["textures"] as Record<string, unknown>[] | undefined;
    for (let i = 0; i < imagesArr.length; i++) {
      const img = imagesArr[i]!;
      if (img["uri"]) continue; // already has a URI
      const tex = textures.find((t) => t.name === (img["source"] as string | undefined));
      if (!tex) continue;
      const b64 = Buffer.from(tex.bytes).toString("base64");
      img["uri"] = `data:${tex.mimeType};base64,${b64}`;
    }
    if (texturesArr) {
      // Adjust texture source indices to match renumbered images
      texturesArr.forEach((t) => {
        const src = t["source"] as number;
        if (typeof src === "number") t["source"] = src;
      });
    }
  } else if (!inline && textures.length > 0) {
    // Reference external image files by basename
    const imagesArr = json["images"] as Record<string, unknown>[];
    const texturesArr = json["textures"] as Record<string, unknown>[] | undefined;
    if (imagesArr) {
      const externalImages: Record<string, unknown>[] = [];
      const srcRemap = new Map<number, number>();
      let extIdx = 0;
      for (let i = 0; i < imagesArr.length; i++) {
        const img = imagesArr[i]!;
        if (img["bufferView"] !== undefined) {
          const tex = textures[extIdx];
          if (tex) {
            srcRemap.set(i, extIdx);
            externalImages.push({ uri: tex.name.split("/").pop()!, mimeType: tex.mimeType });
            extIdx++;
          }
        }
      }
      if (texturesArr) {
        for (const t of texturesArr) {
          const src = t["source"] as number;
          if (srcRemap.has(src)) t["source"] = srcRemap.get(src);
        }
      }
      json["images"] = externalImages;
    }
  }

  return { gltf: JSON.stringify(json, null, 2), images: new Map(textures.map((t) => [t.name, t.bytes])) };
}
