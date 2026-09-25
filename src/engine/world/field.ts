import {
  BufferAttribute,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type Texture,
} from 'three';
import type { CollisionWorld } from '../../sim/collision';
import { createRng } from '../../sim/math';
import { PAD, PILOT, terrainHeight } from '../../sim/world';
import { worldClock } from '../materials';
import { Batch } from './batch';

function padTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(0, 0, 512, 512);
  // Rubber texture speckle.
  const rng = createRng(12);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rng() * 0.05})`;
    ctx.fillRect(rng() * 512, rng() * 512, 2, 2);
  }
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 16;
  ctx.strokeRect(24, 24, 464, 464);
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(256, 256, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#e5e7eb';
  ctx.font = 'bold 190px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 256, 268);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function bannerTexture(text: string, sub: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  g.addColorStop(0, '#0b1220');
  g.addColorStop(1, '#0e2a3a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#22d3ee';
  ctx.fillRect(0, 0, 1024, 14);
  ctx.fillRect(0, 242, 1024, 14);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 110px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 512, 112);
  ctx.fillStyle = '#f97316';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText(sub, 512, 196);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Feather flag with a wind flutter in the vertex shader. Batching bakes world
 * transforms into the positions, so the flag's own (local) coordinates travel
 * in a separate `aLocal` attribute.
 */
function flagMaterial(color: string): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color(color), roughness: 0.7, side: DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nattribute vec2 aLocal;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float along = max(aLocal.x, 0.0);
        transformed += objectNormal * sin(uTime * 4.2 + aLocal.x * 3.0 + aLocal.y * 0.8) * 0.12 * along;`,
      );
  };
  m.customProgramCacheKey = () => 'feather-flag';
  return m;
}

export interface FieldProps {
  windsock: Group;
  pads: Vector3[];
}

export function buildField(scene: Scene, world: CollisionWorld, textures: { dirt: Texture }): FieldProps {
  const batch = new Batch(world);
  const white = new MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.5, metalness: 0.2 });
  const darkMetal = new MeshStandardMaterial({ color: '#374151', roughness: 0.45, metalness: 0.7 });
  const canopy = new MeshStandardMaterial({ color: '#0e7490', roughness: 0.75, side: DoubleSide });
  const tableMat = new MeshStandardMaterial({ color: '#d6d3d1', roughness: 0.6 });
  const chairMat = new MeshStandardMaterial({ color: '#1f2937', roughness: 0.8 });
  const caseMat = new MeshStandardMaterial({ color: '#f97316', roughness: 0.5 });
  const hay = new MeshStandardMaterial({ color: '#d9b46a', map: textures.dirt, roughness: 1 });

  const up = new Vector3(0, 1, 0);
  const pads: Vector3[] = [];

  // ------------------------------------------------------------ launch pad
  const padMat = new MeshStandardMaterial({ map: padTexture(), roughness: 0.95 });
  const addPad = (x: number, z: number): void => {
    const y = terrainHeight(x, z);
    batch.box(padMat, new Vector3(x, y + 0.02, z), new Vector3(2.6, 0.04, 2.6), 'fabric');
    pads.push(new Vector3(x, y + 0.04, z));
  };
  addPad(PAD.x, PAD.z);

  // ----------------------------------------------------------- pilot area
  const px = PILOT.x;
  const pz = PILOT.z;
  const py = terrainHeight(px, pz);
  for (const sx of [-1.5, 1.5]) {
    for (const sz of [-1.5, 1.5]) {
      batch.box(white, new Vector3(px + sx, py + 1.05, pz + sz), new Vector3(0.05, 2.1, 0.05), 'metal');
    }
  }
  const roof = new ConeGeometry(2.13, 0.75, 4, 1, true);
  roof.rotateY(Math.PI / 4);
  batch.place(canopy, roof, new Vector3(px, py + 2.47, pz));
  world.addBox(new Vector3(px, py + 2.4, pz), new Vector3(1.55, 0.35, 1.55), 'fabric');
  for (const [dx, dz, w, d] of [
    [0, -1.5, 3.02, 0.02],
    [0, 1.5, 3.02, 0.02],
    [-1.5, 0, 0.02, 3.02],
    [1.5, 0, 0.02, 3.02],
  ] as const) {
    batch.box(canopy, new Vector3(px + dx, py + 2.0, pz + dz), new Vector3(w, 0.22, d), null);
  }
  batch.box(tableMat, new Vector3(px, py + 0.74, pz - 0.4), new Vector3(1.8, 0.04, 0.75), 'wood');
  for (const sx of [-0.8, 0.8]) {
    for (const sz of [-0.7, -0.1]) batch.box(darkMetal, new Vector3(px + sx, py + 0.37, pz + sz), new Vector3(0.04, 0.74, 0.04), null);
  }
  batch.box(caseMat, new Vector3(px - 0.4, py + 0.86, pz - 0.4), new Vector3(0.55, 0.2, 0.38), null);
  for (const sx of [-0.5, 0.5]) {
    batch.box(chairMat, new Vector3(px + sx, py + 0.45, pz + 0.35), new Vector3(0.48, 0.05, 0.45), 'fabric');
    batch.box(chairMat, new Vector3(px + sx, py + 0.72, pz + 0.58), new Vector3(0.48, 0.5, 0.05), null);
  }

  // Safety net between the pilots and the course.
  const netTex = document.createElement('canvas');
  netTex.width = netTex.height = 64;
  const nctx = netTex.getContext('2d')!;
  nctx.strokeStyle = '#111827';
  nctx.lineWidth = 3;
  nctx.strokeRect(0, 0, 64, 64);
  const net = new CanvasTexture(netTex);
  net.wrapS = net.wrapT = RepeatWrapping;
  net.repeat.set(40, 12);
  const netMat = new MeshStandardMaterial({ map: net, transparent: true, alphaTest: 0.3, side: DoubleSide, roughness: 1 });
  const netZ = pz - 3.2;
  const netGeo = new PlaneGeometry(11, 3);
  batch.place(netMat, netGeo, new Vector3(px + 1, terrainHeight(px, netZ) + 1.5, netZ));
  world.addBox(new Vector3(px + 1, terrainHeight(px, netZ) + 1.5, netZ), new Vector3(5.5, 1.5, 0.05), 'net');
  for (let i = 0; i <= 4; i++) {
    const x = px + 1 - 5.5 + i * 2.75;
    batch.box(darkMetal, new Vector3(x, terrainHeight(x, netZ) + 1.55, netZ), new Vector3(0.06, 3.1, 0.06), 'metal');
  }

  // Banner facing the course.
  const bannerMat = new MeshStandardMaterial({ map: bannerTexture('FPV SIM', 'TRAINING FIELD · حقل التدريب'), roughness: 0.6, side: DoubleSide });
  const bannerGeo = new PlaneGeometry(6, 1.5);
  const bx = 9;
  const bz = 24;
  // Faces north, towards the course (a plane faces +Z by default).
  batch.place(bannerMat, bannerGeo, new Vector3(bx, terrainHeight(bx, bz) + 2.2, bz), new Quaternion().setFromAxisAngle(up, Math.PI));
  for (const s of [-3.05, 3.05]) batch.box(darkMetal, new Vector3(bx + s, terrainHeight(bx + s, bz) + 1.5, bz), new Vector3(0.08, 3, 0.08), 'metal');
  world.addBox(new Vector3(bx, terrainHeight(bx, bz) + 2.2, bz), new Vector3(3, 0.75, 0.05), 'fabric');

  // ------------------------------------------------------------- hay bales
  const rng = createRng(33);
  const bales: Array<[number, number]> = [
    [-30, -20],
    [-26, -24],
    [70, -40],
    [74, -44],
    [32, 8],
    [128, -48],
    [-70, -10],
    [60, 60],
  ];
  const lie = new Quaternion();
  for (const [x, z] of bales) {
    const y = terrainHeight(x, z);
    const r = 0.72;
    const yaw = rng() * Math.PI;
    lie.setFromAxisAngle(new Vector3(Math.cos(yaw), 0, Math.sin(yaw)), Math.PI / 2);
    batch.place(hay, new CylinderGeometry(r, r, 1.2, 18), new Vector3(x, y + r, z), lie);
    const axis = new Vector3(0, 0.6, 0).applyQuaternion(lie);
    world.addCapsule(new Vector3(x, y + r, z).sub(axis), new Vector3(x, y + r, z).add(axis), r, 'fabric');
  }

  batch.build(scene);

  // ----------------------------------------------------------- feather flags
  const flagShape = new Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.9, 0.3);
  flagShape.quadraticCurveTo(1.05, 2.2, 0.35, 3.1);
  flagShape.lineTo(0, 3.25);
  flagShape.lineTo(0, 0);
  const flagGeo = new ShapeGeometry(flagShape, 12);
  const flagPos = flagGeo.attributes.position as BufferAttribute;
  const local = new Float32Array(flagPos.count * 2);
  for (let i = 0; i < flagPos.count; i++) {
    local[i * 2] = flagPos.getX(i);
    local[i * 2 + 1] = flagPos.getY(i);
  }
  flagGeo.setAttribute('aLocal', new BufferAttribute(local, 2));
  const flagMaterials = ['#f97316', '#22d3ee', '#f43f5e', '#a3e635'].map(flagMaterial);
  const flagSpots: Array<[number, number]> = [
    [-14, -8],
    [14, -30],
    [66, -98],
    [124, -40],
    [104, 38],
    [-44, 56],
    [-126, -30],
    [-80, -78],
  ];
  const flagBatch = new Batch(world);
  flagSpots.forEach(([x, z], i) => {
    const y = terrainHeight(x, z);
    flagBatch.place(darkMetal, new CylinderGeometry(0.025, 0.035, 4.4, 8), new Vector3(x, y + 2.2, z));
    world.addCapsule(new Vector3(x, y, z), new Vector3(x, y + 4.4, z), 0.05, 'metal');
    const g = flagGeo.clone();
    flagBatch.place(flagMaterials[i % flagMaterials.length], g, new Vector3(x + 0.03, y + 1.05, z), new Quaternion().setFromAxisAngle(up, rng() * Math.PI * 2));
  });
  flagBatch.build(scene);

  // -------------------------------------------------------------- windsock
  const windsock = new Group();
  const wx = -20;
  const wz = 32;
  const wy = terrainHeight(wx, wz);
  const pole = new Mesh(new CylinderGeometry(0.04, 0.06, 5, 8), darkMetal);
  pole.position.set(wx, wy + 2.5, wz);
  pole.castShadow = true;
  scene.add(pole);
  world.addCapsule(new Vector3(wx, wy, wz), new Vector3(wx, wy + 5, wz), 0.07, 'metal');
  const sockGeo = new CylinderGeometry(0.1, 0.28, 1.6, 16, 5, true);
  sockGeo.rotateZ(Math.PI / 2);
  sockGeo.translate(0.8, 0, 0);
  // Red/white bands.
  const colors = new Float32Array(sockGeo.attributes.position.count * 3);
  const pos = sockGeo.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const band = Math.floor((pos.getX(i) / 1.6) * 5 + 0.001) % 2 === 0;
    colors[i * 3] = 0.95;
    colors[i * 3 + 1] = band ? 0.25 : 0.95;
    colors[i * 3 + 2] = band ? 0.12 : 0.95;
  }
  sockGeo.setAttribute('color', new BufferAttribute(colors, 3));
  const sock = new Mesh(sockGeo, new MeshStandardMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.8 }));
  sock.castShadow = true;
  windsock.add(sock);
  windsock.position.set(wx, wy + 4.85, wz);
  scene.add(windsock);

  return { windsock, pads };
}
