

import { exportGltf, generateGlbV2, type GlbOptionsV2, type GltfExportOptions } from "./glb2";
import type { LDrawFile } from "./parser";
import { collectTextures, computeStats, extractColorPalette, mergeGeometry, transformGeometry, lduToUnitScale, type ColorUsage, type GeometryStats, type LengthUnit } from "./postprocess";
import { generateSvgThumbnail, type SvgCameraOptions } from "./svg";
import type { FlatGeometry } from "./types";



export class LDrawPart {
	file: LDrawFile
	geometry: FlatGeometry
	private loadTexture?: (name: string) => Promise<Uint8Array>

	constructor(file: LDrawFile, geometry: FlatGeometry, loadTexture?: (name: string) => Promise<Uint8Array>) {
		this.file = file;
		this.geometry = geometry;
		this.loadTexture = loadTexture
	}


	async toGltf(options?: Omit<GlbOptionsV2 & GltfExportOptions, 'name' | 'loadTexture'>): Promise<{ gltf: string; images: Map<string, Uint8Array> }> {
		return exportGltf(this.geometry, { name: this.file.name.replace('.dat', ''), loadTexture: this.loadTexture, ...options });
	}


	/**
	 * Generate a GLB binary buffer from already-flattened geometry.
	 *
	 * @param unit   Output unit (default: "m" for glTF compliance)
	 * @param merge  Merge meshes by color before export (default: true)
	 */
	async toGlb(options?: Omit<GlbOptionsV2, 'name' | 'loadTexture'>, unit: LengthUnit = "m", merge = true): Promise<Uint8Array> {
		const scale = unit === "ldu" ? 1 : lduToUnitScale(unit);
		let g = transformGeometry(this.geometry, scale, true);
		if (merge) {
			g = mergeGeometry(g);
		}
		return await generateGlbV2(g, { name: this.file.name.replace('.dat', ''), loadTexture: this.loadTexture, ...options });
	}


	/**
	 * Generate an SVG thumbnail string from already-flattened geometry.
	 */
	toSvg(options?: SvgCameraOptions): string {
		return generateSvgThumbnail(this.geometry, options);
	}


	/**
	 * Compute geometry statistics (triangle count, AABB, estimated memory…).
	 */
	stats(): GeometryStats {
		return computeStats(this.geometry);
	}


	/**
	 * Extract the color palette used in the geometry, sorted by usage.
	 */
	palette(): ColorUsage[] {
		return extractColorPalette(this.geometry);
	}


	/**
	 * List all texture file names referenced via TEXMAP.
	 */
	textures(): string[] {
		return collectTextures(this.geometry);
	}
}
