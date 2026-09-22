// ============================================================
// LDraw Parser – Public API
// ============================================================

// ── High-level convenience class ─────────────────────────────
import { ColorTable } from "./colors";
import type { LDrawPart } from "./ldraw-part";
import type { LDrawFile } from "./parser";
import { loadLDrawModel, type ResolverContext } from "./resolver";
import { SimpleFileResolver } from "./simple-resolver";


// ── Parser options ────────────────────────────────────────────

export type LDrawParserOptions =
	({
		/**
	     * Resolve sub-file content.
	     * Called with the raw file name as written in the type-1 command.
	     * Raise exception if the file cannot be found.
	     */
		resolveFile: (name: string) => Promise<string>;
		resolveTexture?: (name: string) => Promise<Uint8Array>
	}
		| { libraryRoot: string }) &
	{
		/** Maximum recursion depth for sub-file references (default: 64) */
		maxDepth?: number;

		/**
		 * Default color used for geometry that inherits from a parent (code 16)
		 * when there is no parent — i.e. when parsing a standalone part file (.dat).
		 *
		 * Accepts any LDrawColor. Common choices:
		 *   - table.get(71)  Light Bluish Grey  (LDraw viewer default)
		 *   - table.get(15)  White
		 *   - table.get(4)   Red
		 *
		 * Defaults to Light Bluish Grey (code 71) if omitted.
		 */
		defaultColor?: number;
	}


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
	private defaultColor: number;

	constructor(options: LDrawParserOptions) {

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
			true,
			await this.ctx.colorTable.get(ctxOverride?.defaultColor ?? this.defaultColor),
		);
	}

	/**
	 * Parse and resolve an LDraw model.
	 *
	 * @param name – file name (used to retrieve file in ldraw folder)
	 */
	async parseOnly(name: string, ctxOverride?: { defaultColor?: number }): Promise<LDrawFile> {
		return loadLDrawModel(
			name,
			this.ctx,
			false,
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

}
