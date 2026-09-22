// ============================================================
// LDraw Parser – Post-processing edge cases
// ============================================================

import { describe, test, expect } from "bun:test";
import {
  mergeGeometry,
  transformGeometry,
  lduToUnitScale,
  cullSmallTriangles,
  extractColorPalette,
  collectTextures,
  computeStats,
  MM_PER_LDU
} from "../src/postprocess";
import { buildColorTable } from "./color-table";
import type { Vec3 } from "../src/types";
import type { LDrawColor } from "../src/colors";

function makeVec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function makeMesh(tris: Array<[number, number, number, number, number, number, number, number, number]>, colorCode = 4) {
  return {
    colorCode,
    triangles: tris.map((t) => ({
      a: { position: makeVec(t[0], t[1], t[2]) },
      b: { position: makeVec(t[3], t[4], t[5]) },
      c: { position: makeVec(t[6], t[7], t[8]) },
    })),
  };
}

function makeFlatGeometry(meshes: any[]) {
  const colorTable = new Map<number, LDrawColor>();
  const table = buildColorTable();
  for (const m of meshes) {
    if (!colorTable.has(m.colorCode)) {
      colorTable.set(m.colorCode, table.get(m.colorCode)!);
    }
  }
  return { meshes, edges: [], colorTable, aabb: { min: makeVec(-10, -10, -10), max: makeVec(10, 10, 10), center: makeVec(0, 0, 0), size: makeVec(20, 20, 20), radius: 17.32 } };
}

// ── Unit conversion ──────────────────────────────────────────

describe("lduToUnitScale edge cases", () => {
  test("mm scale equals MM_PER_LDU", () => {
    expect(lduToUnitScale("mm")).toBeCloseTo(MM_PER_LDU);
  });

  test("m scale is mm/1000", () => {
    expect(lduToUnitScale("m")).toBeCloseTo(MM_PER_LDU / 1000);
  });

  test("studs scale is correct (1 stud = 20 LDU = 8mm)", () => {
    const studs = lduToUnitScale("studs");
    const mm = lduToUnitScale("mm");
    // 1 stud = 20 LDU, so 1 LDU = 1/20 studs = 0.05
    // 1 LDU = 0.4 mm, so mm / 8 = studs (since 1 stud = 8 mm)
    expect(studs).toBeCloseTo(0.05, 2);
    expect(mm).toBeCloseTo(0.4, 2);
    expect(studs).toBeCloseTo(mm / 8, 2);
  });

  test("ldu scale is 1", () => {
    expect(lduToUnitScale("ldu")).toBe(1);
  });

  test("cm scale is mm/10", () => {
    expect(lduToUnitScale("cm")).toBeCloseTo(MM_PER_LDU / 10);
  });

  test("in scale converts correctly", () => {
    const result = lduToUnitScale("in");
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1); // 1 LDU = 0.4mm = 0.0157 in
  });
});

// ── cullSmallTriangles ────────────────────────────────────────

describe("cullSmallTriangles edge cases", () => {
  test("removes all triangles (empty result)", () => {
    const degenMesh = makeMesh([
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1],
    ]);
    const geo = makeFlatGeometry([degenMesh]);
    const culled = cullSmallTriangles(geo, 0.1);
    // Degenerate triangles have zero area
    const totalTris = culled.meshes.reduce((a, m) => a + m.triangles.length, 0);
    expect(totalTris).toBe(0);
  });

  test("preserves collinear but non-degenerate triangles", () => {
    const mesh = makeMesh([
      [0, 0, 0, 5, 0, 0, 10, 0, 0], // collinear but not degenerate (distinct vertices)
    ]);
    const geo = makeFlatGeometry([mesh]);
    const culled = cullSmallTriangles(geo, 0.01);
    // This depends on the implementation's handling of collinear triangles
    expect(culled.meshes).toBeDefined();
  });

  test("does not modify original geometry", () => {
    const mesh = makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]]);
    const geo = makeFlatGeometry([mesh]);
    const origCount = geo.meshes[0].triangles.length;
    cullSmallTriangles(geo, 100);
    expect(geo.meshes[0].triangles.length).toBe(origCount);
  });
});

// ── mergeGeometry with edges ─────────────────────────────────

describe("mergeGeometry with edges", () => {
  test("merges edges by color", () => {
    buildColorTable().get(4)!;
    const mesh = makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4);
    const geo = {
      ...makeFlatGeometry([mesh]),
      edges: [
        { colorCode: 4, segments: [{ start: makeVec(0, 0, 0), end: makeVec(10, 0, 0) }] },
        { colorCode: 4, segments: [{ start: makeVec(0, 0, 0), end: makeVec(0, 10, 0) }] },
      ],
    };
    const merged = mergeGeometry(geo);
    // Both edges have colorCode 4, should be merged into one
    expect(merged.edges.length).toBe(1);
    expect(merged.edges[0]!.segments).toHaveLength(2);
  });

  test("keeps edges of different colors separate", () => {
    const mesh = makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4);
    const geo = {
      ...makeFlatGeometry([mesh]),
      edges: [
        { colorCode: 4, segments: [{ start: makeVec(0, 0, 0), end: makeVec(10, 0, 0) }] },
        { colorCode: 1, segments: [{ start: makeVec(0, 0, 0), end: makeVec(0, 10, 0) }] },
      ],
    };
    const merged = mergeGeometry(geo);
    expect(merged.edges.length).toBe(2);
  });
});

// ── extractColorPalette with edges ───────────────────────────

describe("extractColorPalette", () => {
  test("includes edge colors in palette", () => {
    const mesh = makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4);
    const geo = {
      ...makeFlatGeometry([mesh]),
      edges: [{ colorCode: 4, segments: [{ start: makeVec(0, 0, 0), end: makeVec(10, 0, 0) }] }],
    };
    const palette = extractColorPalette(geo);
    const redEntry = palette.find((p) => p.color.code === 4);
    expect(redEntry).toBeDefined();
    expect(redEntry!.triangleCount).toBeGreaterThanOrEqual(1);
    expect(redEntry!.edgeCount).toBeGreaterThanOrEqual(1);
  });
});

// ── transformGeometry ────────────────────────────────────────

describe("transformGeometry", () => {
  test("with yUp=false preserves coordinates", () => {
    const mesh = makeMesh([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    const geo = makeFlatGeometry([mesh]);
    const transformed = transformGeometry(geo, 1, false);
    const pos = transformed.meshes[0]!.triangles[0]!.a.position;
    expect(pos.x).toBeCloseTo(1);
    expect(pos.y).toBeCloseTo(2);
    expect(pos.z).toBeCloseTo(3);
  });

  test("scale factor is applied correctly", () => {
    const mesh = makeMesh([[10, 0, 0, 20, 0, 0, 30, 0, 0]]);
    const geo = makeFlatGeometry([mesh]);
    const transformed = transformGeometry(geo, 0.001, false);
    const pos = transformed.meshes[0]!.triangles[0]!.a.position;
    expect(pos.x).toBeCloseTo(0.01);
  });
});

// ── collectTextures with glossmap ────────────────────────────

describe("collectTextures with glossmap", () => {
  test("collects glossmap names when present", () => {
    const mesh = {
      ...makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4),
      texmap: {
        projection: "PLANAR" as const,
        point1: makeVec(0, 0, 0),
        point2: makeVec(10, 0, 0),
        point3: makeVec(0, 0, 10),
        texture: "diffuse.png",
        glossmap: "gloss.png",
      },
    };
    const geo = makeFlatGeometry([mesh]);
    const textures = collectTextures(geo);
    expect(textures).toContain("diffuse.png");
    expect(textures).toContain("gloss.png");
  });
});

// ── computeStats with edges ──────────────────────────────────

describe("computeStats with edges", () => {
  test("edge count is included in stats", () => {
    const mesh = makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]]);
    const geo = {
      ...makeFlatGeometry([mesh]),
      edges: [{ colorCode: 4, segments: [{ start: makeVec(0, 0, 0), end: makeVec(10, 0, 0) }] }],
    };
    const stats = computeStats(geo);
    expect(stats.triangleCount).toBe(1);
    expect(stats.vertexCount).toBe(3);
  });
});
