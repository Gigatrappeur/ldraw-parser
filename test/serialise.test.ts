// ============================================================
// LDraw Parser – Serialiser + Steps tests
// bun test tests/serialise.test.ts
// ============================================================

import { describe, test, expect } from "bun:test";
import {
  serialiseLDrawFile,
  serialiseColor,
  buildLDrawFile,
  buildMpd,
} from "../src/serialise";
import { buildColorTable } from "./color-table";
import { IDENTITY } from "../src/utils";
import { parseLDrawFile, type LDrawSubFileRef, type LDrawTriangle } from "../src/parser";

// ── Fixtures ─────────────────────────────────────────────────

const table = buildColorTable();

const SIMPLE_LDR = `0 Test Part
0 Name: test.dat
0 Author: Tester
0 !LDRAW_ORG Unofficial_Part
0 !CATEGORY Brick
0 !KEYWORDS test, round-trip
0 BFC CERTIFY CCW
3 4 0 0 0 10 0 0 5 10 0
4 16 -5 0 -5 5 0 -5 5 0 5 -5 0 5
2 24 0 0 0 10 0 0
5 24 0 0 0 10 0 0 5 5 0 5 -5 0 5`.trim();

// ─────────────────────────────────────────────────────────────
// serialiseColor
// ─────────────────────────────────────────────────────────────

describe("serialiseColor", () => {
  test("produces 0 !COLOUR line", () => {
    const red = table.get(4)!;
    const line = serialiseColor(red);
    expect(line).toStartWith("0 !COLOUR");
    expect(line).toContain("CODE 4");
    expect(line).toContain("VALUE #");
    expect(line).toContain("EDGE #");
  });

  test("alpha included when < 255", () => {
    const trans = table.get(285) ?? { ...table.get(4)!, alpha: 128, code: 285, name: "Trans" };
    const line = serialiseColor(trans);
    if (trans.alpha < 255) {
      expect(line).toContain(`ALPHA ${trans.alpha}`);
    }
  });

  test("alpha omitted when 255", () => {
    const red = table.get(4)!;
    expect(red.alpha).toBe(255);
    expect(serialiseColor(red)).not.toContain("ALPHA");
  });

  test("CHROME finish included", () => {
    const chrome = table.get(383)!; // Chrome Silver
    const line = serialiseColor(chrome);
    expect(line).toContain("CHROME");
  });

  test("round-trips: serialise then parse produces same code", () => {
    const red = table.get(4)!;
    const line = serialiseColor(red);
    const file = parseLDrawFile(line, "colours.dat");
    expect(file.meta.colors?.[0]?.code).toBe(4);
  });

  test("MATERIAL finish with GLITTER sub-fields", () => {
    const glitter = table.get(75); // Speckle Black Copper
    if (!glitter) return; // skip if not in table
    const line = serialiseColor(glitter);
    expect(line).toMatch(/MATERIAL (GLITTER|SPECKLE)/);
  });
});

// ─────────────────────────────────────────────────────────────
// serialiseLDrawFile – single file
// ─────────────────────────────────────────────────────────────

describe("serialiseLDrawFile – single file", () => {
  test("produces non-empty string", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out.length).toBeGreaterThan(0);
  });

  test("contains description as first line", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out.split("\n")[0]).toBe("0 Test Part");
  });

  test("contains name meta", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toContain("0 Name: test.dat");
  });

  test("contains author meta", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toContain("0 Author: Tester");
  });

  test("contains LDRAW_ORG meta", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toContain("0 !LDRAW_ORG");
  });

  test("contains CATEGORY meta", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toContain("0 !CATEGORY Brick");
  });

  test("contains KEYWORDS meta", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out).toContain("0 !KEYWORDS");
    expect(out).toContain("test");
    expect(out).toContain("round-trip");
  });

  test("contains BFC CERTIFY line", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toMatch(/0 BFC CERTIFY (CW|CCW)/);
  });

  test("type-3 triangle serialised with correct syntax", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    // "3 4 0 0 0 10 0 0 5 10 0"
    expect(out).toMatch(/^3 4 /m);
  });

  test("type-4 quad serialised with correct syntax", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out).toMatch(/^4 16 /m);
  });

  test("type-2 edge line serialised", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toMatch(/^2 24 /m);
  });

  test("type-5 optional line serialised", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    expect(serialiseLDrawFile(file, { newline: "\n" })).toMatch(/^5 24 /m);
  });

  test("type-1 sub-file reference preserved", () => {
    const content = "0 M\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat";
    const file = parseLDrawFile(content, "m.ldr");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out).toContain("1 4");
    expect(out).toContain("stud.dat");
  });

  test("identity matrix produces clean 1 0 0 ... values", () => {
    const content = "0 M\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat";
    const file = parseLDrawFile(content, "m.ldr");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    // should contain "1 4 0 0 0  1 0 0  0 1 0  0 0 1 stud.dat" roughly
    expect(out).toMatch(/1 4 0 0 0\s+1 0 0\s+0 1 0\s+0 0 1\s+stud\.dat/);
  });

  test("uses CRLF by default", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file);
    expect(out).toContain("\r\n");
  });

  test("respects custom newline option", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    expect(out).not.toContain("\r\n");
    expect(out).toContain("\n");
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip fidelity
// ─────────────────────────────────────────────────────────────

describe("Round-trip fidelity", () => {
  test("geometry command count is preserved", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    const reparsed = parseLDrawFile(out, "test.dat");
    const origGeo = file.commands.filter(c => c.type !== 0).length;
    const newGeo  = reparsed.commands.filter(c => c.type !== 0).length;
    expect(newGeo).toBe(origGeo);
  });

  test("triangle vertices are preserved within float tolerance", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    const reparsed = parseLDrawFile(out, "test.dat");
    const origTri = file.commands.find(c => c.type === 3) as LDrawTriangle;
    const newTri  = reparsed.commands.find(c => c.type === 3) as LDrawTriangle;
    expect(newTri.points[0].x).toBeCloseTo(origTri.points[0].x, 3);
    expect(newTri.points[1].y).toBeCloseTo(origTri.points[1].y, 3);
    expect(newTri.points[2].z).toBeCloseTo(origTri.points[2].z, 3);
  });

  test("keywords survive round-trip", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    const reparsed = parseLDrawFile(out, "test.dat");
    expect(reparsed.meta.keywords).toContain("test");
    expect(reparsed.meta.keywords).toContain("round-trip");
  });

  test("BFC winding survives round-trip", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    const reparsed = parseLDrawFile(out, "test.dat");
    expect(reparsed.meta.bfcCertified).toBe(file.meta.bfcCertified);
  });

  test("sub-file transform matrix round-trips accurately", () => {
    // Non-identity transform
    const content = "0 M\n1 4 10.5 -3 0.25  0 1 0  -1 0 0  0 0 1 part.dat";
    const file = parseLDrawFile(content, "m.ldr");
    const out = serialiseLDrawFile(file, { newline: "\n" });
    const reparsed = parseLDrawFile(out, "m.ldr");
    const origRef = file.commands.find(c => c.type === 1) as LDrawSubFileRef;
    const newRef  = reparsed.commands.find(c => c.type === 1) as LDrawSubFileRef;
    // Translation components
    expect(newRef.transform[12]).toBeCloseTo(origRef.transform[12]!, 3);
    expect(newRef.transform[13]).toBeCloseTo(origRef.transform[13]!, 3);
    expect(newRef.transform[14]).toBeCloseTo(origRef.transform[14]!, 3);
  });
});

// ─────────────────────────────────────────────────────────────
// MPD serialisation
// ─────────────────────────────────────────────────────────────

describe("MPD serialisation", () => {
  test("root file has 0 FILE marker", () => {
    const main = buildLDrawFile({ name: "main.ldr", description: "Main" });
    const part = buildLDrawFile({ name: "part.dat", description: "Part" });
    const mpd = buildMpd([main, part]);
    const out = serialiseLDrawFile(mpd, { newline: "\n" });
    expect(out).toContain("0 FILE main.ldr");
  });

  test("embedded sub-files have FILE markers", () => {
    const main = buildLDrawFile({ name: "main.ldr" });
    const p1   = buildLDrawFile({ name: "part1.dat" });
    const p2   = buildLDrawFile({ name: "part2.dat" });
    const mpd  = buildMpd([main, p1, p2]);
    const out  = serialiseLDrawFile(mpd, { newline: "\n" });
    expect(out).toContain("0 FILE part1.dat");
    expect(out).toContain("0 FILE part2.dat");
  });

  test("MPD round-trips sub-files", () => {
    const main = buildLDrawFile({ name: "main.ldr", description: "Main" });
    main.commands.push({ type: 1, colorCode: 4, transform: IDENTITY, file: "part.dat" });
    const part = buildLDrawFile({ name: "part.dat", description: "A Part" });
    part.commands.push({ type: 3, colorCode: 16, points: [{ x:0,y:0,z:0 }, { x:10,y:0,z:0 }, { x:5,y:10,z:0 }] });
    const mpd = buildMpd([main, part]);
    const out = serialiseLDrawFile(mpd, { newline: "\n" });

    const reparsed = parseLDrawFile(out, "assembly.mpd");
    expect(reparsed.subFiles?.has("part.dat")).toBe(true);
    const subPart = reparsed.subFiles?.get("part.dat");
    expect(subPart?.meta.description).toBe("A Part");
    expect(subPart?.commands.some(c => c.type === 3)).toBe(true);
  });

  test("single file omits FILE markers", () => {
    const file = parseLDrawFile(SIMPLE_LDR, "test.dat");
    const out  = serialiseLDrawFile(file, { newline: "\n", mpd: false });
    expect(out).not.toContain("0 FILE");
  });
});

// ─────────────────────────────────────────────────────────────
// buildLDrawFile / buildMpd
// ─────────────────────────────────────────────────────────────

describe("buildLDrawFile", () => {
  test("creates file with given description", () => {
    const f = buildLDrawFile({ description: "My Part" });
    expect(f.meta.description).toBe("My Part");
  });

  test("commands array starts empty", () => {
    expect(buildLDrawFile().commands).toHaveLength(0);
  });

  test("bfc defaults to false", () => {
    expect(buildLDrawFile().meta.bfcCertified).toBe(false);
  });

  test("bfc:true sets certified flag", () => {
    expect(buildLDrawFile({ bfc: true }).meta.bfcCertified).toBe(true);
  });

  test("custom winding is set", () => {
    const f = buildLDrawFile({ bfc: true, winding: "CW" });
    expect(f.meta.bfcWinding).toBe("CW");
  });
});

describe("buildMpd", () => {
  test("first file is the root", () => {
    const a = buildLDrawFile({ name: "a.ldr", description: "A" });
    const b = buildLDrawFile({ name: "b.dat" });
    const mpd = buildMpd([a, b]);
    expect(mpd.meta.description).toBe("A");
  });

  test("subsequent files become subFiles", () => {
    const a = buildLDrawFile({ name: "a.ldr" });
    const b = buildLDrawFile({ name: "b.dat" });
    const c = buildLDrawFile({ name: "c.dat" });
    const mpd = buildMpd([a, b, c]);
    expect(mpd.subFiles?.size).toBe(2);
  });

  test("throws on empty array", () => {
    expect(() => buildMpd([])).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// buildLDrawFile / buildMpd
