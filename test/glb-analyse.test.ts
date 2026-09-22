// ============================================================
// GLB Analyser tests
// bun test test/glb-analyse.test.ts
// ============================================================

import { describe, test, expect } from "bun:test";
import { generateGlbV2 } from "../src/glb2";
import { analyseGlb, formatAnalysis, analysisToJson } from "../src/glb-analyser";
import type { GeometryMesh, Vec3 } from "../src/types";
import { buildColorTable } from "./color-table";
import type { LDrawColor } from "../src/colors";

// ── Fixtures ──────────────────────────────────────────────

const RED_COLOR: LDrawColor = buildColorTable().get(4)!;

function makeVec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function makeMesh(
  triangles: Array<[Vec3, Vec3, Vec3]>,
  colorCode = 4,
  _color: LDrawColor = RED_COLOR,
): GeometryMesh {
  return {
    colorCode,
    triangles: triangles.map(([a, b, c]) => ({
      a: { position: a },
      b: { position: b },
      c: { position: c },
    })),
  };
}

function makeFlatQuad(): GeometryMesh {
  return makeMesh([
    [makeVec(0, 0, 0), makeVec(10, 0, 0), makeVec(10, 0, 10)],
    [makeVec(0, 0, 0), makeVec(10, 0, 10), makeVec(0, 0, 10)],
  ]);
}

function makeFlatTriangle(): GeometryMesh {
  return makeMesh([
    [makeVec(0, 0, 0), makeVec(10, 0, 0), makeVec(0, 10, 0)],
  ]);
}

function makeFlatGeometry(meshes: GeometryMesh[]): any {
  const colorTable = new Map<number, LDrawColor>();
  for (const m of meshes) {
    if (!colorTable.has(m.colorCode)) {
      colorTable.set(m.colorCode, buildColorTable().get(m.colorCode) ?? RED_COLOR);
    }
  }
  return {
    meshes,
    edges: [],
    colorTable,
    aabb: {
      min: { x: -10, y: -10, z: -10 },
      max: { x: 10, y: 10, z: 10 },
      size: { x: 20, y: 20, z: 20 },
      center: { x: 0, y: 0, z: 0 },
      radius: 17.32,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────

describe("analyseGlb", () => {
  test("returns invalid for non-GLB data", () => {
    const empty = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = analyseGlb(empty);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Not a valid GLB file");
  });

  test("returns invalid for short buffer", () => {
    const short = new Uint8Array([0x46, 0x54, 0x6c, 0x67, 0x02]);
    const result = analyseGlb(short);
    expect(result.valid).toBe(false);
  });

  test("parses a valid GLB (single triangle)", async () => {
    const geo = makeFlatGeometry([makeFlatTriangle()]);
    const glb = await generateGlbV2(geo, { name: "TestTriangle" });
    const result = analyseGlb(glb);

    expect(result.valid).toBe(true);
    expect(result.header.magic).toBe(0x46546c67);
    expect(result.header.version).toBe(2);
    expect(result.header.length).toBe(glb.byteLength);
    expect(result.asset.version).toBe("2.0");
    expect(result.stats.meshCount).toBeGreaterThan(0);
  });

  test("parses a valid GLB (quad = 2 triangles)", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    expect(result.valid).toBe(true);
    expect(result.stats.meshCount).toBeGreaterThan(0);

    const triMesh = result.meshes.find(m => m.triangleCount === 2);
    expect(triMesh).toBeDefined();
  });

  test("reports correct file size", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    expect(result.fileBytes).toBe(glb.byteLength);
  });

  test("detects JSON and BIN chunks", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    const jsonChunk = result.chunks.find(c => c.typeString === "JSON");
    const binChunk = result.chunks.find(c => c.typeString === "BIN\0");
    expect(jsonChunk).toBeDefined();
    expect(binChunk).toBeDefined();
  });

  test("reports materials count", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    expect(result.stats.materialCount).toBeGreaterThan(0);
    expect(result.materials.length).toBeGreaterThan(0);
  });

  test("material has base color", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    const mat = result.materials[0];
    expect(mat).toBeDefined();
    expect(mat!.baseColor).toMatch(/^#/);
    expect(mat!.baseColor.length).toBeGreaterThan(3);
  });

  test("mesh detail includes triangle count and bounds", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);

    const mesh = result.meshes[0];
    expect(mesh).toBeDefined();
    expect(mesh!.triangleCount).toBeGreaterThan(0);
    expect(mesh!.bounds.size[0]).toBeGreaterThan(0);
    expect(mesh!.bounds.size[1]).toBeGreaterThan(0);
    expect(mesh!.bounds.size[2]).toBeGreaterThan(0);
  });

  test("empty buffer returns invalid", () => {
    const empty = new Uint8Array(0);
    const result = analyseGlb(empty);
    expect(result.valid).toBe(false);
  });

  test("truncated GLB returns invalid", () => {
    const truncated = new Uint8Array([0x46, 0x54, 0x6c, 0x67, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
    const result = analyseGlb(truncated);
    expect(result.valid).toBe(false);
  });
});

describe("formatAnalysis", () => {
  test("formats a valid result as string", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo, { name: "FmtTest" });
    const result = analyseGlb(glb);
    const formatted = formatAnalysis(result);

    expect(formatted).toContain("GLB Analysis Report");
    expect(formatted).toContain("Version");
    expect(formatted).toContain("Size");
  });

  test("formats an invalid result with error message", () => {
    const empty = new Uint8Array([0, 0, 0, 0]);
    const result = analyseGlb(empty);
    const formatted = formatAnalysis(result);
    expect(formatted).toContain("Error");
  });

  test("includes mesh info in format", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);
    const formatted = formatAnalysis(result);

    expect(formatted).toContain("Meshes");
    expect(formatted).toContain("Triangles");
  });

  test("includes material info in format", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);
    const formatted = formatAnalysis(result);

    expect(formatted).toContain("Materials");
    expect(formatted).toContain("Color");
  });
});

describe("analysisToJson", () => {
  test("produces valid JSON string", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);
    const json = analysisToJson(result);

    const parsed = JSON.parse(json);
    expect(parsed.valid).toBe(true);
    expect(parsed.stats).toBeDefined();
    expect(parsed.meshes).toBeDefined();
    expect(parsed.materials).toBeDefined();
  });

  test("includes all expected fields", async () => {
    const geo = makeFlatGeometry([makeFlatQuad()]);
    const glb = await generateGlbV2(geo);
    const result = analyseGlb(glb);
    const json = analysisToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveProperty("valid");
    expect(parsed).toHaveProperty("header");
    expect(parsed).toHaveProperty("chunks");
    expect(parsed).toHaveProperty("stats");
    expect(parsed).toHaveProperty("meshes");
    expect(parsed).toHaveProperty("materials");
    expect(parsed).toHaveProperty("warnings");
  });

  test("includes error for invalid GLB", () => {
    const empty = new Uint8Array([0, 0, 0, 0]);
    const result = analyseGlb(empty);
    const json = analysisToJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.valid).toBe(false);
    expect(parsed.error).toBeDefined();
  });
});
