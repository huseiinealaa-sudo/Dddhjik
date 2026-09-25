import {
  BufferAttribute,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  MeshStandardMaterial,
  RGBAFormat,
  Vector3,
  type Scene,
} from 'three';
import { createRng, smoothstep } from '../../sim/math';
import { fbm } from '../../sim/noise';
import { LAKE, terrainHeight, YARD } from '../../sim/world';
import type { Quality } from '../environment';
import { worldClock } from '../materials';

/**
 * GPU grass. A fixed pool of blade clumps is wrapped around the camera by the
 * vertex shader (toroidally, so clumps stay put in the world as you fly), and
 * each clump reads the terrain height and a grass density from a baked
 * half-float texture. No per-frame CPU work at all.
 */

const MAP_SIZE = 512;
const MAP_EXTENT = 420; // metres from the centre covered by the height map
const TILE = 52; // metres of grass carried around the camera

const COUNT: Record<Quality, number> = { low: 0, medium: 5200, high: 10500 };

function bakeHeightMap(blocked: (x: number, z: number) => boolean): DataTexture {
  const data = new Uint16Array(MAP_SIZE * MAP_SIZE * 4);
  for (let j = 0; j < MAP_SIZE; j++) {
    for (let i = 0; i < MAP_SIZE; i++) {
      const x = -MAP_EXTENT + ((i + 0.5) / MAP_SIZE) * 2 * MAP_EXTENT;
      const z = -MAP_EXTENT + ((j + 0.5) / MAP_SIZE) * 2 * MAP_EXTENT;
      const h = terrainHeight(x, z);
      let density = 1;
      const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.radius;
      if (lakeD < 1.4) density *= smoothstep(1.15, 1.4, lakeD);
      const yardD = Math.max(Math.abs(x - YARD.x) - YARD.halfX, Math.abs(z - YARD.z) - YARD.halfZ);
      if (yardD < 16) density *= smoothstep(4, 16, yardD);
      density *= 0.55 + 0.45 * smoothstep(0.25, 0.55, fbm(x * 0.03, z * 0.03, 2, 901));
      density *= 1 - smoothstep(40, 60, h);
      if (blocked(x, z)) density = 0;
      const k = (j * MAP_SIZE + i) * 4;
      data[k] = DataUtils.toHalfFloat(h);
      data[k + 1] = DataUtils.toHalfFloat(density);
      data[k + 2] = 0;
      data[k + 3] = DataUtils.toHalfFloat(1);
    }
  }
  const tex = new DataTexture(data, MAP_SIZE, MAP_SIZE, RGBAFormat, HalfFloatType);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** One clump: five tapered, slightly curved blades. */
function clumpGeometry(): { position: Float32Array; color: Float32Array; normal: Float32Array; index: number[] } {
  const rng = createRng(606);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const index: number[] = [];
  // Linear-space albedo (vertex colours are not sRGB-decoded).
  const base = new Color(0.018, 0.04, 0.008);
  const tip = new Color(0.12, 0.2, 0.035);
  const c = new Color();
  for (let b = 0; b < 5; b++) {
    const ox = (rng() - 0.5) * 0.18;
    const oz = (rng() - 0.5) * 0.18;
    const rot = rng() * Math.PI;
    const h = 0.2 + rng() * 0.2;
    const w = 0.022 + rng() * 0.01;
    const lean = (rng() - 0.5) * 0.12;
    const dx = Math.cos(rot);
    const dz = Math.sin(rot);
    const start = pos.length / 3;
    const rows: Array<[number, number]> = [
      [0, 1],
      [0.4, 0.85],
      [0.75, 0.5],
    ];
    for (const [t, wf] of rows) {
      const bendX = lean * t * t;
      for (const s of [-1, 1]) {
        pos.push(ox + dx * w * wf * s + bendX, t * h, oz + dz * w * wf * s);
        c.copy(base).lerp(tip, t);
        col.push(c.r, c.g, c.b);
        nor.push(-dz * 0.4, 0.9, dx * 0.4);
      }
    }
    pos.push(ox + lean, h, oz);
    col.push(tip.r, tip.g, tip.b);
    nor.push(0, 1, 0);
    // rows: 0-1, 2-3, 4-5, tip 6
    const i0 = start;
    index.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    index.push(i0 + 2, i0 + 3, i0 + 4, i0 + 3, i0 + 5, i0 + 4);
    index.push(i0 + 4, i0 + 5, i0 + 6);
  }
  return { position: new Float32Array(pos), color: new Float32Array(col), normal: new Float32Array(nor), index };
}

export class Grass {
  readonly mesh: Mesh | null = null;
  private readonly uniforms = {
    uCamera: { value: new Vector3() },
    uWind: { value: new Vector3(0.12, 0, 0.05) },
  };

  constructor(scene: Scene, quality: Quality, blocked: (x: number, z: number) => boolean) {
    const count = COUNT[quality];
    if (count === 0) return;
    const heightMap = bakeHeightMap(blocked);
    const clump = clumpGeometry();

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(clump.position, 3));
    geometry.setAttribute('normal', new BufferAttribute(clump.normal, 3));
    geometry.setAttribute('color', new BufferAttribute(clump.color, 3));
    geometry.setIndex(clump.index);

    const rng = createRng(4711);
    const offsets = new Float32Array(count * 2);
    const rand = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      offsets[i * 2] = rng() * TILE;
      offsets[i * 2 + 1] = rng() * TILE;
      rand[i * 4] = rng() * Math.PI * 2; // rotation
      rand[i * 4 + 1] = 0.75 + rng() * 0.7; // scale
      rand[i * 4 + 2] = rng(); // tint
      rand[i * 4 + 3] = rng(); // density threshold
    }
    geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 2));
    geometry.setAttribute('aRand', new InstancedBufferAttribute(rand, 4));
    geometry.instanceCount = count;

    const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = worldClock;
      shader.uniforms.uCamera = this.uniforms.uCamera;
      shader.uniforms.uWind = this.uniforms.uWind;
      shader.uniforms.tHeight = { value: heightMap };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec2 aOffset;
          attribute vec4 aRand;
          uniform float uTime;
          uniform vec3 uCamera;
          uniform vec3 uWind;
          uniform sampler2D tHeight;
          varying float vGrassTint;`,
        )
        .replace(
          '#include <begin_vertex>',
          `
          const float G_TILE = ${TILE.toFixed(1)};
          const float G_EXTENT = ${MAP_EXTENT.toFixed(1)};
          vec2 rootXZ = uCamera.xz + mod(aOffset - uCamera.xz + G_TILE * 0.5, G_TILE) - G_TILE * 0.5;
          vec2 gHuv = (rootXZ + G_EXTENT) / (2.0 * G_EXTENT);
          vec4 gHs = texture2D(tHeight, gHuv);
          float gInside = step(0.0, gHuv.x) * step(gHuv.x, 1.0) * step(0.0, gHuv.y) * step(gHuv.y, 1.0);
          float gDist = length(rootXZ - uCamera.xz);
          float gFade = 1.0 - smoothstep(G_TILE * 0.28, G_TILE * 0.48, gDist);
          float gKeep = step(aRand.w, gHs.g) * gInside;
          float gScale = aRand.y * gKeep * mix(0.15, 1.0, gFade);
          float gCos = cos(aRand.x);
          float gSin = sin(aRand.x);
          vec3 gP = vec3(position.x * gCos - position.z * gSin, position.y, position.x * gSin + position.z * gCos) * gScale;
          float gH = position.y / 0.4;
          float gGust = 0.6 + 0.4 * sin(uTime * 2.1 + rootXZ.x * 0.31 + rootXZ.y * 0.23);
          gP.xz += uWind.xz * gGust * gH * gH * gScale * 2.0;
          vec3 transformed = vec3(rootXZ.x + gP.x, gHs.r + gP.y - 0.02, rootXZ.y + gP.z);
          vGrassTint = aRand.z;
          `,
        )
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normal, 0.35));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vGrassTint;`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= mix(vec3(0.85, 0.95, 0.8), vec3(1.25, 1.12, 0.78), vGrassTint);`,
        );
    };
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    scene.add(mesh);
    (this as { mesh: Mesh | null }).mesh = mesh;
  }

  update(camera: Vector3, groundHeight: number, wind: Vector3): void {
    if (!this.mesh) return;
    this.uniforms.uCamera.value.copy(camera);
    this.uniforms.uWind.value.set(wind.x * 0.02 + 0.05, 0, wind.z * 0.02 + 0.03);
    // Grass is invisible from altitude anyway; stop paying for it.
    this.mesh.visible = camera.y - groundHeight < 30 && Math.hypot(camera.x, camera.z) < MAP_EXTENT;
  }
}

