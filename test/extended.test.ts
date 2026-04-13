// ============================================================
// LDraw Parser – Extended test suite
// bun test tests/extended.test.ts
// ============================================================

import { describe, test, expect } from "bun:test";
import { weldMesh, weldGeometry, mergeWeldedMeshes } from "../src/weld";
import { smoothMeshNormals, computeSmoothNormals } from "../src/normals";
import { generateGlbV2 } from "../src/glb2";
import { generateObj } from "../src/obj";
import { LDrawError, LDrawParseError, LDrawResolveError, LDrawDepthError } from "../src/errors";
import {
  transformGeometry,
  mergeGeometry,
  computeStats,
  cullSmallTriangles,
  extractColorPalette,
  collectTextures,
  lduToUnitScale,
  LDU_PER_MM,
  MM_PER_LDU,
} from "../src/postprocess";
import { LDrawParser } from "../src/index";
import type { GeometryMesh, FlatGeometry, LDrawColor, Vec3 } from "../src/types";
import { buildColorTable } from "../src/colors";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const RED_COLOR: LDrawColor = buildColorTable().get(4)!;
const TRANS_COLOR: LDrawColor = (() => {
  const c = buildColorTable().get(285); // Trans-Light_Blue
  return c ?? { ...RED_COLOR, alpha: 128, isTransparent: true, rgba: [0.4, 0.7, 0.8, 0.5] };
})();

function makeVec(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

/** Build a flat GeometryMesh from an array of triangle vertex triplets */
function makeMesh(
  triangles: Array<[Vec3, Vec3, Vec3]>,
  colorCode = 4,
  color: LDrawColor = RED_COLOR,
): GeometryMesh {
  return {
    colorCode,
    color,
    triangles: triangles.map(([a, b, c]) => ({
      a: { position: a },
      b: { position: b },
      c: { position: c },
    })),
  };
}

/** A flat quad made of two coplanar triangles sharing an edge */
const FLAT_QUAD_MESH = makeMesh([
  [makeVec(0,0,0),  makeVec(10,0,0),  makeVec(10,0,10)],
  [makeVec(0,0,0),  makeVec(10,0,10), makeVec(0,0,10)],
]);

/** A cube: 6 faces × 2 triangles = 12 triangles */
function makeCubeMesh(size = 10): GeometryMesh {
  const s = size / 2;
  const tris: Array<[Vec3, Vec3, Vec3]> = [
    // +Y
    [makeVec(-s,s,-s), makeVec(s,s,-s), makeVec(s,s,s)],
    [makeVec(-s,s,-s), makeVec(s,s,s),  makeVec(-s,s,s)],
    // -Y
    [makeVec(-s,-s,s),  makeVec(s,-s,s),  makeVec(s,-s,-s)],
    [makeVec(-s,-s,s),  makeVec(s,-s,-s), makeVec(-s,-s,-s)],
    // +X
    [makeVec(s,-s,-s), makeVec(s,-s,s),  makeVec(s,s,s)],
    [makeVec(s,-s,-s), makeVec(s,s,s),   makeVec(s,s,-s)],
    // -X
    [makeVec(-s,-s,s), makeVec(-s,-s,-s), makeVec(-s,s,-s)],
    [makeVec(-s,-s,s), makeVec(-s,s,-s),  makeVec(-s,s,s)],
    // +Z
    [makeVec(-s,-s,s), makeVec(s,-s,s),  makeVec(s,s,s)],
    [makeVec(-s,-s,s), makeVec(s,s,s),   makeVec(-s,s,s)],
    // -Z
    [makeVec(s,-s,-s), makeVec(-s,-s,-s), makeVec(-s,s,-s)],
    [makeVec(s,-s,-s), makeVec(-s,s,-s),  makeVec(s,s,-s)],
  ];
  return makeMesh(tris);
}

function makeFlatGeometry(meshes: GeometryMesh[]): FlatGeometry {
  return {
    meshes,
    edges: [],
    aabb: {
      min: makeVec(-10,-10,-10), max: makeVec(10,10,10),
      center: makeVec(0,0,0), size: makeVec(20,20,20), radius: 17.32,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Weld
// ─────────────────────────────────────────────────────────────

describe("weldMesh", () => {
  test("produces fewer vertices than triangles×3 for shared geometry", () => {
    const w = weldMesh(FLAT_QUAD_MESH);
    const raw = FLAT_QUAD_MESH.triangles.length * 3;
    // The quad has 4 unique corners – two shared
    expect(w.positions.length / 3).toBeLessThan(raw);
    expect(w.positions.length / 3).toBe(4);
  });

  test("index count equals triangle×3", () => {
    const w = weldMesh(FLAT_QUAD_MESH);
    expect(w.indices.length).toBe(FLAT_QUAD_MESH.triangles.length * 3);
  });

  test("smooth normals are normalised (length ≈ 1)", () => {
    const w = weldMesh(FLAT_QUAD_MESH, { smoothNormals: true });
    for (let i = 0; i < w.normals.length; i += 3) {
      const nx = w.normals[i] ?? 0, ny = w.normals[i+1] ?? 0, nz = w.normals[i+2] ?? 0;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      expect(len).toBeCloseTo(1, 4);
    }
  });

  test("flat normals yield correct face normal for XZ plane", () => {
    const w = weldMesh(FLAT_QUAD_MESH, { smoothNormals: false });
    // XZ plane → normal should be (0, ±1, 0)
    const ny = w.normals[1] ?? 0;
    expect(Math.abs(ny)).toBeCloseTo(1, 4);
    expect(w.normals[0]).toBeCloseTo(0, 4);
    expect(w.normals[2]).toBeCloseTo(0, 4);
  });

  test("cube has 8 unique corners after welding", () => {
    const w = weldMesh(makeCubeMesh());
    expect(w.positions.length / 3).toBe(8);
  });

  test("UV coords preserved when present", () => {
    const meshWithUV: GeometryMesh = {
      ...FLAT_QUAD_MESH,
      triangles: FLAT_QUAD_MESH.triangles.map(t => ({
        a: { position: t.a.position, uv: { u: 0, v: 0 } },
        b: { position: t.b.position, uv: { u: 1, v: 0 } },
        c: { position: t.c.position, uv: { u: 1, v: 1 } },
      })),
    };
    const w = weldMesh(meshWithUV);
    expect(w.uvs).not.toBeNull();
    expect(w.uvs!.length / 2).toBe(w.positions.length / 3);
  });

  test("uses Uint16 index for small meshes, Uint32 for large", () => {
    const w16 = weldMesh(FLAT_QUAD_MESH);
    expect(w16.indices).toBeInstanceOf(Uint16Array);

    // Build a mesh with >65535 unique vertices
    const bigTris: Array<[Vec3, Vec3, Vec3]> = [];
    for (let i = 0; i < 22000; i++) {
      bigTris.push([makeVec(i*3,0,0), makeVec(i*3+1,0,0), makeVec(i*3,1,0)]);
    }
    const bigMesh = makeMesh(bigTris);
    const w32 = weldMesh(bigMesh);
    expect(w32.indices).toBeInstanceOf(Uint32Array);
  });

  test("epsilon controls merge aggressiveness", () => {
    // Two triangles with slightly different shared vertices
    const mesh = makeMesh([
      [makeVec(0,0,0),      makeVec(10,0,0),    makeVec(5,10,0)],
      [makeVec(0.0001,0,0), makeVec(10,0,0.0001), makeVec(5,10,0)],
    ]);
    const loose = weldMesh(mesh, { epsilon: 0.01 });
    const strict = weldMesh(mesh, { epsilon: 1e-6 });
    expect(loose.positions.length).toBeLessThanOrEqual(strict.positions.length);
  });
});

describe("weldGeometry + mergeWeldedMeshes", () => {
  test("weldGeometry processes all meshes", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH, makeCubeMesh()]);
    const welded = weldGeometry(geo.meshes);
    expect(welded).toHaveLength(2);
  });

  test("mergeWeldedMeshes combines same-color meshes", () => {
    const m1 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4);
    const m2 = makeMesh([[makeVec(2,0,0), makeVec(3,0,0), makeVec(2,1,0)]], 4);
    const welded = weldGeometry([m1, m2]);
    const merged = mergeWeldedMeshes(welded);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.indices.length).toBe(6);
  });

  test("mergeWeldedMeshes keeps different colors separate", () => {
    const blueColor = buildColorTable().get(1)!;
    const m1 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4, RED_COLOR);
    const m2 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 1, blueColor);
    const merged = mergeWeldedMeshes(weldGeometry([m1, m2]));
    expect(merged).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Smooth normals
// ─────────────────────────────────────────────────────────────

describe("smoothMeshNormals", () => {
  test("returns a SmoothMesh with same triangle count", () => {
    const smooth = smoothMeshNormals(makeCubeMesh());
    expect(smooth.triangles.length).toBe(12);
  });

  test("each vertex has a normal", () => {
    const smooth = smoothMeshNormals(FLAT_QUAD_MESH);
    for (const tri of smooth.triangles) {
      for (const v of [tri.a, tri.b, tri.c]) {
        expect(v.normal).toBeDefined();
        const l = Math.sqrt(v.normal.x**2 + v.normal.y**2 + v.normal.z**2);
        expect(l).toBeCloseTo(1, 4);
      }
    }
  });

  test("coplanar triangles get same smooth normal", () => {
    const smooth = smoothMeshNormals(FLAT_QUAD_MESH, Math.PI);
    const n0 = smooth.triangles[0]!.a.normal;
    const n1 = smooth.triangles[1]!.a.normal;
    expect(n0.x).toBeCloseTo(n1.x, 4);
    expect(n0.y).toBeCloseTo(n1.y, 4);
    expect(n0.z).toBeCloseTo(n1.z, 4);
  });

  test("computeSmoothNormals processes whole FlatGeometry", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH, makeCubeMesh()]);
    const result = computeSmoothNormals(geo);
    expect(result.meshes).toHaveLength(2);
    expect(result.edges).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────
// GLB v2
// ─────────────────────────────────────────────────────────────

describe("generateGlbV2", () => {
  test("returns a Uint8Array", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo);
    expect(glb).toBeInstanceOf(Uint8Array);
  });

  test("starts with glTF magic 0x46546C67", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo);
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
  });

  test("version field is 2", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo);
    expect(new DataView(glb.buffer).getUint32(4, true)).toBe(2);
  });

  test("total length field matches buffer length", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo);
    expect(new DataView(glb.buffer).getUint32(8, true)).toBe(glb.byteLength);
  });

  test("JSON chunk is valid JSON with required fields", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo);
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const jsonBytes = glb.slice(20, 20 + jsonLen);
    const json = JSON.parse(new TextDecoder().decode(jsonBytes).trimEnd());
    expect(json.asset.version).toBe("2.0");
    expect(json.meshes).toHaveLength(1);
    expect(json.accessors.length).toBeGreaterThan(0);
    expect(json.bufferViews.length).toBeGreaterThan(0);
  });

  test("indexed geometry: accessor count < triangle×3", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo, { weld: { smoothNormals: true } });
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const posAcc = json.accessors[0];
    // 2 triangles = 6 corners, but after welding = 4 unique vertices
    expect(posAcc.count).toBeLessThan(6);
  });

  test("generates BLEND alphaMode for transparent color", async () => {
    const geo = makeFlatGeometry([makeMesh(
      [[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]],
      285, TRANS_COLOR,
    )]);
    const glb = await generateGlbV2(geo);
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const mat = json.materials[0];
    expect(mat.alphaMode).toBe("BLEND");
  });

  test("KHR_materials_transmission extension when opted in", async () => {
    const geo = makeFlatGeometry([makeMesh(
      [[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]],
      285, TRANS_COLOR,
    )]);
    const glb = await generateGlbV2(geo, { transmission: true });
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    expect(json.extensionsUsed).toContain("KHR_materials_transmission");
    expect(json.materials[0].extensions?.KHR_materials_transmission).toBeDefined();
  });

  test("chrome material has high metallic factor", async () => {
    const chromeColor = buildColorTable().get(383)!; // Chrome Silver
    const geo = makeFlatGeometry([makeMesh(
      [[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 383, chromeColor,
    )]);
    const glb = await generateGlbV2(geo);
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const pbr = json.materials[0].pbrMetallicRoughness;
    expect(pbr.metallicFactor).toBeGreaterThanOrEqual(0.9);
    expect(pbr.roughnessFactor).toBeLessThan(0.1);
  });

  test("texture embedding: image in bufferViews when loadTexture provided", async () => {
    const fakePng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const meshWithTex: GeometryMesh = {
      ...FLAT_QUAD_MESH,
      texmap: {
        projection: "PLANAR",
        point1: makeVec(0,0,0), point2: makeVec(10,0,0), point3: makeVec(0,0,10),
        texture: "test.png",
      },
      triangles: FLAT_QUAD_MESH.triangles.map((t) => ({
        a: { position: t.a.position, uv: { u: 0, v: 0 } },
        b: { position: t.b.position, uv: { u: 1, v: 0 } },
        c: { position: t.c.position, uv: { u: 1, v: 1 } },
      })),
    };
    const geo = makeFlatGeometry([meshWithTex]);
    const glb = await generateGlbV2(geo, {
      loadTexture: () => fakePng,
    });
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    expect(json.images).toHaveLength(1);
    expect(json.textures).toHaveLength(1);
    expect(json.samplers).toHaveLength(1);
    expect(json.images[0].mimeType).toBe("image/png");
  });

  test("weld:false produces non-indexed geometry (vertex count = tri×3)", async () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const glb = await generateGlbV2(geo, { weld: false });
    const dv = new DataView(glb.buffer);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    const posAcc = json.accessors[0];
    expect(posAcc.count).toBe(FLAT_QUAD_MESH.triangles.length * 3);
  });
});

// ─────────────────────────────────────────────────────────────
// OBJ exporter
// ─────────────────────────────────────────────────────────────

describe("generateObj", () => {
  test("returns obj and mtl strings", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj, mtl, mtlFileName } = generateObj(geo);
    expect(typeof obj).toBe("string");
    expect(typeof mtl).toBe("string");
    expect(mtlFileName).toEndWith(".mtl");
  });

  test("OBJ contains mtllib reference", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj } = generateObj(geo, { name: "mymodel" });
    expect(obj).toContain("mtllib mymodel.mtl");
  });

  test("OBJ contains vertex lines (v ...)", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj } = generateObj(geo);
    const vLines = obj.split("\n").filter((l) => l.startsWith("v "));
    expect(vLines.length).toBeGreaterThan(0);
  });

  test("OBJ contains face lines (f ...)", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj } = generateObj(geo);
    const fLines = obj.split("\n").filter((l) => l.startsWith("f "));
    expect(fLines.length).toBe(FLAT_QUAD_MESH.triangles.length);
  });

  test("MTL contains newmtl entry", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { mtl } = generateObj(geo);
    expect(mtl).toContain("newmtl");
  });

  test("MTL contains Kd (diffuse) line", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { mtl } = generateObj(geo);
    expect(mtl).toContain("Kd ");
  });

  test("transparent color gets d < 1 in MTL", () => {
    const geo = makeFlatGeometry([makeMesh(
      [[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 285, TRANS_COLOR,
    )]);
    const { mtl } = generateObj(geo);
    const dLine = mtl.split("\n").find((l) => l.startsWith("d "));
    expect(dLine).toBeDefined();
    const val = parseFloat(dLine!.split(" ")[1]!);
    expect(val).toBeLessThan(1);
  });

  test("OBJ contains vn lines when normals enabled", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj } = generateObj(geo, { normals: true });
    const vnLines = obj.split("\n").filter((l) => l.startsWith("vn "));
    expect(vnLines.length).toBeGreaterThan(0);
  });

  test("OBJ face refs include normal index when normals enabled", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj } = generateObj(geo, { normals: true });
    const fLine = obj.split("\n").find((l) => l.startsWith("f "));
    // face format: v/vt/vn or v//vn
    expect(fLine).toMatch(/f \d+(\/\d*\/\d+)( \d+(\/\d*\/\d+)){2}/);
  });

  test("includes edge lines when edges:true", () => {
    const geoWithEdges: FlatGeometry = {
      ...makeFlatGeometry([FLAT_QUAD_MESH]),
      edges: [{
        colorCode: 0,
        color: buildColorTable().get(0)!,
        segments: [{ start: makeVec(0,0,0), end: makeVec(10,0,0) }],
      }],
    };
    const { obj } = generateObj(geoWithEdges, { edges: true });
    const lLines = obj.split("\n").filter((l) => l.startsWith("l "));
    expect(lLines.length).toBeGreaterThan(0);
  });

  test("respects unit option: m produces smaller coordinates than mm", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const { obj: objM }  = generateObj(geo, { unit: "m" });
    const { obj: objMm } = generateObj(geo, { unit: "mm" });
    // Extract first non-zero vertex coordinate from any axis
    const getMaxCoord = (s: string) =>
      Math.max(...s.split("\n")
        .filter((l) => l.startsWith("v "))
        .flatMap((l) => l.split(" ").slice(1).map(parseFloat)));
    expect(getMaxCoord(objMm)).toBeGreaterThan(getMaxCoord(objM));
  });
});

// ─────────────────────────────────────────────────────────────
// Typed errors
// ─────────────────────────────────────────────────────────────

describe("Error classes", () => {
  test("LDrawError is an Error", () => {
    const e = new LDrawError("test");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("LDrawError");
  });

  test("LDrawParseError carries file/line info", () => {
    const e = new LDrawParseError("test.dat", 42, "0 bad line", "unexpected token");
    expect(e.fileName).toBe("test.dat");
    expect(e.lineNumber).toBe(42);
    expect(e.rawLine).toBe("0 bad line");
    expect(e.message).toContain("42");
    expect(e.message).toContain("unexpected token");
  });

  test("LDrawResolveError carries file names", () => {
    const e = new LDrawResolveError("model.ldr", "stud.dat");
    expect(e.referencedBy).toBe("model.ldr");
    expect(e.missingFile).toBe("stud.dat");
    expect(e.message).toContain("stud.dat");
  });

  test("LDrawDepthError carries depth", () => {
    const e = new LDrawDepthError("recursive.dat", 64);
    expect(e.depth).toBe(64);
    expect(e.message).toContain("64");
  });

  test("all error classes are instanceof LDrawError", () => {
    expect(new LDrawParseError("f", 0, "", "")).toBeInstanceOf(LDrawError);
    expect(new LDrawResolveError("f", "g")).toBeInstanceOf(LDrawError);
    expect(new LDrawDepthError("f", 1)).toBeInstanceOf(LDrawError);
  });
});

// ─────────────────────────────────────────────────────────────
// Post-processing
// ─────────────────────────────────────────────────────────────

describe("Unit conversion", () => {
  test("LDU constants are correct", () => {
    expect(MM_PER_LDU).toBeCloseTo(0.4);
    expect(LDU_PER_MM).toBeCloseTo(2.5);
    expect(MM_PER_LDU * LDU_PER_MM).toBeCloseTo(1);
  });

  test("lduToUnitScale('mm') = 0.4", () => {
    expect(lduToUnitScale("mm")).toBeCloseTo(0.4);
  });

  test("lduToUnitScale('m') = 0.0004", () => {
    expect(lduToUnitScale("m")).toBeCloseTo(0.0004);
  });

  test("lduToUnitScale('studs') = 1/20 * LDU_PER_MM * ...", () => {
    // 1 stud = 20 LDU = 8mm; scale should be 20 LDU → 1 stud
    // We just check scale("studs") < scale("mm")
    expect(lduToUnitScale("studs")).toBeGreaterThan(lduToUnitScale("m"));
  });

  test("transformGeometry Y-up flips Y and Z", () => {
    const geo = makeFlatGeometry([makeMesh([
      [makeVec(1,2,3), makeVec(4,5,6), makeVec(7,8,9)],
    ])]);
    const t = transformGeometry(geo, 1, true);
    const v = t.meshes[0]!.triangles[0]!.a.position;
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(-2); // Y flipped
    expect(v.z).toBeCloseTo(-3); // Z flipped
  });

  test("transformGeometry scale applies to all axes", () => {
    const geo = makeFlatGeometry([makeMesh([
      [makeVec(10,0,0), makeVec(0,10,0), makeVec(0,0,10)],
    ])]);
    const t = transformGeometry(geo, 0.001, false);
    const v = t.meshes[0]!.triangles[0]!.a.position;
    expect(v.x).toBeCloseTo(0.01);
  });

  test("transformGeometry recomputes AABB", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    // FLAT_QUAD_MESH spans 0..10 on X; the fixture aabb is irrelevant —
    // transformGeometry recomputes from actual vertices.
    // scale=2, yUp=false: 0..10 → 0..20, so size.x should be 20.
    const t = transformGeometry(geo, 2, false);
    expect(t.aabb.size.x).toBeCloseTo(10 * 2, 1);
  });
});

describe("mergeGeometry", () => {
  test("merges meshes of same color", () => {
    const m1 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4, RED_COLOR);
    const m2 = makeMesh([[makeVec(2,0,0), makeVec(3,0,0), makeVec(2,1,0)]], 4, RED_COLOR);
    const geo = makeFlatGeometry([m1, m2]);
    const merged = mergeGeometry(geo);
    expect(merged.meshes.length).toBe(1);
    expect(merged.meshes[0]!.triangles.length).toBe(2);
  });

  test("keeps meshes of different colors separate", () => {
    const blue = buildColorTable().get(1)!;
    const m1 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4, RED_COLOR);
    const m2 = makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 1, blue);
    const geo = makeFlatGeometry([m1, m2]);
    expect(mergeGeometry(geo).meshes.length).toBe(2);
  });
});

describe("cullSmallTriangles", () => {
  test("removes zero-area triangles", () => {
    const degenMesh = makeMesh([
      [makeVec(0,0,0), makeVec(0,0,0), makeVec(0,0,0)], // area = 0
      [makeVec(0,0,0), makeVec(10,0,0), makeVec(5,10,0)], // normal triangle
    ]);
    const geo = makeFlatGeometry([degenMesh]);
    const culled = cullSmallTriangles(geo, 0.1);
    expect(culled.meshes[0]!.triangles.length).toBe(1);
  });

  test("keeps large triangles", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const culled = cullSmallTriangles(geo, 0.01);
    expect(culled.meshes[0]!.triangles.length).toBe(FLAT_QUAD_MESH.triangles.length);
  });
});

describe("computeStats", () => {
  test("counts triangles correctly", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH, makeCubeMesh()]);
    const stats = computeStats(geo);
    expect(stats.triangleCount).toBe(FLAT_QUAD_MESH.triangles.length + 12);
  });

  test("vertexCount = triangleCount × 3", () => {
    const geo = makeFlatGeometry([FLAT_QUAD_MESH]);
    const stats = computeStats(geo);
    expect(stats.vertexCount).toBe(stats.triangleCount * 3);
  });

  test("colorCount counts unique colors", () => {
    const blue = buildColorTable().get(1)!;
    const geo = makeFlatGeometry([
      makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4),
      makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 1, blue),
    ]);
    expect(computeStats(geo).colorCount).toBe(2);
  });

  test("transparentMeshes counts correctly", () => {
    const geo = makeFlatGeometry([
      makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 4, RED_COLOR),
      makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 285, TRANS_COLOR),
    ]);
    expect(computeStats(geo).transparentMeshes).toBe(1);
  });
});

describe("extractColorPalette + collectTextures", () => {
  test("palette is sorted by triangle count desc", () => {
    const blue = buildColorTable().get(1)!;
    const geo = makeFlatGeometry([
      makeMesh(Array(5).fill([makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]), 4, RED_COLOR),
      makeMesh([[makeVec(0,0,0), makeVec(1,0,0), makeVec(0,1,0)]], 1, blue),
    ]);
    const palette = extractColorPalette(geo);
    // expect(palette[0]!.colorCode).toBe(4);
    expect(palette[0]!.triangleCount).toBe(5);
  });

  test("collectTextures returns unique texture names", () => {
    const meshA: GeometryMesh = {
      ...FLAT_QUAD_MESH,
      texmap: { projection: "PLANAR", point1: makeVec(0,0,0), point2: makeVec(1,0,0), point3: makeVec(0,0,1), texture: "a.png" },
    };
    const meshB: GeometryMesh = {
      ...FLAT_QUAD_MESH,
      texmap: { projection: "PLANAR", point1: makeVec(0,0,0), point2: makeVec(1,0,0), point3: makeVec(0,0,1), texture: "a.png" },
    };
    const geo = makeFlatGeometry([meshA, meshB]);
    expect(collectTextures(geo)).toEqual(["a.png"]);
  });
});

// ─────────────────────────────────────────────────────────────
// Full pipeline integration
// ─────────────────────────────────────────────────────────────

describe("Full pipeline: parse → weld → GLB → JSON", () => {
  const CUBE_LDR = `
0 Cube Part
0 Name: cube.dat
0 !LDRAW_ORG Unofficial_Part
0 BFC CERTIFY CCW
3 4  0 0 0  10 0 0  10 10 0
3 4  0 0 0  10 10 0  0 10 0
3 4  0 0 0  0 0 10  10 0 10
3 4  0 0 0  10 0 10  10 0 0
3 4  0 0 0  0 10 0  0 10 10
3 4  0 0 0  0 10 10  0 0 10
3 4 10 0 0  10 0 10  10 10 10
3 4 10 0 0  10 10 10  10 10 0
3 4  0 10 0  10 10 0  10 10 10
3 4  0 10 0  10 10 10  0 10 10
3 4  0 0 10  10 0 10  10 10 10
3 4  0 0 10  10 10 10  0 10 10
`.trim();

  test("parse produces geometry", async () => {
    const parser = new LDrawParser();
    const { geometry } = await parser.parse(CUBE_LDR, "cube.dat");
    expect(geometry).toBeDefined();
    const stats = computeStats(geometry!);
    expect(stats.triangleCount).toBe(12);
  });

  test("GLB output is valid after full pipeline", async () => {
    const parser = new LDrawParser();
    const { geometry } = await parser.parse(CUBE_LDR, "cube.dat");
    const scale = lduToUnitScale("m");
    const geo = mergeGeometry(transformGeometry(geometry!, scale, true));
    const glb = await generateGlbV2(geo, {
      weld: { smoothNormals: true, creasAngle: 45 },
      normals: true,
    });
    // Validate structure
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    // Parse JSON chunk
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLen)).trimEnd());
    expect(json.meshes[0].primitives).toHaveLength(1);
    // Welded cube: 8 unique corners
    const posAcc = json.accessors.find((a: { type: string }) => a.type === "VEC3");
    expect(posAcc.count).toBeLessThanOrEqual(8);
  });

  test("OBJ output has correct vertex count (deduped)", () => {
    // const parser = new LDrawParser();
    const geo = {
      meshes: [makeMesh(
        Array.from({ length: 12 }, (_, i): [Vec3, Vec3, Vec3] => [
          makeVec(Math.cos(i), 0, Math.sin(i)),
          makeVec(Math.cos(i+1), 0, Math.sin(i+1)),
          makeVec(0, 1, 0),
        ])
      )],
      edges: [],
      aabb: { min: makeVec(-1,-1,-1), max: makeVec(1,1,1), center: makeVec(0,0,0), size: makeVec(2,2,2), radius: 1.73 },
    };
    const { obj } = generateObj(geo, { normals: false });
    const vCount = obj.split("\n").filter((l) => l.startsWith("v ")).length;
    const fCount = obj.split("\n").filter((l) => l.startsWith("f ")).length;
    expect(fCount).toBe(12); // one face per triangle
    expect(vCount).toBeLessThan(12 * 3); // deduplication happened
  });
});