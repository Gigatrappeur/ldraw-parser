// ============================================================
// LDraw Parser – Vertex welding & smooth normals
// ============================================================

import type { GeometryMesh } from "./types";

export interface WeldOptions {
  /** Position tolerance for merging vertices (default: 1e-4) */
  epsilon?: number;
  /** Compute smooth normals by averaging face normals (default: false) */
  smoothNormals?: boolean;
  /** Crease angle in degrees – sharper edges are kept hard (default: 60) */
  creasAngle?: number;
}

export interface WeldedMesh {
  colorCode:       number;
  positions:       Float32Array;
  normals:         Float32Array;
  uvs:             Float32Array | null;
  indices:         Uint16Array | Uint32Array;
  texmapTexture?:  string;
  texmapKey?:      string;
}

// ── Spatial hash ──────────────────────────────────────────────

class Grid {
  private cells = new Map<number, number[]>();
  constructor(private eps: number) {}

  private h(x: number, y: number, z: number): number {
    const ix = Math.round(x / this.eps) | 0;
    const iy = Math.round(y / this.eps) | 0;
    const iz = Math.round(z / this.eps) | 0;
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }

  add(i: number, x: number, y: number, z: number) {
    const k = this.h(x, y, z);
    const c = this.cells.get(k); if (c) c.push(i); else this.cells.set(k, [i]);
  }

  near(x: number, y: number, z: number): number[] {
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
    for (let dz = -1; dz <= 1; dz++) {
      const ix = (Math.round(x / this.eps) | 0) + dx;
      const iy = (Math.round(y / this.eps) | 0) + dy;
      const iz = (Math.round(z / this.eps) | 0) + dz;
      const k = ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
      const c = this.cells.get(k); if (c) for (const i of c) out.push(i);
    }
    return out;
  }
}

// ── Core weld ─────────────────────────────────────────────────

function texmapKeyString(t: { projection: string; texture: string; point1: {x:number;y:number;z:number}; point2: {x:number;y:number;z:number}; point3: {x:number;y:number;z:number}; angle?: number; angle1?: number; angle2?: number }): string {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const p = (v: {x:number;y:number;z:number}) => `${r(v.x)},${r(v.y)},${r(v.z)}`;
  let k = `${t.projection}::${t.texture}::${p(t.point1)}::${p(t.point2)}::${p(t.point3)}`;
  if (t.angle    !== undefined) k += `::${t.angle}`;
  if (t.angle1 !== undefined) k += `::${t.angle1}::${t.angle2}`;
  return k;
}

export function weldMesh(mesh: GeometryMesh, opts: WeldOptions = {}): WeldedMesh {
  const eps    = opts.epsilon       ?? 1e-4;
  const smooth = opts.smoothNormals ?? false;
  const hasUV  = mesh.triangles.length > 0 && mesh.triangles[0]?.a.uv !== undefined;

  const pos: number[]  = [];
  const uvPos: number[] = [];  // mirrors pos: [u0,v0, u1,v1, ...] for UV matching
  const uvArr: number[] = [];
  const grid = new Grid(eps);
  const triIdx: number[] = [];
  const faceNX: number[] = [], faceNY: number[] = [], faceNZ: number[] = [];

  for (const tri of mesh.triangles) {
    const {a,b,c} = tri;
    const abx=b.position.x-a.position.x, aby=b.position.y-a.position.y, abz=b.position.z-a.position.z;
    const acx=c.position.x-a.position.x, acy=c.position.y-a.position.y, acz=c.position.z-a.position.z;
    const nx=aby*acz-abz*acy, ny=abz*acx-abx*acz, nz=abx*acy-aby*acx;
    const l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    faceNX.push(nx/l); faceNY.push(ny/l); faceNZ.push(nz/l);

    for (const v of [a,b,c] as const) {
      const {x,y,z} = v.position;
      let found = -1;
      for (const ci of grid.near(x,y,z)) {
        const px=pos[ci*3]??0, py=pos[ci*3+1]??0, pz=pos[ci*3+2]??0;
        const d2 = (x-px)**2+(y-py)**2+(z-pz)**2;
        if (d2 < eps*eps) {
          if (!hasUV ||
              (v.uv?.u ?? 0) === (uvPos[ci*2] ?? 0) &&
              (v.uv?.v ?? 0) === (uvPos[ci*2+1] ?? 0)) {
            found = ci; break;
          }
        }
      }
      if (found < 0) {
        found = pos.length/3;
        pos.push(x,y,z);
        if (hasUV) {
          const u = v.uv?.u ?? 0;
          const vv = v.uv?.v ?? 0;
          uvArr.push(u, vv);
          uvPos.push(u, vv);
        }
        grid.add(found,x,y,z);
      }
      triIdx.push(found);
    }
  }

  const vc = pos.length/3;
  const norArr = new Float32Array(vc*3);

  if (smooth) {
    const creaseAngle = opts.creasAngle != null ? (opts.creasAngle * Math.PI) / 180 : Math.PI / 4;
    const cosCrease = Math.cos(creaseAngle);
    
    // Accumulate face normals per vertex with crease angle filtering
    type NorAccum = { sum: [number,number,number]; ref: [number,number,number] | null };
    const accum = new Array<NorAccum | null>(vc);
    
    for (let fi=0; fi<mesh.triangles.length; fi++) {
      const nx=faceNX[fi]??0, ny=faceNY[fi]??0, nz=faceNZ[fi]??0;
      for (let ci=0; ci<3; ci++) {
        const vi = triIdx[fi*3+ci]??0;
        let acc = accum[vi];
        if (!acc) {
          acc = { sum: [nx, ny, nz], ref: [nx, ny, nz] as [number,number,number] };
          accum[vi] = acc;
        } else if (acc.ref) {
          // Check if within crease angle
          const dot = acc.ref[0]*nx + acc.ref[1]*ny + acc.ref[2]*nz;
          if (dot >= cosCrease) {
            acc.sum[0] += nx; acc.sum[1] += ny; acc.sum[2] += nz;
          }
        }
      }
    }
    
    // Normalize accumulated normals
    for (let vi=0; vi<vc; vi++) {
      const acc = accum[vi];
      if (acc) {
        const sx=acc.sum[0], sy=acc.sum[1], sz=acc.sum[2];
        const l=Math.sqrt(sx*sx+sy*sy+sz*sz)||1;
        norArr[vi*3]=sx/l; norArr[vi*3+1]=sy/l; norArr[vi*3+2]=sz/l;
      }
    }
  } else {
    for (let fi=0; fi<mesh.triangles.length; fi++) {
      const nx=faceNX[fi]??0, ny=faceNY[fi]??0, nz=faceNZ[fi]??0;
      for (let ci=0; ci<3; ci++) {
        const vi = triIdx[fi*3+ci]??0;
        norArr[vi*3]=nx; norArr[vi*3+1]=ny; norArr[vi*3+2]=nz;
      }
    }
  }

  return {
    colorCode:    mesh.colorCode,
    positions:    new Float32Array(pos),
    normals:      norArr,
    uvs:          hasUV ? new Float32Array(uvArr) : null,
    indices:      vc>65535 ? new Uint32Array(triIdx) : new Uint16Array(triIdx),
    texmapTexture: mesh.texmap?.texture,
    texmapKey:    mesh.texmap ? texmapKeyString(mesh.texmap) : undefined,
  };
}

export function weldGeometry(meshes: GeometryMesh[], opts: WeldOptions={}): WeldedMesh[] {
  return meshes.map((m) => weldMesh(m, opts));
}

export function mergeWeldedMeshes(meshes: WeldedMesh[]): WeldedMesh[] {
  const byKey = new Map<string, WeldedMesh[]>();
  for (const m of meshes) {
    const k = `${m.colorCode}::${m.texmapKey??m.texmapTexture??""}`;
    const a = byKey.get(k); if (a) a.push(m); else byKey.set(k,[m]);
  }
  const out: WeldedMesh[] = [];
  for (const group of byKey.values()) {
    if (group.length===1) { out.push(group[0]!); continue; }
    let tv=0, ti=0;
    for (const m of group) { tv+=m.positions.length/3; ti+=m.indices.length; }
    const positions=new Float32Array(tv*3), normals=new Float32Array(tv*3);
    const hasUV=group[0]!.uvs!==null;
    const uvs=hasUV?new Float32Array(tv*2):null;
    const u32=tv>65535; const indices=u32?new Uint32Array(ti):new Uint16Array(ti);
    let vo=0,io=0;
    for (const m of group) {
      const nv=m.positions.length/3;
      positions.set(m.positions,vo*3); normals.set(m.normals,vo*3);
      if (uvs&&m.uvs) uvs.set(m.uvs,vo*2);
      for (let i=0;i<m.indices.length;i++) indices[io+i]=(m.indices[i]??0)+vo;
      vo+=nv; io+=m.indices.length;
    }
    out.push({ colorCode:group[0]!.colorCode, positions, normals, uvs, indices, texmapTexture:group[0]!.texmapTexture, texmapKey: group[0]!.texmapKey });
  }
  return out;
}
