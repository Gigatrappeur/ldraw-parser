// ============================================================
// LDraw Parser – Vertex welding & smooth normals
// ============================================================

import type { GeometryMesh } from "./types";

export interface WeldOptions {
  /** Position tolerance for merging vertices (default: 1e-4) */
  epsilon?: number;
  /** Compute smooth normals by averaging face normals (default: true) */
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

export function weldMesh(mesh: GeometryMesh, opts: WeldOptions = {}): WeldedMesh {
  const eps    = opts.epsilon       ?? 1e-4;
  const smooth = opts.smoothNormals ?? true;
  const hasUV  = mesh.triangles.length > 0 && mesh.triangles[0]?.a.uv !== undefined;

  const pos: number[]  = [];
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
      if (smooth) {
        for (const ci of grid.near(x,y,z)) {
          const px=pos[ci*3]??0, py=pos[ci*3+1]??0, pz=pos[ci*3+2]??0;
          if ((x-px)**2+(y-py)**2+(z-pz)**2 < eps*eps) { found=ci; break; }
        }
      }
      if (found < 0) {
        found = pos.length/3;
        pos.push(x,y,z);
        if (hasUV) uvArr.push(v.uv?.u??0, v.uv?.v??0);
        grid.add(found,x,y,z);
      }
      triIdx.push(found);
    }
  }

  const vc = pos.length/3;
  const norArr = new Float32Array(vc*3);

  for (let fi=0; fi<mesh.triangles.length; fi++) {
    const nx=faceNX[fi]??0, ny=faceNY[fi]??0, nz=faceNZ[fi]??0;
    for (let ci=0; ci<3; ci++) {
      const vi = triIdx[fi*3+ci]??0;
      if (smooth) {
        (norArr[vi*3] = (norArr[vi*3]??0)+nx, norArr[vi*3+1]=(norArr[vi*3+1]??0)+ny, norArr[vi*3+2]=(norArr[vi*3+2]??0)+nz);
      } else {
        norArr[vi*3]=nx; norArr[vi*3+1]=ny; norArr[vi*3+2]=nz;
      }
    }
  }

  if (smooth) {
    for (let vi=0; vi<vc; vi++) {
      const nx=norArr[vi*3]??0, ny=norArr[vi*3+1]??0, nz=norArr[vi*3+2]??0;
      const l=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
      norArr[vi*3]=nx/l; norArr[vi*3+1]=ny/l; norArr[vi*3+2]=nz/l;
    }
  }

  return {
    colorCode:    mesh.colorCode,
    positions:    new Float32Array(pos),
    normals:      norArr,
    uvs:          hasUV ? new Float32Array(uvArr) : null,
    indices:      vc>65535 ? new Uint32Array(triIdx) : new Uint16Array(triIdx),
    texmapTexture: mesh.texmap?.texture,
  };
}

export function weldGeometry(meshes: GeometryMesh[], opts: WeldOptions={}): WeldedMesh[] {
  return meshes.map((m) => weldMesh(m, opts));
}

export function mergeWeldedMeshes(meshes: WeldedMesh[]): WeldedMesh[] {
  const byKey = new Map<string, WeldedMesh[]>();
  for (const m of meshes) {
    const k = `${m.colorCode}::${m.texmapTexture??""}`;
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
    out.push({ colorCode:group[0]!.colorCode, positions, normals, uvs, indices, texmapTexture:group[0]!.texmapTexture });
  }
  return out;
}
