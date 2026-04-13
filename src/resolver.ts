// ============================================================
// LDraw Parser – Recursive file resolver + geometry flattener
// ============================================================

import {
  type LDrawFile,
  type LDrawSubFileRef,
  type LDrawColor,
  type Matrix4,
  type FlatGeometry,
  type GeometryMesh,
  type GeometryEdges,
  type GeometryVertex,
  type ResolverContext,
} from "./types";
import { parseLDrawFile } from "./parser";
import {
  multiplyMatrices,
  transformPoint,
  matrixDeterminant3,
  IDENTITY,
  normalizeFileName,
  aabbEmpty,
  aabbExpand,
  aabbFinalize,
  projectTexmap,
} from "./utils";
import {
  resolveColor,
  isMetaColorCode,
} from "./colors";

// ── Types ─────────────────────────────────────────────────────

interface MeshKey {
  colorCode: number;
  texmapTexture?: string;
}

function meshKey(k: MeshKey): string {
  return `${k.colorCode}::${k.texmapTexture ?? ""}`;
}

// ── Resolver ──────────────────────────────────────────────────

/**
 * Resolve a sub-file reference.
 * Returns the parsed LDrawFile (from cache if already seen).
 */
async function resolveSubFile(
  ref: LDrawSubFileRef,
  ctx: ResolverContext,
): Promise<LDrawFile | null> {
  const key = normalizeFileName(ref.file);
  if (ctx.cache.has(key)) return ctx.cache.get(key)!;

  const content = await ctx.resolveFile(ref.file);
  if (!content) return null;

  const file = parseLDrawFile(content, key);
  ctx.cache.set(key, file);

  // Register any embedded colours from the file into the table
  if (file.meta.colors) {
    for (const c of file.meta.colors) {
      if (!ctx.colorTable.has(c.code)) ctx.colorTable.set(c.code, c);
    }
  }

  return file;
}

// ── Flatten ───────────────────────────────────────────────────

/**
 * Recursively walk an LDrawFile and accumulate flat geometry.
 *
 * @param file         – file being processed
 * @param matrix       – accumulated world transform
 * @param parentColor  – inherited colour (for code 16)
 * @param invertWinding – accumulated BFC winding inversion
 * @param depth        – recursion depth guard
 * @param meshMap      – output mesh accumulator
 * @param edgeMap      – output edge accumulator
 * @param ctx          – resolver context
 */
async function flattenFile(
  file: LDrawFile,
  matrix: Matrix4,
  parentColor: LDrawColor | undefined,
  invertWinding: boolean,
  depth: number,
  meshMap: Map<string, GeometryMesh>,
  edgeMap: Map<string, GeometryEdges>,
  ctx: ResolverContext,
): Promise<void> {
  if (depth > ctx.maxDepth) return;

  // Local BFC winding inherits from file certification
  const fileWinding = file.meta.bfcWinding ?? "CCW";
  const det = matrixDeterminant3(matrix);
  const reflectionInvert = det < 0;

  // Effective inversion = parent invert XOR reflection XOR … accumulated later
  let localInvert = invertWinding !== reflectionInvert;

  for (const cmd of file.commands) {
    // ── Type 1 – sub-file reference ──────────────────────────
    if (cmd.type === 1) {
      const ref = cmd as LDrawSubFileRef;
      const childMatrix = multiplyMatrices(matrix, ref.transform);
      const childInvert = ref.inverted ? !localInvert : localInvert;

      // Resolve colour for child
      const refColor = isMetaColorCode(ref.colorCode)
        ? parentColor
        : resolveColor(ref.colorCode, ctx.colorTable, parentColor);

      // Try MPD embedded sub-files first
      const normalised = normalizeFileName(ref.file);
      let childFile = file.subFiles?.get(normalised) ?? null;

      // Then external resolver
      if (!childFile) {
        childFile = await resolveSubFile(ref, ctx);
      }

      if (childFile) {
        // Inherit file-level colours into table
        if (childFile.meta.colors) {
          for (const c of childFile.meta.colors) ctx.colorTable.set(c.code, c);
        }
        await flattenFile(
          childFile,
          childMatrix,
          refColor,
          childInvert,
          depth + 1,
          meshMap,
          edgeMap,
          ctx,
        );
      }
      continue;
    }

    // ── Types 3 & 4 – triangles / quads ─────────────────────
    if (cmd.type === 3 || cmd.type === 4) {
      const color = resolveColor(cmd.colorCode, ctx.colorTable, parentColor);
      const texmap = cmd.texmap;
      const key = meshKey({ colorCode: color.code, texmapTexture: texmap?.texture });

      if (!meshMap.has(key)) {
        meshMap.set(key, { colorCode: color.code, color, triangles: [], texmap });
      }
      const mesh = meshMap.get(key)!;

      const rawPts = cmd.points.map((p) => transformPoint(matrix, p));

      // Build UVs if texmap active
      const uv = texmap
        ? rawPts.map((p) => projectTexmap(texmap, p))
        : undefined;

      const makeVertex = (i: number): GeometryVertex => ({
        position: rawPts[i] ?? { x: 0, y: 0, z: 0 },
        uv: uv?.[i],
      });

      // Determine winding after BFC + reflection
      const cmdWinding = (cmd.winding ?? fileWinding);
      const effectiveWinding = localInvert ? (cmdWinding === "CW" ? "CCW" : "CW") : cmdWinding;

      if (cmd.type === 3) {
        const v0 = makeVertex(0), v1 = makeVertex(1), v2 = makeVertex(2);
        const [a, b, c] = effectiveWinding === "CW" ? [v0, v2, v1] : [v0, v1, v2];
        mesh.triangles.push({ a, b, c });
      } else {
        // Quad → 2 triangles (0,1,2) and (0,2,3)
        const v0 = makeVertex(0), v1 = makeVertex(1), v2 = makeVertex(2), v3 = makeVertex(3);
        const pts = effectiveWinding === "CW"
          ? [v0, v3, v2, v1]
          : [v0, v1, v2, v3];
        const p0 = pts[0]!, p1 = pts[1]!, p2 = pts[2]!, p3 = pts[3]!;
        mesh.triangles.push({ a: p0, b: p1, c: p2 });
        mesh.triangles.push({ a: p0, b: p2, c: p3 });
      }
      continue;
    }

    // ── Type 2 & 5 – edges / optional lines ─────────────────
    if (cmd.type === 2 || cmd.type === 5) {
      const color = resolveColor(cmd.colorCode, ctx.colorTable, parentColor);
      const key = `edge::${color.code}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { colorCode: color.code, color, segments: [] });
      }
      const edges = edgeMap.get(key)!;
      edges.segments.push({
        start: transformPoint(matrix, cmd.points[0]),
        end:   transformPoint(matrix, cmd.points[1]),
      });
      continue;
    }
  }
}

// ── Public API ────────────────────────────────────────────────

/**
 * Fully resolve and flatten an LDrawFile into a FlatGeometry
 * suitable for GLB/SVG rendering.
 */
export async function flattenGeometry(
  file: LDrawFile,
  ctx: ResolverContext,
): Promise<FlatGeometry> {
  const meshMap = new Map<string, GeometryMesh>();
  const edgeMap = new Map<string, GeometryEdges>();

  await flattenFile(
    file,
    IDENTITY,
    ctx.defaultColor,   // top-level default for code 16 (no parent)
    false,
    0,
    meshMap,
    edgeMap,
    ctx,
  );

  const meshes = [...meshMap.values()];
  const edges  = [...edgeMap.values()];

  // Compute AABB
  const box = aabbEmpty();
  for (const mesh of meshes) {
    for (const tri of mesh.triangles) {
      aabbExpand(box, tri.a.position);
      aabbExpand(box, tri.b.position);
      aabbExpand(box, tri.c.position);
    }
  }

  return {
    meshes,
    edges,
    aabb: aabbFinalize(box),
  };
}

/**
 * Load, parse and resolve an LDraw model from its string content.
 * Returns both the structured LDrawFile and (if flatten=true) a FlatGeometry.
 */
export async function loadLDrawModel(
  content: string,
  name: string,
  ctx: ResolverContext,
  flatten = true,
): Promise<{ file: LDrawFile; geometry?: FlatGeometry }> {
  const file = parseLDrawFile(content, name);

  // Register file-level colours
  if (file.meta.colors) {
    for (const c of file.meta.colors) ctx.colorTable.set(c.code, c);
  }

  if (!flatten) return { file };

  // ── MPD root detection ────────────────────────────────────
  // A standard MPD file's geometry lives entirely inside embedded
  // sub-files (0 FILE sections).  When the root has no type-1
  // commands of its own but does have sub-files, we flatten the
  // FIRST sub-file as the main model (LDraw MPD spec §1).
  const hasType1 = file.commands.some((c) => c.type === 1);

  if (!hasType1 && file.subFiles && file.subFiles.size > 0) {
    // Register all embedded sub-files into the resolver cache so
    // recursive type-1 references within them can be resolved.
    for (const [subName, subFile] of file.subFiles) {
      ctx.cache.set(subName, subFile);
      if (subFile.meta.colors) {
        for (const c of subFile.meta.colors) ctx.colorTable.set(c.code, c);
      }
    }

    // The first sub-file (insertion order) is the main model.
    const [, firstSubFile] = [...file.subFiles.entries()][0]!;
    const geometry = await flattenGeometry(firstSubFile, ctx);
    return { file, geometry };
  }

  // Standard single-file or MPD where the root itself has type-1 refs
  const geometry = await flattenGeometry(file, ctx);
  return { file, geometry };
}
