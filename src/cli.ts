#!/usr/bin/env bun
// ============================================================
// LDraw Parser – CLI batch converter
// Usage:  bun run src/cli.ts [options] <file> [file...]
// ============================================================

import Bun from 'bun'
import { join, basename, extname, resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { LDrawParser } from "./index";
import { createNodeResolver, loadLdConfigNode, warmNodeResolverCache } from "./node-resolver";
import { generateGlbV2 } from "./glb2";
import { generateObj } from "./obj";
import { computeStats, transformGeometry, lduToUnitScale, mergeGeometry, applyColorOverrides, type LengthUnit } from "./postprocess";
import { generateSvgThumbnail } from "./svg";
import { buildColorTable } from "./colors";
import type { FlatGeometry, LDrawColor } from "./types";

// ── CLI argument parser ───────────────────────────────────────

// ── Color spec ────────────────────────────────────────────────
//
//  A color spec accepted on the CLI can be:
//    - An LDraw code integer        4         (Red)
//    - A 6-digit hex string         #FF0000   (with or without #)
//    - A color name                 Red       (case-insensitive)
//
//  --color <spec>
//      Override the model's main color (LDraw code 16).
//      Parts that inherit the parent color will use this value.
//
//  --color-map <code:spec[,code:spec...]>
//      Remap any LDraw code to a new color.
//      Example:  --color-map "4:#00FF00,1:Yellow"
//
// Both flags can be combined.

interface CliOptions {
  inputs:       string[];
  outDir:       string;
  formats:      Set<"glb" | "svg" | "obj" | "json">;
  unit:         string;
  svgSize:      number;
  svgAzimuth:   number;
  svgElevation: number;
  smooth:       boolean;
  creaseAngle:  number;
  merge:        boolean;
  libraryRoot:  string | undefined;
  verbose:      boolean;
  help:         boolean;
  statsOnly:    boolean;
  /** Remap specific color codes: "4:#FF0000,1:Blue" */
  colorMap: string | undefined;
  /** Parsed --color spec (resolved before parser creation) */
  colorOverride: string | undefined;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    inputs:       [],
    outDir:       "./out",
    formats:      new Set(["glb", "svg"]),
    unit:         "m",
    svgSize:      512,
    svgAzimuth:   45,
    svgElevation: 30,
    smooth:       true,
    creaseAngle:  45,
    merge:        true,
    libraryRoot:  process.env["LDRAW_LIB"],
    verbose:       false,
    help:          false,
    statsOnly:     false,
    colorOverride: undefined,
    colorMap:      undefined,
  };

  const args = argv.slice(2);
  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    switch (a) {
      case "-h": case "--help":       opts.help = true; break;
      case "-v": case "--verbose":    opts.verbose = true; break;
      case "--stats":                 opts.statsOnly = true; break;
      case "--no-smooth":             opts.smooth = false; break;
      case "--no-merge":              opts.merge = false; break;
      case "-o": case "--out":        opts.outDir = args[++i] ?? "./out"; break;
      case "--unit":                  opts.unit = args[++i] ?? "m"; break;
      case "--svg-size":              opts.svgSize = parseInt(args[++i] ?? "512"); break;
      case "--az":                    opts.svgAzimuth = parseFloat(args[++i] ?? "45"); break;
      case "--el":                    opts.svgElevation = parseFloat(args[++i] ?? "30"); break;
      case "--crease":                opts.creaseAngle = parseFloat(args[++i] ?? "45"); break;
      case "--library": case "--lib": opts.libraryRoot = args[++i]; break;
      case "--color":                opts.colorOverride = args[++i]; break;
      case "--color-map":            opts.colorMap = args[++i]; break;
      case "--format": case "-f": {
        const fmts = (args[++i] ?? "glb,svg").split(",");
        opts.formats = new Set(fmts.filter((f): f is "glb" | "svg" | "obj" | "json" =>
          ["glb", "svg", "obj", "json"].includes(f)));
        break;
      }
      default:
        if (!a.startsWith("-")) opts.inputs.push(a);
    }
    i++;
  }

  return opts;
}

// ── Help text ─────────────────────────────────────────────────

function printHelp() {
  console.log(`
ldraw-parser CLI — LDraw → GLB / SVG / OBJ / JSON converter

USAGE
  bun run src/cli.ts [options] <file.ldr|mpd|dat> [...]

OPTIONS
  -o, --out <dir>       Output directory (default: ./out)
  -f, --format <list>   Comma-separated formats: glb,svg,obj,json  (default: glb,svg)
  --unit <unit>         Output unit: ldu|mm|cm|m|in|studs  (default: m)
  --lib, --library <p>  Path to LDraw library root (env: LDRAW_LIB)
  --svg-size <px>       SVG thumbnail size in pixels (default: 512)
  --az <deg>            SVG camera azimuth angle (default: 45)
  --el <deg>            SVG camera elevation angle (default: 30)
  --crease <deg>        Smooth normals crease angle (default: 45)
  --no-smooth           Disable smooth normals (flat shading)
  --no-merge            Don't merge meshes by color
  --stats               Print geometry stats only, no file output
  --color <spec>        Override the main color (code 16)
                          spec = LDraw code | #RRGGBB | color name
                          Example: --color 4   --color "#FF0000"   --color Red
  --color-map <map>     Remap specific color codes (comma-separated)
                          map = <code>:<spec>[,<code>:<spec>...]
                          Example: --color-map "4:#00FF00,1:Yellow"
  -v, --verbose         Verbose logging
  -h, --help            Show this help

EXAMPLES
  bun run src/cli.ts model.mpd
  bun run src/cli.ts -f glb,svg,obj -o ./exports *.ldr
  bun run src/cli.ts --stats model.ldr
  bun run src/cli.ts --lib /usr/share/ldraw --unit mm -f glb model.ldr
  bun run src/cli.ts --color 4 model.dat
  bun run src/cli.ts --color "#FF6600" -f glb,svg model.ldr
  bun run src/cli.ts --color-map "16:Red,4:#0000FF" model.ldr
`);
}

// ── Format a byte size ────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

// ── Color spec parser ────────────────────────────────────────

/**
 * Parse a single color spec string into an LDrawColor.
 *
 * Accepted forms:
 *   - "4"          → LDraw color code integer
 *   - "#FF0000"    → hex RGB (# optional)
 *   - "Red"        → color name (case-insensitive, matched against table)
 *
 * Returns null when the spec cannot be resolved.
 */
function parseColorSpec(spec: string, table: Map<number, LDrawColor>): LDrawColor | null {
  const s = spec.trim();

  // ── Try integer color code ────────────────────────────────
  if (/^\d+$/.test(s)) {
    const code = parseInt(s, 10);
    return table.get(code) ?? null;
  }

  // ── Try hex color #RRGGBB or RRGGBB ──────────────────────
  const hexMatch = s.match(/^#?([0-9A-Fa-f]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    const v = parseInt(hex, 16);
    const r = ((v >> 16) & 0xff) / 255;
    const g = ((v >>  8) & 0xff) / 255;
    const b = (v         & 0xff) / 255;
    // Synthesise an anonymous color with code 16 (will be set by caller)
    return {
      code:          16,
      name:          `#${hex.toUpperCase()}`,
      value:         v,
      edge:          0x595959,
      alpha:         255,
      luminance:     0,
      finish:        "NORMAL",
      isTransparent: false,
      rgba:          [r, g, b, 1],
      edgeRgba:      [0.35, 0.35, 0.35, 1],
    } satisfies LDrawColor;
  }

  // ── Try hex with alpha #RRGGBBAA ──────────────────────────
  const hexAlphaMatch = s.match(/^#?([0-9A-Fa-f]{8})$/);
  if (hexAlphaMatch) {
    const hex = hexAlphaMatch[1]!;
    const v    = parseInt(hex.slice(0, 6), 16);
    const a255 = parseInt(hex.slice(6, 8), 16);
    const r = ((v >> 16) & 0xff) / 255;
    const g = ((v >>  8) & 0xff) / 255;
    const b = (v         & 0xff) / 255;
    const a = a255 / 255;
    return {
      code:          16,
      name:          `#${hex.toUpperCase()}`,
      value:         v,
      edge:          0x595959,
      alpha:         a255,
      luminance:     0,
      finish:        "NORMAL",
      isTransparent: a < 1,
      rgba:          [r, g, b, a],
      edgeRgba:      [0.35, 0.35, 0.35, 1],
    } satisfies LDrawColor;
  }

  // ── Try color name ────────────────────────────────────────
  const lower = s.toLowerCase();
  for (const color of table.values()) {
    if (color.name.toLowerCase() === lower) return color;
  }
  // Partial match (e.g. "dark blue" → "Dark_Blue")
  for (const color of table.values()) {
    if (color.name.toLowerCase().replace(/_/g, " ") === lower) return color;
  }

  return null;
}

/**
 * Build the Map<code, LDrawColor> of overrides from CLI options.
 * Code 16 is used when --color is given without a --color-map entry for 16.
 */
function buildColorOverrides(
  opts: CliOptions,
  table: Map<number, LDrawColor>,
): Map<number, LDrawColor> {
  const overrides = new Map<number, LDrawColor>();

  // --color-map → remap specific codes (--color is handled via parser defaultColor)
  if (opts.colorMap) {
    for (const entry of opts.colorMap.split(",")) {
      const colon = entry.indexOf(":");
      if (colon < 1) {
        console.warn(`  ⚠ Invalid --color-map entry: "${entry.trim()}" – expected <code>:<spec>`);
        continue;
      }
      const codeStr = entry.slice(0, colon).trim();
      const spec    = entry.slice(colon + 1).trim();
      const code    = parseInt(codeStr, 10);
      if (isNaN(code)) {
        console.warn(`  ⚠ Invalid color code in --color-map: "${codeStr}"`);
        continue;
      }
      const color = parseColorSpec(spec, table);
      if (color) {
        overrides.set(code, { ...color, code });
      } else {
        console.warn(`  ⚠ Unknown color spec in --color-map for code ${code}: "${spec}" – ignored`);
      }
    }
  }

  return overrides;
}

// ── Process a single file ─────────────────────────────────────

async function processFile(
  inputPath: string,
  opts: CliOptions,
  parser: LDrawParser,
): Promise<void> {
  const absInput = resolve(inputPath);
  const stem     = basename(absInput, extname(absInput));
  const outDir   = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });

  if (opts.verbose) console.log(`\n→ Processing: ${absInput}`);

  // Read file
  let content: string;
  try {
    content = await Bun.file(absInput).text();
  } catch {
    console.error(`  ✗ Cannot read file: ${absInput}`);
    return;
  }

  // Parse
  const t0 = performance.now();
  let geometry: FlatGeometry;
  try {
    const result = await parser.parse(content, basename(absInput));
    if (!result.geometry) {
      console.error(`  ✗ No geometry produced for: ${absInput}`);
      return;
    }
    geometry = result.geometry;

    const { file } = result;
    if (opts.verbose || opts.statsOnly) {
      console.log(`  Description : ${file.meta.description ?? "(none)"}`);
      if (file.meta.author)    console.log(`  Author      : ${file.meta.author}`);
      if (file.meta.category)  console.log(`  Category    : ${file.meta.category}`);
      if (file.meta.keywords?.length) console.log(`  Keywords    : ${file.meta.keywords.join(", ")}`);
    }
  } catch (err) {
    console.error(`  ✗ Parse error: ${(err as Error).message}`);
    return;
  }

  const tParse = performance.now() - t0;

  // Stats
  const stats = computeStats(geometry);
  if (opts.verbose || opts.statsOnly) {
    console.log(`  Triangles   : ${fmtNum(stats.triangleCount)}`);
    console.log(`  Vertices    : ${fmtNum(stats.vertexCount)}`);
    console.log(`  Colors      : ${stats.colorCount}`);
    console.log(`  Transparent : ${stats.transparentMeshes} mesh(es)`);
    console.log(`  AABB size   : ${stats.aabb.size.x.toFixed(1)} × ${stats.aabb.size.y.toFixed(1)} × ${stats.aabb.size.z.toFixed(1)} LDU`);
    console.log(`  Est. memory : ${fmtBytes(stats.estimatedBytes)}`);
    console.log(`  Parse time  : ${tParse.toFixed(1)} ms`);
  }

  if (opts.statsOnly) return;

  // ── Color overrides ───────────────────────────────────────
  // --color-map: remap specific color codes post-parse
  const colorOverrides = buildColorOverrides(opts, parser.colorTable);
  if (colorOverrides.size > 0) {
    geometry = applyColorOverrides(geometry, colorOverrides);
    if (opts.verbose) {
      console.log(`  Color map applied: ${[...colorOverrides.entries()]
        .map(([code, c]) => `${code}→${c.name}(#${c.value.toString(16).padStart(6,"0")})`).join(", ")}`);
    }
  }

  // ── GLB ──────────────────────────────────────────────────
  if (opts.formats.has("glb")) {
    const t1 = performance.now();
    // Convert to target unit + Y-up axis (LDraw → glTF convention)
    const unit = opts.unit as LengthUnit;
    const scale = unit === "ldu" ? 1 : lduToUnitScale(unit);
    const geoForGlb = opts.merge
      ? mergeGeometry(transformGeometry(geometry, scale, true))
      : transformGeometry(geometry, scale, true);
    const glb = await generateGlbV2(geoForGlb, {
      name:    stem,
      normals: true,
      weld:    opts.smooth
        ? { smoothNormals: true, creasAngle: opts.creaseAngle }
        : { smoothNormals: false },
    });
    const outPath = join(outDir, `${stem}.glb`);
    await Bun.write(outPath, glb);
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ GLB  → ${outPath}  (${fmtBytes(glb.byteLength)}, ${dt} ms)`);
  }

  // ── SVG ──────────────────────────────────────────────────
  if (opts.formats.has("svg")) {
    const t1  = performance.now();
    const svg = generateSvgThumbnail(geometry, {
      width:     opts.svgSize,
      height:    opts.svgSize,
      azimuth:   opts.svgAzimuth,
      elevation: opts.svgElevation,
      showEdges: true,
      background: "#ffffff",
    });
    const outPath = join(outDir, `${stem}.svg`);
    await Bun.write(outPath, svg);
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ SVG  → ${outPath}  (${fmtBytes(svg.length)}, ${dt} ms)`);
  }

  // ── OBJ ──────────────────────────────────────────────────
  if (opts.formats.has("obj")) {
    const t1 = performance.now();
    const { obj, mtl, mtlFileName } = generateObj(geometry, {
      name:        stem,
      unit:        opts.unit as any,
      normals:     opts.smooth,
      creaseAngle: opts.creaseAngle,
    });
    await Bun.write(join(outDir, `${stem}.obj`), obj);
    await Bun.write(join(outDir, mtlFileName),   mtl);
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ OBJ  → ${join(outDir, stem + ".obj")}  (${fmtBytes(obj.length + mtl.length)}, ${dt} ms)`);
  }

  // ── JSON (geometry + metadata) ───────────────────────────
  if (opts.formats.has("json")) {
    const t1 = performance.now();
    const { file } = await parser.parse(content, basename(absInput));
    const payload = {
      meta:  file.meta,
      stats: computeStats(geometry),
      aabb:  geometry.aabb,
      palette: parser.palette(geometry).map((p) => ({
        code: p.color.code,
        name: p.color.name,
        hex: `#${p.color.value.toString(16).padStart(6, "0")}`,
        alpha: p.color.alpha,
        triangles: p.triangleCount,
      })),
    };
    const outPath = join(outDir, `${stem}.json`);
    await Bun.write(outPath, JSON.stringify(payload, null, 2));
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ JSON → ${outPath}  (${dt} ms)`);
  }
}

// ── Entry point ───────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help || opts.inputs.length === 0) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  // Set up parser
  const resolver = createNodeResolver({ libraryRoot: opts.libraryRoot });

  // Load colour table first so parseColorSpec can match names
  const ldconfig = await loadLdConfigNode(opts.libraryRoot);
  const baseTable = buildColorTable(ldconfig ?? undefined);

  // Resolve --color into a defaultColor for the parser (overrides code 16)
  let defaultColor = baseTable.get(71); // Light Bluish Grey — standard LDraw default
  if (opts.colorOverride) {
    const resolved = parseColorSpec(opts.colorOverride, baseTable);
    if (resolved) {
      defaultColor = { ...resolved, code: 16 };
      if (opts.verbose)
        console.log(`✓ Default color: ${defaultColor.name} (#${defaultColor.value.toString(16).padStart(6,"0")})`);
    } else {
      console.warn(`⚠ Unknown --color spec: "${opts.colorOverride}" – using default`);
    }
  }

  const parser = new LDrawParser({
    resolveFile:  resolver,
    colorTable:   baseTable,
    defaultColor,
  });

  if (ldconfig) {
    if (opts.verbose) console.log(`✓ LDConfig.ldr loaded`);
  } else if (opts.verbose) {
    console.warn("⚠ LDConfig.ldr not found – using built-in colour table");
  }

  // Warm caches
  if (opts.libraryRoot || process.env["LDRAW_LIB"]) {
    await warmNodeResolverCache(opts.libraryRoot);
    if (opts.verbose) console.log("✓ Directory caches warmed");
  }

  const total = opts.inputs.length;
  let success = 0;

  for (const input of opts.inputs) {
    try {
      await processFile(input, opts, parser);
      success++;
    } catch (err) {
      console.error(`✗ Failed: ${input}\n  ${(err as Error).message}`);
    }
  }

  console.log(`\nDone: ${success}/${total} file(s) converted`);
  if (success < total) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});