// ============================================================
// LDraw Parser – SVG thumbnail generator
// ============================================================
//
// Renders a lightweight 2-D isometric-ish projection.
// No external dependencies – pure string manipulation.
// ============================================================

import type { FlatGeometry, GeometryMesh, GeometryEdges, Vec3 } from "./types";
import { vec3Normalize, vec3Sub, vec3Cross, vec3Dot } from "./utils";

// ── Camera ────────────────────────────────────────────────────

export interface SvgCameraOptions {
  /** Horizontal rotation around Y axis in degrees (default 45) */
  azimuth?: number;
  /** Vertical tilt in degrees (default 30) */
  elevation?: number;
  /** Output width in px (default 512) */
  width?: number;
  /** Output height in px (default 512) */
  height?: number;
  /** Margin ratio relative to min viewport dimension (default 0.05) */
  margin?: number;
  /** Include edge lines (default true) */
  showEdges?: boolean;
  /** Background fill (default "transparent") */
  background?: string;
  /** Edge stroke width in px before scaling (default 0.5) */
  edgeWidth?: number;
}

// ── Projection ────────────────────────────────────────────────

function degToRad(d: number): number { return (d * Math.PI) / 180; }

interface Camera {
  viewMatrix: number[];  // 3x3 row-major (just rotation)
  scale: number;
  tx: number;
  ty: number;
}

/** LDraw Y-axis is down; we flip it to screen-space */
function projectVertex(v: Vec3, cam: Camera): [number, number] {
  const m = cam.viewMatrix;
  const x = (m[0] ?? 0) * v.x + (m[1] ?? 0) * (-v.y) + (m[2] ?? 0) * v.z;
  const y = (m[3] ?? 0) * v.x + (m[4] ?? 0) * (-v.y) + (m[5] ?? 0) * v.z;
  return [x * cam.scale + cam.tx, y * cam.scale + cam.ty];
}

function buildCamera(
  geometry: FlatGeometry,
  opts: Required<SvgCameraOptions>,
): Camera {
  const az  = degToRad(opts.azimuth);
  const el  = degToRad(opts.elevation);

  // Rotation matrix: Ry(azimuth) * Rx(-elevation)
  const cosAz = Math.cos(az), sinAz = Math.sin(az);
  const cosEl = Math.cos(el), sinEl = Math.sin(el);

  // Combined 3x3 view matrix (row-major)
  const m: number[] = [
     cosAz,          0,       -sinAz,
     sinAz * sinEl,  cosEl,    cosAz * sinEl,
     sinAz * cosEl, -sinEl,    cosAz * cosEl,
  ];

  // Find bounds in projected space
  const { aabb } = geometry;
  const corners: Vec3[] = [];
  for (const dx of [aabb.min.x, aabb.max.x])
  for (const dy of [aabb.min.y, aabb.max.y])
  for (const dz of [aabb.min.z, aabb.max.z])
    corners.push({ x: dx, y: dy, z: dz });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of corners) {
    // Apply rotation only (no scale/translate yet)
    const px = (m[0] ?? 0) * c.x + (m[1] ?? 0) * (-c.y) + (m[2] ?? 0) * c.z;
    const py = (m[3] ?? 0) * c.x + (m[4] ?? 0) * (-c.y) + (m[5] ?? 0) * c.z;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  const margin = Math.min(opts.width, opts.height) * opts.margin;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min(
    (opts.width  - 2 * margin) / rangeX,
    (opts.height - 2 * margin) / rangeY,
  );

  const tx = opts.width  / 2 - ((minX + maxX) / 2) * scale;
  const ty = opts.height / 2 - ((minY + maxY) / 2) * scale;

  return { viewMatrix: m, scale, tx, ty };
}

// ── Face sorting (painter's algorithm) ────────────────────────

interface SvgFace {
  d: string;
  fill: string;
  opacity: number;
  depth: number;
}

function rgbaToSvg(rgba: [number, number, number, number]): { fill: string; opacity: number } {
  const r = Math.round(rgba[0] * 255);
  const g = Math.round(rgba[1] * 255);
  const b = Math.round(rgba[2] * 255);
  const fill = `rgb(${r},${g},${b})`;
  return { fill, opacity: rgba[3] };
}

function lightFactor(a: Vec3, b: Vec3, c: Vec3): number {
  // Simple Lambert shading with a fixed light direction
  const ab = vec3Sub(b, a);
  const ac = vec3Sub(c, a);
  const normal = vec3Normalize(vec3Cross(ab, ac));
  // Light from upper-front-right
  const light = vec3Normalize({ x: 1, y: -2, z: 1 });
  const dot = Math.max(0, vec3Dot(normal, light));
  return 0.35 + 0.65 * dot;
}

// ── SVG generator ─────────────────────────────────────────────

/**
 * Generate an SVG string representing a thumbnail of the model.
 * Uses a simple painter's algorithm (back-to-front depth sort).
 */
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
  };

  if (geometry.meshes.length === 0 && geometry.edges.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}"></svg>`;
  }

  const cam = buildCamera(geometry, opts);

  // ── Collect faces ──────────────────────────────────────────
  const faces: SvgFace[] = [];

  for (const mesh of geometry.meshes) {
    const { fill, opacity } = rgbaToSvg(mesh.color.rgba);

    for (const tri of mesh.triangles) {
      const [ax, ay] = projectVertex(tri.a.position, cam);
      const [bx, by] = projectVertex(tri.b.position, cam);
      const [cx, cy] = projectVertex(tri.c.position, cam);

      // Average projected depth (Z in view space) for painter sort
      const m = cam.viewMatrix;
      const depthOf = (v: Vec3) =>
        (m[6] ?? 0) * v.x + (m[7] ?? 0) * (-v.y) + (m[8] ?? 0) * v.z;
      const depth =
        (depthOf(tri.a.position) + depthOf(tri.b.position) + depthOf(tri.c.position)) / 3;

      const lf = lightFactor(tri.a.position, tri.b.position, tri.c.position);
      const r = Math.round((mesh.color.rgba[0] ?? 0) * lf * 255);
      const g = Math.round((mesh.color.rgba[1] ?? 0) * lf * 255);
      const b = Math.round((mesh.color.rgba[2] ?? 0) * lf * 255);

      faces.push({
        d: `M${ax.toFixed(2)},${ay.toFixed(2)} L${bx.toFixed(2)},${by.toFixed(2)} L${cx.toFixed(2)},${cy.toFixed(2)} Z`,
        fill: `rgb(${r},${g},${b})`,
        opacity,
        depth,
      });
    }
  }

  // Sort back-to-front (painter's algorithm)
  faces.sort((a, b) => b.depth - a.depth);

  // ── Collect edge segments ──────────────────────────────────
  const edgeLines: string[] = [];
  if (opts.showEdges) {
    for (const edgeGroup of geometry.edges) {
      const { fill } = rgbaToSvg(edgeGroup.color.rgba);
      for (const seg of edgeGroup.segments) {
        const [x1, y1] = projectVertex(seg.start, cam);
        const [x2, y2] = projectVertex(seg.end,   cam);
        edgeLines.push(
          `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" ` +
          `x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ` +
          `stroke="${fill}" stroke-width="${opts.edgeWidth}" stroke-linecap="round"/>`,
        );
      }
    }
  }

  // ── Build SVG ─────────────────────────────────────────────
  const bg =
    opts.background !== "transparent"
      ? `<rect width="${opts.width}" height="${opts.height}" fill="${opts.background}"/>`
      : "";

  const facePaths = faces
    .map(
      (f) =>
        `<path d="${f.d}" fill="${f.fill}" opacity="${f.opacity.toFixed(3)}" stroke="none"/>`,
    )
    .join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" `,
    `viewBox="0 0 ${opts.width} ${opts.height}">`,
    bg,
    `<g id="faces">${facePaths}</g>`,
    opts.showEdges ? `<g id="edges">${edgeLines.join("\n")}</g>` : "",
    `</svg>`,
  ].join("\n");
}
