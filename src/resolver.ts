// ============================================================
// LDraw Parser – Recursive file resolver + geometry flattener
// ============================================================

import {
	type LDrawFile,
	// type LDrawSubFileRef,
	type LDrawColor,
	type Matrix4,
	type FlatGeometry,
	type GeometryMesh,
	type GeometryEdges,
	type GeometryVertex,
	type ResolverContext,
	type TexmapDefinition,
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
import { exportGltf, generateGlbV2, type GlbOptionsV2, type GltfExportOptions } from "./glb2";
import { collectTextures, computeStats, extractColorPalette, mergeGeometry, transformGeometry, lduToUnitScale, type ColorUsage, type GeometryStats, type LengthUnit } from "./postprocess";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";

// ── Types ─────────────────────────────────────────────────────

function texmapKeyForMesh(texmap: FlatGeometry["meshes"][number]["texmap"]): string {
	if (!texmap) return "";
	const r = (n: number) => Math.round(n * 1e6) / 1e6;
	const p = (v: { x: number; y: number; z: number }) => `${r(v.x)},${r(v.y)},${r(v.z)}`;
	let k = `${texmap.projection}::${texmap.texture}::${p(texmap.point1)}::${p(texmap.point2)}::${p(texmap.point3)}`;
	if ((texmap as any).angle    !== undefined) k += `::${(texmap as any).angle}`;
	if ((texmap as any).angle1 !== undefined) k += `::${(texmap as any).angle1}::${(texmap as any).angle2}`;
	return k;
}

function meshKeyFull(colorCode: number, texmap: FlatGeometry["meshes"][number]["texmap"]): string {
	return `${colorCode}::${texmapKeyForMesh(texmap)}`;
}

// ── Resolver ──────────────────────────────────────────────────

/**
 * Resolve a sub-file reference.
 * Returns the parsed LDrawFile (from cache if already seen).
 */
async function resolveFile(
	// ref: LDrawSubFileRef,
	filename: string,
	ctx: ResolverContext,
): Promise<LDrawFile | null> {
	const key = normalizeFileName(filename);
	if (ctx.cache.has(key)) return ctx.cache.get(key)!;

	const content = await ctx.resolveFile(filename);


	if (!content) return null;

	const file = parseLDrawFile(content, key);
	ctx.cache.set(key, file);

	// Register any embedded colours from the file into the table
	if (file.meta.colors) {
		for (const c of file.meta.colors) {
			ctx.colorTable.add(c);
			// if (!ctx.colorTable.has(c.code)) ctx.colorTable.set(c.code, c);
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
 * @param _invertWinding – accumulated BFC winding inversion (reserved)
 * @param depth        – recursion depth guard
 * @param meshMap      – output mesh accumulator
 * @param edgeMap      – output edge accumulator
 * @param ctx          – resolver context
 */
async function flattenFile(
	file: LDrawFile,
	matrix: Matrix4,
	parentColor: LDrawColor,
	_invertWinding: boolean,
	depth: number,
	meshMap: Map<string, GeometryMesh>,
	edgeMap: Map<string, GeometryEdges>,
	ctx: ResolverContext,
	parentTexmap?: TexmapDefinition,
): Promise<void> {
	if (depth > ctx.maxDepth) return;

	// Local BFC winding inherits from file certification
	const fileWinding = file.meta.bfcWinding ?? "CCW";
	const det = matrixDeterminant3(matrix);
	const reflectionInvert = det < 0;

	// Effective inversion only accounts for reflection in the composed matrix
	// (parent symmetry is already baked into the child matrix)
	let localInvert = reflectionInvert;

	for (const cmd of file.commands) {
		// ── Type 1 – sub-file reference ──────────────────────────
		if (cmd.type === 1) {
			const ref = cmd;
			const childMatrix = multiplyMatrices(matrix, ref.transform);
			const childInvert = ref.inverted ? !localInvert : localInvert;

			// Resolve colour for child
			const refColor = await ctx.colorTable.resolveColor(ref.colorCode, parentColor);

			// Try MPD embedded sub-files first
			const normalised = normalizeFileName(ref.file);
			let childFile = file.subFiles?.get(normalised) ?? null;

			// Then external resolver
			if (!childFile) {
				childFile = await resolveFile(ref.file, ctx);
			}

			if (childFile) {
				// Inherit file-level colours into table
				if (childFile.meta.colors) {
					for (const c of childFile.meta.colors) {
						ctx.colorTable.add(c)
					}
				}
				// Pass parent texmap to child for inheritance
				await flattenFile(
					childFile,
					childMatrix,
					refColor,
					childInvert,
					depth + 1,
					meshMap,
					edgeMap,
					ctx,
					ref.texmap,
				);
			}
			continue;
		}

		// ── Types 3 & 4 – triangles / quads ─────────────────────
		if (cmd.type === 3 || cmd.type === 4) {
			const color = await ctx.colorTable.resolveColor(cmd.colorCode, parentColor);
			// Inherit parent texmap if child doesn't have one
			const texmap = cmd.texmap ?? parentTexmap;
			const key = meshKeyFull(color.code, texmap);

			if (!meshMap.has(key)) {
				meshMap.set(key, { colorCode: color.code, triangles: [], texmap });
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
			const color = await ctx.colorTable.resolveColor(cmd.colorCode, parentColor);
			const key = `edge::${color.code}`;
			if (!edgeMap.has(key)) {
				edgeMap.set(key, { colorCode: color.code, segments: [] });
			}
			const edges = edgeMap.get(key)!;
			edges.segments.push({
				start: transformPoint(matrix, cmd.points[0]),
				end: transformPoint(matrix, cmd.points[1]),
			});
			continue;
		}
	}
}


// ── Public API ────────────────────────────────────────────────


export class LDrawPart {
	file: LDrawFile
	geometry?: FlatGeometry
	private loadTexture?: (name: string) => Promise<Uint8Array | null | undefined>

	constructor(file: LDrawFile, geometry?: FlatGeometry, loadTexture?: (name: string) => Promise<Uint8Array | null | undefined>) {
		this.file = file;
		this.geometry = geometry;
		this.loadTexture = loadTexture
	}

	async toGltf(
		options?: GlbOptionsV2 & GltfExportOptions,
	  ): Promise<{ gltf: string; images: Map<string, Uint8Array> }> {
		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		return exportGltf(this.geometry, { name: this.file.name.replace('.dat', ''), loadTexture: this.loadTexture, ...options });
	  }
	/**
	 * Generate a GLB binary buffer from already-flattened geometry.
	 *
	 * @param unit   Output unit (default: "m" for glTF compliance)
	 * @param merge  Merge meshes by color before export (default: true)
	 */
	async toGlb(
		options?: GlbOptionsV2,
		unit: LengthUnit = "m",
		merge = true,
	): Promise<Uint8Array> {
		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		const scale = unit === "ldu" ? 1 : lduToUnitScale(unit);
		let g = transformGeometry(this.geometry, scale, true);
		if (merge) g = mergeGeometry(g);
		return await generateGlbV2(g, { name: this.file.name.replace('.dat', ''), loadTexture: this.loadTexture, ...options });
	}


	/**
	 * Generate an SVG thumbnail string from already-flattened geometry.
	 */
	toSvg(options?: SvgCameraOptions): string {

		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		return generateSvgThumbnail(this.geometry, options);
	}

	/**
		 * Compute geometry statistics (triangle count, AABB, estimated memory…).
		 */
	stats(): GeometryStats {
		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		return computeStats(this.geometry);
	}



	/**
	 * Extract the color palette used in the geometry, sorted by usage.
	 */
	palette(): ColorUsage[] {
		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		return extractColorPalette(this.geometry);
	}

	/**
	 * List all texture file names referenced via TEXMAP.
	 */
	textures(): string[] {
		if (!this.geometry) {
			throw new Error("No geometry available. Use LDrawParser.parse() with flatten=true to generate geometry.");
		}
		return collectTextures(this.geometry);
	}
}
/**
 * Fully resolve and flatten an LDrawFile into a FlatGeometry
 * suitable for GLB/SVG rendering.
 */
export async function flattenGeometry(
	file: LDrawFile,
	ctx: ResolverContext,
	defaultColor: LDrawColor,
): Promise<FlatGeometry> {
	const meshMap = new Map<string, GeometryMesh>();
	const edgeMap = new Map<string, GeometryEdges>();

	await flattenFile(
		file,
		IDENTITY,
		defaultColor,
		false,
		0,
		meshMap,
		edgeMap,
		ctx,
	);

	const meshes = [...meshMap.values()];
	const edges = [...edgeMap.values()];

	// Build a color table limited to only the colors used by the meshes/edges
	const usedColorTable = new Map<number, LDrawColor>();
	for (const mesh of meshes) {
		const c = await ctx.colorTable.get(mesh.colorCode);
		if (c) usedColorTable.set(mesh.colorCode, c);
	}
	for (const edge of edges) {
		const c = await ctx.colorTable.get(edge.colorCode);
		if (c) usedColorTable.set(edge.colorCode, c);
	}

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
		colorTable: usedColorTable.size > 0 ? usedColorTable : undefined,
		aabb: aabbFinalize(box),
	};
}

/**
 * Load, parse and resolve an LDraw model from its string content.
 * Returns both the structured LDrawFile and (if flatten=true) a FlatGeometry.
 */
export async function loadLDrawModel(
	name: string,
	ctx: ResolverContext,
	flatten = true,
	defaultColor: LDrawColor,
): Promise<LDrawPart> {
	const file = await resolveFile(name, ctx); // Preload the file into cache
	if (!file) {
		throw new Error(`Fichier introuvable: ${name}`);
	}

	// Register file-level colours
	if (file.meta.colors) {
		for (const c of file.meta.colors) {
			ctx.colorTable.add(c);
		}
	}

	if (!flatten) {
		return new LDrawPart(file);
	}

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
				for (const c of subFile.meta.colors) ctx.colorTable.add(c);
			}
		}

		// The first sub-file (insertion order) is the main model.
		const [, firstSubFile] = [...file.subFiles.entries()][0]!;
		const geometry = await flattenGeometry(firstSubFile, ctx, defaultColor);
		return new LDrawPart(file, geometry, ctx.resolverTexture);
	}

	// Standard single-file or MPD where the root itself has type-1 refs
	const geometry = await flattenGeometry(file, ctx, defaultColor);
	return new LDrawPart(file, geometry, ctx.resolverTexture);
}
