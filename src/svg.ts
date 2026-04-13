// ============================================================
// LDraw Parser – SVG thumbnail generator  (v2)
// ============================================================
//
// Improvements over v1:
//   • Back-face culling via screen-space signed-area test
//     → back-faces no longer bleed through the model
//   • Degenerate-triangle skip (zero area → no artifact)
//   • Min-depth sort key for each face (more stable than centroid)
//   • Two-source Lambert shading (key + fill lights)
//   • Thin inter-face stroke to hide painter-algo seams
//   • Back-face optional two-sided rendering for uncertified parts
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
  depth:   number;   // view-space Z, larger = further away
}

// ── Math helpers ──────────────────────────────────────────────

function degToRad(d: number): number { return (d * Math.PI) / 180; }

/**
 * Project a world-space Vec3 to [sx, sy] in screen space.
 * Y is negated so that LDraw Y-down maps to a Y-up view convention;
 * SVG then naturally places Y-up objects correctly.
 */
function project(v: Vec3, cam: Camera): [number, number] {
  const m = cam.m;
  const sx = ((m[0]??0)*v.x + (m[1]??0)*(-v.y) + (m[2]??0)*v.z) * cam.scale + cam.tx;
  const sy = ((m[3]??0)*v.x + (m[4]??0)*(-v.y) + (m[5]??0)*v.z) * cam.scale + cam.ty;
  return [sx, sy];
}

/** View-space Z (depth, positive = further from viewer). */
function viewZ(v: Vec3, cam: Camera): number {
  return (cam.m[6]??0)*v.x + (cam.m[7]??0)*(-v.y) + (cam.m[8]??0)*v.z;
}

/** 2-D signed area of a projected triangle (positive = CCW in SVG-Y-down space = front-facing). */
function signedArea2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
}

// ── Camera builder ────────────────────────────────────────────

function buildCamera(geo: FlatGeometry, opts: Required<SvgCameraOptions>): Camera {
  const az = degToRad(opts.azimuth);
  const el = degToRad(opts.elevation);
  const cosAz = Math.cos(az), sinAz = Math.sin(az);
  const cosEl = Math.cos(el), sinEl = Math.sin(el);

  // Ry(az) * Rx(-el), row-major:
  //   row0 (screen X): [ cosAz,         0,      -sinAz      ]
  //   row1 (screen Y): [ sinAz*sinEl,   cosEl,   cosAz*sinEl ]
  //   row2 (depth Z):  [ sinAz*cosEl,  -sinEl,   cosAz*cosEl ]
  const m: number[] = [
    cosAz,          0,     -sinAz,
    sinAz * sinEl,  cosEl,  cosAz * sinEl,
    sinAz * cosEl, -sinEl,  cosAz * cosEl,
  ];

  // Fit AABB corners into viewport
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

/**
 * Two-source Lambert shading in LDraw world space (Y-down).
 * Returns a multiplier in [ambient, 1.0].
 * Light directions are expressed in LDraw Y-down convention:
 *   y < 0  →  pointing upward in LDraw = illuminates top faces.
 */
function shadeFactor(a: Vec3, b: Vec3, c: Vec3): number {
  const ab = vec3Sub(b, a);
  const ac = vec3Sub(c, a);
  const n  = vec3Normalize(vec3Cross(ab, ac));

  // Key light: upper-front-right in LDraw space (y-down → negative y = up)
  const key  = vec3Normalize({ x: 0.6, y: -1.0, z: 0.4 });
  // Fill light: lower-left-back  (softer)
  const fill = vec3Normalize({ x: -0.4, y: 0.6, z: -0.3 });

  const dKey  = Math.max(0, vec3Dot(n, key));
  const dFill = Math.max(0, vec3Dot(n, fill));

  // ambient + key contribution + fill contribution
  return 0.25 + 0.65 * dKey + 0.15 * dFill;
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
    const [cr, cg, cb, ca] = mesh.color.rgba;
    const r0 = (cr ?? 0) * 255;
    const g0 = (cg ?? 0) * 255;
    const b0 = (cb ?? 0) * 255;
    const opacity = ca ?? 1;

    for (const tri of mesh.triangles) {
      const { a, b, c } = tri;

      // Project to screen space
      const [ax, ay] = project(a.position, cam);
      const [bx, by] = project(b.position, cam);
      const [cx, cy] = project(c.position, cam);

      // Skip degenerate triangles (zero / near-zero area on screen)
      const sa2 = signedArea2(ax, ay, bx, by, cx, cy);
      if (Math.abs(sa2) < 0.01) continue;

      // Back-face culling:
      // After our projection (LDraw Y-down → view Y-up, then SVG Y-down),
      // front-facing triangles have NEGATIVE screen-space signed area
      // (CCW in math convention = CW in SVG Y-down = negative sa2).
      const isFrontFace = sa2 < 0;
      if (!isFrontFace && !opts.twoSided) continue;

      // Shading — always computed from world-space normal (LDraw Y-down)
      // For back-faces we negate the factor to still get a lit appearance.
      let lf = shadeFactor(a.position, b.position, c.position);
      if (!isFrontFace) lf = shadeFactor(c.position, b.position, a.position); // reversed winding

      // Use minimum (nearest) vertex depth for sort key so closer faces win
      const za = viewZ(a.position, cam);
      const zb = viewZ(b.position, cam);
      const zc = viewZ(c.position, cam);
      const depth = Math.min(za, zb, zc);

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
      const [er, eg2, eb] = eg.color.rgba;
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

  // Tiny anti-artifact stroke (same color as fill, 0.3px) closes seams
  // between adjacent coplanar faces from painter-algo imprecision.
  const pathParts = faces.map(
    (f) => `<path d="${f.d}" fill="${f.fill}" opacity="${f.opacity.toFixed(3)}"` +
            ` stroke="${f.fill}" stroke-width="0.3" stroke-linejoin="round"/>`,
  );

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` width="${opts.width}" height="${opts.height}"`,
    ` viewBox="0 0 ${opts.width} ${opts.height}">`,
    bg,
    `<g id="faces">${pathParts.join("")}</g>`,
    opts.showEdges && edgeLines.length > 0
      ? `<g id="edges">${edgeLines.join("")}</g>`
      : "",
    `</svg>`,
  ];

  return parts.join("\n");
}
