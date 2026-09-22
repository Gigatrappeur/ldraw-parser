
// ── TEXMAP UV projection ──────────────────────────────────────


import type { TexmapCylindrical, TexmapDefinition, TexmapPlanar, TexmapSpherical, Vec2, Vec3 } from "./types";
import { vec, vec3Cross, vec3Dot, vec3Length, vec3LengthSq, vec3Normalize, vec3Sub } from "./utils";




// ── Parse a TEXMAP opening line ───────────────────────────────

export function parseTexmapStart(parts: string[]): TexmapDefinition | null {
	// 0 !TEXMAP START|NEXT PLANAR|CYLINDRICAL|SPHERICAL <...> <texture> [GLOSSMAP <gloss>]
	const startIdx = parts.findIndex((p) => /^(START|NEXT)$/i.test(p));
	if (startIdx < 0) return null;
	const projection = (parts[startIdx + 1] ?? "").toUpperCase();

	const textureIdx = parts.findIndex((p) => /\.png$/i.test(p));
	const texture = textureIdx >= 0 ? (parts[textureIdx] ?? "") : (parts[parts.length - 1] ?? "");
	const glossIdx = parts.findIndex((p) => /^GLOSSMAP$/i.test(p));
	const glossmap = glossIdx >= 0 ? parts[glossIdx + 1] : undefined;

	const p = (offset: number) =>
		vec(parts, startIdx + 2 + offset * 3);

	if (projection === "PLANAR") {
		return { projection: "PLANAR", point1: p(0), point2: p(1), point3: p(2), texture, glossmap } as TexmapPlanar;
	}
	if (projection === "CYLINDRICAL") {
		const angle = parseFloat(parts[startIdx + 2 + 9] ?? "360") || 360;
		return { projection: "CYLINDRICAL", point1: p(0), point2: p(1), point3: p(2), angle, texture, glossmap } as TexmapCylindrical;
	}
	if (projection === "SPHERICAL") {
		const angle1 = parseFloat(parts[startIdx + 2 + 9] ?? "360") || 360;
		const angle2 = parseFloat(parts[startIdx + 2 + 10] ?? "180") || 180;
		return { projection: "SPHERICAL", point1: p(0), point2: p(1), point3: p(2), angle1, angle2, texture, glossmap } as TexmapSpherical;
	}
	return null;
}


/** Project a world-space point onto UV coordinates using the TEXMAP definition */
export function projectTexmap(def: TexmapDefinition, point: Vec3): Vec2 {
	if (def.projection === "PLANAR") {
		const { point1, point2, point3 } = def;
		const u_vec = vec3Sub(point2, point1);
		const v_vec = vec3Sub(point3, point1);
		const rel = vec3Sub(point, point1);
		const u = vec3Dot(rel, u_vec) / vec3LengthSq(u_vec);
		const v = vec3Dot(rel, v_vec) / vec3LengthSq(v_vec);
		return { u, v };
	}

	if (def.projection === "CYLINDRICAL") {
		const { point1, point2, point3, angle } = def;
		const axis = vec3Normalize(vec3Sub(point2, point1));
		const ref = vec3Normalize(vec3Sub(point3, point1));
		const rel = vec3Sub(point, point1);
		const v = vec3Dot(rel, axis) / vec3Length(vec3Sub(point2, point1));
		const proj = vec3Sub(rel, { x: axis.x * v, y: axis.y * v, z: axis.z * v });
		let theta = Math.atan2(vec3Dot(proj, vec3Cross(axis, ref)), vec3Dot(proj, ref));
		if (theta < 0) theta += 2 * Math.PI;
		const u = theta / ((angle * Math.PI) / 180);
		return { u, v };
	}

	// SPHERICAL
	const { point1, point2, point3, angle1, angle2 } = def as { point1: Vec3; point2: Vec3; point3: Vec3; angle1: number; angle2: number; texture: string };
	const axis = vec3Normalize(vec3Sub(point2, point1));
	const ref = vec3Normalize(vec3Sub(point3, point1));
	const rel = vec3Normalize(vec3Sub(point, point1));
	const phi = Math.acos(Math.max(-1, Math.min(1, vec3Dot(rel, axis))));
	const side = vec3Sub(rel, { x: axis.x * vec3Dot(rel, axis), y: axis.y * vec3Dot(rel, axis), z: axis.z * vec3Dot(rel, axis) });
	let theta = Math.atan2(vec3Dot(side, vec3Cross(axis, ref)), vec3Dot(side, ref));
	if (theta < 0) theta += 2 * Math.PI;
	const u = theta / ((angle1 * Math.PI) / 180);
	const v = phi / ((angle2 * Math.PI) / 180);
	return { u, v };
}
