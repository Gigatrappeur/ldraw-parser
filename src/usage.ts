// ============================================================
// LDraw Parser – Usage examples (Bun backend)
// ============================================================
//
// Run with:  bun run examples/usage.ts

import { join } from "node:path";
import { LDrawParser } from "../src/index";
import type { LDrawFile, FlatGeometry } from "../src/types";

// ─────────────────────────────────────────────────────────────
// 1. Basic setup: file resolver using the local LDraw library
// ─────────────────────────────────────────────────────────────

const LDRAW_LIB = process.env.LDRAW_LIB ?? "/usr/share/ldraw"; // adjust to your installation

async function fileResolver(name: string): Promise<string | null> {
  // LDraw file name resolution order:
  //   1. parts/         (official parts)
  //   2. p/             (primitives)
  //   3. p/48/          (high-res primitives)
  //   4. models/        (models)
  //   5. unofficial/parts/ etc.
  const normalised = name.replace(/\\/g, "/");
  const candidates = [
    join(LDRAW_LIB, normalised),
    join(LDRAW_LIB, "parts",   normalised),
    join(LDRAW_LIB, "p",       normalised),
    join(LDRAW_LIB, "p", "48", normalised),
    join(LDRAW_LIB, "models",  normalised),
    join(LDRAW_LIB, "unofficial", "parts", normalised),
    join(LDRAW_LIB, "unofficial", "p",     normalised),
  ];

  for (const path of candidates) {
    const f = Bun.file(path);
    if (await f.exists()) return await f.text();
  }

  return null;
}

// Optionally load LDConfig for full official colour table
async function loadLdConfig(): Promise<string | null> {
  const f = Bun.file(join(LDRAW_LIB, "LDConfig.ldr"));
  return (await f.exists()) ? await f.text() : null;
}

// ─────────────────────────────────────────────────────────────
// 2. Create parser instance
// ─────────────────────────────────────────────────────────────

const parser = new LDrawParser({
  resolveFile: fileResolver,
  processBFC:  true,
  flatten:     true,
  maxDepth:    64,
});

// Optionally load the full colour table from LDConfig.ldr
const ldconfig = await loadLdConfig();
if (ldconfig) {
  parser.loadColorTable(ldconfig);
  console.log("✓ LDConfig.ldr loaded");
}

// ─────────────────────────────────────────────────────────────
// 3. Parse an LDR model file
// ─────────────────────────────────────────────────────────────

async function parseModel(ldrPath: string) {
  const content = await Bun.file(ldrPath).text();
  const { file, geometry } = await parser.parse(content, ldrPath);

  // ── Metadata ────────────────────────────────────────────────
  console.log("\n=== File metadata ===");
  console.log("Description:", file.meta.description);
  console.log("Name:       ", file.meta.name);
  console.log("Author:     ", file.meta.author);
  console.log("Type:       ", file.meta.fileType);
  console.log("Category:   ", file.meta.category);
  console.log("Keywords:   ", file.meta.keywords?.join(", "));
  console.log("License:    ", file.meta.license);
  console.log("BFC:        ", file.meta.bfcCertified ? `yes (${file.meta.bfcWinding})` : "no");

  if (file.meta.history?.length) {
    console.log("History:");
    for (const h of file.meta.history) {
      console.log(`  ${h.date} [${h.author}] ${h.description}`);
    }
  }

  // ── Geometry stats ───────────────────────────────────────────
  if (geometry) {
    const triCount = geometry.meshes.reduce((acc, m) => acc + m.triangles.length, 0);
    const segCount = geometry.edges.reduce((acc, e)  => acc + e.segments.length,  0);
    console.log("\n=== Geometry ===");
    console.log(`Meshes:    ${geometry.meshes.length}`);
    console.log(`Triangles: ${triCount}`);
    console.log(`Edges:     ${segCount}`);
    console.log(`AABB:      ${JSON.stringify(geometry.aabb.size)}`);
    console.log(`Radius:    ${geometry.aabb.radius.toFixed(2)} LDU`);

    // Show transparent colour usage
    const transparentMeshes = geometry.meshes.filter((m) => m.color.isTransparent);
    if (transparentMeshes.length) {
      console.log(`\nTransparent meshes: ${transparentMeshes.length}`);
      for (const m of transparentMeshes) {
        console.log(`  code ${m.colorCode} "${m.color.name}" alpha=${m.color.alpha}`);
      }
    }
  }

  return { file, geometry };
}

// ─────────────────────────────────────────────────────────────
// 4. Generate SVG thumbnail
// ─────────────────────────────────────────────────────────────

async function saveSvg(geometry: FlatGeometry, outPath: string) {
  const svg = parser.toSvg(geometry, {
    azimuth:    45,
    elevation:  30,
    width:      512,
    height:     512,
    showEdges:  true,
    background: "#ffffff",
  });

  await Bun.write(outPath, svg);
  console.log(`✓ SVG thumbnail written to ${outPath}`);
}

// ─────────────────────────────────────────────────────────────
// 5. Generate GLB file
// ─────────────────────────────────────────────────────────────

async function saveGlb(geometry: FlatGeometry, outPath: string) {
  const glb = parser.toGlb(geometry, {
    normals: true,
    uvs:     true,
    name:    "LDrawModel",
  });

  await Bun.write(outPath, glb);
  console.log(`✓ GLB written to ${outPath} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
}

// ─────────────────────────────────────────────────────────────
// 6. Parse an inline MPD (multi-part document)
// ─────────────────────────────────────────────────────────────

const SAMPLE_MPD = `
0 Sample MPD
0 Name: sample.mpd
0 Author: Test
0 !LDRAW_ORG Model
0 !LICENSE Redistributable under CCAL version 2.0 : see CAreadme.txt
0 !KEYWORDS sample, demo

0 FILE main.ldr
0 Sample Model
0 Name: main.ldr
0 Author: Test
1 4 0 0 0 1 0 0 0 1 0 0 0 1 box.dat
1 1 0 -24 0 1 0 0 0 1 0 0 0 1 stud.dat

0 FILE box.dat
0 A simple box
0 Name: box.dat
0 !LDRAW_ORG Unofficial_Part
0 BFC CERTIFY CCW
4 16 -10 -10 10 10 -10 10 10 -10 -10 -10 -10 -10
4 16 -10 10 -10 10 10 -10 10 10 10 -10 10 10
4 16 -10 -10 -10 -10 10 -10 -10 10 10 -10 -10 10
4 16 10 -10 10 10 10 10 10 10 -10 10 -10 -10
4 16 -10 10 -10 -10 10 10 10 10 10 10 10 -10
4 16 -10 -10 10 -10 -10 -10 10 -10 -10 10 -10 10
`.trim();

async function demonstrateMpd() {
  console.log("\n=== MPD demo ===");
  const { file, geometry } = await parser.parse(SAMPLE_MPD, "sample.mpd");

  console.log("Root file:", file.name);
  console.log("Description:", file.meta.description);
  console.log("Keywords:", file.meta.keywords);
  console.log("Sub-files:", file.subFiles ? [...file.subFiles.keys()] : "none");

  if (geometry) {
    console.log("Triangles:", geometry.meshes.reduce((a, m) => a + m.triangles.length, 0));
  }
}

// ─────────────────────────────────────────────────────────────
// 7. Parse metadata only (fast path, no sub-file resolution)
// ─────────────────────────────────────────────────────────────

function extractMetadataOnly(ldrContent: string): void {
  const file = parser.parseOnly(ldrContent, "quick.ldr");
  console.log("\n=== Quick metadata ===");
  console.log("Description:", file.meta.description);
  console.log("Keywords:   ", file.meta.keywords);
  console.log("Category:   ", file.meta.category);
}

// ─────────────────────────────────────────────────────────────
// 8. HTTP server example (Bun)
// ─────────────────────────────────────────────────────────────

export function createLDrawServer(port = 3000) {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // POST /parse  → returns JSON { meta, stats }
      if (req.method === "POST" && url.pathname === "/parse") {
        const body = await req.text();
        const name = url.searchParams.get("name") ?? "model.ldr";
        const { file, geometry } = await parser.parse(body, name);
        return Response.json({
          meta:     file.meta,
          subFiles: file.subFiles ? [...file.subFiles.keys()] : [],
          stats: geometry ? {
            meshes:    geometry.meshes.length,
            triangles: geometry.meshes.reduce((a, m) => a + m.triangles.length, 0),
            edges:     geometry.edges.reduce((a, e)  => a + e.segments.length,  0),
            aabb:      geometry.aabb,
          } : null,
        });
      }

      // POST /thumbnail.svg  → returns SVG image
      if (req.method === "POST" && url.pathname === "/thumbnail.svg") {
        const body  = await req.text();
        const name  = url.searchParams.get("name") ?? "model.ldr";
        const az    = parseFloat(url.searchParams.get("az")  ?? "45");
        const el    = parseFloat(url.searchParams.get("el")  ?? "30");
        const size  = parseInt(  url.searchParams.get("size") ?? "512", 10);
        const { geometry } = await parser.parse(body, name);
        if (!geometry) return new Response("No geometry", { status: 400 });
        const svg = parser.toSvg(geometry, { azimuth: az, elevation: el, width: size, height: size });
        return new Response(svg, {
          headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
        });
      }

      // POST /model.glb  → returns binary GLB
      if (req.method === "POST" && url.pathname === "/model.glb") {
        const body = await req.text();
        const name = url.searchParams.get("name") ?? "model.ldr";
        const { geometry } = await parser.parse(body, name);
        if (!geometry) return new Response("No geometry", { status: 400 });
        const glb = parser.toGlb(geometry, { normals: true, uvs: true });
        return new Response(glb, {
          headers: {
            "Content-Type":        "model/gltf-binary",
            "Content-Disposition": 'attachment; filename="model.glb"',
          },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`LDraw server listening on http://localhost:${server.port}`);
  return server;
}

// ─────────────────────────────────────────────────────────────
// Run demos
// ─────────────────────────────────────────────────────────────

await demonstrateMpd();
extractMetadataOnly(SAMPLE_MPD);

// Uncomment to test with a real LDraw file:
// const { file, geometry } = await parseModel("path/to/model.ldr");
// if (geometry) {
//   await saveSvg(geometry, "output/thumbnail.svg");
//   await saveGlb(geometry, "output/model.glb");
// }

// Uncomment to start the HTTP server:
// createLDrawServer(3000);
