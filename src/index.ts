// ============================================================
// LDraw Parser – Public API
// ============================================================

export * from "./types";
export * from "./colors";
export * from "./utils";
export { parseLDrawFile } from "./parser";
export { flattenGeometry, loadLDrawModel } from "./resolver";
export { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
export { generateGlb, type GlbOptions } from "./glb";
export {
  createFilesystemResolver,
  createProjectResolver,
  loadLdConfig,
  warmResolverCache,
  type LDrawLibraryOptions,
} from "./fs-resolver";
export {
  lduToUnitScale,
  transformGeometry,
  mergeMeshesByColor,
  mergeEdgesByColor,
  mergeGeometry,
  extractColorPalette,
  computeStats,
  cullSmallTriangles,
  collectTextures,
  LDU_PER_MM,
  MM_PER_LDU,
  STUDS_PER_LDU,
  type LengthUnit,
  type ColorUsage,
  type GeometryStats,
} from "./postprocess";

// ── High-level convenience class ─────────────────────────────

import { type LDrawParserOptions, type ResolverContext, type FlatGeometry, type LDrawFile, type LDrawColor } from "./types";
import { buildColorTable, getDefaultColorTable } from "./colors";
import { parseLDrawFile } from "./parser";
import { loadLDrawModel } from "./resolver";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
import { generateGlb, type GlbOptions } from "./glb";
import { normalizeFileName } from "./utils";
import {
  transformGeometry,
  mergeGeometry,
  computeStats,
  extractColorPalette,
  collectTextures,
  type LengthUnit,
  type GeometryStats,
  type ColorUsage,
} from "./postprocess";

export class LDrawParser {
  private ctx: ResolverContext;
  private opts: Required<LDrawParserOptions>;

  constructor(options: LDrawParserOptions = {}) {
    const colorTable = options.colorTable ?? getDefaultColorTable();
    // Default color for code 16 with no parent: Light Bluish Grey (71),
    // the standard display color used by LDraw reference viewers.
    const defaultColor =
      options.defaultColor ??
      colorTable.get(71) ??   // Light Bluish Grey
      colorTable.get(7)  ??   // Light_Grey fallback
      colorTable.get(15) ??   // White fallback
      colorTable.get(0)!;     // Black last resort

    this.opts = {
      resolveFile:   options.resolveFile   ?? (() => null),
      colorTable,
      processBFC:    options.processBFC    ?? true,
      flatten:       options.flatten       ?? true,
      keepRawLines:  options.keepRawLines  ?? false,
      maxDepth:      options.maxDepth      ?? 64,
      defaultColor,
    };

    this.ctx = {
      colorTable:   this.opts.colorTable,
      resolveFile: async (name: string) => {
        const result = await this.opts.resolveFile(name);
        return result ?? null;
      },
      processBFC:   this.opts.processBFC,
      maxDepth:     this.opts.maxDepth,
      defaultColor: this.opts.defaultColor!,
      cache:        new Map(),
    };
  }

  /**
   * Load an LDConfig.ldr content to populate the full official colour table.
   * Call this once before parsing models if you have the file available.
   */
  loadColorTable(ldconfigContent: string): void {
    const table = buildColorTable(ldconfigContent);
    for (const [code, color] of table) {
      this.ctx.colorTable.set(code, color);
    }
  }

  /**
   * Parse and resolve an LDraw model.
   *
   * @param content – raw .ldr / .mpd / .dat file content
   * @param name    – file name (used for cache key and MPD sub-file matching)
   */
  async parse(
    content: string,
    name = "model.ldr",
  ): Promise<{ file: LDrawFile; geometry?: FlatGeometry }> {
    return loadLDrawModel(content, normalizeFileName(name), this.ctx, this.opts.flatten);
  }

  /**
   * Parse only (no sub-file resolution, no geometry flattening).
   * Useful for quick metadata extraction.
   */
  parseOnly(content: string, name = "model.ldr"): LDrawFile {
    return parseLDrawFile(content, normalizeFileName(name), this.opts.keepRawLines);
  }

  /**
   * Generate an SVG thumbnail string from already-flattened geometry.
   */
  toSvg(geometry: FlatGeometry, options?: SvgCameraOptions): string {
    return generateSvgThumbnail(geometry, options);
  }

  /**
   * Generate a GLB binary buffer from already-flattened geometry.
   *
   * @param unit   Output unit (default: "m" for glTF compliance)
   * @param merge  Merge meshes by color before export (default: true)
   */
  toGlb(
    geometry: FlatGeometry,
    options?: GlbOptions,
    unit: LengthUnit = "m",
    merge = true,
  ): Uint8Array {
    const scale = unit === "ldu" ? 1 : this._lduScale(unit);
    let g = transformGeometry(geometry, scale, true);
    if (merge) g = mergeGeometry(g);
    return generateGlb(g, options);
  }

  /** LDU → output-unit scale factor */
  private _lduScale(unit: LengthUnit): number {
    // 1 LDU = 0.4 mm
    const mm: Record<LengthUnit, number> = {
      ldu: 1 / 0.4, mm: 1, cm: 0.1, m: 0.001, in: 1 / 25.4, studs: 1 / 8,
    };
    return 0.4 * (mm[unit] ?? 1);
  }

  /**
   * Compute geometry statistics (triangle count, AABB, estimated memory…).
   */
  stats(geometry: FlatGeometry): GeometryStats {
    return computeStats(geometry);
  }

  /**
   * Extract the color palette used in the geometry, sorted by usage.
   */
  palette(geometry: FlatGeometry): ColorUsage[] {
    return extractColorPalette(geometry);
  }

  /**
   * List all texture file names referenced via TEXMAP.
   */
  textures(geometry: FlatGeometry): string[] {
    return collectTextures(geometry);
  }

  /**
   * One-shot: parse → resolve → generate SVG thumbnail.
   */
  async toSvgFromContent(
    content: string,
    name?: string,
    svgOptions?: SvgCameraOptions,
  ): Promise<string> {
    const { geometry } = await this.parse(content, name);
    if (!geometry) throw new Error("Geometry flattening was disabled");
    return this.toSvg(geometry, svgOptions);
  }

  /**
   * One-shot: parse → resolve → generate GLB.
   */
  async toGlbFromContent(
    content: string,
    name?: string,
    glbOptions?: GlbOptions,
    unit: LengthUnit = "m",
  ): Promise<Uint8Array> {
    const { geometry } = await this.parse(content, name);
    if (!geometry) throw new Error("Geometry flattening was disabled");
    return this.toGlb(geometry, glbOptions, unit);
  }

  /** Clear the internal sub-file cache. */
  clearCache(): void {
    this.ctx.cache.clear();
  }

  /** Read-only access to the colour table. */
  get colorTable(): Map<number, LDrawColor> {
    return this.ctx.colorTable;
  }
}

// ── Additional module re-exports ──────────────────────────────

export {
  createNodeResolver,
  loadLdConfigNode,
  warmNodeResolverCache,
  type NodeResolverOptions,
} from "./node-resolver";
export {
  smoothMeshNormals,
  computeSmoothNormals,
  type VertexWithNormal,
  type SmoothTriangle,
  type SmoothMesh,
  type SmoothGeometry,
} from "./normals";
export {
  generateGlbV2,
  type GlbOptionsV2,
} from "./glb2";
export {
  generateObj,
  type ObjExportOptions,
  type ObjExportResult,
} from "./obj";
export {
  LDrawError,
  LDrawParseError,
  LDrawResolveError,
  LDrawDepthError,
  type LDrawWarning,
  type ParseResult,
} from "./errors";
export {
  weldMesh,
  weldGeometry,
  mergeWeldedMeshes,
  type WeldOptions,
  type WeldedMesh,
} from "./weld";

export {
  serialiseLDrawFile,
  serialiseColor,
  buildLDrawFile,
  buildMpd,
  type SerialiseOptions,
  type MinimalFileOptions,
} from "./serialise";
export {
  extractSteps,
  hasSteps,
  generateStepGeometries,
  rotationToMatrix,
  computeCameraRotations,
  type BuildStep,
  type StepRotation,
  type StepGeometry,
} from "./steps";
