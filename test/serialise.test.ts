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
import {
  extractSteps,
  hasSteps,
  computeCameraRotations,
  rotationToMatrix,
} from "../src/steps";
import { parseLDrawFile, LDrawParser } from "../src/index";
import { buildColorTable } from "../src/colors";
import type { LDrawSubFileRef, LDrawTriangle } from "../src/types";
import { IDENTITY } from "../src/utils";

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
5 24 0 0 0 10 0 0 5 5 0 5 -5 0`.trim();

const STEPPED_LDR = `0 Assembly
0 Name: assembly.ldr
0 BFC CERTIFY CCW
1 4 0 0 0 1 0 0 0 1 0 0 0 1 part1.dat
0 STEP
1 1 20 0 0 1 0 0 0 1 0 0 0 1 part2.dat
0 ROTSTEP 30 45 0 REL
0 STEP
1 2 40 0 0 1 0 0 0 1 0 0 0 1 part3.dat
0 ROTSTEP 0 0 0 END
0 STEP`.trim();

const NO_STEP_LDR = `0 Single Step
0 BFC CERTIFY CCW
3 4 0 0 0 10 0 0 5 10 0`.trim();

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
// extractSteps
// ─────────────────────────────────────────────────────────────

describe("extractSteps", () => {
  test("file without STEP yields one step", () => {
    const file = parseLDrawFile(NO_STEP_LDR, "t.ldr");
    const steps = extractSteps(file);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.index).toBe(0);
  });

  test("stepped file yields correct number of steps", () => {
    const file = parseLDrawFile(STEPPED_LDR, "a.ldr");
    expect(extractSteps(file)).toHaveLength(3);
  });

  test("each step has the right commands", () => {
    const file = parseLDrawFile(STEPPED_LDR, "a.ldr");
    const steps = extractSteps(file);
    // step 0: part1.dat only
    const s0Refs = steps[0]!.commands.filter(c => c.type === 1);
    expect(s0Refs).toHaveLength(1);
    expect((s0Refs[0] as LDrawSubFileRef).file).toBe("part1.dat");
    // step 1: part2.dat only
    const s1Refs = steps[1]!.commands.filter(c => c.type === 1);
    expect(s1Refs).toHaveLength(1);
    expect((s1Refs[0] as LDrawSubFileRef).file).toBe("part2.dat");
  });

  test("STEP indices are sequential", () => {
    const file = parseLDrawFile(STEPPED_LDR, "a.ldr");
    const steps = extractSteps(file);
    expect(steps.map(s => s.index)).toEqual([0, 1, 2]);
  });

  test("ROTSTEP is attached to correct step", () => {
    const file = parseLDrawFile(STEPPED_LDR, "a.ldr");
    const steps = extractSteps(file);
    expect(steps[0]!.rotation).toBeUndefined();
    expect(steps[1]!.rotation).toBeDefined();
    expect(steps[1]!.rotation!.x).toBe(30);
    expect(steps[1]!.rotation!.y).toBe(45);
    expect(steps[1]!.rotation!.type).toBe("REL");
    expect(steps[2]!.rotation).toBeUndefined(); // END cleared it
  });
});

// ─────────────────────────────────────────────────────────────
// hasSteps
// ─────────────────────────────────────────────────────────────

describe("hasSteps", () => {
  test("returns true for stepped model", () => {
    expect(hasSteps(parseLDrawFile(STEPPED_LDR, "a.ldr"))).toBe(true);
  });

  test("returns false for model without steps", () => {
    expect(hasSteps(parseLDrawFile(NO_STEP_LDR, "t.ldr"))).toBe(false);
  });

  test("returns false for empty model", () => {
    expect(hasSteps(parseLDrawFile("0 Empty", "e.ldr"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// computeCameraRotations
// ─────────────────────────────────────────────────────────────

describe("computeCameraRotations", () => {
  test("no rotation → all undefined", () => {
    const file = parseLDrawFile(NO_STEP_LDR, "t.ldr");
    const rots = computeCameraRotations(extractSteps(file));
    expect(rots.every(r => r === undefined)).toBe(true);
  });

  test("REL rotations accumulate", () => {
    const ldr = `0 T\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 10 20 0 REL\n0 STEP\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 10 20 0 REL\n0 STEP`;
    const steps = extractSteps(parseLDrawFile(ldr, "t.ldr"));
    const rots  = computeCameraRotations(steps);
    expect(rots[0]?.x).toBe(10);
    expect(rots[1]?.x).toBe(20);  // accumulated
  });

  test("ABS rotation resets", () => {
    const ldr = `0 T\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 10 0 0 REL\n0 STEP\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 90 0 0 ABS\n0 STEP`;
    const steps = extractSteps(parseLDrawFile(ldr, "t.ldr"));
    const rots  = computeCameraRotations(steps);
    expect(rots[1]?.x).toBe(90);  // ABS reset
    expect(rots[1]?.type).toBe("ABS");
  });

  test("END clears rotation", () => {
    const ldr = `0 T\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 30 0 0 ABS\n0 STEP\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 0 0 0 END\n0 STEP`;
    const steps = extractSteps(parseLDrawFile(ldr, "t.ldr"));
    const rots  = computeCameraRotations(steps);
    expect(rots[0]?.x).toBe(30);
    expect(rots[1]).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// rotationToMatrix
// ─────────────────────────────────────────────────────────────

describe("rotationToMatrix", () => {
  test("undefined → identity matrix", () => {
    const m = rotationToMatrix(undefined);
    expect(m).toEqual(IDENTITY);
  });

  test("END → identity matrix", () => {
    const m = rotationToMatrix({ x: 0, y: 0, z: 0, type: "END" });
    expect(m).toEqual(IDENTITY);
  });

  test("zero rotation → identity matrix", () => {
    const m = rotationToMatrix({ x: 0, y: 0, z: 0, type: "ABS" });
    // Should be very close to identity
    expect(m[0]).toBeCloseTo(1, 5);
    expect(m[5]).toBeCloseTo(1, 5);
    expect(m[10]).toBeCloseTo(1, 5);
    expect(m[1]).toBeCloseTo(0, 5);
  });

  test("90° Y rotation: x→z, z→-x", () => {
    const m = rotationToMatrix({ x: 0, y: 90, z: 0, type: "ABS" });
    // Ry(90): [0,0,1,0, 0,1,0,0, -1,0,0,0, 0,0,0,1] (col-major)
    // But our matrix is applied to vectors; check col 0 = [cos90, 0, -sin90, 0] = [0,0,-1,0]
    expect(m[0]).toBeCloseTo(0, 4);   // col0 row0
    expect(m[2]).toBeCloseTo(-1, 4);  // col0 row2
    expect(m[8]).toBeCloseTo(1, 4);   // col2 row0
  });

  test("matrix is 16 elements long", () => {
    const m = rotationToMatrix({ x: 45, y: 30, z: 15, type: "REL" });
    expect(m).toHaveLength(16);
  });

  test("matrix preserves vector length (no scaling)", () => {
    const m = rotationToMatrix({ x: 37, y: 53, z: 12, type: "ABS" });
    // Column 0 should be a unit vector
    const len = Math.sqrt((m[0]??0)**2 + (m[1]??0)**2 + (m[2]??0)**2);
    expect(len).toBeCloseTo(1, 4);
  });
});

// ─────────────────────────────────────────────────────────────
// Integration: parse → extract steps → flatten per step
// ─────────────────────────────────────────────────────────────

describe("Step geometry integration", () => {
  const ASSEMBLY = `0 Assembly
0 BFC CERTIFY CCW
3 4 0 0 0 10 0 0 5 10 0
0 STEP
3 1 0 0 0 10 0 0 5 10 0
0 STEP
3 2 0 0 0 10 0 0 5 10 0
0 STEP`.trim();

  test("cumulative geometry grows with each step", async () => {
    const parser = new LDrawParser();
    const { file } = await parser.parse(ASSEMBLY, "assembly.ldr");
    const steps = extractSteps(file);
    expect(steps).toHaveLength(3);

    // Each step adds 1 triangle
    expect(steps[0]!.commands.filter(c => c.type === 3)).toHaveLength(1);
    expect(steps[1]!.commands.filter(c => c.type === 3)).toHaveLength(1);
    expect(steps[2]!.commands.filter(c => c.type === 3)).toHaveLength(1);
  });

  test("step 0 contains only first part", () => {
    const { file } = { file: parseLDrawFile(ASSEMBLY, "a.ldr") };
    const steps = extractSteps(file);
    const tris = steps[0]!.commands.filter(c => c.type === 3) as LDrawTriangle[];
    expect(tris).toHaveLength(1);
    expect(tris[0]!.colorCode).toBe(4); // Red
  });

  test("ROTSTEP END appears in step before the final geometry", () => {
    const ROT_LDR = `0 T\n3 4 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 45 0 0 ABS\n0 STEP\n3 1 0 0 0 1 0 0 0 1 0\n0 ROTSTEP 0 0 0 END\n0 STEP\n3 2 0 0 0 1 0 0 0 1 0\n0 STEP`;
    const file = parseLDrawFile(ROT_LDR, "r.ldr");
    const steps = extractSteps(file);
    const rots  = computeCameraRotations(steps);
    // Step 0: rotation 45° ABS
    expect(rots[0]?.x).toBe(45);
    // Step 1: END → undefined
    expect(rots[1]).toBeUndefined();
    // Step 2: still no rotation (persisted clear)
    expect(rots[2]).toBeUndefined();
  });
});
