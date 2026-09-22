// ============================================================
// GLB Analyser — Parse and analyze GLB (glTF Binary) files
// ============================================================

// ── Types ──────────────────────────────────────────────────────

export interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: [number, number, number, number];
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: { index: number };
  };
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  doubleSided?: boolean;
  emissiveFactor?: [number, number, number];
  extensions?: Record<string, any>;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  max?: number[];
  min?: number[];
}

export interface GltfMeshPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfMesh {
  name?: string;
  primitives: GltfMeshPrimitive[];
}

export interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfScene {
  name?: string;
  nodes: number[];
}

export interface GltfTexture {
  name?: string;
  source?: number;
  sampler?: number;
}

export interface GltfImage {
  name?: string;
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

export interface GltfAnimationChannel {
  sampler: number;
  target: {
    node?: number;
    property: string;
  };
}

export interface GltfAnimation {
  name?: string;
  channels: GltfAnimationChannel[];
  samplers: any[];
}

export interface GltfAsset {
  generator?: string;
  version: string;
  copyright?: string;
  minVersion?: string;
}

export interface GltfPayload {
  asset: GltfAsset;
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  accessors?: GltfAccessor[];
  bufferViews?: any[];
  buffers?: any[];
  materials?: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
  animations?: GltfAnimation[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
}

export interface AnalyserOptions {
  verbose?: boolean;
  json?: boolean;
}

export interface MeshDetail {
  index: number;
  name?: string;
  triangleCount: number;
  vertexCount: number;
  primitiveCount: number;
  materialIndex?: number;
  materialName?: string;
  hasNormals: boolean;
  hasUVs: boolean;
  hasIndices: boolean;
  bounds: { min: number[]; max: number[]; size: number[] };
}

export interface MaterialInfo {
  index: number;
  name?: string;
  baseColor: string;
  alphaMode: string;
  metallicFactor: number;
  roughnessFactor: number;
  hasTexture: boolean;
  textureType?: string;
  hasTransmission: boolean;
  hasEmissive: boolean;
}

export interface AnimationInfo {
  index: number;
  name?: string;
  channelCount: number;
  samplerCount: number;
  targets: Array<{ nodeName?: string; property: string }>;
}

export interface GlbAnalysisResult {
  valid: boolean;
  error?: string;
  header: {
    magic: number;
    version: number;
    length: number;
    fileSize: number;
  };
  chunks: Array<{ length: number; type: number; typeString: string }>;
  payload: GltfPayload;
  fileBytes: number;
  jsonBytes: number;
  binaryBytes: number;
  asset: GltfAsset;
  stats: {
    sceneCount: number;
    nodeCount: number;
    meshCount: number;
    materialCount: number;
    textureCount: number;
    imageCount: number;
    animationCount: number;
    totalTriangles: number;
    totalVertices: number;
    totalPrimitives: number;
    extensionsUsed: string[];
    extensionsRequired: string[];
  };
  meshes: MeshDetail[];
  materials: MaterialInfo[];
  animations: AnimationInfo[];
  warnings: string[];
}

// ── Constants ──────────────────────────────────────────────────

const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON" (little-endian)
const CHUNK_TYPE_BIN = 0x004e4942;   // "BIN\0"

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const ACCESSOR_COMPONENTS: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4,
  MAT2: 4, MAT3: 9, MAT4: 16,
};

// ── Helpers ────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function hexColor(r: number, g: number, b: number, a = 1): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  if (a < 1) return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}`;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function computeAABB(
  positions: Float32Array,
  count: number,
): { min: number[]; max: number[]; size: number[] } {
  if (count === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count * 3; i += 3) {
    const x = positions[i]!;
    const y = positions[i + 1]!;
    const z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

// ── Main Analyser ─────────────────────────────────────────────

export function analyseGlb(buffer: Uint8Array, _options?: AnalyserOptions): GlbAnalysisResult {
  const warnings: string[] = [];
  const dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // ── Header ──────────────────────────────────────────────
  if (buffer.byteLength < 12) {
    return makeInvalidResult(`Buffer too short for GLB header (${buffer.byteLength} bytes)`);
  }

  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return makeInvalidResult(`Not a valid GLB file (magic: 0x${magic.toString(16)}, expected 0x${GLB_MAGIC.toString(16)})`);
  }

  const version = dv.getUint32(4, true);
  const length = dv.getUint32(8, true);

  if (version !== GLB_VERSION) {
    warnings.push(`GLB version ${version} detected (expected ${GLB_VERSION})`);
  }
  if (length !== buffer.byteLength) {
    warnings.push(`Header length (${length}) does not match actual file size (${buffer.byteLength})`);
  }

  // ── Chunks ──────────────────────────────────────────────
  const chunks: Array<{ length: number; type: number; typeString: string }> = [];
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const typeString = chunkType === CHUNK_TYPE_JSON ? "JSON" : chunkType === CHUNK_TYPE_BIN ? "BIN\0" : `0x${chunkType.toString(16).padStart(8, "0")}`;
    chunks.push({ length: chunkLength, type: chunkType, typeString });

    offset += 8 + chunkLength;
  }

  if (chunks.length === 0) {
    warnings.push("No chunks found in GLB file");
  }

  // ── Parse JSON chunk ────────────────────────────────────
  const jsonChunk = chunks.find(c => c.type === CHUNK_TYPE_JSON);
  const binChunk = chunks.find(c => c.type === CHUNK_TYPE_BIN);
  const jsonBytes = jsonChunk?.length ?? 0;
  const binaryBytes = binChunk?.length ?? 0;

  let payload: GltfPayload = {
    asset: { version: "0.0", generator: "unknown" },
    scenes: [], nodes: [], meshes: [], accessors: [],
    bufferViews: [], buffers: [], materials: [],
    textures: [], images: [], animations: [],
  };

  if (jsonChunk) {
    // Find where JSON chunk data starts in buffer
    // Each chunk has 8 bytes header (length + type), then data
    let jsonOffset = 12; // Start of first chunk
    for (const ch of chunks) {
      jsonOffset += 8; // Skip chunk header
      if (ch.type === CHUNK_TYPE_JSON) break;
      jsonOffset += ch.length; // Skip chunk data
    }
    try {
      const rawBytes = buffer.slice(jsonOffset, jsonOffset + jsonChunk.length);
      // GLB padding: trim leading/trailing null/space bytes to get valid JSON
      let start = 0;
      while (start < rawBytes.length && (rawBytes[start] === 0x20 || rawBytes[start] === 0x00)) start++;
      let end = rawBytes.length;
      while (end > start && (rawBytes[end - 1] === 0x20 || rawBytes[end - 1] === 0x00)) end--;
      const jsonStr = new TextDecoder().decode(rawBytes.slice(start, end));
      payload = JSON.parse(jsonStr) as GltfPayload;
    } catch (err) {
      warnings.push(`Failed to parse JSON chunk: ${(err as Error).message}`);
    }
  }

  // ── Read accessor data from buffer ──────────────────────
  function getJsonChunkOffset(): number {
    let off = 12; // Start of first chunk
    for (const ch of chunks) {
      off += 8; // Skip chunk header
      if (ch.type === CHUNK_TYPE_JSON) return off;
      off += ch.length; // Skip chunk data
    }
    return 20;
  }

  function readAccessorData(accessorIdx: number): Float32Array | null {
    const acc = payload.accessors?.[accessorIdx];
    const bvs = payload.bufferViews;
    if (!acc || acc.bufferView == null || !bvs) return null;
    const bv = bvs[acc.bufferView];
    if (!bv) return null;

    const bytesPerComponent = COMPONENT_BYTES[acc.componentType] ?? 4;
    const componentsNeeded = ACCESSOR_COMPONENTS[acc.type] ?? 1;
    const totalBytes = acc.count * componentsNeeded * bytesPerComponent;
    const jsonOff = getJsonChunkOffset();
    const binStart = jsonOff + jsonChunk!.length;
    const start = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);

    if (acc.componentType === 5126) {
      return new Float32Array(buffer.slice(start, start + totalBytes).buffer);
    }

    // For integer types, convert to float
    const raw = buffer.slice(start, start + totalBytes);
    const floatData = new Float32Array(acc.count * componentsNeeded);
    if (bytesPerComponent === 1) {
      for (let i = 0; i < acc.count * componentsNeeded; i++) {
        const v = raw[i] ?? 0;
        floatData[i] = acc.componentType === 5121 ? v / 255 : v;
      }
    }
    return floatData;
  }

  // ── Compute stats ───────────────────────────────────────
  const asset = payload.asset ?? { version: "0.0" };
  const scenes = payload.scenes ?? [];
  const nodes = payload.nodes ?? [];
  const meshes = payload.meshes ?? [];
  const materials = payload.materials ?? [];
  const textures = payload.textures ?? [];
  const images = payload.images ?? [];
  const animations = payload.animations ?? [];

  let totalTriangles = 0;
  let totalVertices = 0;
  let totalPrimitives = 0;

  // ── Analyse meshes ──────────────────────────────────────
  const meshDetails: MeshDetail[] = [];

  for (let mi = 0; mi < meshes.length; mi++) {
    const mesh = meshes[mi]!;
    let triCount = 0;
    let vertCount = 0;
    let primCount = 0;
    let matIdx: number | undefined;
    let matName: string | undefined;
    let hasNormals = false;
    let hasUVs = false;
    let hasIndices = false;
    let allMin: number[] = [Infinity, Infinity, Infinity];
    let allMax: number[] = [-Infinity, -Infinity, -Infinity];

    for (const prim of mesh.primitives) {
      primCount++;
      if (prim.material != null) {
        matIdx = prim.material;
        matName = materials[prim.material]?.name;
      }
      if (prim.indices != null) hasIndices = true;
      if (prim.attributes["NORMAL"] != null) hasNormals = true;
      if (prim.attributes["TEXCOORD_0"] != null) hasUVs = true;

      const posAccIdx = prim.attributes["POSITION"];
      const acc = posAccIdx != null ? payload.accessors?.[posAccIdx] : undefined;
      if (acc) {
        vertCount += acc.count;

        const posData = readAccessorData(posAccIdx!);
        if (posData) {
          const aabb = computeAABB(posData, acc.count);
          const mn = aabb.min;
          const mx = aabb.max;
          for (let d = 0; d < 3; d++) {
            if (mn[d]! < allMin[d]!) allMin[d] = mn[d]!;
            if (mx[d]! > allMax[d]!) allMax[d] = mx[d]!;
          }
        }
      }

      // Count triangles based on mode and indices
      const mode = prim.mode ?? 4; // Default: TRIANGLES
      if (prim.indices != null && payload.accessors?.[prim.indices]) {
        const idxAcc = payload.accessors[prim.indices]!;
        triCount += idxAcc.count / 3;
      } else if (acc) {
        if (mode === 4) { // TRIANGLES
          triCount += acc.count / 3;
        } else if (mode === 5 || mode === 6) { // TRIANGLE_STRIP / TRIANGLE_FAN
          triCount += Math.max(0, acc.count - 2);
        } else if (mode === 1) { // LINES
          triCount += Math.floor(acc.count / 2);
        }
      }
    }

    totalTriangles += triCount;
    totalVertices += vertCount;
    totalPrimitives += primCount;

    const aabb = computeAABB(
      new Float32Array([
        allMin[0]!, allMin[1]!, allMin[2]!,
        allMax[0]!, allMax[1]!, allMax[2]!,
      ]),
      2,
    );

    meshDetails.push({
      index: mi,
      name: mesh.name,
      triangleCount: triCount,
      vertexCount: vertCount,
      primitiveCount: primCount,
      materialIndex: matIdx,
      materialName: matName,
      hasNormals,
      hasUVs,
      hasIndices,
      bounds: aabb,
    });
  }

  // ── Analyse materials ───────────────────────────────────
  const materialInfos: MaterialInfo[] = [];
  for (let mi = 0; mi < materials.length; mi++) {
    const mat = materials[mi]!;
    const pbr = mat.pbrMetallicRoughness;
    const bc = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    materialInfos.push({
      index: mi,
      name: mat.name,
      baseColor: hexColor(bc[0], bc[1], bc[2], bc[3]),
      alphaMode: mat.alphaMode ?? "OPAQUE",
      metallicFactor: pbr?.metallicFactor ?? 0,
      roughnessFactor: pbr?.roughnessFactor ?? 1,
      hasTexture: pbr?.baseColorTexture != null,
      textureType: pbr?.baseColorTexture != null ? "baseColor" : undefined,
      hasTransmission: mat.extensions?.["KHR_materials_transmission"] != null,
      hasEmissive: mat.emissiveFactor != null,
    });
  }

  // ── Analyse animations ──────────────────────────────────
  const animationInfos: AnimationInfo[] = [];
  for (let ai = 0; ai < animations.length; ai++) {
    const anim = animations[ai]!;
    const targets: Array<{ nodeName?: string; property: string }> = [];
    for (const ch of anim.channels) {
      const nodeName = ch.target.node != null ? nodes[ch.target.node]?.name : undefined;
      targets.push({ nodeName, property: ch.target.property });
    }
    animationInfos.push({
      index: ai,
      name: anim.name,
      channelCount: anim.channels.length,
      samplerCount: anim.samplers?.length ?? 0,
      targets,
    });
  }

  // ── Warnings ────────────────────────────────────────────
  for (const md of meshDetails) {
    const name = md.name ?? `mesh_${md.index}`;
    if (md.triangleCount > 100000) {
      warnings.push(`Mesh "${name}" has ${fmtNum(md.triangleCount)} triangles (>100k)`);
    }
    if (!md.hasNormals && md.triangleCount > 0) {
      warnings.push(`Mesh "${name}" has no normals`);
    }
    if (!md.hasUVs && md.hasIndices) {
      warnings.push(`Mesh "${name}" has indices but no UVs`);
    }
  }

  for (const mat of materialInfos) {
    const name = mat.name ?? `mat_${mat.index}`;
    if (mat.alphaMode === "BLEND" && mat.hasTransmission) {
      warnings.push(`Material "${name}" has both BLEND alpha and transmission`);
    }
  }

  const knownExtensions = new Set([
    "KHR_materials_pbrSpecularGlossiness", "KHR_materials_unlit",
    "KHR_materials_transmission", "KHR_materials_emissive_strength",
    "KHR_materials_ior", "KHR_materials_specular",
    "KHR_texture_basisu", "KHR_texture_transform",
    "KHR_draco_mesh_compression", "EXT_mesh_glb", "EXT_meshopt_compression",
  ]);
  for (const ext of payload.extensionsUsed ?? []) {
    if (!knownExtensions.has(ext)) {
      warnings.push(`Unknown extension used: ${ext}`);
    }
  }

  // ── Result ──────────────────────────────────────────────
  return {
    valid: true,
    header: { magic, version, length, fileSize: buffer.byteLength },
    chunks,
    payload,
    fileBytes: buffer.byteLength,
    jsonBytes,
    binaryBytes,
    asset,
    stats: {
      sceneCount: scenes.length,
      nodeCount: nodes.length,
      meshCount: meshes.length,
      materialCount: materials.length,
      textureCount: textures.length,
      imageCount: images.length,
      animationCount: animations.length,
      totalTriangles,
      totalVertices,
      totalPrimitives,
      extensionsUsed: payload.extensionsUsed ?? [],
      extensionsRequired: payload.extensionsRequired ?? [],
    },
    meshes: meshDetails,
    materials: materialInfos,
    animations: animationInfos,
    warnings,
  };
}

function makeInvalidResult(error: string): GlbAnalysisResult {
  const emptyPayload: GltfPayload = {
    asset: { version: "0.0", generator: "unknown" },
    scenes: [], nodes: [], meshes: [], accessors: [],
    bufferViews: [], buffers: [], materials: [],
    textures: [], images: [], animations: [],
  };
  return {
    valid: false,
    error,
    header: { magic: 0, version: 0, length: 0, fileSize: 0 },
    chunks: [],
    payload: emptyPayload,
    fileBytes: 0,
    jsonBytes: 0,
    binaryBytes: 0,
    asset: { version: "0.0" },
    stats: {
      sceneCount: 0, nodeCount: 0, meshCount: 0, materialCount: 0,
      textureCount: 0, imageCount: 0, animationCount: 0,
      totalTriangles: 0, totalVertices: 0, totalPrimitives: 0,
      extensionsUsed: [], extensionsRequired: [],
    },
    meshes: [],
    materials: [],
    animations: [],
    warnings: [],
  };
}

// ── Pretty-print analysis result ────────────────────────────

export function formatAnalysis(result: GlbAnalysisResult, _options: AnalyserOptions = {}): string {
  const lines: string[] = [];

  if (!result.valid) {
    return `Error: ${result.error}`;
  }

  lines.push("═══════════════════════════════════════════");
  lines.push("  GLB Analysis Report");
  lines.push("═══════════════════════════════════════════");
  lines.push("");

  lines.push("── File ──────────────────────────────────");
  lines.push(`  Version  : ${result.header.version}`);
  lines.push(`  Size     : ${fmtBytes(result.fileBytes)} (${result.fileBytes} bytes)`);
  lines.push(`  JSON     : ${fmtBytes(result.jsonBytes)} (${result.jsonBytes} bytes)`);
  lines.push(`  Binary   : ${fmtBytes(result.binaryBytes)} (${result.binaryBytes} bytes)`);
  lines.push(`  Chunks   : ${result.chunks.length}`);
  lines.push(`  Asset    : ${result.asset.generator ?? "unknown"} | ${result.asset.version}`);
  if (result.asset.copyright) lines.push(`  Copyright: ${result.asset.copyright}`);
  lines.push("");

  lines.push("── Global Statistics ─────────────────────");
  lines.push(`  Scenes      : ${fmtNum(result.stats.sceneCount)}`);
  lines.push(`  Nodes       : ${fmtNum(result.stats.nodeCount)}`);
  lines.push(`  Meshes      : ${fmtNum(result.stats.meshCount)}`);
  lines.push(`  Materials   : ${fmtNum(result.stats.materialCount)}`);
  lines.push(`  Textures    : ${fmtNum(result.stats.textureCount)}`);
  lines.push(`  Images      : ${fmtNum(result.stats.imageCount)}`);
  lines.push(`  Animations  : ${fmtNum(result.stats.animationCount)}`);
  lines.push(`  Triangles   : ${fmtNum(result.stats.totalTriangles)}`);
  lines.push(`  Vertices    : ${fmtNum(result.stats.totalVertices)}`);
  lines.push(`  Primitives  : ${fmtNum(result.stats.totalPrimitives)}`);
  if (result.stats.extensionsUsed.length > 0) {
    lines.push(`  Extensions  : ${result.stats.extensionsUsed.join(", ")}`);
  }
  lines.push("");

  if (result.meshes.length > 0) {
    lines.push("── Meshes ────────────────────────────────");
    for (const m of result.meshes) {
      lines.push(`  [${m.index}] ${m.name ?? "(unnamed)"}`);
      lines.push(`    Primitives: ${m.primitiveCount} | Triangles: ${fmtNum(m.triangleCount)} | Vertices: ${fmtNum(m.vertexCount)}`);
      if (m.materialName) lines.push(`    Material  : ${m.materialName} (${m.materialIndex})`);
      if (!m.hasNormals) lines.push(`    ⚠ No normals`);
      if (!m.hasUVs) lines.push(`    ⚠ No UVs`);
      lines.push(`    Bounds    : ${m.bounds.size[0]!.toFixed(2)} × ${m.bounds.size[1]!.toFixed(2)} × ${m.bounds.size[2]!.toFixed(2)}`);
    }
    lines.push("");
  }

  if (result.materials.length > 0) {
    lines.push("── Materials ─────────────────────────────");
    for (const m of result.materials) {
      lines.push(`  [${m.index}] ${m.name ?? "(unnamed)"}`);
      lines.push(`    Color   : ${m.baseColor}`);
      lines.push(`    Alpha   : ${m.alphaMode}`);
      lines.push(`    Metal   : ${m.metallicFactor.toFixed(2)} | Rough: ${m.roughnessFactor.toFixed(2)}`);
      if (m.hasTexture) lines.push(`    Texture : ${m.textureType}`);
      if (m.hasTransmission) lines.push(`    Transmission: yes`);
      if (m.hasEmissive) lines.push(`    Emissive: yes`);
    }
    lines.push("");
  }

  if (result.animations.length > 0) {
    lines.push("── Animations ────────────────────────────");
    for (const a of result.animations) {
      lines.push(`  [${a.index}] ${a.name ?? "(unnamed)"}`);
      lines.push(`    Channels: ${a.channelCount} | Samplers: ${a.samplerCount}`);
      for (const t of a.targets) {
        lines.push(`    → ${t.property}${t.nodeName ? ` (node: ${t.nodeName})` : ""}`);
      }
    }
    lines.push("");
  }

  if (result.warnings.length > 0) {
    lines.push("── Warnings ──────────────────────────────");
    for (const w of result.warnings) {
      lines.push(`  ⚠ ${w}`);
    }
    lines.push("");
  }

  lines.push("═══════════════════════════════════════════");
  return lines.join("\n");
}

// ── JSON output ───────────────────────────────────────────────

export function analysisToJson(result: GlbAnalysisResult): string {
  const json = {
    valid: result.valid,
    error: result.error,
    header: result.header,
    chunks: result.chunks,
    fileBytes: result.fileBytes,
    jsonBytes: result.jsonBytes,
    binaryBytes: result.binaryBytes,
    asset: result.asset,
    stats: result.stats,
    meshes: result.meshes,
    materials: result.materials,
    animations: result.animations,
    warnings: result.warnings,
  };
  return JSON.stringify(json, null, 2);
}
