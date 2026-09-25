import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import type { CollisionWorld } from '../../sim/collision';
import { createRng } from '../../sim/math';
import { valueNoise } from '../../sim/noise';
import { YARD } from '../../sim/world';
import { BANDO, CANYON_X0, CANYON_Z, TOWER, WAREHOUSE, YARD_ENTRANCE } from '../../sim/yardLayout';
import { triplanarMaterial } from '../materials';
import { Batch } from './batch';

export interface YardTextures {
  yard: Texture;
  concrete: Texture;
  corrugated: Texture;
  metal: Texture;
  fence: Texture;
  graffiti: Texture[];
}

const Y0 = YARD.height;

/** Shipping container with UVs in metres, so the corrugation tiles correctly on every face. */
function containerGeometry(): BoxGeometry {
  const g = new BoxGeometry(12.19, 2.59, 2.44);
  const pos = g.attributes.position as BufferAttribute;
  const nor = g.attributes.normal as BufferAttribute;
  const uv = g.attributes.uv as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    if (ny > 0.5) uv.setXY(i, x / 2.4, z / 2.4);
    else if (nx > 0.5) uv.setXY(i, z / 2.4, y / 2.59 + 0.5);
    else uv.setXY(i, x / 2.4, y / 2.59 + 0.5);
  }
  return g;
}

function rubble(seed: number, r: number): IcosahedronGeometry {
  const g = new IcosahedronGeometry(r, 1);
  const pos = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + valueNoise(x * 2 + seed, z * 2 + y, seed) * 0.35;
    pos.setXYZ(i, x * n, Math.max(y * n * 0.55, -0.1), z * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildYard(scene: Scene, world: CollisionWorld, tex: YardTextures): void {
  const rng = createRng(4040);
  const batch = new Batch(world);

  // ------------------------------------------------------------------ slab
  tex.yard.repeat.set(4, 3);
  const slabMat = new MeshStandardMaterial({ map: tex.yard, roughness: 0.92 });
  const slab = new Mesh(new PlaneGeometry(YARD.halfX * 2, YARD.halfZ * 2), slabMat);
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(YARD.x, Y0 + 0.012, YARD.z);
  slab.receiveShadow = true;
  scene.add(slab);

  const concrete = triplanarMaterial(tex.concrete, { scale: 0.32, roughness: 0.95 });
  const steel = triplanarMaterial(tex.metal, { scale: 0.5, color: '#5b6573', roughness: 0.55, metalness: 0.6 });
  const sheet = triplanarMaterial(tex.corrugated, { scale: 0.4, color: '#a8b0ba', roughness: 0.6, metalness: 0.45 });
  const wood = new MeshStandardMaterial({ color: '#9a7b52', roughness: 0.9 });

  // ----------------------------------------------------------------- bando
  const { x0, z0, sx, sz, floors, floorH, bayX, bayZ } = BANDO;
  const nx = sx / bayX; // 6 bays along x
  const nz = sz / bayZ; // 4 bays along z
  const roofTop = Y0 + floors * floorH + 0.15;

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= nz; j++) {
      const x = x0 + i * bayX;
      const z = z0 + j * bayZ;
      batch.box(concrete, new Vector3(x, (Y0 + roofTop) / 2, z), new Vector3(0.45, roofTop - Y0, 0.45), 'concrete');
    }
  }

  // Slabs, with a stairwell, a collapse and a half-missing roof.
  const holes = new Set<string>(['1:5:3', '1:2:1', '2:5:3', '2:1:2', '2:3:0', '3:5:3']);
  for (let k = 1; k <= floors; k++) {
    const y = Y0 + k * floorH;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (holes.has(`${k}:${i}:${j}`)) continue;
        if (k === floors && rng() < 0.3) continue;
        batch.box(
          concrete,
          new Vector3(x0 + (i + 0.5) * bayX, y, z0 + (j + 0.5) * bayZ),
          new Vector3(bayX + 0.02, 0.3, bayZ + 0.02),
          'concrete',
        );
      }
    }
  }

  // Perimeter walls. Each bay is solid, a window, a door or simply gone.
  type Bay = 'solid' | 'window' | 'door' | 'open';
  const t = 0.25;
  const wallBay = (ax: number, az: number, bx: number, bz: number, floor: number, kind: Bay, outward: Vector3): void => {
    const len = Math.hypot(bx - ax, bz - az);
    const along = new Vector3(bx - ax, 0, bz - az).normalize();
    const yb = Y0 + floor * floorH + 0.15;
    const yt = Y0 + (floor + 1) * floorH - 0.15;
    const cx = (ax + bx) / 2 + outward.x * 0.1;
    const cz = (az + bz) / 2 + outward.z * 0.1;
    const q = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), along);
    const piece = (offset: number, width: number, y0: number, y1: number): void => {
      if (width <= 0.05 || y1 - y0 <= 0.05) return;
      batch.box(
        concrete,
        new Vector3(cx + along.x * offset, (y0 + y1) / 2, cz + along.z * offset),
        new Vector3(width, y1 - y0, t),
        'concrete',
        q,
      );
    };
    const margin = 0.23; // columns take the ends
    const inner = len - margin * 2;
    if (kind === 'open') {
      if (floor > 0) piece(0, inner, yb, yb + 0.9); // parapet
      return;
    }
    if (kind === 'solid') {
      piece(0, inner, yb, yt);
      return;
    }
    const openW = kind === 'door' ? 3.2 : Math.min(2.6, inner - 1);
    const sill = kind === 'door' ? 0 : 1.0;
    const top = kind === 'door' ? 3.0 : 2.7;
    const pier = (inner - openW) / 2;
    piece(-(openW / 2 + pier / 2), pier, yb, yt);
    piece(openW / 2 + pier / 2, pier, yb, yt);
    piece(0, openW, yb, yb + sill);
    piece(0, openW, Math.min(yb + top, yt), yt);
  };

  const pick = (floor: number): Bay => {
    const r = rng();
    if (floor === 0) return r < 0.45 ? 'window' : r < 0.8 ? 'solid' : 'open';
    return r < 0.55 ? 'window' : r < 0.75 ? 'solid' : 'open';
  };
  const canyonBay = Math.round((CANYON_Z - z0 - bayZ / 2) / bayZ);
  // Bays that carry a graffiti piece must be solid walls.
  const solid = new Set(['west:0:0', 'north:1:0', 'south:4:1', 'east:3:0']);
  const bayKind = (side: string, index: number, floor: number): Bay => (solid.has(`${side}:${index}:${floor}`) ? 'solid' : pick(floor));
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < nx; i++) {
      wallBay(x0 + i * bayX, z0, x0 + (i + 1) * bayX, z0, f, bayKind('north', i, f), new Vector3(0, 0, -1));
      wallBay(x0 + i * bayX, z0 + sz, x0 + (i + 1) * bayX, z0 + sz, f, bayKind('south', i, f), new Vector3(0, 0, 1));
    }
    for (let j = 0; j < nz; j++) {
      const door = f === 0 && j === canyonBay;
      wallBay(x0, z0 + j * bayZ, x0, z0 + (j + 1) * bayZ, f, door ? 'door' : bayKind('west', j, f), new Vector3(-1, 0, 0));
      wallBay(x0 + sx, z0 + j * bayZ, x0 + sx, z0 + (j + 1) * bayZ, f, door ? 'door' : bayKind('east', j, f), new Vector3(1, 0, 0));
    }
  }

  // Rubble inside.
  for (let r = 0; r < 9; r++) {
    const x = x0 + 3 + rng() * (sx - 6);
    const z = z0 + 2 + rng() * (sz - 4);
    if (Math.abs(z - CANYON_Z) < 3) continue; // keep the flight line clear
    const level = Math.floor(rng() * 2);
    const size = 0.6 + rng() * 1.1;
    batch.place(concrete, rubble(r, size), new Vector3(x, Y0 + level * floorH + 0.15, z));
    world.addSphere(new Vector3(x, Y0 + level * floorH + 0.15, z), size * 0.7, 'concrete');
  }

  // --------------------------------------------------------- container canyon
  const containers: Array<{ p: Vector3; yaw: number; color: string }> = [];
  const palette = ['#b4432f', '#1f5fa8', '#2f7a44', '#d07a1a', '#7a818c', '#c9c2b4', '#8b2f5a'];
  for (const zRow of [CANYON_Z - 4, CANYON_Z + 4]) {
    for (let i = 0; i < 3; i++) {
      const x = CANYON_X0 + 6.15 + i * 12.35;
      containers.push({ p: new Vector3(x, Y0 + 1.295, zRow), yaw: 0, color: palette[Math.floor(rng() * palette.length)] });
      if (!(i === 2 && zRow > CANYON_Z)) {
        containers.push({ p: new Vector3(x, Y0 + 3.885, zRow), yaw: 0, color: palette[Math.floor(rng() * palette.length)] });
      }
    }
  }
  const scatter: Array<[number, number, number, number]> = [
    [300, -58, 0.5, 3],
    [214, -86, 0.1, 2],
    [236, -8, 1.4, 1],
    [332, -2, 0.3, 2],
    [206, 4, 0.9, 1],
  ];
  for (const [x, z, yaw, levels] of scatter) {
    for (let l = 0; l < levels; l++) {
      containers.push({ p: new Vector3(x, Y0 + 1.295 + l * 2.59, z), yaw: yaw + (rng() - 0.5) * 0.08, color: palette[Math.floor(rng() * palette.length)] });
    }
  }
  const containerMat = new MeshStandardMaterial({ map: tex.corrugated, roughness: 0.62, metalness: 0.35 });
  tex.corrugated.repeat.set(1, 1);
  const containerMesh = new InstancedMesh(containerGeometry(), containerMat, containers.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  containers.forEach((c, i) => {
    q.setFromAxisAngle(up, c.yaw);
    containerMesh.setMatrixAt(i, m.compose(c.p, q, one));
    containerMesh.setColorAt(i, new Color(c.color));
    world.addBox(c.p, new Vector3(6.095, 1.295, 1.22), 'metal', q.clone());
  });
  containerMesh.castShadow = true;
  containerMesh.receiveShadow = true;
  containerMesh.computeBoundingSphere();
  scene.add(containerMesh);

  // ------------------------------------------------------------- lattice tower
  const beams: Array<{ a: Vector3; b: Vector3; r: number; color: Color }> = [];
  const levels = 10;
  const red = new Color('#c2312b');
  const white = new Color('#e8e8e8');
  const corner = (level: number, ci: number): Vector3 => {
    const h = (level / levels) * TOWER.height;
    const half = (TOWER.base + (TOWER.top - TOWER.base) * (level / levels)) / 2;
    const sxs = ci === 0 || ci === 3 ? -1 : 1;
    const szs = ci < 2 ? -1 : 1;
    return new Vector3(TOWER.x + sxs * half, Y0 + h, TOWER.z + szs * half);
  };
  for (let l = 0; l < levels; l++) {
    const color = l % 2 === 0 ? red : white;
    for (let c = 0; c < 4; c++) {
      const a0 = corner(l, c);
      const a1 = corner(l + 1, c);
      const b1 = corner(l + 1, (c + 1) % 4);
      const b0 = corner(l, (c + 1) % 4);
      beams.push({ a: a0, b: a1, r: 0.11, color });
      beams.push({ a: a1, b: b1, r: 0.06, color });
      beams.push({ a: a0, b: b1, r: 0.045, color });
      beams.push({ a: b0, b: a1, r: 0.045, color });
    }
  }
  const beamGeo = new CylinderGeometry(1, 1, 1, 6);
  beamGeo.translate(0, 0.5, 0);
  const beamMat = new MeshStandardMaterial({ roughness: 0.5, metalness: 0.5 });
  const beamMesh = new InstancedMesh(beamGeo, beamMat, beams.length);
  const dir = new Vector3();
  const scale = new Vector3();
  beams.forEach((b, i) => {
    dir.subVectors(b.b, b.a);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    scale.set(b.r, len, b.r);
    beamMesh.setMatrixAt(i, m.compose(b.a, q, scale));
    beamMesh.setColorAt(i, b.color);
    world.addCapsule(b.a, b.b, Math.max(b.r, 0.05), 'metal');
  });
  beamMesh.castShadow = true;
  beamMesh.computeBoundingSphere();
  scene.add(beamMesh);
  const beacon = new Mesh(new SphereGeometry(0.35, 12, 8), new MeshBasicMaterial({ color: new Color(4, 0.3, 0.2), toneMapped: false }));
  beacon.position.set(TOWER.x, Y0 + TOWER.height + 0.5, TOWER.z);
  scene.add(beacon);

  // ----------------------------------------------------------------- warehouse
  const W = WAREHOUSE;
  const wh = W.height;
  const cols = 5;
  for (let i = 0; i < cols; i++) {
    const x = W.x0 + (i / (cols - 1)) * W.sx;
    for (const z of [W.z0, W.z0 + W.sz]) {
      batch.box(steel, new Vector3(x, Y0 + wh / 2, z), new Vector3(0.4, wh, 0.4), 'metal');
    }
    batch.box(steel, new Vector3(x, Y0 + wh + 0.25, W.z0 + W.sz / 2), new Vector3(0.3, 0.5, W.sz + 0.4), 'metal');
  }
  for (const z of [W.z0, W.z0 + W.sz / 3, W.z0 + (2 * W.sz) / 3, W.z0 + W.sz]) {
    batch.box(steel, new Vector3(W.x0 + W.sx / 2, Y0 + wh + 0.6, z), new Vector3(W.sx + 0.4, 0.22, 0.22), 'metal');
  }
  // Roof sheets, a third of them blown away.
  const sheetsX = 8;
  const sheetsZ = 4;
  for (let i = 0; i < sheetsX; i++) {
    for (let j = 0; j < sheetsZ; j++) {
      if (rng() < 0.34) continue;
      const w = W.sx / sheetsX;
      const d = W.sz / sheetsZ;
      batch.box(sheet, new Vector3(W.x0 + (i + 0.5) * w, Y0 + wh + 0.78, W.z0 + (j + 0.5) * d), new Vector3(w - 0.05, 0.05, d - 0.05), 'metal');
    }
  }
  // Cladding on the long sides, with gaps; the ends stay open for the portals.
  for (let i = 0; i < cols - 1; i++) {
    const xa = W.x0 + (i / (cols - 1)) * W.sx;
    const xb = W.x0 + ((i + 1) / (cols - 1)) * W.sx;
    for (const z of [W.z0, W.z0 + W.sz]) {
      if (rng() < 0.3) continue;
      const top = rng() < 0.5 ? wh : wh * 0.55;
      batch.box(sheet, new Vector3((xa + xb) / 2, Y0 + top / 2, z), new Vector3(xb - xa - 0.4, top, 0.06), 'metal');
    }
  }

  // --------------------------------------------------- pallets and barrels
  const palletSpots: Array<[number, number, number]> = [
    [244, -40, 3],
    [247, -36, 2],
    [290, -48, 4],
    [226, -24, 2],
    [318, -50, 3],
    [270, -2, 2],
  ];
  for (const [x, z, h] of palletSpots) {
    for (let l = 0; l < h; l++) {
      batch.box(wood, new Vector3(x, Y0 + 0.07 + l * 0.15, z), new Vector3(1.2, 0.14, 1.0), null);
    }
    world.addBox(new Vector3(x, Y0 + (h * 0.15) / 2, z), new Vector3(0.6, (h * 0.15) / 2, 0.5), 'wood');
  }
  const barrelColors = [new Color('#1e40af'), new Color('#b91c1c'), new Color('#ca8a04'), new Color('#15803d')];
  const barrels: Array<[number, number]> = [];
  for (let g = 0; g < 5; g++) {
    const cx = 215 + rng() * 110;
    const cz = -95 + rng() * 100;
    if (cx > BANDO.x0 - 3 && cx < BANDO.x0 + BANDO.sx + 3 && cz > BANDO.z0 - 3 && cz < BANDO.z0 + BANDO.sz + 3) continue;
    if (Math.abs(cz - CANYON_Z) < 7 && cx < 245) continue;
    for (let b = 0; b < 4; b++) barrels.push([cx + (b % 2) * 0.62, cz + Math.floor(b / 2) * 0.62]);
  }
  const barrelMesh = new InstancedMesh(new CylinderGeometry(0.29, 0.29, 0.88, 16), new MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), Math.max(barrels.length, 1));
  barrels.forEach(([x, z], i) => {
    barrelMesh.setMatrixAt(i, m.compose(new Vector3(x, Y0 + 0.44, z), q.identity(), one));
    barrelMesh.setColorAt(i, barrelColors[i % barrelColors.length]);
    world.addCylinder(new Vector3(x, Y0 + 0.44, z), 0.29, 0.44, 'metal');
  });
  barrelMesh.castShadow = true;
  barrelMesh.computeBoundingSphere();
  scene.add(barrelMesh);

  // --------------------------------------------------------------- light poles
  const poles: Array<[number, number]> = [
    [YARD.x - YARD.halfX + 3, YARD.z - YARD.halfZ + 3],
    [YARD.x + YARD.halfX - 3, YARD.z - YARD.halfZ + 3],
    [YARD.x + YARD.halfX - 3, YARD.z + YARD.halfZ - 3],
    [YARD.x - YARD.halfX + 3, YARD.z + YARD.halfZ - 3],
  ];
  for (const [x, z] of poles) {
    batch.place(steel, new CylinderGeometry(0.1, 0.16, 11, 8), new Vector3(x, Y0 + 5.5, z));
    batch.box(steel, new Vector3(x, Y0 + 11, z), new Vector3(1.4, 0.25, 0.6), null);
    world.addCapsule(new Vector3(x, Y0, z), new Vector3(x, Y0 + 11.2, z), 0.2, 'metal');
  }

  // -------------------------------------------------------------------- fence
  const fenceTex = tex.fence;
  fenceTex.repeat.set(1, 1);
  const fenceMat = new MeshStandardMaterial({ map: fenceTex, alphaTest: 0.5, side: DoubleSide, metalness: 0.6, roughness: 0.5 });
  const fenceH = 2.4;
  const run = (ax: number, az: number, bx: number, bz: number): void => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const along = new Vector3(bx - ax, 0, bz - az).normalize();
    const posts = Math.ceil(len / 3);
    for (let i = 0; i <= posts; i++) {
      const x = ax + ((bx - ax) * i) / posts;
      const z = az + ((bz - az) * i) / posts;
      batch.place(steel, new CylinderGeometry(0.04, 0.04, fenceH + 0.1, 6), new Vector3(x, Y0 + fenceH / 2, z));
    }
    const panel = new PlaneGeometry(len, fenceH);
    const uv = panel.attributes.uv as BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len * 2, uv.getY(i) * fenceH * 2);
    const quat = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), along);
    batch.place(fenceMat, panel, new Vector3((ax + bx) / 2, Y0 + fenceH / 2, (az + bz) / 2), quat);
    world.addBox(new Vector3((ax + bx) / 2, Y0 + fenceH / 2, (az + bz) / 2), new Vector3(len / 2, fenceH / 2, 0.04), 'net', quat);
  };
  const xa = YARD.x - YARD.halfX;
  const xb = YARD.x + YARD.halfX;
  const za = YARD.z - YARD.halfZ;
  const zb = YARD.z + YARD.halfZ;
  const gapA = YARD_ENTRANCE.z - YARD_ENTRANCE.width / 2;
  const gapB = YARD_ENTRANCE.z + YARD_ENTRANCE.width / 2;
  run(xa, za, xb, za);
  run(xb, za, xb, zb);
  run(xb, zb, xa, zb);
  run(xa, zb, xa, gapB);
  run(xa, gapA, xa, za);

  batch.build(scene);

  // ------------------------------------------------------------------ graffiti
  const tags: Array<{ p: Vector3; yaw: number; w: number }> = [
    { p: new Vector3(x0 - 0.2, Y0 + 2.2, z0 + 3), yaw: -Math.PI / 2, w: 4 },
    { p: new Vector3(x0 + 9, Y0 + 2, z0 - 0.2), yaw: Math.PI, w: 4.5 },
    { p: new Vector3(x0 + 27, Y0 + 6.2, z0 + sz + 0.2), yaw: 0, w: 4 },
    { p: new Vector3(x0 + sx + 0.2, Y0 + 2.4, z0 + 17), yaw: Math.PI / 2, w: 3.6 },
    { p: new Vector3(CANYON_X0 + 18, Y0 + 1.4, CANYON_Z - 2.7), yaw: 0, w: 5 },
    { p: new Vector3(CANYON_X0 + 30, Y0 + 1.5, CANYON_Z + 2.7), yaw: Math.PI, w: 5 },
  ];
  tags.forEach((tag, i) => {
    const map = tex.graffiti[i % tex.graffiti.length];
    const mat = new MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new Mesh(new PlaneGeometry(tag.w, tag.w / 2), mat);
    mesh.position.copy(tag.p);
    mesh.rotation.y = tag.yaw;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });
}
