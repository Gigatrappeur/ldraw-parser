// ============================================================
// LDraw Parser – SVG thumbnail generator  (v2.2)
// ============================================================
//
// v2:   back-face culling, degenerate skip, Lambert shading
// v2.1: Y-flip via SVG transform
// v2.2: centroid depth sort + normal-bias tie-breaker
//       → fixes coplanar triangle ordering (3003 stud artifacts)
// ============================================================

import type { FlatGeometry, Vec3 } from "./types";
import { vec3Normalize, vec3Sub, vec3Cross, vec3Dot } from "./utils";

// ── Options ───────────────────────────────────────────────────

export interface SvgCameraOptions {
  /** Horizontal rotation around Y axis in degrees (default 45) */
  azimuth?: number;
  /** Vertical tilt in degrees (default 30) */
  elevation?: number;
  /** Output width in pixels (default 512) */
  width?: number;
  /** Output height in pixels (default 512) */
  height?: number;
  /** Margin as a fraction of the smaller viewport dimension (default 0.05) */
  margin?: number;
  /** Draw edge lines (default true) */
  showEdges?: boolean;
  /** Background fill color (default "transparent") */
  background?: string;
  /** Edge stroke width in viewport pixels (default 0.5) */
  edgeWidth?: number;
  /**
   * Render back-faces (faces pointing away from the viewer).
   * True = two-sided (useful for uncertified parts, default true).
   * False = cull back-faces (faster, cleaner for BFC-certified models).
   */
  twoSided?: boolean;
}

// ── Internal types ────────────────────────────────────────────

interface Camera {
  /** 3×3 view rotation matrix, row-major, applied with Y-flip: y_view = -y_world */
  m: number[];
  scale: number;
  tx: number;
  ty: number;
}

interface Face {
  d:       string;   // SVG path data
  fill:    string;   // rgb(…)
  opacity: number;   // 0–1
  depth:   number;   // sort key, larger = further away
}

// ── Math helpers ──────────────────────────────────────────────

function degToRad(d: number): number { return (d * Math.PI) / 180; }

function project(v: Vec3, cam: Camera): [number, number] {
  const m = cam.m;
  const sx = ((m[0]??0)*v.x + (m[1]??0)*(-v.y) + (m[2]??0)*v.z) * cam.scale + cam.tx;
  const sy = ((m[3]??0)*v.x + (m[4]??0)*(-v.y) + (m[5]??0)*v.z) * cam.scale + cam.ty;
  return [sx, sy];
}

function viewZ(v: Vec3, cam: Camera): number {
  return (cam.m[6]??0)*v.x + (cam.m[7]??0)*(-v.y) + (cam.m[8]??0)*v.z;
}

function signedArea2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
}

// ── Camera builder ────────────────────────────────────────────

function buildCamera(geo: FlatGeometry, opts: Required<SvgCameraOptions>): Camera {
  const az = degToRad(opts.azimuth);
  const el = degToRad(opts.elevation);
  const cosAz = Math.cos(az), sinAz = Math.sin(az);
  const cosEl = Math.cos(el), sinEl = Math.sin(el);

  const m: number[] = [
    cosAz,          0,     -sinAz,
    sinAz * sinEl,  cosEl,  cosAz * sinEl,
    sinAz * cosEl, -sinEl,  cosAz * cosEl,
  ];

  const { aabb } = geo;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const dx of [aabb.min.x, aabb.max.x])
  for (const dy of [aabb.min.y, aabb.max.y])
  for (const dz of [aabb.min.z, aabb.max.z]) {
    const wx = (m[0]??0)*dx + (m[1]??0)*(-dy) + (m[2]??0)*dz;
    const wy = (m[3]??0)*dx + (m[4]??0)*(-dy) + (m[5]??0)*dz;
    if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
  }

  const pad   = Math.min(opts.width, opts.height) * opts.margin;
  const scale = Math.min(
    (opts.width  - 2 * pad) / (maxX - minX || 1),
    (opts.height - 2 * pad) / (maxY - minY || 1),
  );
  const tx = opts.width  / 2 - ((minX + maxX) / 2) * scale;
  const ty = opts.height / 2 - ((minY + maxY) / 2) * scale;

  return { m, scale, tx, ty };
}

// ── Shading ───────────────────────────────────────────────────

function shadeFactor(a: Vec3, b: Vec3, c: Vec3, cam: Camera): number {
  const ab = vec3Sub(b, a);
  const ac = vec3Sub(c, a);
  const n  = vec3Normalize(vec3Cross(ab, ac));

  const m = cam.m;
  const nv = vec3Normalize({
    x: (m[0]??0)*n.x + (m[1]??0)*(-n.y) + (m[2]??0)*n.z,
    y: (m[3]??0)*n.x + (m[4]??0)*(-n.y) + (m[5]??0)*n.z,
    z: (m[6]??0)*n.x + (m[7]??0)*(-n.y) + (m[8]??0)*n.z,
  });

  const key  = vec3Normalize({ x:  0.6, y:  0.8, z: -0.5 });
  const fill = vec3Normalize({ x: -0.4, y: -0.5, z:  0.3 });

  const dKey  = Math.max(0, vec3Dot(nv, key));
  const dFill = Math.max(0, vec3Dot(nv, fill));

  return 0.68 + 0.52 * dKey + 0.18 * dFill;
}

// ── SVG color helpers ─────────────────────────────────────────

function clamp255(x: number): number { return Math.max(0, Math.min(255, Math.round(x))); }

function rgbStr(r: number, g: number, b: number): string {
  return `rgb(${clamp255(r)},${clamp255(g)},${clamp255(b)})`;
}

// ── Main export ───────────────────────────────────────────────

export function generateSvgThumbnail(
  geometry: FlatGeometry,
  options: SvgCameraOptions = {},
): string {
  const opts: Required<SvgCameraOptions> = {
    azimuth:    options.azimuth    ?? 45,
    elevation:  options.elevation  ?? 30,
    width:      options.width      ?? 512,
    height:     options.height     ?? 512,
    margin:     options.margin     ?? 0.05,
    showEdges:  options.showEdges  ?? true,
    background: options.background ?? "transparent",
    edgeWidth:  options.edgeWidth  ?? 0.5,
    twoSided:   options.twoSided   ?? true,
  };

  if (geometry.meshes.length === 0 && geometry.edges.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
  }

  const cam = buildCamera(geometry, opts);

  // ── Collect & cull faces ──────────────────────────────────
  const faces: Face[] = [];

  for (const mesh of geometry.meshes) {
    const color = geometry.colorTable?.get(mesh.colorCode);
    const [cr, cg, cb, ca] = color?.rgba ?? [0, 0, 0, 1];
    const r0 = (cr ?? 0) * 255;
    const g0 = (cg ?? 0) * 255;
    const b0 = (cb ?? 0) * 255;
    const opacity = ca ?? 1;

    for (const tri of mesh.triangles) {
      const { a, b, c } = tri;

      const [ax, ay] = project(a.position, cam);
      const [bx, by] = project(b.position, cam);
      const [cx, cy] = project(c.position, cam);

      const sa2 = signedArea2(ax, ay, bx, by, cx, cy);
      if (Math.abs(sa2) < 0.01) continue;

      const isFrontFace = sa2 < 0;
      if (!isFrontFace && !opts.twoSided) continue;

      let lf = shadeFactor(a.position, b.position, c.position, cam);
      if (!isFrontFace) lf = shadeFactor(c.position, b.position, a.position, cam);

      const za = viewZ(a.position, cam);
      const zb = viewZ(b.position, cam);
      const zc = viewZ(c.position, cam);

      // Centroid depth — more stable than min for curved/stud geometry
      const centroid = (za + zb + zc) / 3;

      // Normal-bias tie-breaker for coplanar triangles:
      // compute view-space Z component of face normal (with Y-flip)
      const abx = b.position.x - a.position.x, aby = b.position.y - a.position.y, abz = b.position.z - a.position.z;
      const acx = c.position.x - a.position.x, acy = c.position.y - a.position.y, acz = c.position.z - a.position.z;
      const wnx = aby * acz - abz * acy;
      const wny = abz * acx - abx * acz;
      const wnz = abx * acy - aby * acx;
      // Project normal onto view Z (with Y-flip matching project())
      const nvz = (cam.m[6]??0)*wnx + (cam.m[7]??0)*(-wny) + (cam.m[8]??0)*wnz;
      // nvz < 0 → normal toward camera → face is "on top" → draw last → smaller depth key
      const normalBias = nvz < 0 ? -0.01 : 0.01;

      const depth = centroid + normalBias;

      faces.push({
        d: `M${ax.toFixed(1)},${ay.toFixed(1)} L${bx.toFixed(1)},${by.toFixed(1)} L${cx.toFixed(1)},${cy.toFixed(1)} Z`,
        fill:    rgbStr(r0 * lf, g0 * lf, b0 * lf),
        opacity,
        depth,
      });
    }
  }

  // Sort back-to-front: larger depth (further away) first
  faces.sort((a, b) => b.depth - a.depth);

  // ── Edges ─────────────────────────────────────────────────
  const edgeLines: string[] = [];
  if (opts.showEdges) {
    for (const eg of geometry.edges) {
      const color = geometry.colorTable?.get(eg.colorCode);
      const [er, eg2, eb] = color?.rgba ?? [0, 0, 0];
      const stroke = rgbStr((er??0)*255, (eg2??0)*255, (eb??0)*255);
      for (const seg of eg.segments) {
        const [x1, y1] = project(seg.start, cam);
        const [x2, y2] = project(seg.end,   cam);
        edgeLines.push(
          `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}"` +
          ` x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"` +
          ` stroke="${stroke}" stroke-width="${opts.edgeWidth}" stroke-linecap="round"/>`,
        );
      }
    }
  }

  // ── Assemble SVG ──────────────────────────────────────────
  const bg = opts.background !== "transparent"
    ? `<rect width="${opts.width}" height="${opts.height}" fill="${opts.background}"/>`
    : "";

  const pathParts = faces.map(
    (f) => `<path d="${f.d}" fill="${f.fill}" opacity="${f.opacity.toFixed(3)}"` +
            ` stroke="${f.fill}" stroke-width="0.5"/>`,
  );

  // Y-flip via SVG transform: LDraw Y-down → affichage Y-up
  const flipTransform = `translate(0,${opts.height}) scale(1,-1)`;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${opts.width}" height="${opts.height}"`,
    ` viewBox="0 0 ${opts.width} ${opts.height}">`,
    bg,
    `<g transform="${flipTransform}">`,
    `<g id="faces" shape-rendering="crispEdges">${pathParts.join("")}</g>`,
    opts.showEdges && edgeLines.length > 0
      ? `<g id="edges">${edgeLines.join("")}</g>`
      : "",
    `</g>`,
    `</svg>`,
  ];

  return parts.join("\n");
}