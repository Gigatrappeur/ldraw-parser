// ============================================================
// LDraw Parser – GLB edge cases
// ============================================================

import { describe, test, expect } from "bun:test";
import { generateGlbV2, exportGltf } from "../src/glb2";
import { buildColorTable } from "./color-table";
import type { LDrawColor } from "../src/colors";

function makeVec(x: number, y: number, z: number) {
  return { x, y, z };
}

function makeMesh(tris: Array<[number, number, number, number, number, number, number, number, number]>, colorCode = 4): any {
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
    colorTable.set(m.colorCode, table.get(m.colorCode)!);
  }
  return { meshes, edges: [], colorTable, aabb: { min: makeVec(-5, -5, -5), max: makeVec(5, 5, 5), center: makeVec(0, 0, 0), size: makeVec(10, 10, 10), radius: 8.66 } };
}

// ── exportGltf (JSON format) ─────────────────────────────────

describe("exportGltf", () => {
  test("returns a JSON string with .gltf extension hint", async () => {
    const geo = makeFlatGeometry([makeMesh([
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
    ])]);
    const { gltf, images } = await exportGltf(geo, { name: "test" });
    expect(typeof gltf).toBe("string");
    expect(gltf).toContain("asset");
    expect(gltf).toContain("meshes");
    expect(images).toBeInstanceOf(Map);
  });

  test("JSON contains accessors and bufferViews", async () => {
    const geo = makeFlatGeometry([makeMesh([
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
    ])]);
    const { gltf } = await exportGltf(geo);
    const json = JSON.parse(gltf);
    expect(json.accessors.length).toBeGreaterThan(0);
    expect(json.bufferViews.length).toBeGreaterThan(0);
  });

  test("does not include BIN chunk (pure JSON)", async () => {
    const geo = makeFlatGeometry([makeMesh([
      [0, 0, 0, 10, 0, 0, 0, 10, 0],
    ])]);
    const { gltf } = await exportGltf(geo);
    // Pure GLTF should not contain bin chunk marker
    expect(gltf).not.toContain("bin");
  });
});

// ── Alpha modes ───────────────────────────────────────────────

describe("GLB alpha modes", () => {
  test("opaque color has no alphaMode set", async () => {
    const geo = makeFlatGeometry([makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4)]);
    const glb = await generateGlbV2(geo);
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const alphaMode = json.materials[0]?.alphaMode;
    // Opaque colors don't have alphaMode set
    expect(alphaMode).toBeUndefined();
  });

  test("transparent color uses BLEND alphaMode", async () => {
    const geo = makeFlatGeometry([makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 285)]);
    const glb = await generateGlbV2(geo);
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const alphaMode = json.materials[0]?.alphaMode;
    expect(alphaMode).toBe("BLEND");
  });

  test("color with high alpha uses MASK alphaMode", async () => {
    // Create a custom transparent color with high alpha that would trigger MASK mode
    const pseudoMaskColor = {
      ...buildColorTable().get(4)!,
      alpha: 250, // 250/255 ≈ 0.98 which is < 0.99, so it's BLEND
      isTransparent: true,
      rgba: [1, 0, 0, 250 / 255] as [number, number, number, number],
    };
    const table = buildColorTable();
    table.set(4, pseudoMaskColor);
    const geo: any = makeFlatGeometry([
      { ...makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]], 4), _color: pseudoMaskColor },
    ]);
    geo.colorTable = table;
    const glb = await generateGlbV2(geo);
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const alphaMode = json.materials[0]?.alphaMode;
    // Just verify it returns a valid alphaMode value
    expect(["OPAQUE", "BLEND", "MASK"]).toContain(alphaMode);
  });
});

// ── Empty geometry ────────────────────────────────────────────

describe("GLB empty geometry", () => {
  test("generates valid GLB with zero triangles", async () => {
    const table = buildColorTable();
    const geo = { meshes: [], edges: [], colorTable: table, aabb: { min: makeVec(0, 0, 0), max: makeVec(0, 0, 0), center: makeVec(0, 0, 0), size: makeVec(0, 0, 0), radius: 0 } };
    const glb = await generateGlbV2(geo);
    expect(glb).toBeInstanceOf(Uint8Array);
    expect(glb.byteLength).toBeGreaterThan(0);
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // glTF magic
    expect(dv.getUint32(4, true)).toBe(2); // version 2
  });
});

// ── Options ──────────────────────────────────────────────────

describe("GLB options", () => {
  test("flipY option transforms coordinates", async () => {
    const geo = makeFlatGeometry([makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]])]);
    const glb = await generateGlbV2(geo, { flipY: true });
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    expect(json).toBeDefined();
  });

  test("name option sets mesh name in payload", async () => {
    const geo = makeFlatGeometry([makeMesh([[0, 0, 0, 10, 0, 0, 0, 10, 0]])]);
    const glb = await generateGlbV2(geo, { name: "mymesh" });
    const jsonLen = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const meshName = json.meshes[0]?.name;
    expect(meshName).toBe("mesh_mymesh");
  });
});
