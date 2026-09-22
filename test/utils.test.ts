// ============================================================
// LDraw Parser – Utility functions tests
// ============================================================

import { describe, test, expect } from "bun:test";
import {
  IDENTITY,
  buildMatrix,
  tok,
  num,
  vec,
  vec3,
  vec3Add,
  vec3Sub,
  vec3Cross,
  vec3Dot,
  vec3LengthSq,
  vec3Length,
  vec3Normalize,
  aabbEmpty,
  aabbExpand,
  aabbFinalize,
  normalizeFileName,
} from "../src/utils";
import type { Vec3 } from "../src/types";

// ── Matrix helpers ────────────────────────────────────────────

describe("IDENTITY", () => {
  test("has 16 elements", () => {
    expect(IDENTITY).toHaveLength(16);
  });

  test("diagonal elements are 1", () => {
    expect(IDENTITY[0]).toBe(1);
    expect(IDENTITY[5]).toBe(1);
    expect(IDENTITY[10]).toBe(1);
    expect(IDENTITY[15]).toBe(1);
  });

  test("off-diagonal elements are 0", () => {
    for (let i = 0; i < 16; i++) {
      if ([0, 5, 10, 15].includes(i)) continue;
      expect(IDENTITY[i]).toBe(0);
    }
  });
});

describe("buildMatrix", () => {
  test("builds identity matrix from identity LDraw values", () => {
    const m = buildMatrix(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    expect(m).toEqual(IDENTITY);
  });

  test("translation is stored in last column", () => {
    const m = buildMatrix(10, 20, 30, 1, 0, 0, 0, 1, 0, 0, 0, 1);
    expect(m[12]).toBe(10);
    expect(m[13]).toBe(20);
    expect(m[14]).toBe(30);
  });

  test("stores rotation column-major (transposed)", () => {
    // LDraw row-major: [1,2,3; 4,5,6; 7,8,9]
    // Should become column-major: col0=[1,4,7], col1=[2,5,8], col2=[3,6,9]
    const m = buildMatrix(0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    expect(m[0]).toBe(1); // col0 row0
    expect(m[1]).toBe(4); // col0 row1
    expect(m[2]).toBe(7); // col0 row2
    expect(m[4]).toBe(2); // col1 row0
    expect(m[5]).toBe(5); // col1 row1
    expect(m[8]).toBe(3); // col2 row0
    expect(m[9]).toBe(6); // col2 row1
    expect(m[10]).toBe(9); // col2 row2
  });

  test("rotation by 90 degrees around Z", () => {
    // cos(90)=0, sin(90)=1
    // Row-major: [0, -1, 0; 1, 0, 0; 0, 0, 1]
    const m = buildMatrix(0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 1);
    expect(m[0]).toBe(0);
    expect(m[1]).toBe(1);
    expect(m[4]).toBe(-1);
    expect(m[5]).toBe(0);
  });
});

// ── Token helpers ─────────────────────────────────────────────

describe("tok", () => {
  test("returns string at index", () => {
    expect(tok(["a", "b", "c"], 1)).toBe("b");
  });

  test("returns empty string for out-of-bounds index", () => {
    expect(tok(["a"], 5)).toBe("");
  });
});

describe("num", () => {
  test("parses numeric string", () => {
    expect(num(["1", "2", "3"], 0)).toBe(1);
  });

  test("returns 0 for non-numeric", () => {
    expect(num(["abc"], 0)).toBe(0);
  });

  test("returns 0 for out-of-bounds", () => {
    expect(num(["a"], 10)).toBe(0);
  });
});

describe("vec", () => {
  test("creates Vec3 from three consecutive values", () => {
    const result = vec(["1", "2", "3"], 0);
    expect(result).toEqual({ x: 1, y: 2, z: 3 });
  });

  test("handles mixed numeric and non-numeric", () => {
    const result = vec(["1", "abc", "3"], 0);
    expect(result).toEqual({ x: 1, y: 0, z: 3 });
  });
});

// ── Vec3 helpers ──────────────────────────────────────────────

describe("vec3", () => {
  test("creates a Vec3", () => {
    expect(vec3(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("vec3Add", () => {
  test("adds two vectors", () => {
    expect(vec3Add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }))
      .toEqual({ x: 5, y: 7, z: 9 });
  });

  test("adds zero vector", () => {
    const v: Vec3 = { x: 1, y: 2, z: 3 };
    expect(vec3Add(v, { x: 0, y: 0, z: 0 })).toEqual(v);
  });
});

describe("vec3Sub", () => {
  test("subtracts two vectors", () => {
    expect(vec3Sub({ x: 5, y: 7, z: 9 }, { x: 4, y: 5, z: 6 }))
      .toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("vec3Cross", () => {
  test("cross product of X and Y is Z", () => {
    const cross = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(cross).toEqual({ x: 0, y: 0, z: 1 });
  });

  test("cross product of parallel vectors is zero", () => {
    const cross = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    expect(cross).toEqual({ x: 0, y: 0, z: 0 });
  });

  test("cross product is anti-commutative", () => {
    const ab = vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const ba = vec3Cross({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(ba.x).toBeCloseTo(-ab.x, 10);
    expect(ba.y).toBeCloseTo(-ab.y, 10);
    expect(ba.z).toBeCloseTo(-ab.z, 10);
  });
});

describe("vec3Dot", () => {
  test("dot product of perpendicular vectors is 0", () => {
    expect(vec3Dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  test("dot product of parallel vectors is product of lengths", () => {
    expect(vec3Dot({ x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })).toBe(6);
  });

  test("dot product of a vector with itself is squared length", () => {
    const v: Vec3 = { x: 3, y: 4, z: 0 };
    expect(vec3Dot(v, v)).toBe(25);
  });
});

describe("vec3LengthSq", () => {
  test("returns squared length", () => {
    expect(vec3LengthSq({ x: 3, y: 4, z: 0 })).toBe(25);
  });

  test("length of zero vector is 0", () => {
    expect(vec3LengthSq({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe("vec3Length", () => {
  test("returns length", () => {
    expect(vec3Length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 4);
  });

  test("length of zero vector is 0", () => {
    expect(vec3Length({ x: 0, y: 0, z: 0 })).toBe(0);
  });
});

describe("vec3Normalize", () => {
  test("normalizes a vector to unit length", () => {
    const v: Vec3 = { x: 3, y: 4, z: 0 };
    const n = vec3Normalize(v);
    expect(vec3Length(n)).toBeCloseTo(1, 4);
  });

  test("normalizes X axis to itself", () => {
    const n = vec3Normalize({ x: 5, y: 0, z: 0 });
    expect(n).toEqual({ x: 1, y: 0, z: 0 });
  });

  test("normalizes zero vector to zero", () => {
    const n = vec3Normalize({ x: 0, y: 0, z: 0 });
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ── AABB helpers ──────────────────────────────────────────────

describe("aabbEmpty", () => {
  test("creates an AABB with Infinity bounds", () => {
    const box = aabbEmpty();
    expect(box.min.x).toBe(Infinity);
    expect(box.max.x).toBe(-Infinity);
  });
});

describe("aabbExpand", () => {
  test("expands box to include a point", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 5, y: -3, z: 10 });
    expect(box.min.x).toBe(5);
    expect(box.max.x).toBe(5);
    expect(box.min.y).toBe(-3);
    expect(box.max.y).toBe(-3);
    expect(box.min.z).toBe(10);
    expect(box.max.z).toBe(10);
  });

  test("expands to cover multiple points", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 0, y: 0, z: 0 });
    aabbExpand(box, { x: -5, y: 10, z: -3 });
    aabbExpand(box, { x: 7, y: -2, z: 4 });
    expect(box.min).toEqual({ x: -5, y: -2, z: -3 });
    expect(box.max).toEqual({ x: 7, y: 10, z: 4 });
  });

  test("does not shrink for interior points", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 0, y: 0, z: 0 });
    aabbExpand(box, { x: 10, y: 10, z: 10 });
    aabbExpand(box, { x: 5, y: 5, z: 5 }); // interior
    expect(box.min).toEqual({ x: 0, y: 0, z: 0 });
    expect(box.max).toEqual({ x: 10, y: 10, z: 10 });
  });
});

describe("aabbFinalize", () => {
  test("computes center, size, and radius", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 0, y: 0, z: 0 });
    aabbExpand(box, { x: 10, y: 10, z: 10 });
    const result = aabbFinalize(box);
    expect(result.center).toEqual({ x: 5, y: 5, z: 5 });
    expect(result.size).toEqual({ x: 10, y: 10, z: 10 });
    expect(result.radius).toBeCloseTo(Math.sqrt(75), 4);
  });

  test("handles empty AABB (all Infinity)", () => {
    const box: any = { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } };
    const result = aabbFinalize(box);
    expect(result.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.size).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.radius).toBe(0);
  });

  test("handles single-point AABB", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 5, y: 5, z: 5 });
    const result = aabbFinalize(box);
    expect(result.size).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.radius).toBe(0);
  });

  test("does not mutate original box", () => {
    const box = aabbEmpty();
    aabbExpand(box, { x: 0, y: 0, z: 0 });
    aabbExpand(box, { x: 10, y: 10, z: 10 });
    void aabbFinalize(box);
    expect((box as any).center).toBeUndefined();
    expect((box as any).size).toBeUndefined();
    expect((box as any).radius).toBeUndefined();
  });
});

// ── File name normalization ──────────────────────────────────

describe("normalizeFileName", () => {
  test("converts backslashes to forward slashes", () => {
    expect(normalizeFileName("sub\\dir\\file.dat")).toBe("sub/dir/file.dat");
  });

  test("lowercases the result", () => {
    expect(normalizeFileName("SubDir/File.DAT")).toBe("subdir/file.dat");
  });

  test("trims whitespace", () => {
    expect(normalizeFileName("  file.dat  ")).toBe("file.dat");
  });

  test("handles already-normalized names", () => {
    expect(normalizeFileName("file.dat")).toBe("file.dat");
  });
});
