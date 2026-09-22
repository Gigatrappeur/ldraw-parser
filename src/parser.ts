// ============================================================
// LDraw Parser – Core line-by-line parser
// ============================================================

import { parseColorDefinition, type LDrawColor } from "./colors";
import { parseTexmapStart } from "./texture";
import type { Matrix4, TexmapDefinition, Vec3 } from "./types";
import { buildMatrix, normalizeFileName, num, vec } from "./utils";


// ── TEXMAP state machine ──────────────────────────────────────

type TexmapPhase = "START" | "BODY" | "FALLBACK";

interface TexmapState {
	phase: TexmapPhase;
	definition: TexmapDefinition;
	depth: number; // for nested texmaps
	fallback?: boolean; // true if this texmap is a fallback for the next one
}

// ── BFC state ─────────────────────────────────────────────────

interface BFCState {
	certified: boolean;
	localWinding: "CW" | "CCW";
	clipEnabled: boolean;
	invertNext: boolean;
}

const DEFAULT_BFC: BFCState = { certified: false, localWinding: "CCW", clipEnabled: true, invertNext: false }


// ── Parse META (type-0) lines ─────────────────────────────────

function parseMeta(raw: string, meta: LDrawFileMeta, isFirstLine: boolean): { bfc?: BFCStatement; colorDef?: LDrawColor; fileName?: string; isFileMarker?: boolean } {
	const body = raw.replace(/^\s*0\s*/, "").trim();
	const result: ReturnType<typeof parseMeta> = {};

	// Description (very first non-empty line that is a type-0 without keyword)
	if (isFirstLine && !body.startsWith("!") && !body.startsWith("//")) {
		meta.description = body;
		return result;
	}

	// FILE marker (MPD)
	if (/^FILE\s+/i.test(body)) {
		result.fileName = body.replace(/^FILE\s+/i, "").trim();
		result.isFileMarker = true;
		return result;
	}

	if (/^NAME\s*:/i.test(body)) {
		meta.name = body.replace(/^NAME\s*:\s*/i, "");
		return result;
	}

	if (/^AUTHOR\s*:/i.test(body)) {
		meta.author = body.replace(/^AUTHOR\s*:\s*/i, "");
		return result;
	}

	// !LDRAW_ORG
	if (/^!LDRAW_ORG\b/i.test(body)) {
		const rest = body.replace(/^!LDRAW_ORG\s+/i, "");
		meta.fileType = rest.split(/\s/)[0] as LDrawFileType;
		return result;
	}

	// !LICENSE
	if (/^!LICENSE\b/i.test(body)) {
		meta.license = body.replace(/^!LICENSE\s+/i, "");
		return result;
	}

	// !HELP
	if (/^!HELP\b/i.test(body)) {
		meta.help = meta.help ?? [];
		meta.help.push(body.replace(/^!HELP\s+/i, ""));
		return result;
	}

	// !CATEGORY
	if (/^!CATEGORY\b/i.test(body)) {
		meta.category = body.replace(/^!CATEGORY\s+/i, "").trim();
		return result;
	}

	// !KEYWORDS
	if (/^!KEYWORDS\b/i.test(body)) {
		const kwStr = body.replace(/^!KEYWORDS\s+/i, "");
		const kws = kwStr.split(",").map((k) => k.trim()).filter(Boolean);
		meta.keywords = meta.keywords ?? [];
		for (const kw of kws) {
			if (!meta.keywords.includes(kw)) meta.keywords.push(kw);
		}
		return result;
	}

	// !CMDLINE
	if (/^!CMDLINE\b/i.test(body)) {
		meta.cmdline = body.replace(/^!CMDLINE\s+/i, "");
		return result;
	}

	// !HISTORY
	if (/^!HISTORY\b/i.test(body)) {
		const rest = body.replace(/^!HISTORY\s+/i, "");
		// Format: YYYY-MM-DD [Author] description OR YYYY-MM-DD {Author} description
		const hm = rest.match(/^(\d{4}-\d{2}-\d{2})\s+[\[{]([^\]})]+)[\]}]\s*(.*)/);
		if (hm) {
			meta.history = meta.history ?? [];
			meta.history.push({
				date: hm[1] ?? "",
				author: (hm[2] ?? "").trim(),
				description: (hm[3] ?? "").trim(),
			});
		}
		return result;
	}

	// !COLOUR definition
	if (/^!COLOUR\b/i.test(body)) {
		const color = parseColorDefinition(`0 ${body}`);
		if (color) {
			meta.colors = meta.colors ?? [];
			meta.colors.push(color);
			result.colorDef = color;
		}
		return result;
	}

	// BFC
	if (/^BFC\b/i.test(body)) {
		const bfcBody = body.replace(/^BFC\s*/i, "").toUpperCase().trim();
		if (bfcBody === "NOCERTIFY") {
			meta.bfcCertified = false;
			result.bfc = "NOCERTIFY";
		} else if (bfcBody.includes("CERTIFY")) {
			meta.bfcCertified = true;
			meta.bfcWinding = bfcBody.includes("CCW") ? "CCW" : "CW";
			result.bfc = bfcBody.includes("CCW") ? "CERTIFY CCW" : "CERTIFY CW";
		} else if (bfcBody === "CW" || bfcBody === "CCW") {
			result.bfc = bfcBody as BFCStatement;
		} else if (bfcBody === "INVERTNEXT") {
			result.bfc = "INVERTNEXT";
		} else if (bfcBody === "CLIP") {
			result.bfc = "CLIP";
		} else if (bfcBody === "NOCLIP") {
			result.bfc = "NOCLIP";
		}
		return result;
	}

	return result;
}



// ── Line types ───────────────────────────────────────────────

export interface LDrawComment {
  type: 0;
  raw: string;
  /** Parsed META command, e.g. "FILE", "COLOUR", "TEXMAP" … */
  meta?: string;
}

export interface LDrawSubFileRef {
  type: 1;
  colorCode: number;
  /** The resolved LDrawColor (if colour table is loaded) */
  color?: LDrawColor;
  transform: Matrix4;
  /** As written in the file, e.g. "stud.dat" */
  file: string;
  /** Absolute / resolved path after file resolution */
  resolvedPath?: string;
  /** BFC invert flag set by parent */
  inverted?: boolean;
  texmap?: TexmapDefinition;
}

export interface LDrawLine {
  type: 2;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3];
}

export interface LDrawTriangle {
  type: 3;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3, Vec3];
  /** Normal direction after BFC winding (true = outward with CCW front) */
  winding?: "CW" | "CCW";
  texmap?: TexmapDefinition;
}

export interface LDrawQuad {
  type: 4;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3, Vec3, Vec3];
  winding?: "CW" | "CCW";
  texmap?: TexmapDefinition;
}

export interface LDrawOptionalLine {
  type: 5;
  colorCode: number;
  color?: LDrawColor;
  points: [Vec3, Vec3];
  controlPoints: [Vec3, Vec3];
}

export type LDrawCommand =
  | LDrawComment
  | LDrawSubFileRef
  | LDrawLine
  | LDrawTriangle
  | LDrawQuad
  | LDrawOptionalLine;

// ── BFC ──────────────────────────────────────────────────────

export type BFCStatement =
  | "CERTIFY CW"
  | "CERTIFY CCW"
  | "NOCERTIFY"
  | "CW"
  | "CCW"
  | "INVERTNEXT"
  | "CLIP"
  | "NOCLIP";

// ── Main parser ───────────────────────────────────────────────



export type LDrawFileType = "Model" | "Unofficial_Model" | "Subpart" | "Shortcut" | "Part" | "Unofficial_Part" | "Unofficial_Subpart" | "Unofficial_Shortcut" | "Primitive" | "Unofficial_Primitive" | "8_Primitive" | "48_Primitive";

export interface LDrawFileMeta {
	/** First comment line – human readable description */
	description?: string;
	/** 0 Name: ... */
	name?: string;
	/** 0 Author: ... */
	author?: string;
	/** 0 !LDRAW_ORG ... */
	fileType?: LDrawFileType;
	/** 0 !LICENSE ... */
	license?: string;
	/** 0 !HELP lines */
	help?: string[];
	/** 0 !CATEGORY ... */
	category?: string;
	/** 0 !KEYWORDS ... (merged from multiple lines, deduplicated) */
	keywords?: string[];
	/** 0 !CMDLINE ... */
	cmdline?: string;
	/** 0 !HISTORY entries */
	history?: Array<{ date: string; author: string; description: string }>;
	/** File-level colour definitions (0 !COLOUR) */
	colors?: LDrawColor[];
	/** BFC certification of this file */
	bfcCertified?: boolean;
	bfcWinding?: "CW" | "CCW";
}

// ── Parsed file ───────────────────────────────────────────────

export interface LDrawFile {
	/** File name as declared by "0 FILE <name>" or the source path */
	name: string;
	meta: LDrawFileMeta;
	commands: LDrawCommand[];
	/** Sub-files embedded in an MPD (only at root level) */
	subFiles?: Map<string, LDrawFile>;
	/** Raw lines for debugging */
	rawLines?: string[];
}


/**
 * Parse a single LDraw file content string into an LDrawFile.
 * Does NOT resolve sub-files – that is done by the Resolver.
 */
export function parseLDrawFile(content: string, name: string, keepRawLines = false): LDrawFile {
	const lines = content.split(/\r?\n/);
	const commands: LDrawCommand[] = [];
	const meta: LDrawFileMeta = {};
	const rawLines: string[] = [];

	const bfc = DEFAULT_BFC;
	let isFirstContent = true;

	// TEXMAP state stack (nested TEXMAPs are theoretically possible)
	const texmapStack: TexmapState[] = [];

	// MPD embedded files
	const subFiles = new Map<string, LDrawFile>();
	let currentSubName: string | null = null;
	let currentSubLines: string[] = [];

	const flushSubFile = () => {
		if (currentSubName !== null) {
			const sf = parseLDrawFile(currentSubLines.join("\n"), currentSubName, keepRawLines);
			subFiles.set(normalizeFileName(currentSubName), sf);
			currentSubLines = [];
		}
	};

	for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
		const raw = lines[lineIdx] ?? "";
		const trimmed = raw.trim();
		if (keepRawLines) rawLines.push(raw);

		if (!trimmed) continue;

		const parts = trimmed.split(/\s+/);
		const lineType = parseInt(parts[0] ?? "0", 10);

		// ── Type 0 ──────────────────────────────────────────────
		if (lineType === 0) {
			// Check for FILE marker first (MPD)
			if (/^0\s+FILE\s+/i.test(trimmed)) {
				const fileName = trimmed.replace(/^0\s+FILE\s+/i, "").trim();
				if (isFirstContent) {
					// This is the root file's own FILE marker
					isFirstContent = false;
					// Don't create a sub-file for the root
				} else {
					flushSubFile();
					currentSubName = fileName;
				}
				const cmd: LDrawComment = { type: 0, raw: trimmed, meta: "FILE" };
				commands.push(cmd);
				continue;
			}

			// If we're collecting sub-file lines, route them there
			if (currentSubName !== null) {
				currentSubLines.push(raw);
				continue;
			}

			const metaResult = parseMeta(trimmed, meta, isFirstContent && commands.length === 0);
			isFirstContent = false;

			// BFC state updates
			if (metaResult.bfc) {
				const stmt = metaResult.bfc;
				if (stmt === "CERTIFY CW") { bfc.certified = true; bfc.localWinding = "CW"; }
				else if (stmt === "CERTIFY CCW") { bfc.certified = true; bfc.localWinding = "CCW"; }
				else if (stmt === "NOCERTIFY") { bfc.certified = false; }
				else if (stmt === "CW") { bfc.localWinding = "CW"; }
				else if (stmt === "CCW") { bfc.localWinding = "CCW"; }
				else if (stmt === "INVERTNEXT") { bfc.invertNext = true; }
				else if (stmt === "CLIP") { bfc.clipEnabled = true; }
				else if (stmt === "NOCLIP") { bfc.clipEnabled = false; }
			}

			// TEXMAP
			if (/^0\s+!TEXMAP\b/i.test(trimmed)) {
				const texParts = trimmed.split(/\s+/);
				const keyword = (texParts[2] ?? "").toUpperCase();
				if (keyword === "START" || keyword === "NEXT") {
					const def = parseTexmapStart(texParts);
					if (def) {
						texmapStack.push({ phase: "BODY", definition: def, depth: texmapStack.length });
					}
				} else if (keyword === "FALLBACK") {
					// FALLBACK marks the current texmap as a fallback for the NEXT texmap,
					// but does NOT deactivate it. The current texmap remains active for
					// geometry lines until the NEXT replaces it.
					const top = texmapStack[texmapStack.length - 1];
					if (top) top.fallback = true;
				} else if (keyword === "END") {
					texmapStack.pop();
				}
				const cmd: LDrawComment = { type: 0, raw: trimmed, meta: "TEXMAP" };
				commands.push(cmd);
				continue;
			}

			const comment: LDrawComment = { type: 0, raw: trimmed, meta: metaResult.isFileMarker ? "FILE" : undefined };
			commands.push(comment);
			continue;
		}

		// Route to sub-file if we're collecting one
		if (currentSubName !== null) {
			currentSubLines.push(raw);
			continue;
		}

		isFirstContent = false;

		// Active TEXMAP definition for geometry lines
		const topTexmap = texmapStack[texmapStack.length - 1];
		const activeTexmap =
			topTexmap !== undefined && topTexmap.phase === "BODY"
				? topTexmap.definition
				: undefined;

		// ── Type 1 – Sub-file reference ──────────────────────────
		if (lineType === 1) {
			const colorCode = parseInt(parts[1] ?? "16", 10);
			const x = num(parts, 2), y = num(parts, 3), z = num(parts, 4);
			const a = num(parts, 5), b = num(parts, 6), c = num(parts, 7);
			const d = num(parts, 8), e = num(parts, 9), f = num(parts, 10);
			const g = num(parts, 11), h = num(parts, 12), i = num(parts, 13);
			// File name may contain spaces
			const fileName = parts.slice(14).join(" ");

			const transform = buildMatrix(x, y, z, a, b, c, d, e, f, g, h, i);
			const inverted = bfc.invertNext;
			if (bfc.invertNext) bfc.invertNext = false;

			const ref: LDrawSubFileRef = {
				type: 1,
				colorCode,
				transform,
				file: fileName,
				inverted,
				texmap: activeTexmap,
			};
			commands.push(ref);
			continue;
		}

		// ── Type 2 – Line ────────────────────────────────────────
		if (lineType === 2) {
			const colorCode = parseInt(parts[1] ?? "24", 10);
			const cmd: LDrawLine = {
				type: 2,
				colorCode,
				points: [vec(parts, 2), vec(parts, 5)],
			};
			commands.push(cmd);
			continue;
		}

		// ── Type 3 – Triangle ────────────────────────────────────
		if (lineType === 3) {
			const colorCode = parseInt(parts[1] ?? "16", 10);
			const winding = bfc.certified ? bfc.localWinding : undefined;
			const cmd: LDrawTriangle = {
				type: 3,
				colorCode,
				points: [vec(parts, 2), vec(parts, 5), vec(parts, 8)],
				winding,
				texmap: activeTexmap,
			};
			commands.push(cmd);
			continue;
		}

		// ── Type 4 – Quad ────────────────────────────────────────
		if (lineType === 4) {
			const colorCode = parseInt(parts[1] ?? "16", 10);
			const winding = bfc.certified ? bfc.localWinding : undefined;
			const cmd: LDrawQuad = {
				type: 4,
				colorCode,
				points: [vec(parts, 2), vec(parts, 5), vec(parts, 8), vec(parts, 11)],
				winding,
				texmap: activeTexmap,
			};
			commands.push(cmd);
			continue;
		}

		// ── Type 5 – Optional line ───────────────────────────────
		if (lineType === 5) {
			const colorCode = parseInt(parts[1] ?? "24", 10);
			const cmd: LDrawOptionalLine = {
				type: 5,
				colorCode,
				points: [vec(parts, 2), vec(parts, 5)],
				controlPoints: [vec(parts, 8), vec(parts, 11)],
			};
			commands.push(cmd);
			continue;
		}
	}

	// Flush last embedded sub-file
	flushSubFile();

	const file: LDrawFile = {
		name,
		meta,
		commands,
	};

	if (subFiles.size > 0) file.subFiles = subFiles;
	if (keepRawLines) file.rawLines = rawLines;

	return file;
}
