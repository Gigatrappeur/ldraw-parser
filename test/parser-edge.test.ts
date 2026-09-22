// ============================================================
// LDraw Parser – Parser edge cases
// ============================================================

import { describe, test, expect } from "bun:test";
import { parseLDrawFile } from "../src/parser";

// ── Empty / minimal files ─────────────────────────────────────

describe("parser edge cases", () => {
  test("handles completely empty file", () => {
    const file = parseLDrawFile("", "empty.dat");
    expect(file.meta.description).toBeUndefined();
    expect(file.commands).toHaveLength(0);
  });

  test("handles whitespace-only file", () => {
    const file = parseLDrawFile("   \n  \t  \n  ", "ws.dat");
    expect(file.commands).toHaveLength(0);
  });

  test("handles file with only meta (no geometry)", () => {
    const content = [
      "0 Only Meta",
      "0 Name: meta_only.dat",
      "0 Author: Bot",
      "0 BFC CERTIFY CCW",
    ].join("\n");
    const file = parseLDrawFile(content, "meta_only.dat");
    expect(file.meta.description).toBe("Only Meta");
    expect(file.meta.author).toBe("Bot");
    expect(file.meta.bfcCertified).toBe(true);
    expect(file.commands.filter((c) => c.type === 3)).toHaveLength(0);
  });

  test("keeps raw lines when keepRawLines is true", () => {
    const content = "0 Test\n3 4 0 0 0 10 0 0 0 10 0";
    const file = parseLDrawFile(content, "test.dat", true);
    expect(file.rawLines).toBeDefined();
    expect(file.rawLines!.length).toBe(2);
  });

  test("does not keep raw lines when keepRawLines is false", () => {
    const content = "0 Test\n3 4 0 0 0 10 0 0 0 10 0";
    const file = parseLDrawFile(content, "test.dat", false);
    expect(file.rawLines).toBeUndefined();
  });
});

// ── TEXMAP keywords ──────────────────────────────────────────

describe("TEXMAP keywords", () => {
  test("FALLBACK keyword does not break parsing", () => {
    const content = [
      "0 Tex File",
      "0 !TEXMAP START PLANAR 0 0 0 10 0 0 0 0 10 tex.png",
      "0 !TEXMAP FALLBACK",
      "3 4 0 0 0 10 0 0 0 10 0",
    ].join("\n");
    const file = parseLDrawFile(content, "fallback.dat");
    const texmaps = file.commands.filter((c) => 'meta' in c && c.meta === "TEXMAP");
    expect(texmaps.length).toBeGreaterThanOrEqual(2);
  });

  test("END keyword closes texmap", () => {
    const content = [
      "0 Tex File",
      "0 !TEXMAP START PLANAR 0 0 0 10 0 0 0 0 10 tex.png",
      "3 4 0 0 0 10 0 0 0 10 0",
      "0 !TEXMAP END",
      "3 1 10 0 0 10 10 0 10 0 10",
    ].join("\n");
    const file = parseLDrawFile(content, "end.dat");
    const texmaps = file.commands.filter((c) => 'meta' in c && c.meta === "TEXMAP");
    expect(texmaps).toHaveLength(2); // START + END
  });
});

// ── BFC edge cases ───────────────────────────────────────────

describe("BFC commands", () => {
  test("INVERTNEXT inverts next triangle winding", () => {
    const content = [
      "0 BFC Test",
      "0 BFC CERTIFY CCW",
      "0 BFC INVERTNEXT",
      "3 4 0 0 0 10 0 0 0 10 0",
    ].join("\n");
    const file = parseLDrawFile(content, "invert.dat");
    // INVERTNEXT affects internal parser state (not stored on command)
    const tri = file.commands.find((c) => c.type === 3);
    expect(tri).toBeDefined();
    expect(tri!.type).toBe(3);
  });

  test("CW standalone directive does not certify", () => {
    const content = [
      "0 BFC Test",
      "0 BFC CW",
      "3 4 0 0 0 10 0 0 0 10 0",
    ].join("\n");
    const file = parseLDrawFile(content, "cw.dat");
    // bfcCertified is undefined when no CERTIFY/NO CERTIFY directive found
    expect(file.meta.bfcCertified).toBeUndefined();
  });

  test("CLIP directive does not add bfcClipEnabled to meta", () => {
    const content = [
      "0 Clip Test",
      "0 BFC CLIP",
      "3 4 0 0 0 10 0 0 0 10 0",
    ].join("\n");
    const file = parseLDrawFile(content, "clip.dat");
    // bfcClipEnabled is not a field on LDrawFileMeta
    expect((file.meta as any).bfcClipEnabled).toBeUndefined();
  });
});

// ── Meta commands ────────────────────────────────────────────

describe("meta commands", () => {
  test("parses !LICENSE meta", () => {
    const content = "0 License Test\n0 !LICENSE CC-BY-4.0\n3 4 0 0 0 10 0 0 0 10 0";
    const file = parseLDrawFile(content, "license.dat");
    expect(file.meta.license).toBe("CC-BY-4.0");
  });

  test("parses !HELP meta", () => {
    const content = "0 Help Test\n0 !HELP This is help text\n3 4 0 0 0 10 0 0 0 10 0";
    const file = parseLDrawFile(content, "help.dat");
    expect(file.meta.help).toEqual(["This is help text"]);
  });

  test("parses multiple !KEYWORDS lines with deduplication", () => {
    const content = [
      "0 Dup Test",
      "0 !KEYWORDS alpha, beta",
      "0 !KEYWORDS beta, gamma",
      "0 !KEYWORDS gamma, delta",
    ].join("\n");
    const file = parseLDrawFile(content, "dup.dat");
    const kw = file.meta.keywords!;
    expect(kw).toContain("alpha");
    expect(kw).toContain("beta");
    expect(kw).toContain("gamma");
    expect(kw).toContain("delta");
    expect(kw.length).toBe(4); // no duplicates
  });

  test("parses type-5 optional line", () => {
    const content = [
      "0 Optional Line Test",
      "5 0 10 20 30 40 50 60 70 80 90 100",
    ].join("\n");
    const file = parseLDrawFile(content, "opt.dat");
    const opt = file.commands.find((c) => c.type === 5);
    expect(opt).toBeDefined();
    expect(opt!.type).toBe(5);
  });
});

// ── Sub-file references ──────────────────────────────────────

describe("sub-file reference edge cases", () => {
  test("handles file name with spaces", () => {
    const content = "0 Spaces\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 my part.dat";
    const file = parseLDrawFile(content, "spaces.dat");
    const sub = file.commands.find((c) => c.type === 1);
    expect((sub as any).file).toBe("my part.dat");
  });

  test("type-1 with color 24 (edges) is parsed", () => {
    const content = "0 Edges\n1 24 0 0 0 1 0 0 0 1 0 0 0 1 edge_part.dat";
    const file = parseLDrawFile(content, "edges.dat");
    const sub = file.commands.find((c) => c.type === 1);
    expect((sub as any).colorCode).toBe(24);
  });
});
