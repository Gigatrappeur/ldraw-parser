// ============================================================
// LDraw Parser – Core line-by-line parser
// ============================================================

import {
  type LDrawFile,
  type LDrawFileMeta,
  type LDrawCommand,
  type LDrawComment,
  type LDrawSubFileRef,
  type LDrawLine,
  type LDrawTriangle,
  type LDrawQuad,
  type LDrawOptionalLine,
  type LDrawColor,
  type Vec3,
  type TexmapDefinition,
  type TexmapPlanar,
  type TexmapCylindrical,
  type TexmapSpherical,
  type BFCStatement,
  type LDrawFileType,
} from "./types";
import { parseColorDefinition } from "./colors";
import { buildMatrix, normalizeFileName } from "./utils";

// ── Token helpers ─────────────────────────────────────────────

function tok(parts: string[], i: number): string {
  return parts[i] ?? "";
}

function num(parts: string[], i: number): number {
  return parseFloat(tok(parts, i)) || 0;
}

function vec(parts: string[], i: number): Vec3 {
  return { x: num(parts, i), y: num(parts, i + 1), z: num(parts, i + 2) };
}

// ── TEXMAP state machine ──────────────────────────────────────

type TexmapPhase = "START" | "BODY" | "FALLBACK";

interface TexmapState {
  phase: TexmapPhase;
  definition: TexmapDefinition;
  depth: number; // for nested texmaps
}

// ── BFC state ─────────────────────────────────────────────────

interface BFCState {
  certified: boolean;
  localWinding: "CW" | "CCW";
  clipEnabled: boolean;
  invertNext: boolean;
}

function defaultBFC(): BFCState {
  return { certified: false, localWinding: "CCW", clipEnabled: true, invertNext: false };
}

// ── Parse META (type-0) lines ─────────────────────────────────

function parseMeta(
  raw: string,
  meta: LDrawFileMeta,
  isFirstLine: boolean,
): { bfc?: BFCStatement; colorDef?: LDrawColor; fileName?: string; isFileMarker?: boolean } {
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

// ── Parse a TEXMAP opening line ───────────────────────────────

function parseTexmapStart(parts: string[]): TexmapDefinition | null {
  // 0 !TEXMAP START|NEXT PLANAR|CYLINDRICAL|SPHERICAL <...> <texture> [GLOSSMAP <gloss>]
  const startIdx = parts.findIndex((p) => /^(START|NEXT)$/i.test(p));
  if (startIdx < 0) return null;
  const projection = (parts[startIdx + 1] ?? "").toUpperCase();

  const textureIdx = parts.findIndex((p) => /\.png$/i.test(p));
  const texture = textureIdx >= 0 ? (parts[textureIdx] ?? "") : (parts[parts.length - 1] ?? "");
  const glossIdx = parts.findIndex((p) => /^GLOSSMAP$/i.test(p));
  const glossmap = glossIdx >= 0 ? parts[glossIdx + 1] : undefined;

  const p = (offset: number) =>
    vec(parts, startIdx + 2 + offset * 3);

  if (projection === "PLANAR") {
    return { projection: "PLANAR", point1: p(0), point2: p(1), point3: p(2), texture, glossmap } as TexmapPlanar;
  }
  if (projection === "CYLINDRICAL") {
    const angle = parseFloat(parts[startIdx + 2 + 9] ?? "360") || 360;
    return { projection: "CYLINDRICAL", point1: p(0), point2: p(1), point3: p(2), angle, texture, glossmap } as TexmapCylindrical;
  }
  if (projection === "SPHERICAL") {
    const angle1 = parseFloat(parts[startIdx + 2 + 9]  ?? "360") || 360;
    const angle2 = parseFloat(parts[startIdx + 2 + 10] ?? "180") || 180;
    return { projection: "SPHERICAL", point1: p(0), point2: p(1), point3: p(2), angle1, angle2, texture, glossmap } as TexmapSpherical;
  }
  return null;
}

// ── Main parser ───────────────────────────────────────────────

/**
 * Parse a single LDraw file content string into an LDrawFile.
 * Does NOT resolve sub-files – that is done by the Resolver.
 */
export function parseLDrawFile(
  content: string,
  name: string,
  keepRawLines = false,
): LDrawFile {
  const lines = content.split(/\r?\n/);
  const commands: LDrawCommand[] = [];
  const meta: LDrawFileMeta = {};
  const rawLines: string[] = keepRawLines ? [] : [];

  const bfc = defaultBFC();
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
          const top = texmapStack[texmapStack.length - 1];
          if (top) top.phase = "FALLBACK";
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
      const a = num(parts, 5),  b = num(parts, 6),  c = num(parts, 7);
      const d = num(parts, 8),  e = num(parts, 9),  f = num(parts, 10);
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
