// ============================================================
// LDraw Parser – Public API
// ============================================================

// ── High-level convenience class ─────────────────────────────

import { type LDrawParserOptions, type ResolverContext } from "./types";
import { ColorTable } from "./colors";
import { LDrawPart, loadLDrawModel } from "./resolver";
import { SimpleFileResolver } from "./simple-resolver";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
import { generateGlbV2, exportGltf, type GlbOptionsV2, type GltfExportOptions } from "./glb2";
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
export default class LDrawParser {
  private ctx: ResolverContext;
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
    
    let partResolver, textureResolver;
    if ('resolveFile' in options) {
      partResolver = options.resolveFile
      textureResolver = options.resolveTexture
    } else {
      const resolver = new SimpleFileResolver(options.libraryRoot)
      partResolver = resolver.resolvePart
      textureResolver = resolver.resolveTexture
    }
    

    this.defaultColor = options.defaultColor ?? 71; // Light Bluish Grey

    this.ctx = {
      colorTable: new ColorTable(partResolver),
      resolveFile: partResolver,
      resolverTexture: textureResolver,
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
    return generateGlbV2(geometry, {loadTexture: this.ctx.resolverTexture, ...options});
  }

  /**
   * Generate a `.gltf` file (plain JSON). Returns the JSON string plus any
   * external image bytes (when `inlineImages: false`).
   */
  async toGltf(
    geometry: NonNullable<Awaited<ReturnType<typeof loadLDrawModel>>["geometry"]>,
    options?: GlbOptionsV2 & GltfExportOptions,
  ): Promise<{ gltf: string; images: Map<string, Uint8Array> }> {
    return exportGltf(geometry, { loadTexture: this.ctx.resolverTexture, ...options });
  }

  /** Generate an OBJ file from parsed geometry. */
  toObj(geometry: NonNullable<Awaited<ReturnType<typeof loadLDrawModel>>["geometry"]>, options?: ObjExportOptions): string {
    const { obj, mtl } = generateObj(geometry, options ?? {});
    return obj + "\n" + mtl;
  }
}
