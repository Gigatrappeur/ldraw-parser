// ============================================================
// test/serialise-edge.test.ts
// ============================================================
// Edge case tests for the serialise module.
// Covers:
//   • serialiseColor (all finish types)
//   • serialiseLDrawFile (meta only, empty, with geometry)
//   • buildLDrawFile / buildMpd
//   • round-trip parsing → serialising
//   • newline option
//   • alwaysDescription
// ============================================================

import { describe, expect, test } from "bun:test";
import { serialiseColor, serialiseLDrawFile, buildLDrawFile, buildMpd } from "../src/serialise";
import { parseLDrawFile } from "../src/parser";
import type { LDrawColor } from "../src/colors";

// ── serialiseColor: finishes ──────────────────────────────────

describe("serialiseColor", () => {
  test("NORMAL finish produces no finish token", () => {
    const c = {
      code: 1,
      name: "Red",
      value: 0xff0000,
      edge: 0x800000,
      alpha: 255,
      luminance: 0,
      finish: "NORMAL",
      hex: "FF0000",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("0 !COLOUR Red");
    expect(s).toContain("CODE 1");
    expect(s).toContain("VALUE #FF0000");
    expect(s).toContain("EDGE #800000");
    expect(s).not.toContain("CHROME");
    expect(s).not.toContain("PEARLESCENT");
  });

  test("CHROME finish appends CHROME token", () => {
    const c = {
      code: 100,
      name: "Chrome",
      value: 0xcccccc,
      edge: 0x888888,
      alpha: 255,
      luminance: 0,
      finish: "CHROME",
      hex: "CCCCCC",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("CHROME");
    expect(s).toContain("VALUE #CCCCCC");
  });

  test("PEARLESCENT finish appends PEARLESCENT token", () => {
    const c = {
      code: 101,
      name: "Pearlescent Blue",
      value: 0x3366cc,
      edge: 0x112266,
      alpha: 255,
      luminance: 0,
      finish: "PEARLESCENT",
      hex: "3366CC",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("PEARLESCENT");
    expect(s).toContain("VALUE #3366CC");
  });

  test("RUBBER finish appends RUBBER token", () => {
    const c = {
      code: 102,
      name: "Rubber Black",
      value: 0x1a1a1a,
      edge: 0x0a0a0a,
      alpha: 255,
      luminance: 0,
      finish: "RUBBER",
      hex: "1A1A1A",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("RUBBER");
    expect(s).toContain("VALUE #1A1A1A");
  });

  test("MATTE_METALLIC finish appends MATTE_METALLIC token", () => {
    const c = {
      code: 103,
      name: "Matte Metallic Grey",
      value: 0x777777,
      edge: 0x444444,
      alpha: 255,
      luminance: 0,
      finish: "MATTE_METALLIC",
      hex: "777777",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("MATTE_METALLIC");
    expect(s).toContain("VALUE #777777");
  });

  test("METAL finish appends METAL token", () => {
    const c = {
      code: 104,
      name: "Metal Silver",
      value: 0xd4d4d4,
      edge: 0x8a8a8a,
      alpha: 255,
      luminance: 0,
      finish: "METAL",
      hex: "D4D4D4",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("METAL");
    expect(s).toContain("VALUE #D4D4D4");
  });

  test("ALPHA < 255 adds ALPHA token", () => {
    const c = {
      code: 285,
      name: "Trans Light Blue",
      value: 0x66b3ff,
      edge: 0x3380cc,
      alpha: 128,
      luminance: 0,
      finish: "NORMAL",
      hex: "66B3FF",
    } as LDrawColor;
    expect(serialiseColor(c)).toContain("ALPHA 128");
  });

  test("LUMINANCE > 0 adds LUMINANCE token", () => {
    const c = {
      code: 200,
      name: "Glowing Green",
      value: 0x00ff00,
      edge: 0x008000,
      alpha: 255,
      luminance: 100,
      finish: "NORMAL",
      hex: "00FF00",
    } as LDrawColor;
    expect(serialiseColor(c)).toContain("LUMINANCE 100");
  });

  test("MATERIAL GLITTER finish with all sub-params", () => {
    const c = {
      code: 300,
      name: "Glitter Red",
      value: 0xff0000,
      edge: 0x800000,
      alpha: 255,
      luminance: 0,
      finish: "MATERIAL",
      material: {
        type: "GLITTER",
        value: "FFAA00",
        alpha: 200,
        luminance: 50,
        fraction: 0.8,
        vfraction: 0.6,
        size: 2,
        minsize: 1,
        maxsize: 4,
      },
      hex: "FF0000",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("MATERIAL GLITTER");
    expect(s).toContain("VALUE #FFAA00");
    expect(s).toContain("ALPHA 200");
    expect(s).toContain("LUMINANCE 50");
    expect(s).toContain("FRACTION 0.8");
    expect(s).toContain("VFRACTION 0.6");
    expect(s).toContain("SIZE 2");
    expect(s).toContain("MINSIZE 1");
    expect(s).toContain("MAXSIZE 4");
  });

  test("MATERIAL SPECKLE without optional params omits SIZE/MINSIZE/MAXSIZE", () => {
    const c = {
      code: 301,
      name: "Speckle Black",
      value: 0x000000,
      edge: 0x222222,
      alpha: 255,
      luminance: 0,
      finish: "MATERIAL",
      material: {
        type: "SPECKLE",
        value: "FFFFFF",
        fraction: 0.5,
        vfraction: 0.5,
      },
      hex: "000000",
    } as LDrawColor;
    const s = serialiseColor(c);
    expect(s).toContain("MATERIAL SPECKLE");
    expect(s).toContain("VALUE #FFFFFF");
    expect(s).not.toContain("SIZE");
    expect(s).not.toContain("MINSIZE");
    expect(s).not.toContain("MAXSIZE");
  });
});

// ── buildLDrawFile ────────────────────────────────────────────

describe("buildLDrawFile", () => {
  test("defaults produce a valid file skeleton", () => {
    const f = buildLDrawFile();
    expect(f.name).toBe("model.ldr");
    expect(f.commands).toEqual([]);
    expect(f.meta.description).toBeUndefined();
    expect(f.meta.author).toBeUndefined();
    expect(f.meta.bfcCertified).toBe(false);
    expect(f.meta.bfcWinding).toBe("CCW");
  });

  test("all options applied", () => {
    const f = buildLDrawFile({
      description: "My Test Part",
      name: "test.dat",
      author: "Tester",
      bfc: true,
      winding: "CW",
    });
    expect(f.name).toBe("test.dat");
    expect(f.meta.description).toBe("My Test Part");
    expect(f.meta.author).toBe("Tester");
    expect(f.meta.bfcCertified).toBe(true);
    expect(f.meta.bfcWinding).toBe("CW");
  });
});

// ── buildMpd ──────────────────────────────────────────────────

describe("buildMpd", () => {
  test("throws when given empty array", () => {
    expect(() => buildMpd([])).toThrow("buildMpd: at least one file required");
  });

  test("single file has no subFiles", () => {
    const root = buildLDrawFile({ description: "Root" });
    const mpd = buildMpd([root]);
    expect(mpd.commands).toEqual([]);
    // buildMpd always sets subFiles (even if empty)
    expect(mpd.subFiles).toBeDefined();
    expect(mpd.subFiles!.size).toBe(0);
  });

  test("multiple files become subFiles keyed by normalised name", () => {
    const root = buildLDrawFile({ description: "Root", name: "root.ldr" });
    const partA = buildLDrawFile({ description: "Part A", name: "a.dat" });
    const partB = buildLDrawFile({ description: "Part B", name: "b.dat" });

    const mpd = buildMpd([root, partA, partB]);

    expect(mpd.subFiles).toBeDefined();
    expect(mpd.subFiles!.size).toBe(2);
    expect(mpd.subFiles!.has("a.dat")).toBe(true);
    expect(mpd.subFiles!.has("b.dat")).toBe(true);
    expect(mpd.subFiles!.get("a.dat")?.meta.description).toBe("Part A");
  });

  test("subFiles names are lowercased and forward-slashed", () => {
    const root = buildLDrawFile({ name: "root.ldr" });
    const part = buildLDrawFile({ name: "SUBDIR/MyPart.DAT" });
    const mpd = buildMpd([root, part]);

    expect(mpd.subFiles!.keys()).toContain("subdir/mypart.dat");
  });
});

// ── serialiseLDrawFile: meta-only ─────────────────────────────

describe("serialiseLDrawFile (meta)", () => {
  test("empty file produces BFC NOCERTIFY (default)", () => {
    const f = buildLDrawFile();
    const out = serialiseLDrawFile(f);
    expect(out).toContain("BFC NOCERTIFY");
  });

  test("meta.description produces type-0 line", () => {
    const f = buildLDrawFile({ description: "A Test Part" });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("0 A Test Part");
  });

  test("meta !LICENSE / !HELP / !CMDLINE present", () => {
    const f = buildLDrawFile({ description: "Licensed part" });
    f.meta.license = "CC-BY-SA 4.0";
    f.meta.help = ["This is help", "More help"];
    f.meta.cmdline = "build --release";
    const out = serialiseLDrawFile(f);
    expect(out).toContain("0 !LICENSE CC-BY-SA 4.0");
    expect(out).toContain("0 !HELP This is help");
    expect(out).toContain("0 !HELP More help");
    expect(out).toContain("0 !CMDLINE build --release");
  });

  test("BFC CERTIFY CW serialised", () => {
    const f = buildLDrawFile({ bfc: true, winding: "CW" });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("0 BFC CERTIFY CW");
  });

  test("BFC NOCERTIFY serialised", () => {
    const f = buildLDrawFile({ bfc: false });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("0 BFC NOCERTIFY");
  });
});

// ── serialiseLDrawFile: geometry ──────────────────────────────

describe("serialiseLDrawFile (geometry)", () => {
  test("triangles serialised correctly", () => {
    const f = buildLDrawFile({ description: "Triangle" });
    f.commands.push({
      type: 3,
      colorCode: 4,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 5, y: 10, z: 0 },
      ],
    });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("3 4");
    expect(out).toContain("0 0 0");
    expect(out).toContain("10 0 0");
    expect(out).toContain("5 10 0");
  });

  test("sub-file reference serialised", () => {
    const f = buildLDrawFile({ description: "Sub-file ref" });
    f.commands.push({
      type: 1,
      colorCode: 34,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
      file: "minivan.dat",
    });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("1 34");
    expect(out).toContain("minivan.dat");
  });

  test("line command serialised", () => {
    const f = buildLDrawFile({ description: "Line test" });
    f.commands.push({
      type: 2,
      colorCode: 1,
      points: [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }],
    });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("2 1");
    expect(out).toContain("100 0 0");
  });
});

// ── serialiseLDrawFile: newline option ────────────────────────

describe("serialiseLDrawFile (newline)", () => {
  test("default newline is \\r\\n", () => {
    const f = buildLDrawFile({ description: "Line 1" });
    f.meta.help = ["Line 2"];
    const out = serialiseLDrawFile(f);
    expect(out).toContain("\r\n");
    expect(out).not.toContain("\n\n");
  });

  test("can override to \\n", () => {
    const f = buildLDrawFile({ description: "LF only" });
    const out = serialiseLDrawFile(f, { newline: "\n" });
    expect(out).not.toContain("\r");
  });
});

// ── serialiseLDrawFile: MPD mode ──────────────────────────────

describe("serialiseLDrawFile (MPD)", () => {
  test("auto-detects MPD when subFiles present", () => {
    const root = buildLDrawFile({ description: "Root", name: "root.ldr" });
    const sub = buildLDrawFile({ description: "Sub", name: "sub.dat" });
    root.subFiles = new Map([["sub.dat", sub]]);

    const out = serialiseLDrawFile(root);
    expect(out).toContain("0 FILE root.ldr");
    expect(out).toContain("0 FILE sub.dat");
  });

  test("root description line follows FILE marker", () => {
    const root = buildLDrawFile({ description: "My Root" });
    const out = serialiseLDrawFile(root, { mpd: true });
    const fileIdx = out.indexOf("0 FILE model.ldr");
    const descIdx = out.indexOf("0 My Root");
    expect(descIdx).toBeGreaterThan(fileIdx);
  });
});

// ── Round-trip: parse → serialise → parse ─────────────────────

describe("serialise round-trip", () => {
  test("simple file round-trips geometry + meta", () => {
    const ldr = `0 Name: RoundTrip Test
0 Author: Tester
0 !LDRAW_ORG Part
0 !LICENSE MIT
4 34 0 0 0  1 0 0 0 1 0 0 1 0 0  10 0 0  20 0 0  30 0 0
3 4 0 0 0  10 0 0  5 10 0`;

    const parsed = parseLDrawFile(ldr, "roundtrip.ldr");
    const reserialised = serialiseLDrawFile(parsed);

    expect(reserialised).toContain("0 Name: RoundTrip Test");
    expect(reserialised).toContain("0 Author: Tester");
    expect(reserialised).toContain("0 !LDRAW_ORG Part");
    expect(reserialised).toContain("0 !LICENSE MIT");
    expect(reserialised).toContain("3 4");
    expect(reserialised).toContain("4 34");

    // Re-parse the serialised output
    const reparsed = parseLDrawFile(reserialised, "roundtrip.ldr");
    expect(reparsed.meta.name).toBe("RoundTrip Test");
    expect(reparsed.meta.author).toBe("Tester");
    expect(reparsed.meta.license).toBe("MIT");
    expect(reparsed.commands.length).toBeGreaterThan(0);
  });
});

// ── serialiseLDrawFile: raw line passthrough ──────────────────

describe("serialiseLDrawFile (raw lines)", () => {
  test("type-0 raw lines are preserved as-is", () => {
    const f = buildLDrawFile({ description: "My Part" });
    f.commands.push({
      type: 0,
      raw: "0 // Custom comment line",
    });
    const out = serialiseLDrawFile(f);
    expect(out).toContain("0 // Custom comment line");
  });
});
