// ============================================================
// LDraw Parser – LDrawPart wrapper tests
// ============================================================

import { describe, test, expect } from "bun:test";
import { LDrawPart } from "../src/ldraw-part";
import { loadLDrawModel } from "../src/resolver";
import { createTestResolver } from "./test-resolver";
import { ColorTable } from "../src/colors";

const SIMPLE_PART = `
0 Test Part
0 Name: test_part.dat
0 Author: TestBot
0 BFC CERTIFY CCW
3 4 0 0 0 10 0 0 0 10 0
3 1 10 0 0 10 10 0 10 0 10
`.trim();

// ── Helper ────────────────────────────────────────────────────

async function makePart(): Promise<LDrawPart> {
  const resolver = createTestResolver({ "test_part.dat": SIMPLE_PART });
  const colorTable = new ColorTable(resolver);
  const defaultColor = await colorTable.get(4);
  const result = await loadLDrawModel(
    "test_part.dat",
    {
      colorTable,
      resolveFile: resolver,
      resolverTexture: () => Promise.reject(new Error("not used")),
      maxDepth: 64,
      cache: new Map(),
    },
    true,
    defaultColor,
  );
  return result;
}

// ── Tests ─────────────────────────────────────────────────────

describe("LDrawPart", () => {
  test("toSvg returns an SVG string", async () => {
    const part = await makePart();
    const svg = part.toSvg();
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("</svg>");
  });

  test("toSvg accepts custom options", async () => {
    const part = await makePart();
    const svg = part.toSvg({ width: 128, height: 128, azimuth: 90 });
    expect(svg).toContain('width="128"');
    expect(svg).toContain('height="128"');
  });

  test("stats returns geometry statistics", async () => {
    const part = await makePart();
    const stats = part.stats();
    expect(stats.triangleCount).toBe(2);
    expect(stats.vertexCount).toBe(6);
    expect(stats.colorCount).toBeGreaterThan(0);
  });

  test("palette returns non-empty palette", async () => {
    const part = await makePart();
    const palette = part.palette();
    expect(palette.length).toBeGreaterThan(0);
    expect(palette[0]!.triangleCount).toBeGreaterThan(0);
  });

  test("textures returns empty array for non-textured geometry", async () => {
    const part = await makePart();
    const textures = part.textures();
    expect(textures).toEqual([]);
  });

  test("file carries metadata", async () => {
    const part = await makePart();
    expect(part.file.meta.description).toBe("Test Part");
    expect(part.file.meta.author).toBe("TestBot");
    expect(part.file.name).toBe("test_part.dat");
  });

  test("geometry has meshes", async () => {
    const part = await makePart();
    expect(part.geometry.meshes.length).toBeGreaterThan(0);
  });

  test("geometry AABB is valid", async () => {
    const part = await makePart();
    const { aabb } = part.geometry;
    expect(aabb.size.x).toBeGreaterThan(0);
    expect(aabb.size.y).toBeGreaterThan(0);
    expect(aabb.size.z).toBeGreaterThan(0);
  });
});
