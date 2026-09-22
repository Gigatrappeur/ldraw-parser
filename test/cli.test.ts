// ============================================================
// LDraw Parser – CLI parser tests
// ============================================================

import { describe, test, expect } from "bun:test";
import { parseColorSpec } from "../src/cli";

// ── parseColorSpec ────────────────────────────────────────────

describe("parseColorSpec", () => {
  test("returns 71 (default) for unknown hex colors", () => {
    // FF0000 is not an LDraw color code, so it returns the default (71)
    const result = parseColorSpec("#FF0000");
    expect(result).toBe(71);
  });

  test("returns 71 for unknown hex without #", () => {
    const result = parseColorSpec("FF0000");
    expect(result).toBe(71);
  });

  test("returns 71 for unknown hex 999999", () => {
    const result = parseColorSpec("#999999");
    expect(result).toBe(71);
  });

  test("parses numeric LDraw code", () => {
    const result = parseColorSpec("4");
    expect(result).toBe(4);
  });

  test("parses numeric code 71", () => {
    const result = parseColorSpec("71");
    expect(result).toBe(71);
  });

  test("returns 71 for invalid input", () => {
    const result = parseColorSpec("notAColor");
    expect(result).toBe(71);
  });

  test("handles whitespace in input", () => {
    expect(parseColorSpec("  4  ")).toBe(4);
    expect(parseColorSpec("  71  ")).toBe(71);
  });

  test("returns 71 (default) for malformed hex", () => {
    // Malformed hex doesn't match the regex, so parseInt returns NaN
    // and the function returns 71 (default)
    expect(parseColorSpec("#GGG000")).toBe(71);
    expect(parseColorSpec("#FFFF")).toBe(71);
    expect(parseColorSpec("#12345")).toBe(71);
  });
});
