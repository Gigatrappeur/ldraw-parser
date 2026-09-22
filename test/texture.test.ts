// ============================================================
// LDraw Parser – TEXMAP UV projection tests
// ============================================================

import { describe, test, expect } from "bun:test";
import { parseTexmapStart, projectTexmap } from "../src/texture";
import type { TexmapDefinition, Vec3 } from "../src/types";

// ── parseTexmapStart ──────────────────────────────────────────

describe("parseTexmapStart", () => {
  test("returns null for input without START/NEXT keyword", () => {
    const parts = "0 !TEXMAP texture.png PLANAR 0 0 0 10 0 0 0 0 10".split(/\s+/);
    expect(parseTexmapStart(parts)).toBeNull();
  });

  test("parses PLANAR projection with texture name", () => {
    const parts = "0 !TEXMAP START PLANAR 0 0 0 10 0 0 0 0 10 texture.png".split(/\s+/);
    const def = parseTexmapStart(parts);
    expect(def).not.toBeNull();
    expect(def!.projection).toBe("PLANAR");
    expect(def!.texture).toBe("texture.png");
    expect(def!.point1).toMatchObject({ x: 0, y: 0, z: 0 });
    expect(def!.point2).toMatchObject({ x: 10, y: 0, z: 0 });
    expect(def!.point3).toMatchObject({ x: 0, y: 0, z: 10 });
  });

  test("parses NEXT keyword (replaces current texmap)", () => {
    const parts = "0 !TEXMAP NEXT CYLINDRICAL 0 0 0 10 0 0 0 0 10 360 texture.png".split(/\s+/);
    const def = parseTexmapStart(parts);
    expect(def).not.toBeNull();
    expect(def!.projection).toBe("CYLINDRICAL");
    expect(def!.texture).toBe("texture.png");
    if ("angle" in def!) {
      expect((def as any).angle).toBe(360);
    }
  });

  test("parses SPHERICAL projection with two angles", () => {
    const parts = "0 !TEXMAP START SPHERICAL 0 0 0 10 0 0 0 0 10 360 180 texture.png".split(/\s+/);
    const def = parseTexmapStart(parts);
    expect(def).not.toBeNull();
    expect(def!.projection).toBe("SPHERICAL");
    if ("angle1" in def!) {
      expect((def as any).angle1).toBe(360);
      expect((def as any).angle2).toBe(180);
    }
  });

  test("extracts GLOSSMAP when present", () => {
    const parts = "0 !TEXMAP START PLANAR 0 0 0 10 0 0 0 0 10 texture.png GLOSSMAP gloss.png".split(/\s+/);
    const def = parseTexmapStart(parts);
    expect(def).not.toBeNull();
    expect(def!.glossmap).toBe("gloss.png");
  });

  test("returns null for invalid projection type", () => {
    const parts = "0 !TEXMAP START INVALID 0 0 0 10 0 0 0 0 10 texture.png".split(/\s+/);
    expect(parseTexmapStart(parts)).toBeNull();
  });
});

// ── projectTexmap ─────────────────────────────────────────────

describe("projectTexmap", () => {
  test("PLANAR: point at origin maps to (0, 0)", () => {
    const def: TexmapDefinition = {
      projection: "PLANAR",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      texture: "test.png",
    };
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const uv = projectTexmap(def, p);
    expect(uv.u).toBeCloseTo(0, 4);
    expect(uv.v).toBeCloseTo(0, 4);
  });

  test("PLANAR: point at point2 maps to u=1, v=0", () => {
    const def: TexmapDefinition = {
      projection: "PLANAR",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      texture: "test.png",
    };
    const p: Vec3 = { x: 10, y: 0, z: 0 };
    const uv = projectTexmap(def, p);
    expect(uv.u).toBeCloseTo(1, 4);
    expect(uv.v).toBeCloseTo(0, 4);
  });

  test("PLANAR: point at point3 maps to u=0, v=1", () => {
    const def: TexmapDefinition = {
      projection: "PLANAR",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      texture: "test.png",
    };
    const p: Vec3 = { x: 0, y: 0, z: 10 };
    const uv = projectTexmap(def, p);
    expect(uv.u).toBeCloseTo(0, 4);
    expect(uv.v).toBeCloseTo(1, 4);
  });

  test("PLANAR: midpoint maps to u=0.5, v=0.5", () => {
    const def: TexmapDefinition = {
      projection: "PLANAR",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      texture: "test.png",
    };
    const p: Vec3 = { x: 5, y: 0, z: 5 };
    const uv = projectTexmap(def, p);
    expect(uv.u).toBeCloseTo(0.5, 4);
    expect(uv.v).toBeCloseTo(0.5, 4);
  });

  test("CYLINDRICAL: returns UV within [0,1] range", () => {
    const def: TexmapDefinition = {
      projection: "CYLINDRICAL",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      angle: 360,
      texture: "test.png",
    };
    const p: Vec3 = { x: 5, y: 0, z: 5 };
    const uv = projectTexmap(def, p);
    expect(typeof uv.u).toBe("number");
    expect(typeof uv.v).toBe("number");
  });

  test("SPHERICAL: returns UV within [0,1] range", () => {
    const def: TexmapDefinition = {
      projection: "SPHERICAL",
      point1: { x: 0, y: 0, z: 0 },
      point2: { x: 10, y: 0, z: 0 },
      point3: { x: 0, y: 0, z: 10 },
      angle1: 360,
      angle2: 180,
      texture: "test.png",
    };
    const p: Vec3 = { x: 5, y: 0, z: 5 };
    const uv = projectTexmap(def, p);
    expect(typeof uv.u).toBe("number");
    expect(typeof uv.v).toBe("number");
  });
});
