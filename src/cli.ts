#!/usr/bin/env bun
import {  write as bunWrite } from "bun";
// ============================================================
// LDraw Parser – CLI batch converter
// Usage:  bun run src/cli.ts [options] <file> [file...]
// ============================================================

import { join, basename, extname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { LDrawParser } from "./index";
import { loadLdConfigNode, warmNodeResolverCache } from "./node-resolver";
import { generateGlbV2 } from "./glb2";
import { generateObj } from "./obj";
import { computeStats, transformGeometry, lduToUnitScale, mergeGeometry, type LengthUnit } from "./postprocess";
import { generateSvgThumbnail } from "./svg";
import type { FlatGeometry, LDrawFile } from "./types";



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
  /** Parsed --color spec (resolved before parser creation) */
  defaultColor: number | undefined;
}

export function parseColorSpec(spec: string): number | null {
  const trimmed = spec.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    const hex = parseInt(trimmed.replace("#", ""), 16);
    for (const code of [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19,20,21,22,23,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,45,46,47,52,54,57,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,89,92,100,110,112,115,118,120,125,128,134,135,137,142,147,148,150,151,178,179,183,184,185,186,187,189,191,212,216,217,226,230,232,236,272,273,288,295,299,308,313,320,321,322,323,324,325,326,330,335,351,353,366,373,375,378,379,383,406,449,450,462,484,494,495,496,503,504,505,507]) {
      const hexCode = code;
      if (hex === hexCode) return hexCode;
    }
    console.warn(`⚠ Unknown hex color: ${trimmed} – using default (71)`);
    return 71;
  }
  const num = parseInt(trimmed, 10);
  if (!isNaN(num)) return num;
  console.warn(`⚠ Cannot parse color spec "${trimmed}" – using default (71)`);
  return 71;
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
    defaultColor: undefined,
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
      case "--color":                opts.defaultColor = parseColorSpec(args[++i] ?? '71') ?? undefined; break;
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
  bun run src/cli.ts [options] --lib <path> <file.ldr|mpd|dat> [...]

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
  --ri, --relative-input  Treat input paths as relative to the library directory
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

// ── Process a single file ─────────────────────────────────────

async function processFile(
  inputPath: string,
  opts: CliOptions,
  parser: LDrawParser,
): Promise<void> {
  const absInput = inputPath;
  const stem     = basename(absInput, extname(absInput));
  const outDir   = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });

  if (opts.verbose) console.log(`\n→ Processing: ${absInput}`);

  // Parse
  const t0 = performance.now();
  let geometry: FlatGeometry;
  let file: LDrawFile;
  try {
    const result = await parser.parse(absInput, { defaultColor: opts.defaultColor });
    if (!result.geometry) {
      console.error(`  ✗ No geometry produced for: ${absInput}`);
      return;
    }
    geometry = result.geometry;

    file = result.file;
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
    await bunWrite(outPath, glb);
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
      showEdges: false,
    });
    const outPath = join(outDir, `${stem}.svg`);
    await bunWrite(outPath, svg);
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
    await bunWrite(join(outDir, `${stem}.obj`), obj);
    await bunWrite(join(outDir, mtlFileName),   mtl);
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ OBJ  → ${join(outDir, stem + ".obj")}  (${fmtBytes(obj.length + mtl.length)}, ${dt} ms)`);
  }

  // ── JSON (geometry + metadata) ───────────────────────────
  if (opts.formats.has("json")) {
    const t1 = performance.now();
    // const { file } = await parser.parse(content, basename(absInput));
    const payload = {
      meta:  file.meta,
      stats: computeStats(geometry),
      aabb:  geometry.aabb,
    };
    const outPath = join(outDir, `${stem}.json`);
    await bunWrite(outPath, JSON.stringify(payload, null, 2));
    const dt = (performance.now() - t1).toFixed(1);
    console.log(`  ✓ JSON → ${outPath}  (${dt} ms)`);
  }
}

// ── Entry point ───────────────────────────────────────────────



async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help || opts.inputs.length === 0 || opts.libraryRoot === undefined) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  // Load colour table first so parseColorSpec can match names
  const ldconfig = await loadLdConfigNode(opts.libraryRoot);

  const parser = new LDrawParser({
    libraryRoot: opts.libraryRoot,
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
