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

import { type LDrawParserOptions, type ResolverContext } from "./types";
import { ColorTable } from "./colors";
import { LDrawPart, loadLDrawModel } from "./resolver";
import { SimpleFileResolver } from "./simple-resolver";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
import { generateGlbV2, type GlbOptionsV2 } from "./glb2";
import { generateObj, type ObjExportOptions } from "./obj";
import { parseLDrawFile } from "./parser";
import type { LDrawFile } from "./types";

export class LDrawParser {
	private ctx: ResolverContext;
	private opts: {
		flatten: boolean;
		keepRawLines: boolean;
	};
	private defaultColor: number//LDrawColor;

	constructor(options: LDrawParserOptions) {

		this.opts = {
			flatten: options.flatten ?? true,
			keepRawLines: options.keepRawLines ?? false
		};

		const resolver = 'resolveFile' in options ? options.resolveFile : new SimpleFileResolver(options.libraryRoot).resolve;

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
	 * @param name    – file name (used for retrieve file in ldraw folder)
	 */
	async parse(name: string, ctxOverride?: { defaultColor?: number }): Promise<LDrawPart> {
		return loadLDrawModel(
			name,
			this.ctx,
			this.opts.flatten,
			await this.ctx.colorTable.get(ctxOverride?.defaultColor ?? this.defaultColor),
		)
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

	/** Parse LDraw content string without resolving sub-files. */
	parseOnly(content: string, name: string): LDrawFile {
		return parseLDrawFile(content, name, false);
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
