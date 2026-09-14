// ============================================================
// LDraw Parser – Public API
// ============================================================

// ── Core types ────────────────────────────────────────────────

export type {
  LDrawFile,
  LDrawFileMeta,
  LDrawCommand,
  LDrawComment,
  LDrawSubFileRef,
  LDrawLine,
  LDrawTriangle,
  LDrawQuad,
  LDrawOptionalLine,
  LDrawColor,
  Vec3,
  Vec2,
  Matrix4,
  TexmapDefinition,
  TexmapPlanar,
  TexmapCylindrical,
  TexmapSpherical,
  BFCStatement,
  LDrawFileType,
  LDrawParserOptions,
  ResolverContext,
  FlatGeometry,
  GeometryMesh,
  GeometryEdges,
  GeometryVertex,
} from "./types";

// ── Parser ────────────────────────────────────────────────────

export { parseLDrawFile } from "./parser";

// ── Resolver & flattening ────────────────────────────────────

export { flattenGeometry, loadLDrawModel, LDrawPart } from "./resolver";

// ── SVG thumbnail ────────────────────────────────────────────

export { generateSvgThumbnail, type SvgCameraOptions } from "./svg";

// ── GLB export (v2) ─────────────────────────────────────────

export { generateGlbV2, type GlbOptionsV2 } from "./glb2";

// ── OBJ export ───────────────────────────────────────────────

export { generateObj, type ObjExportOptions, type ObjExportResult } from "./obj";

// ── Colour table ─────────────────────────────────────────────

export { ColorTable, parseColorDefinition } from "./colors";

// ── Post-processing utilities ────────────────────────────────

export {
  lduToUnitScale,
  transformGeometry,
  mergeGeometry,
  extractColorPalette,
  computeStats,
  cullSmallTriangles,
  collectTextures,
} from "./postprocess";

export {
  LDU_PER_MM,
  MM_PER_LDU,
  STUDS_PER_LDU,
} from "./postprocess";

export type {
  LengthUnit,
  ColorUsage,
  GeometryStats,
} from "./postprocess";

// ── Resolvers ────────────────────────────────────────────────

export {
  warmResolverCache,
  type LDrawLibraryOptions,
} from "./fs-resolver";

export {
  createNodeResolver,
  loadLdConfigNode,
  warmNodeResolverCache,
  type NodeResolverOptions,
} from "./node-resolver";

// ── Vertex welding ──────────────────────────────────────────

export {
  weldMesh,
  weldGeometry,
  mergeWeldedMeshes,
} from "./weld";

export type {
  WeldOptions,
  WeldedMesh,
} from "./weld";

// ── Smooth normals ──────────────────────────────────────────

export {
  smoothMeshNormals,
  computeSmoothNormals,
} from "./normals";

export type {
  VertexWithNormal,
  SmoothTriangle,
  SmoothMesh,
  SmoothGeometry,
} from "./normals";

// ── Serialisation ────────────────────────────────────────────

export {
  serialiseLDrawFile,
  serialiseColor,
  buildLDrawFile,
  buildMpd,
} from "./serialise";

export type {
  SerialiseOptions,
  MinimalFileOptions,
} from "./serialise";

// ── STEP export ──────────────────────────────────────────────

export {
  extractSteps,
  hasSteps,
  generateStepGeometries,
  rotationToMatrix,
  computeCameraRotations,
} from "./steps";

export type {
  BuildStep,
  StepRotation,
  StepGeometry,
} from "./steps";

// ── Error classes ────────────────────────────────────────────

export {
  LDrawError,
  LDrawParseError,
  LDrawResolveError,
  LDrawDepthError,
} from "./errors";

export type {
  LDrawWarning,
  ParseResult,
} from "./errors";

// ── High-level convenience class ─────────────────────────────

import { type LDrawParserOptions } from "./types";
import { ColorTable } from "./colors";
import { LDrawPart, loadLDrawModel } from "./resolver";
import { SimpleFileResolver } from "./simple-resolver";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
import { generateGlbV2, type GlbOptionsV2 } from "./glb2";
import { generateObj, type ObjExportOptions } from "./obj";

/**
 * High-level LDraw parser with built-in SVG/GLB/OBJ export.
 *
 * @example
 * ```ts
 * const parser = new LDrawParser({ libraryRoot: "/path/to/ldraw" });
 * const part = await parser.parse("3626b.dat");
 * const svg = parser.toSvg(part.geometry);
 * const glb = await parser.toGlb(part.geometry);
 * ```
 */
export class LDrawParser {
  private ctx: import("./types").ResolverContext;
  private opts: {
    flatten: boolean;
    keepRawLines: boolean;
  };
  private defaultColor: number;

  constructor(options: LDrawParserOptions) {
    this.opts = {
      flatten: options.flatten ?? true,
      keepRawLines: options.keepRawLines ?? false,
    };

    const resolver = 'resolveFile' in options
      ? options.resolveFile
      : new SimpleFileResolver(options.libraryRoot).resolve;

    this.defaultColor = options.defaultColor ?? 71; // Light Bluish Grey

    this.ctx = {
      colorTable: new ColorTable(resolver),
      resolveFile: resolver,
      processBFC: options.processBFC ?? true,
      maxDepth: options.maxDepth ?? 64,
      cache: new Map(),
    };
  }

  /**
   * Parse and resolve an LDraw model.
   *
   * @param name – file name (used to retrieve file in ldraw folder)
   */
  async parse(name: string, ctxOverride?: { defaultColor?: number }): Promise<LDrawPart> {
    return loadLDrawModel(
      name,
      this.ctx,
      this.opts.flatten,
      await this.ctx.colorTable.get(ctxOverride?.defaultColor ?? this.defaultColor),
    );
  }

  /** Clear the internal sub-file cache. */
  clearCache(): void {
    this.ctx.cache.clear();
  }

  /** Read-only access to the colour table. */
  get colorTable(): ColorTable {
    return this.ctx.colorTable;
  }

  /** Generate an SVG thumbnail from parsed geometry. */
  toSvg(geometry: NonNullable<Awaited<ReturnType<typeof loadLDrawModel>>["geometry"]>, options?: SvgCameraOptions): string {
    return generateSvgThumbnail(geometry, options ?? {});
  }

  /** Generate a GLB file from parsed geometry. */
  async toGlb(geometry: NonNullable<Awaited<ReturnType<typeof loadLDrawModel>>["geometry"]>, options?: GlbOptionsV2): Promise<Uint8Array> {
    return generateGlbV2(geometry, options ?? {});
  }

  /** Generate an OBJ file from parsed geometry. */
  toObj(geometry: NonNullable<Awaited<ReturnType<typeof loadLDrawModel>>["geometry"]>, options?: ObjExportOptions): string {
    const { obj, mtl } = generateObj(geometry, options ?? {});
    return obj + "\n" + mtl;
  }
}
