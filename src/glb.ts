// ============================================================
// LDraw Parser – GLB (binary glTF 2.0) generator
// No external dependencies – pure Buffer / Uint8Array
// ============================================================

import type {
  FlatGeometry,
  // GeometryMesh,
  LDrawColor,
} from "./types";

// ── glTF constants ────────────────────────────────────────────

const GLTF_MAGIC   = 0x46546c67; // "glTF"
const GLTF_VERSION = 2;
const CHUNK_JSON   = 0x4e4f534a; // "JSON"
const CHUNK_BIN    = 0x004e4942; // "BIN\0"

const COMPONENT_FLOAT = 5126;
const COMPONENT_UINT32 = 5125;
const COMPONENT_UINT16 = 5123;
const TARGET_ARRAY_BUFFER         = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT   = 5125;

// ── Material helpers ──────────────────────────────────────────

function colorToGltfMaterial(color: LDrawColor, index: number) {
  const [r, g, b, a] = color.rgba;

  const mat: Record<string, unknown> = {
    name: color.name,
    pbrMetallicRoughness: {
      baseColorFactor: [r, g, b, a],
      metallicFactor:  color.finish === "CHROME" || color.finish === "METAL" ? 1.0 : 0.0,
      roughnessFactor: color.finish === "CHROME" ? 0.05 :
                       color.finish === "METAL"  ? 0.2  :
                       color.finish === "PEARLESCENT" ? 0.3 : 0.8,
    },
    doubleSided: true,
  };

  if (color.isTransparent) {
    mat.alphaMode = a < 0.99 ? "BLEND" : "MASK";
    mat.alphaCutoff = 0.5;
  }

  if (color.luminance > 0) {
    mat.emissiveFactor = [r * color.luminance / 255, g * color.luminance / 255, b * color.luminance / 255];
  }

  return mat;
}

// ── Buffer helpers ────────────────────────────────────────────

function align4(n: number): number {
  return Math.ceil(n / 4) * 4;
}

function writeUint32LE(buf: Uint8Array, offset: number, value: number) {
  buf[offset]     = value & 0xff;
  buf[offset + 1] = (value >> 8)  & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const b of buffers) total += b.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.byteLength;
  }
  return out;
}

// ── GLB builder ───────────────────────────────────────────────

// interface GltfBuffer {
//   byteOffset: number;
//   byteLength: number;
//   data: Uint8Array;
// }

export interface GlbOptions {
  /** Include vertex normals (computed per-triangle, flat shading) (default true) */
  normals?: boolean;
  /** Include UV coordinates for textured meshes (default true) */
  uvs?: boolean;
  /** Model name for the scene (default "LDrawModel") */
  name?: string;
}

/**
 * Convert a FlatGeometry into a binary GLB buffer.
 * Returns a Uint8Array that can be written directly to disk.
 */
export function generateGlb(
  geometry: FlatGeometry,
  options: GlbOptions = {},
): Uint8Array {
  const includeNormals = options.normals ?? true;
  const includeUVs     = options.uvs     ?? true;
  const modelName      = options.name    ?? "LDrawModel";

  // ── Group meshes by color ──────────────────────────────────
  // We create one glTF primitive per GeometryMesh

  const materials: unknown[] = [];
  const colorIndexMap = new Map<number, number>();

  for (const mesh of geometry.meshes) {
    if (!colorIndexMap.has(mesh.colorCode)) {
      colorIndexMap.set(mesh.colorCode, materials.length);
      const color = geometry.colorTable?.get(mesh.colorCode);
      materials.push(colorToGltfMaterial(color!, materials.length));
    }
  }

  // ── Binary buffer construction ─────────────────────────────

  const binaryChunks: Uint8Array[] = [];
  let binaryOffset = 0;

  const accessors: unknown[] = [];
  const bufferViews: unknown[] = [];

  function addBufferView(
    data: Uint8Array,
    target: number,
  ): number {
    const idx = bufferViews.length;
    const paddedLength = align4(data.byteLength);
    const paddedData = new Uint8Array(paddedLength);
    paddedData.set(data);

    bufferViews.push({
      buffer:     0,
      byteOffset: binaryOffset,
      byteLength: data.byteLength,
      target,
    });

    binaryChunks.push(paddedData);
    binaryOffset += paddedLength;
    return idx;
  }

  function addFloat32Accessor(
    data: Float32Array,
    type: string,
    min?: number[],
    max?: number[],
  ): number {
    const bvIdx = addBufferView(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      TARGET_ARRAY_BUFFER,
    );
    const idx = accessors.length;
    const acc: Record<string, unknown> = {
      bufferView:    bvIdx,
      componentType: COMPONENT_FLOAT,
      count:         data.length / (type === "VEC3" ? 3 : type === "VEC2" ? 2 : 1),
      type,
    };
    if (min) acc.min = min;
    if (max) acc.max = max;
    accessors.push(acc);
    return idx;
  }

  function addIndexAccessor(
    data: Uint16Array | Uint32Array,
    useUint32: boolean,
  ): number {
    const bvIdx = addBufferView(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      TARGET_ELEMENT_ARRAY_BUFFER,
    );
    const idx = accessors.length;
    accessors.push({
      bufferView:    bvIdx,
      componentType: useUint32 ? COMPONENT_UINT32 : COMPONENT_UINT16,
      count:         data.length,
      type:          "SCALAR",
    });
    return idx;
  }

  // ── Build primitives ───────────────────────────────────────

  const primitives: unknown[] = [];

  for (const mesh of geometry.meshes) {
    if (mesh.triangles.length === 0) continue;

    const vertexCount = mesh.triangles.length * 3;
    const positions   = new Float32Array(vertexCount * 3);
    const normals     = includeNormals ? new Float32Array(vertexCount * 3) : null;
    const uvs_buf     = includeUVs && mesh.triangles[0]?.a.uv ? new Float32Array(vertexCount * 2) : null;

    let vi = 0;
    let ni = 0;
    let ui = 0;

    for (const tri of mesh.triangles) {
      const verts = [tri.a, tri.b, tri.c];

      // Flat normal for this triangle
      let nx = 0, ny = 0, nz = 0;
      if (normals) {
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
        nx = ab.y * ac.z - ab.z * ac.y;
        ny = ab.z * ac.x - ab.x * ac.z;
        nz = ab.x * ac.y - ab.y * ac.x;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
      }

      for (const vert of verts) {
        // LDraw Y-down → glTF Y-up: negate Y and Z
        positions[vi++] = vert.position.x / 25.4;  // LDU → mm; /25.4 → inches
        positions[vi++] = -vert.position.y / 25.4;
        positions[vi++] = -vert.position.z / 25.4;

        if (normals) {
          normals[ni++] = nx;
          normals[ni++] = -ny;
          normals[ni++] = -nz;
        }

        if (uvs_buf && vert.uv) {
          uvs_buf[ui++] = vert.uv.u;
          uvs_buf[ui++] = vert.uv.v;
        } else if (uvs_buf) {
          uvs_buf[ui++] = 0;
          uvs_buf[ui++] = 0;
        }
      }
    }

    // Bounding box for positions accessor
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i] ?? 0;
      const py = positions[i + 1] ?? 0;
      const pz = positions[i + 2] ?? 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (pz < minZ) minZ = pz;
      if (pz > maxZ) maxZ = pz;
    }

    const posAccessor = addFloat32Accessor(
      positions, "VEC3",
      [minX, minY, minZ], [maxX, maxY, maxZ],
    );

    // Sequential indices (non-indexed geometry; keeps it simple)
    const useUint32 = vertexCount > 65535;
    const indices = useUint32
      ? new Uint32Array(vertexCount)
      : new Uint16Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) indices[i] = i;
    const idxAccessor = addIndexAccessor(indices, useUint32);

    const attributes: Record<string, number> = { POSITION: posAccessor };

    if (normals) {
      const normAccessor = addFloat32Accessor(normals, "VEC3");
      attributes.NORMAL = normAccessor;
    }

    if (uvs_buf) {
      const uvAccessor = addFloat32Accessor(uvs_buf, "VEC2");
      attributes.TEXCOORD_0 = uvAccessor;
    }

    const color = geometry.colorTable?.get(mesh.colorCode);
    const materialIdx = colorIndexMap.get(mesh.colorCode) ?? 0;

    primitives.push({
      attributes,
      indices:  idxAccessor,
      material: materialIdx,
      mode:     TRIANGLES,
    });
  }

  // ── glTF JSON ──────────────────────────────────────────────

  const binaryData = concatBuffers(binaryChunks);

  const gltf = {
    asset:    { version: "2.0", generator: "ldraw-parser" },
    scene:    0,
    scenes:   [{ name: modelName, nodes: [0] }],
    nodes:    [{ mesh: 0, name: modelName }],
    meshes:   [{ name: modelName, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers:  [{ byteLength: binaryData.byteLength }],
  };

  const jsonString  = JSON.stringify(gltf);
  const jsonBytes   = new TextEncoder().encode(jsonString);
  const jsonPadded  = align4(jsonBytes.byteLength);
  const jsonChunk   = new Uint8Array(jsonPadded);
  // JSON chunk padding is spaces (0x20)
  jsonChunk.fill(0x20);
  jsonChunk.set(jsonBytes);

  const binPadded = align4(binaryData.byteLength);
  const binChunk  = new Uint8Array(binPadded);
  binChunk.set(binaryData);

  // Header: 12 bytes
  // JSON chunk header: 8 bytes
  // JSON chunk data: jsonPadded bytes
  // BIN chunk header: 8 bytes
  // BIN chunk data: binPadded bytes
  const totalLength = 12 + 8 + jsonPadded + (binaryData.byteLength > 0 ? 8 + binPadded : 0);
  const glb = new Uint8Array(totalLength);

  const view = new DataView(glb.buffer);
  view.setUint32(0,  GLTF_MAGIC,   true);
  view.setUint32(4,  GLTF_VERSION, true);
  view.setUint32(8,  totalLength,  true);

  // JSON chunk header
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, CHUNK_JSON,  true);
  glb.set(jsonChunk, 20);

  if (binaryData.byteLength > 0) {
    const binOffset = 20 + jsonPadded;
    view.setUint32(binOffset,     binPadded, true);
    view.setUint32(binOffset + 4, CHUNK_BIN, true);
    glb.set(binChunk, binOffset + 8);
  }

  return glb;
}
