// ============================================================
// LDraw Parser – Unit tests (bun test)
// ============================================================

import { describe, test, expect, beforeEach } from "bun:test";
import { LDrawParser, parseLDrawFile, buildColorTable } from "../src/index";
// import type { LDrawFile, FlatGeometry } from "../src/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const SIMPLE_TRIANGLE = `
0 Test Triangle
0 Name: test.dat
0 Author: Test
0 !LDRAW_ORG Unofficial_Part
0 !CATEGORY Brick
0 !KEYWORDS test, triangle, parser
0 BFC CERTIFY CCW
3 4 0 0 0 10 0 0 0 10 0
`.trim();

const SIMPLE_QUAD = `
0 Test Quad
0 BFC CERTIFY CCW
4 16 -10 0 -10   10 0 -10   10 0 10   -10 0 10
`.trim();

const TRANSPARENT_PART = `
0 Trans test
0 BFC CERTIFY CCW
3 33 0 0 0 10 0 0 5 10 0
`.trim();

const MPD_CONTENT = `
0 MPD Test
0 Name: mpd_test.mpd
0 Author: TestBot
0 !KEYWORDS mpd, test
0 !CATEGORY Test

0 FILE main.ldr
0 Main Model
1 4 0 0 0 1 0 0 0 1 0 0 0 1 part.dat

0 FILE part.dat
0 A Part
0 BFC CERTIFY CCW
3 16 0 0 0 10 0 0 5 10 0
4 4  0 0 0 10 0 0 10 0 10 0 0 10
`.trim();

const COLOUR_DEF = `
0 !COLOUR Custom_Red CODE 1000 VALUE #FF0000 EDGE #000000 ALPHA 200
`.trim();

const TEXMAP_CONTENT = `
0 Texmap test
0 BFC CERTIFY CCW
0 !TEXMAP START PLANAR 0 0 0 10 0 0 0 10 0 texture.png
3 16 0 0 0 10 0 0 5 10 0
0 !TEXMAP END
`.trim();

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function makeParser(subFiles: Record<string, string> = {}) {
  return new LDrawParser({
    resolveFile: (name) => subFiles[name.toLowerCase()] ?? null,
    processBFC:  true,
    flatten:     true,
  });
}

// ─────────────────────────────────────────────────────────────
// parseLDrawFile – structural tests
// ─────────────────────────────────────────────────────────────

describe("parseLDrawFile", () => {
  test("parses description from first line", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    expect(file.meta.description).toBe("Test Triangle");
  });

  test("parses name, author, fileType", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    expect(file.meta.name).toBe("test.dat");
    expect(file.meta.author).toBe("Test");
    expect(file.meta.fileType).toBe("Unofficial_Part");
  });

  test("parses category", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    expect(file.meta.category).toBe("Brick");
  });

  test("parses keywords", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    expect(file.meta.keywords).toContain("test");
    expect(file.meta.keywords).toContain("triangle");
    expect(file.meta.keywords).toContain("parser");
  });

  test("deduplicates keywords across multiple !KEYWORDS lines", () => {
    const content = `0 Dup\n0 !KEYWORDS a, b, c\n0 !KEYWORDS b, c, d\n3 4 0 0 0 1 0 0 0 1 0`;
    const file = parseLDrawFile(content, "dup.dat");
    expect(file.meta.keywords).toEqual(["a", "b", "c", "d"]);
  });

  test("parses BFC certification with winding", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    expect(file.meta.bfcCertified).toBe(true);
    expect(file.meta.bfcWinding).toBe("CCW");
  });

  test("counts type-3 commands", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    const triangles = file.commands.filter((c) => c.type === 3);
    expect(triangles).toHaveLength(1);
  });

  test("triangle has correct color code", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    const tri = file.commands.find((c) => c.type === 3);
    expect(tri?.colorCode).toBe(4); // Red
  });

  test("triangle vertex positions are correct", () => {
    const file = parseLDrawFile(SIMPLE_TRIANGLE, "test.dat");
    const tri = file.commands.find((c) => c.type === 3) as any;
    expect(tri.points[0]).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(tri.points[1]).toMatchObject({ x: 10, y: 0, z: 0 });
    expect(tri.points[2]).toMatchObject({ x: 0, y: 10, z: 0 });
  });

  test("quad command has 4 points", () => {
    const file = parseLDrawFile(SIMPLE_QUAD, "quad.dat");
    const quad = file.commands.find((c) => c.type === 4) as any;
    expect(quad?.points).toHaveLength(4);
  });
});

// ─────────────────────────────────────────────────────────────
// MPD parsing
// ─────────────────────────────────────────────────────────────

describe("MPD parsing", () => {
  test("parses root metadata from MPD", () => {
    const file = parseLDrawFile(MPD_CONTENT, "mpd_test.mpd");
    expect(file.meta.keywords).toContain("mpd");
    expect(file.meta.category).toBe("Test");
  });

  test("extracts embedded sub-files", () => {
    const file = parseLDrawFile(MPD_CONTENT, "mpd_test.mpd");
    expect(file.subFiles?.size).toBeGreaterThan(0);
    expect(file.subFiles?.has("part.dat")).toBe(true);
  });

  test("sub-file has own metadata", () => {
    const file = parseLDrawFile(MPD_CONTENT, "mpd_test.mpd");
    const sub = file.subFiles?.get("part.dat");
    expect(sub?.meta.description).toBe("A Part");
  });

  test("sub-file contains geometry commands", () => {
    const file = parseLDrawFile(MPD_CONTENT, "mpd_test.mpd");
    const sub = file.subFiles?.get("part.dat");
    const tris = sub?.commands.filter((c) => c.type === 3);
    expect(tris?.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Colour system
// ─────────────────────────────────────────────────────────────

describe("Colour system", () => {
  test("builds default colour table", () => {
    const table = buildColorTable();
    expect(table.size).toBeGreaterThan(50);
  });

  test("colour 4 is Red (opaque)", () => {
    const table = buildColorTable();
    const red = table.get(4);
    expect(red?.name).toBe("Red");
    expect(red?.alpha).toBe(255);
    expect(red?.isTransparent).toBe(false);
  });

  test("transparent colours have alpha < 255", () => {
    const table = buildColorTable();
    const trans = [...table.values()].filter((c) => c.isTransparent);
    expect(trans.length).toBeGreaterThan(0);
    for (const c of trans) {
      expect(c.alpha).toBeLessThan(255);
    }
  });

  test("parses custom !COLOUR definition", () => {
    const file = parseLDrawFile(COLOUR_DEF, "colours.dat");
    expect(file.meta.colors).toHaveLength(1);
    const c = file.meta.colors![0];
    expect(c!.code).toBe(1000);
    expect(c!.name).toBe("Custom_Red");
    expect(c!.alpha).toBe(200);
    expect(c!.isTransparent).toBe(true);
  });

  test("RGBA tuple is normalised 0-1", () => {
    const table = buildColorTable();
    const c = table.get(4)!;
    for (const v of c.rgba) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Geometry flattening
// ─────────────────────────────────────────────────────────────

describe("Geometry flattening", () => {
  test("produces triangles from type-3 commands", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    expect(geometry?.meshes.length).toBeGreaterThan(0);
    const total = geometry!.meshes.reduce((a, m) => a + m.triangles.length, 0);
    expect(total).toBe(1);
  });

  test("quad is split into 2 triangles", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_QUAD, "quad.dat");
    const total = geometry!.meshes.reduce((a, m) => a + m.triangles.length, 0);
    expect(total).toBe(2);
  });

  test("transparent mesh has isTransparent flag on colour", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(TRANSPARENT_PART, "trans.dat");
    const meshes = geometry!.meshes;
    expect(meshes.some((m) => m.color.isTransparent)).toBe(true);
  });

  test("resolves embedded MPD sub-files", async () => {
    const p = makeParser(); // sub-files are embedded in MPD
    const { geometry } = await p.parse(MPD_CONTENT, "mpd_test.mpd");
    const total = geometry!.meshes.reduce((a, m) => a + m.triangles.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("resolves external sub-files via resolver", async () => {
    const subPart = `0 External Part\n0 BFC CERTIFY CCW\n3 16 0 0 0 10 0 0 5 10 0`;
    const p = makeParser({ "part.dat": subPart });
    const model = `0 Model\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 part.dat`;
    const { geometry } = await p.parse(model, "model.ldr");
    const total = geometry!.meshes.reduce((a, m) => a + m.triangles.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("AABB is computed", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const { aabb } = geometry!;
    expect(aabb.size.x).toBeGreaterThan(0);
    expect(isFinite(aabb.radius)).toBe(true);
  });

  test("colour 16 inherits parent colour", async () => {
    const subPart = `0 Part\n0 BFC CERTIFY CCW\n3 16 0 0 0 10 0 0 5 10 0`;
    const p = makeParser({ "inherit.dat": subPart });
    // colour 4 = Red for the sub-file reference
    const model = `0 Model\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 inherit.dat`;
    const { geometry } = await p.parse(model, "inherit_test.ldr");
    const mesh = geometry!.meshes[0];
    expect(mesh?.colorCode).toBe(4); // Red, inherited
  });

  test("texmap is attached to triangles", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(TEXMAP_CONTENT, "tex.dat");
    const texturedMeshes = geometry!.meshes.filter((m) => m.texmap !== undefined);
    expect(texturedMeshes.length).toBeGreaterThan(0);
    expect(texturedMeshes[0]!.texmap!.texture).toBe("texture.png");
  });
});

// ─────────────────────────────────────────────────────────────
// SVG generator
// ─────────────────────────────────────────────────────────────

describe("SVG thumbnail", () => {
  test("generates valid SVG string", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const svg = p.toSvg(geometry!);
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("</svg>");
  });

  test("SVG respects width/height options", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const svg = p.toSvg(geometry!, { width: 256, height: 256 });
    expect(svg).toContain('width="256"');
    expect(svg).toContain('height="256"');
  });

  test("SVG with background colour", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const svg = p.toSvg(geometry!, { background: "#ff0000" });
    expect(svg).toContain("ff0000");
  });

  test("empty geometry returns minimal SVG", async () => {
    const p = makeParser();
    const { geometry } = await p.parse("0 Empty\n", "empty.dat");
    const svg = p.toSvg(geometry!);
    expect(svg).toContain("<svg");
  });
});

// ─────────────────────────────────────────────────────────────
// GLB generator
// ─────────────────────────────────────────────────────────────

describe("GLB generator", () => {
  test("generates a Uint8Array", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const glb = p.toGlb(geometry!);
    expect(glb).toBeInstanceOf(Uint8Array);
    expect(glb.byteLength).toBeGreaterThan(100);
  });

  test("GLB starts with glTF magic number", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const glb = p.toGlb(geometry!);
    const view = new DataView(glb.buffer);
    // 0x46546C67 = "glTF"
    expect(view.getUint32(0, true)).toBe(0x46546c67);
  });

  test("GLB version is 2", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const glb = p.toGlb(geometry!);
    const view = new DataView(glb.buffer);
    expect(view.getUint32(4, true)).toBe(2);
  });

  test("total byte length is consistent", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(SIMPLE_TRIANGLE, "test.dat");
    const glb = p.toGlb(geometry!);
    const view = new DataView(glb.buffer);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
  });

  test("GLB contains materials for transparent colours", async () => {
    const p = makeParser();
    const { geometry } = await p.parse(TRANSPARENT_PART, "trans.dat");
    const glb = p.toGlb(geometry!);
    // Decode JSON chunk
    const jsonLength = new DataView(glb.buffer).getUint32(12, true);
    const jsonBytes  = glb.slice(20, 20 + jsonLength);
    const json       = JSON.parse(new TextDecoder().decode(jsonBytes));
    const alphaModes = json.materials.map((m: any) => m.alphaMode).filter(Boolean);
    expect(alphaModes.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────
// LDrawParser class
// ─────────────────────────────────────────────────────────────

describe("LDrawParser class", () => {
  test("parseOnly does not throw", () => {
    const p = new LDrawParser();
    expect(() => p.parseOnly(SIMPLE_TRIANGLE)).not.toThrow();
  });

  test("clearCache resets resolved files", async () => {
    let callCount = 0;
    const p = new LDrawParser({
      resolveFile: (name) => {
        callCount++;
        return `0 Part\n3 16 0 0 0 10 0 0 5 10 0`;
      },
    });
    const model = `0 M\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 part.dat`;
    await p.parse(model, "m1.ldr");
    const first = callCount;
    p.clearCache();
    await p.parse(model, "m1.ldr");
    expect(callCount).toBeGreaterThan(first);
  });

  test("loadColorTable adds custom colours", () => {
    const p = new LDrawParser();
    p.loadColorTable("0 !COLOUR Custom CODE 9999 VALUE #ABCDEF EDGE #000000");
    expect(p.colorTable.has(9999)).toBe(true);
  });
});
