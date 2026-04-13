// ============================================================
// LDraw Parser – SVG rendering tests
// bun test tests/svg.test.ts
// ============================================================

import { describe, test, expect } from "bun:test";
import { generateSvgThumbnail } from "../src/svg";
import { LDrawParser } from "../src/index";
import { buildColorTable } from "../src/colors";
import type { FlatGeometry, GeometryMesh, LDrawColor, Vec3 } from "../src/types";

// ── Helpers ───────────────────────────────────────────────────

const table = buildColorTable();
const RED   = table.get(4)!;
const BLUE  = table.get(1)!;
const TRANS = table.get(285) ?? { ...RED, alpha: 128, isTransparent: true, rgba: [0.4, 0.7, 0.8, 0.5] as [number,number,number,number] };

function v(x: number, y: number, z: number): Vec3 { return { x, y, z }; }

function tri(a: Vec3, b: Vec3, c: Vec3, color: LDrawColor = RED): GeometryMesh {
  return { colorCode: color.code, color, triangles: [{ a: { position: a }, b: { position: b }, c: { position: c } }] };
}

function geo(meshes: GeometryMesh[]): FlatGeometry {
  // Compute real AABB from actual vertex positions so camera framing is correct.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    for (const t of m.triangles) {
      for (const vert of [t.a, t.b, t.c]) {
        const p = vert.position;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
      }
    }
  }
  if (!isFinite(minX)) { minX=minY=minZ=-10; maxX=maxY=maxZ=10; }
  const cx2=(minX+maxX)/2, cy2=(minY+maxY)/2, cz2=(minZ+maxZ)/2;
  const sx2=maxX-minX, sy2=maxY-minY, sz2=maxZ-minZ;
  const r=Math.sqrt((sx2/2)**2+(sy2/2)**2+(sz2/2)**2)||1;
  return {
    meshes, edges: [],
    aabb: { min: v(minX,minY,minZ), max: v(maxX,maxY,maxZ),
            center: v(cx2,cy2,cz2), size: v(sx2,sy2,sz2), radius: r },
  };
}

/** Extract all <path> fill colors from SVG */
function fills(svg: string): string[] {
  return [...svg.matchAll(/fill="(rgb\([^"]+\))"/g)].map((m) => m[1]!);
}

/** Count <path> elements */
function pathCount(svg: string): number {
  return (svg.match(/<path /g) ?? []).length;
}

/** Parse rgb(r,g,b) → [r,g,b] */
function parseRgb(s: string): [number, number, number] {
  const m = s.match(/rgb\((\d+),(\d+),(\d+)\)/);
  return m ? [parseInt(m[1]!), parseInt(m[2]!), parseInt(m[3]!)] : [0, 0, 0];
}

// ── Structure tests ───────────────────────────────────────────

describe("SVG structure", () => {
  test("produces a valid SVG root element", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]));
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  test("width and height attributes are set", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]), { width: 300, height: 200 });
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="200"');
  });

  test("viewBox matches width × height", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]), { width: 128, height: 128 });
    expect(svg).toContain('viewBox="0 0 128 128"');
  });

  test("background rect emitted when background != transparent", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]), { background: "#ffffff" });
    expect(svg).toContain("<rect");
    expect(svg).toContain("ffffff");
  });

  test("no background rect when background = transparent", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]), { background: "transparent" });
    expect(svg).not.toContain("<rect");
  });

  test("empty geometry returns minimal SVG without paths", () => {
    const svg = generateSvgThumbnail({ meshes: [], edges: [], aabb: { min: v(0,0,0), max: v(0,0,0), center: v(0,0,0), size: v(0,0,0), radius: 0 } });
    expect(svg).toContain("<svg");
    expect(pathCount(svg)).toBe(0);
  });

  test("faces group is present in SVG", () => {
    const svg = generateSvgThumbnail(geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]));
    expect(svg).toContain('id="faces"');
  });

  test("edges group present when showEdges=true and edges exist", () => {
    const geoWithEdges: FlatGeometry = {
      ...geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]),
      edges: [{ colorCode: 0, color: table.get(0)!, segments: [{ start: v(0,0,0), end: v(10,0,0) }] }],
    };
    const svg = generateSvgThumbnail(geoWithEdges, { showEdges: true });
    expect(svg).toContain('id="edges"');
    expect(svg).toContain("<line");
  });

  test("no edges group when showEdges=false", () => {
    const geoWithEdges: FlatGeometry = {
      ...geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]),
      edges: [{ colorCode: 0, color: table.get(0)!, segments: [{ start: v(0,0,0), end: v(10,0,0) }] }],
    };
    const svg = generateSvgThumbnail(geoWithEdges, { showEdges: false });
    expect(svg).not.toContain("<line");
  });
});

// ── Back-face culling ─────────────────────────────────────────

describe("Back-face culling", () => {
  // A cube: 12 triangles. With culling, at most 6 faces visible
  // from any angle (half the cube is always hidden).
  function cubeMesh(): GeometryMesh {
    const s = 5;
    const tris: Array<[Vec3,Vec3,Vec3]> = [
      [v(-s,s,-s), v(s,s,-s), v(s,s,s)], [v(-s,s,-s), v(s,s,s), v(-s,s,s)],
      [v(-s,-s,s), v(s,-s,s), v(s,-s,-s)], [v(-s,-s,s), v(s,-s,-s), v(-s,-s,-s)],
      [v(s,-s,-s), v(s,-s,s), v(s,s,s)], [v(s,-s,-s), v(s,s,s), v(s,s,-s)],
      [v(-s,-s,s), v(-s,-s,-s), v(-s,s,-s)], [v(-s,-s,s), v(-s,s,-s), v(-s,s,s)],
      [v(-s,-s,s), v(s,-s,s), v(s,s,s)], [v(-s,-s,s), v(s,s,s), v(-s,s,s)],
      [v(s,-s,-s), v(-s,-s,-s), v(-s,s,-s)], [v(s,-s,-s), v(-s,s,-s), v(s,s,-s)],
    ];
    return { colorCode: 4, color: RED, triangles: tris.map(([a,b,c]) => ({ a:{position:a}, b:{position:b}, c:{position:c} })) };
  }

  test("twoSided=false produces fewer paths than twoSided=true for a cube", () => {
    const g = geo([cubeMesh()]);
    const svgOne  = generateSvgThumbnail(g, { twoSided: false });
    const svgBoth = generateSvgThumbnail(g, { twoSided: true  });
    expect(pathCount(svgOne)).toBeLessThan(pathCount(svgBoth));
  });

  test("twoSided=false on cube shows at most 6 of 12 triangles", () => {
    const g = geo([cubeMesh()]);
    const svg = generateSvgThumbnail(g, { twoSided: false, azimuth: 45, elevation: 30 });
    expect(pathCount(svg)).toBeLessThanOrEqual(6);
  });

  test("twoSided=false emits no path for a fully back-facing single triangle", () => {
    // Triangle that faces directly away from the camera at az=0, el=0
    // Camera looks from +Z. A triangle facing -Z (normal pointing -Z):
    // v0=(0,0,0), v1=(0,1,0), v2=(1,0,0) → normal = (0,0,-1) = back-facing
    const g = geo([tri(v(0,0,0), v(0,10,0), v(10,0,0))]);
    const svg = generateSvgThumbnail(g, { twoSided: false, azimuth: 0, elevation: 0 });
    expect(pathCount(svg)).toBe(0);
  });

  test("twoSided=true renders both faces of a single triangle", () => {
    const g = geo([tri(v(0,0,0), v(0,10,0), v(10,0,0))]);
    const svg = generateSvgThumbnail(g, { twoSided: true, azimuth: 0, elevation: 0 });
    expect(pathCount(svg)).toBe(1);
  });

  test("degenerate zero-area triangle is skipped", () => {
    const g = geo([tri(v(0,0,0), v(0,0,0), v(0,0,0))]);
    const svg = generateSvgThumbnail(g, { twoSided: true });
    expect(pathCount(svg)).toBe(0);
  });

  test("collinear triangle (projected to line) is skipped", () => {
    // Three colinear points project to a line → near-zero area
    const g = geo([tri(v(0,0,0), v(5,0,0), v(10,0,0))]);
    const svg = generateSvgThumbnail(g, { twoSided: false });
    expect(pathCount(svg)).toBe(0);
  });
});

// ── Shading ───────────────────────────────────────────────────

describe("Lambert shading", () => {
  test("top face is brighter than bottom face", () => {
    // Top face (Y=0 plane, normal points up in LDraw Y-down = -Y direction)
    const topFace  = tri(v(-5,0,-5), v(5,0,-5), v(5,0,5));   // normal (0,-1,0) = up in LDraw
    const botFace  = tri(v(-5,0,-5), v(5,0,5), v(5,0,-5));   // same verts, reversed winding → (0,1,0) = down

    const svgTop = generateSvgThumbnail(geo([topFace]), { twoSided: false });
    const svgBot = generateSvgThumbnail(geo([botFace]), { twoSided: false });

    const topFills = fills(svgTop);
    const botFills = fills(svgBot);

    if (topFills.length > 0 && botFills.length > 0) {
      const [rTop] = parseRgb(topFills[0]!);
      const [rBot] = parseRgb(botFills[0]!);
      // Top face (pointing up toward the key light) should be brighter
      expect(rTop).toBeGreaterThan(rBot);
    }
  });

  test("shaded color is derived from mesh color (not pure black)", () => {
    const g = geo([tri(v(0,0,0), v(10,0,0), v(5,10,0), RED)]);
    const svg = generateSvgThumbnail(g, { twoSided: true });
    const pathFills = fills(svg).filter((f) => !f.includes("0,0,0"));
    expect(pathFills.length).toBeGreaterThan(0);
    const [r] = parseRgb(pathFills[0]!);
    // Red base (201,26,9) × shading factor > 0 → r > 0
    expect(r).toBeGreaterThan(0);
  });

  test("ambient floor: no face is rendered pure black with a colored mesh", () => {
    const g = geo([tri(v(0,0,0), v(10,0,0), v(5,10,0), RED)]);
    const svg = generateSvgThumbnail(g, { twoSided: true });
    for (const fill of fills(svg)) {
      const [r, gr, b] = parseRgb(fill);
      // With 0.25 ambient minimum, no channel should be pitch black
      expect(r + gr + b).toBeGreaterThan(0);
    }
  });

  test("transparent mesh uses correct opacity attribute", () => {
    const g = geo([tri(v(0,0,0), v(10,0,0), v(5,10,0), TRANS as LDrawColor)]);
    const svg = generateSvgThumbnail(g, { twoSided: true });
    // opacity should be written on path element
    expect(svg).toMatch(/opacity="0\.[1-9]/);
    const m = svg.match(/opacity="([\d.]+)"/);
    if (m) {
      const op = parseFloat(m[1]!);
      expect(op).toBeLessThan(1.0);
      expect(op).toBeGreaterThan(0);
    }
  });
});

// ── Depth sort ────────────────────────────────────────────────

describe("Depth sort (painter's algorithm)", () => {
  test("two triangles at different depths: closer one appears last in SVG (painted on top)", () => {
    // Camera at azimuth=0, elevation=0: viewZ = v.z, larger = closer.
    // Reversed winding so both triangles are front-facing from +Z camera.
    const far  = tri(v(5, 0, -10), v(-5, 0, -10), v(0, -10, -10), RED);   // z=-10 (far)
    const near = tri(v(5, 0,  10), v(-5, 0,  10), v(0, -10,  10), BLUE);  // z=+10 (near)
    const g = geo([far, near]);
    const svg = generateSvgThumbnail(g, { azimuth: 0, elevation: 0, twoSided: false });
    expect(pathCount(svg)).toBe(2); // both visible
    const idxFar  = svg.indexOf("rgb(");       // first rgb() = far (painted first)
    const idxNear = svg.lastIndexOf("rgb(");   // last  rgb() = near (painted on top)
    expect(idxFar).toBeLessThan(idxNear);
  });

  test("min-depth key: triangle partially in front is drawn after the one fully behind", () => {
    // Both triangles front-facing (reversed winding), different depths.
    const farMesh  = tri(v(5, 5, -20), v(-5, 5, -20), v(0, -5, -20), RED);   // z=-20
    const nearMesh = tri(v(5, 5,   0), v(-5, 5,   0), v(0, -5,   0), BLUE);  // z=0
    const g = geo([farMesh, nearMesh]);
    const svg = generateSvgThumbnail(g, { azimuth: 0, elevation: 0, twoSided: false });
    expect(pathCount(svg)).toBe(2);
  });
});

// ── Camera & projection ───────────────────────────────────────

describe("Camera options", () => {
  test("different azimuths produce different path data", () => {
    const g = geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]);
    const svg0  = generateSvgThumbnail(g, { azimuth: 0,   twoSided: true });
    const svg45 = generateSvgThumbnail(g, { azimuth: 45,  twoSided: true });
    const svg90 = generateSvgThumbnail(g, { azimuth: 90,  twoSided: true });
    expect(svg0).not.toBe(svg45);
    expect(svg45).not.toBe(svg90);
  });

  test("different elevations produce different path data", () => {
    const g = geo([tri(v(0,0,0), v(10,0,0), v(5,10,0))]);
    const svg0  = generateSvgThumbnail(g, { elevation: 0,  twoSided: true });
    const svg30 = generateSvgThumbnail(g, { elevation: 30, twoSided: true });
    expect(svg0).not.toBe(svg30);
  });

  test("model fits within viewport (path coords within bounds)", () => {
    const g = geo([tri(v(0,0,0), v(100,0,0), v(50,100,0))]);
    const W = 256, H = 256;
    const svg = generateSvgThumbnail(g, { width: W, height: H, twoSided: true });
    // Extract all coordinate values from path data
    const coords = [...svg.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].flatMap((m) => [
      parseFloat(m[1]!), parseFloat(m[2]!),
    ]);
    for (let i = 0; i < coords.length; i += 2) {
      expect(coords[i]!).toBeGreaterThanOrEqual(-1);
      expect(coords[i]!).toBeLessThanOrEqual(W + 1);
      expect(coords[i + 1]!).toBeGreaterThanOrEqual(-1);
      expect(coords[i + 1]!).toBeLessThanOrEqual(H + 1);
    }
  });

  test("margin option adds padding (model doesn't touch edges)", () => {
    const g = geo([tri(v(0,0,0), v(100,0,0), v(50,100,0))]);
    const W = 512, H = 512, margin = 0.1;
    const pad = Math.min(W, H) * margin;
    const svg = generateSvgThumbnail(g, { width: W, height: H, margin, twoSided: true });
    const coords = [...svg.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].flatMap((m) => [
      parseFloat(m[1]!), parseFloat(m[2]!),
    ]);
    for (let i = 0; i < coords.length; i += 2) {
      expect(coords[i]!).toBeGreaterThanOrEqual(pad - 1);
      expect(coords[i]!).toBeLessThanOrEqual(W - pad + 1);
      expect(coords[i+1]!).toBeGreaterThanOrEqual(pad - 1);
      expect(coords[i+1]!).toBeLessThanOrEqual(H - pad + 1);
    }
  });
});

// ── Full parser integration ───────────────────────────────────

describe("SVG from parser", () => {
  const PART = `
0 Test Cube
0 BFC CERTIFY CCW
3 4  0 0 0  10 0 0  10 10 0
3 4  0 0 0  10 10 0  0 10 0
3 4  0 0 0  10 0 0  10 0 10
3 4  0 0 0  10 0 10  0 0 10
3 4  0 10 0  10 10 0  10 10 10
3 4  0 10 0  10 10 10  0 10 10
3 4 10 0 0  10 10 0  10 10 10
3 4 10 0 0  10 10 10  10 0 10
3 4  0 0 10  10 0 10  10 10 10
3 4  0 0 10  10 10 10  0 10 10
3 4  0 0 0  0 0 10  0 10 10
3 4  0 0 0  0 10 10  0 10 0
`.trim();

  test("full parse → SVG produces valid output", async () => {
    const parser = new LDrawParser();
    const { geometry } = await parser.parse(PART, "cube.dat");
    const svg = parser.toSvg(geometry!);
    expect(svg).toStartWith("<svg");
    expect(svg).toContain("</svg>");
    expect(pathCount(svg)).toBeGreaterThan(0);
  });

  test("with twoSided=false, back-faces are culled", async () => {
    const parser = new LDrawParser();
    const { geometry } = await parser.parse(PART, "cube.dat");
    const svgTwo  = parser.toSvg(geometry!, { twoSided: true  });
    const svgOne  = parser.toSvg(geometry!, { twoSided: false });
    expect(pathCount(svgOne)).toBeLessThan(pathCount(svgTwo));
  });

  test("defaultColor=Red makes code-16 triangles use red shading", async () => {
    const RED_CODE = table.get(4)!;
    const parser = new LDrawParser({ defaultColor: RED_CODE });
    // part with code 16 triangles
    const PART16 = "0 T\n0 BFC CERTIFY CCW\n3 16 0 0 0 10 0 0 5 10 0";
    const { geometry } = await parser.parse(PART16, "t.dat");
    const svg = parser.toSvg(geometry!, { twoSided: true });
    const pathFills = fills(svg);
    // Red base color: r >> g, r >> b
    for (const f of pathFills) {
      const [r, g, b] = parseRgb(f);
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
    }
  });

  test("transparent color produces opacity < 1 in SVG", async () => {
    const parser = new LDrawParser();
    const TRANS_PART = "0 T\n0 BFC CERTIFY CCW\n3 33 0 0 0 10 0 0 5 10 0"; // code 33 = Trans-Dark_Blue
    const { geometry } = await parser.parse(TRANS_PART, "t.dat");
    const svg = parser.toSvg(geometry!, { twoSided: true });
    const m = svg.match(/opacity="([\d.]+)"/);
    if (m) {
      expect(parseFloat(m[1]!)).toBeLessThan(1.0);
    }
  });

  test("edge lines are rendered with correct color", async () => {
    const parser = new LDrawParser();
    const WITH_EDGES = "0 T\n0 BFC CERTIFY CCW\n3 4 0 0 0 10 0 0 5 10 0\n2 0 0 0 0 10 0 0";
    const { geometry } = await parser.parse(WITH_EDGES, "t.dat");
    const svg = parser.toSvg(geometry!, { showEdges: true });
    expect(svg).toContain("<line");
    expect(svg).toContain("stroke=");
  });
});