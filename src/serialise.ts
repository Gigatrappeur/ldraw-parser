// ============================================================
// LDraw Parser – File Serialiser
// ============================================================
//
// Converts a parsed LDrawFile (or any subset of commands) back
// to a canonical, standards-compliant LDraw text string.
//
// Use cases:
//   • Round-tripping: parse → transform → re-serialise
//   • Generating new LDraw files programmatically
//   • Normalising / pretty-printing existing files
//   • Creating MPD archives from individual files
// ============================================================

import type {
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
  Matrix4,
  Vec3,
} from "./types.js";

// ── Formatting helpers ────────────────────────────────────────

const F = (n: number, d = 4): string => {
  // Remove trailing zeros after decimal point
  const s = n.toFixed(d);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
};

function vec(v: Vec3): string { return `${F(v.x)} ${F(v.y)} ${F(v.z)}`; }

/**
 * Serialise a column-major 4×4 matrix back to LDraw row-major 3×4.
 * LDraw format: x y z  a b c  d e f  g h i
 * Our storage : column-major, so we transpose the rotation part.
 */
function mat(m: Matrix4): string {
  // Translation
  const x = m[12]!, y = m[13]!, z = m[14]!;
  // Rotation: column-major → row-major transpose
  //   col0 = [m0, m1, m2]  → LDraw row0 = [m0, m4, m8]  (a b c)
  //   col1 = [m4, m5, m6]  → LDraw row1 = [m1, m5, m9]  (d e f)
  //   col2 = [m8, m9, m10] → LDraw row2 = [m2, m6, m10] (g h i)
  const a = m[0]!, b = m[4]!, c = m[8]!;
  const d = m[1]!, e = m[5]!, f = m[9]!;
  const g = m[2]!, h = m[6]!, i = m[10]!;
  return `${F(x)} ${F(y)} ${F(z)}  ${F(a)} ${F(b)} ${F(c)}  ${F(d)} ${F(e)} ${F(f)}  ${F(g)} ${F(h)} ${F(i)}`;
}

// ── Colour serialisation ──────────────────────────────────────

function hexColor(value: number): string {
  return `#${value.toString(16).toUpperCase().padStart(6, "0")}`;
}

/**
 * Serialise an LDrawColor as a `0 !COLOUR` definition line.
 */
export function serialiseColor(color: LDrawColor): string {
  const parts: string[] = [
    `0 !COLOUR ${color.name}`,
    `CODE ${color.code}`,
    `VALUE ${hexColor(color.value)}`,
    `EDGE ${hexColor(color.edge)}`,
  ];
  if (color.alpha !== 255) parts.push(`ALPHA ${color.alpha}`);
  if (color.luminance !== 0) parts.push(`LUMINANCE ${color.luminance}`);

  switch (color.finish) {
    case "CHROME":        parts.push("CHROME"); break;
    case "PEARLESCENT":   parts.push("PEARLESCENT"); break;
    case "RUBBER":        parts.push("RUBBER"); break;
    case "MATTE_METALLIC":parts.push("MATTE_METALLIC"); break;
    case "METAL":         parts.push("METAL"); break;
    case "MATERIAL": {
      const mat2 = color.material;
      if (mat2) {
        const sub: string[] = [
          `MATERIAL ${mat2.type}`,
          `VALUE #${mat2.value}`,
          `ALPHA ${mat2.alpha ?? 255}`,
          `LUMINANCE ${mat2.luminance ?? 0}`,
          `FRACTION ${mat2.fraction}`,
          `VFRACTION ${mat2.vfraction}`,
        ];
        if (mat2.size   !== undefined) sub.push(`SIZE ${mat2.size}`);
        if (mat2.minsize !== undefined) sub.push(`MINSIZE ${mat2.minsize}`);
        if (mat2.maxsize !== undefined) sub.push(`MAXSIZE ${mat2.maxsize}`);
        parts.push(sub.join(" "));
      }
      break;
    }
  }

  return parts.join(" ");
}

// ── Meta header serialisation ─────────────────────────────────

function serialiseMeta(meta: LDrawFileMeta): string[] {
  const lines: string[] = [];

  if (meta.name)     lines.push(`0 Name: ${meta.name}`);
  if (meta.author)   lines.push(`0 Author: ${meta.author}`);
  if (meta.fileType) lines.push(`0 !LDRAW_ORG ${meta.fileType}`);
  if (meta.license)  lines.push(`0 !LICENSE ${meta.license}`);

  if (meta.help?.length) {
    for (const h of meta.help) lines.push(`0 !HELP ${h}`);
  }

  if (meta.category) lines.push(`0 !CATEGORY ${meta.category}`);

  if (meta.keywords?.length) {
    // LDraw spec: up to ~several keywords per line; we group in 5s
    for (let i = 0; i < meta.keywords.length; i += 5) {
      lines.push(`0 !KEYWORDS ${meta.keywords.slice(i, i + 5).join(", ")}`);
    }
  }

  if (meta.cmdline) lines.push(`0 !CMDLINE ${meta.cmdline}`);

  if (meta.history?.length) {
    for (const h of meta.history) {
      lines.push(`0 !HISTORY ${h.date} [${h.author}] ${h.description}`);
    }
  }

  if (meta.bfcCertified !== undefined) {
    if (meta.bfcCertified) {
      lines.push(`0 BFC CERTIFY ${meta.bfcWinding ?? "CCW"}`);
    } else {
      lines.push(`0 BFC NOCERTIFY`);
    }
  }

  if (meta.colors?.length) {
    lines.push("");
    for (const c of meta.colors) lines.push(serialiseColor(c));
  }

  return lines;
}

// ── Command serialisation ─────────────────────────────────────

function serialiseCommand(cmd: LDrawCommand): string {
  switch (cmd.type) {
    case 0:
      return cmd.raw;

    case 1: {
      const r = cmd as LDrawSubFileRef;
      return `1 ${r.colorCode} ${mat(r.transform)} ${r.file}`;
    }

    case 2: {
      const l = cmd as LDrawLine;
      return `2 ${l.colorCode} ${vec(l.points[0])} ${vec(l.points[1])}`;
    }

    case 3: {
      const t = cmd as LDrawTriangle;
      return `3 ${t.colorCode} ${vec(t.points[0])} ${vec(t.points[1])} ${vec(t.points[2])}`;
    }

    case 4: {
      const q = cmd as LDrawQuad;
      return `4 ${q.colorCode} ${vec(q.points[0])} ${vec(q.points[1])} ${vec(q.points[2])} ${vec(q.points[3])}`;
    }

    case 5: {
      const o = cmd as LDrawOptionalLine;
      return `5 ${o.colorCode} ${vec(o.points[0])} ${vec(o.points[1])} ${vec(o.controlPoints[0])} ${vec(o.controlPoints[1])}`;
    }
  }
}

// ── SerialiseOptions ──────────────────────────────────────────

export interface SerialiseOptions {
  /**
   * Include sub-files in the output as a proper MPD document
   * (each sub-file preceded by `0 FILE <name>`).
   * Default: true when `file.subFiles` is non-empty.
   */
  mpd?: boolean;

  /**
   * Newline character(s). Default: "\r\n" (LDraw standard).
   */
  newline?: string;

  /**
   * When true, description line is written even if empty.
   * Default: false.
   */
  alwaysDescription?: boolean;
}

// ── Main serialiser ───────────────────────────────────────────

/**
 * Serialise a single set of commands + meta to a string (no FILE marker).
 */
function serialiseBody(
  meta: LDrawFileMeta,
  commands: LDrawCommand[],
  nl: string,
): string {
  const lines: string[] = [];

  if (meta.description) {
    lines.push(`0 ${meta.description}`);
  }

  lines.push(...serialiseMeta(meta));

  if (lines.length > 0) lines.push(""); // blank line before geometry

  for (const cmd of commands) {
    lines.push(serialiseCommand(cmd));
  }

  return lines.join(nl);
}

/**
 * Serialise a parsed LDrawFile back to a valid .ldr / .mpd string.
 *
 * @param file    The parsed LDrawFile to serialise
 * @param options Serialisation options
 * @returns       The LDraw text content
 *
 * @example
 * ```ts
 * const { file } = await parser.parse(content, "model.ldr");
 * // Modify file.commands, file.meta, etc.
 * const newContent = serialiseLDrawFile(file);
 * await Bun.write("modified.ldr", newContent);
 * ```
 */
export function serialiseLDrawFile(
  file: LDrawFile,
  options: SerialiseOptions = {},
): string {
  const nl      = options.newline ?? "\r\n";
  const isMpd   = options.mpd ?? (file.subFiles !== undefined && file.subFiles.size > 0);

  const parts: string[] = [];

  if (isMpd && file.subFiles && file.subFiles.size > 0) {
    // ── MPD format ─────────────────────────────────────────
    // Root file: must have its own "0 FILE <name>" marker
    const rootName = file.name || file.meta.name || "model.ldr";
    parts.push(`0 FILE ${rootName}`);
    parts.push(serialiseBody(file.meta, file.commands, nl));

    // Embedded sub-files
    for (const [subName, subFile] of file.subFiles) {
      parts.push("");
      parts.push(`0 FILE ${subFile.name || subName}`);
      parts.push(serialiseBody(subFile.meta, subFile.commands, nl));
    }
  } else {
    // ── Single-file .ldr format ────────────────────────────
    parts.push(serialiseBody(file.meta, file.commands, nl));
  }

  return parts.join(nl);
}

// ── Convenience: build a minimal LDrawFile ────────────────────

export interface MinimalFileOptions {
  description?: string;
  name?:        string;
  author?:      string;
  bfc?:         boolean;
  winding?:     "CW" | "CCW";
}

/**
 * Build a minimal LDrawFile structure suitable for serialisation,
 * without going through the full parser.
 *
 * @example
 * ```ts
 * const file = buildLDrawFile({
 *   description: "My Custom Part",
 *   name: "custom.dat",
 *   bfc: true,
 * });
 * // Add geometry commands
 * file.commands.push({
 *   type: 3, colorCode: 4,
 *   points: [{ x:0,y:0,z:0 }, { x:10,y:0,z:0 }, { x:5,y:10,z:0 }],
 * });
 * const ldr = serialiseLDrawFile(file);
 * ```
 */
export function buildLDrawFile(opts: MinimalFileOptions = {}): LDrawFile {
  return {
    name: opts.name ?? "model.ldr",
    meta: {
      description:  opts.description,
      name:         opts.name,
      author:       opts.author,
      bfcCertified: opts.bfc ?? false,
      bfcWinding:   opts.winding ?? "CCW",
    },
    commands: [],
  };
}

// ── MPD builder ───────────────────────────────────────────────

/**
 * Combine multiple LDrawFiles into a single MPD (Multi-Part Document).
 * The first file in the array becomes the root model.
 *
 * @example
 * ```ts
 * const mpd = buildMpd([mainModel, partA, partB]);
 * const mpdString = serialiseLDrawFile(mpd);
 * await Bun.write("assembly.mpd", mpdString);
 * ```
 */
export function buildMpd(files: LDrawFile[]): LDrawFile {
  if (files.length === 0) throw new Error("buildMpd: at least one file required");

  const root = files[0]!;
  const subFiles = new Map<string, LDrawFile>();

  for (const f of files.slice(1)) {
    const key = f.name.toLowerCase().replace(/\\/g, "/");
    subFiles.set(key, f);
  }

  return { ...root, subFiles };
}
