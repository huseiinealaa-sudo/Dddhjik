import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  InstancedMesh,

  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Scene,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../../sim/collision';
import { createRng, smoothstep } from '../../sim/math';
import { fbm, valueNoise } from '../../sim/noise';
import { FIELD, LAKE, terrainHeight, terrainNormal, WORLD } from '../../sim/world';
import type { Quality } from '../environment';
import { worldClock } from '../materials';

type Rgb = [number, number, number];

/** Paint a geometry with a vertex colour, darkened towards its base (cheap AO). */
function colorize(g: BufferGeometry, base: Rgb, aoBottom: number, aoTop: number, jitter = 0, seed = 1): BufferGeometry {
  const pos = g.attributes.position as BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / Math.max(maxY - minY, 1e-4);
    const ao = aoBottom + (aoTop - aoBottom) * t;
    const n = jitter > 0 ? 1 + (valueNoise(pos.getX(i) * 3.1, pos.getZ(i) * 3.1 + pos.getY(i), seed) * jitter) : 1;
    // Palette values are authored in sRGB; vertex colours must be linear.
    c.setRGB(base[0] * ao * n, base[1] * ao * n, base[2] * ao * n, SRGBColorSpace);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** Push vertices around with noise so primitives stop looking like primitives. */
function jitter(g: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = g.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(
      i,
      x + valueNoise(x * 1.7 + y, z * 1.7, seed) * amount,
      y + valueNoise(y * 1.9, x * 1.3 + z, seed + 1) * amount * 0.6,
      z + valueNoise(z * 1.7 + x, y * 1.7, seed + 2) * amount,
    );
  }
  g.computeVertexNormals();
  return g;
}

function prepare(g: BufferGeometry): BufferGeometry {
  // mergeGeometries needs identical attribute sets.
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.attributes.uv) out.setAttribute('uv', new BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}

function pineGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.13, 0.24, 2.4, 7);
  trunk.translate(0, 1.2, 0);
  parts.push(prepare(colorize(trunk, [0.24, 0.16, 0.1], 0.7, 1)));
  const tiers = 4;
  for (let k = 0; k < tiers; k++) {
    const r = 2.1 - k * 0.42;
    const cone = new ConeGeometry(r, 2.9 - k * 0.25, 9, 2);
    cone.translate(0, 2.4 + k * 1.45, 0);
    jitter(cone, 0.18, 10 + k);
    parts.push(prepare(colorize(cone, [0.1, 0.22, 0.09], 0.45 + k * 0.08, 1.05, 0.25, 20 + k)));
  }
  return mergeGeometries(parts)!;
}

function broadleafGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.18, 0.32, 3.4, 7);
  trunk.translate(0, 1.7, 0);
  parts.push(prepare(colorize(trunk, [0.28, 0.2, 0.13], 0.65, 1)));
  const blobs: Array<[number, number, number, number]> = [
    [0, 4.6, 0, 2.5],
    [1.1, 4.0, 0.6, 1.8],
    [-1.0, 4.2, -0.5, 1.9],
    [0.2, 5.6, -0.3, 1.7],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    const b = new IcosahedronGeometry(r, 1);
    jitter(b, r * 0.18, 40 + i);
    b.translate(x, y, z);
    parts.push(prepare(colorize(b, [0.2, 0.34, 0.12], 0.5, 1.1, 0.3, 50 + i)));
  });
  return mergeGeometries(parts)!;
}

function bushGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const a = new IcosahedronGeometry(0.9, 1);
  jitter(a, 0.18, 60);
  a.translate(0, 0.55, 0);
  parts.push(prepare(colorize(a, [0.2, 0.31, 0.12], 0.5, 1.05, 0.3, 61)));
  const b = new IcosahedronGeometry(0.65, 1);
  jitter(b, 0.14, 62);
  b.translate(0.6, 0.4, 0.3);
  parts.push(prepare(colorize(b, [0.24, 0.34, 0.13], 0.5, 1.05, 0.3, 63)));
  return mergeGeometries(parts)!;
}

function rockGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  jitter(g, 0.32, 70);
  g.scale(1, 0.62, 1.1);
  return prepare(colorize(g, [0.46, 0.45, 0.42], 0.55, 1.05, 0.35, 71));
}

/** Vertex-shader sway for foliage, phase-shifted per instance. */
function swayMaterial(amount: number, flat = false): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: flat });
  if (amount > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldClock;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 root = instanceMatrix[3].xyz;
          #else
            vec3 root = vec3(0.0);
          #endif
          float bend = max(position.y - 2.0, 0.0);
          bend *= bend * ${amount.toFixed(4)};
          float ph = root.x * 0.13 + root.z * 0.17;
          transformed.x += bend * (sin(uTime * 1.3 + ph) + 0.4 * sin(uTime * 3.1 + ph * 2.0));
          transformed.z += bend * 0.6 * sin(uTime * 1.1 + ph * 1.3);`,
        );
    };
    mat.customProgramCacheKey = () => `sway-${amount}-${flat}`;
  }
  return mat;
}

export interface VegetationOptions {
  quality: Quality;
  /** Return true where nothing should be planted (tracks, props, buildings). */
  blocked: (x: number, z: number, radius: number) => boolean;
}

interface Placement {
  x: number;
  z: number;
  scale: number;
  rot: number;
  tint: number;
}

const COUNTS: Record<Quality, { trees: number; bushes: number; rocks: number }> = {
  low: { trees: 420, bushes: 120, rocks: 90 },
  medium: { trees: 700, bushes: 220, rocks: 140 },
  high: { trees: 1000, bushes: 320, rocks: 190 },
};

export function buildVegetation(scene: Scene, world: CollisionWorld, opts: VegetationOptions): void {
  const rng = createRng(20240917);
  const counts = COUNTS[opts.quality];
  const normal = new Vector3();

  const fieldGap = (x: number, z: number): boolean => {
    const a = Math.atan2(z, x);
    const toYard = Math.abs(Math.atan2(Math.sin(a - -0.15), Math.cos(a - -0.15))) < 0.34;
    const toLake = Math.abs(Math.atan2(Math.sin(a - 2.46), Math.cos(a - 2.46))) < 0.3;
    return toYard || toLake;
  };

  const ok = (x: number, z: number, r: number): boolean => {
    const d = Math.hypot(x - FIELD.x, z - FIELD.z);
    if (d < 150) return false;
    if (d > WORLD.playRadius + 60) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.12) return false;
    const h = terrainHeight(x, z);
    if (h > 74 || h < WORLD.waterLevel + 0.5) return false;
    terrainNormal(x, z, normal);
    if (normal.y < 0.82) return false;
    return !opts.blocked(x, z, r);
  };

  const pines: Placement[] = [];
  const broadleaf: Placement[] = [];
  const add = (x: number, z: number, conifer: boolean, scale: number): void => {
    (conifer ? pines : broadleaf).push({ x, z, scale, rot: rng() * Math.PI * 2, tint: rng() });
  };

  // 1) A tree line framing the meadow, with gaps towards the yard and the lake.
  let guard = 0;
  while (pines.length + broadleaf.length < counts.trees * 0.22 && guard++ < 20000) {
    const a = rng() * Math.PI * 2;
    const r = 168 + rng() * 70;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (fieldGap(x, z) || !ok(x, z, 3)) continue;
    add(x, z, rng() < 0.45, 0.85 + rng() * 0.5);
  }

  // 2) Clustered forest on the hills.
  guard = 0;
  while (pines.length + broadleaf.length < counts.trees && guard++ < 60000) {
    const a = rng() * Math.PI * 2;
    const r = 240 + Math.sqrt(rng()) * 420;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const density = smoothstep(0.1, 0.45, fbm(x * 0.008, z * 0.008, 3, 777));
    if (rng() > density || !ok(x, z, 3)) continue;
    const h = terrainHeight(x, z);
    add(x, z, rng() < 0.4 + h * 0.008, 0.8 + rng() * 0.6);
  }

  // 3) Trees along the lake shore.
  for (let i = 0; i < 36; i++) {
    const a = rng() * Math.PI * 2;
    const r = LAKE.radius * (1.2 + rng() * 0.45);
    const x = LAKE.x + Math.cos(a) * r;
    const z = LAKE.z + Math.sin(a) * r;
    if (!opts.blocked(x, z, 3) && terrainHeight(x, z) > WORLD.waterLevel + 0.4) add(x, z, false, 0.9 + rng() * 0.4);
  }

  const bushes: Placement[] = [];
  guard = 0;
  while (bushes.length < counts.bushes && guard++ < 20000) {
    const a = rng() * Math.PI * 2;
    const r = 158 + rng() * 380;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (!ok(x, z, 1.5)) continue;
    bushes.push({ x, z, scale: 0.7 + rng() * 0.8, rot: rng() * Math.PI * 2, tint: rng() });
  }

  const rocks: Placement[] = [];
  guard = 0;
  while (rocks.length < counts.rocks && guard++ < 20000) {
    const a = rng() * Math.PI * 2;
    const r = 175 + rng() * 460;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.1 || opts.blocked(x, z, 2)) continue;
    if (terrainHeight(x, z) > 95) continue;
    rocks.push({ x, z, scale: 0.4 + rng() * rng() * 2.6, rot: rng() * Math.PI * 2, tint: rng() });
  }

  const tmp = new Object3D();
  const color = new Color();
  const up = new Vector3(0, 1, 0);

  const instance = (
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    list: Placement[],
    tints: [Rgb, Rgb],
    onPlace: (p: Placement, y: number) => void,
    tilt = false,
  ): void => {
    if (list.length === 0) return;
    const mesh = new InstancedMesh(geometry, material, list.length);
    list.forEach((p, i) => {
      const y = terrainHeight(p.x, p.z);
      tmp.position.set(p.x, y - 0.15 * p.scale, p.z);
      tmp.quaternion.setFromAxisAngle(up, p.rot);
      if (tilt) {
        terrainNormal(p.x, p.z, normal);
        tmp.quaternion.premultiply(new Quaternion().setFromUnitVectors(up, normal));
      }
      tmp.scale.setScalar(p.scale);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      const [a, b] = tints;
      color.setRGB(a[0] + (b[0] - a[0]) * p.tint, a[1] + (b[1] - a[1]) * p.tint, a[2] + (b[2] - a[2]) * p.tint, SRGBColorSpace);
      mesh.setColorAt(i, color);
      onPlace(p, y);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  };

  const a = new Vector3();
  const b = new Vector3();
  const treeCollider = (trunkTop: number, crownY: number, crownR: number) => (p: Placement, y: number) => {
    a.set(p.x, y, p.z);
    b.set(p.x, y + trunkTop * p.scale, p.z);
    world.addCapsule(a, b, 0.28 * p.scale, 'wood');
    world.addSphere(a.set(p.x, y + crownY * p.scale, p.z), crownR * p.scale, 'foliage');
  };

  instance(pineGeometry(), swayMaterial(0.0045), pines, [[0.85, 0.95, 0.85], [1.15, 1.08, 0.9]], treeCollider(3.2, 4.4, 1.55));
  instance(broadleafGeometry(), swayMaterial(0.006), broadleaf, [[0.9, 1.0, 0.85], [1.25, 1.1, 0.75]], treeCollider(3.6, 4.7, 2.3));
  instance(bushGeometry(), swayMaterial(0.08), bushes, [[0.85, 0.95, 0.85], [1.2, 1.1, 0.8]], (p, y) => {
    world.addSphere(a.set(p.x, y + 0.5 * p.scale, p.z), 0.85 * p.scale, 'foliage');
  });
  instance(rockGeometry(), swayMaterial(0, true), rocks, [[0.85, 0.85, 0.85], [1.15, 1.1, 1.0]], (p, y) => {
    world.addSphere(a.set(p.x, y + 0.2 * p.scale, p.z), 0.95 * p.scale, 'concrete');
  }, true);
}

