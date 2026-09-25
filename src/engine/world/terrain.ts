import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
  type Texture,
} from 'three';
import type { Quality } from '../environment';
import { clamp01, smoothstep } from '../../sim/math';
import { fbm } from '../../sim/noise';
import { LAKE, terrainHeight, WORLD, YARD } from '../../sim/world';

const RINGS: Record<Quality, [number, number]> = { low: [96, 192], medium: [140, 256], high: [180, 360] };

/**
 * A polar grid: rings are packed tightly around the middle of the map (where
 * people fly low and fast) and spread out towards the mountains.
 */
function polarGrid(innerRadius: number, outerRadius: number, rings: number, segments: number, power: number): BufferGeometry {
  const verts = (rings + 1) * segments;
  const pos = new Float32Array(verts * 3);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = innerRadius + (outerRadius - innerRadius) * Math.pow(t, power);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const k = (i * segments + j) * 3;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      pos[k] = x;
      pos[k + 1] = terrainHeight(x, z);
      pos[k + 2] = z;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = (i + 1) * segments + j;
      const d = (i + 1) * segments + ((j + 1) % segments);
      // Counter-clockwise seen from above, so the faces point up.
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Per-vertex material weights: dirt/sand, rock, snow and dryness. */
function computeSplat(g: BufferGeometry): void {
  const pos = g.attributes.position as BufferAttribute;
  const nor = g.attributes.normal as BufferAttribute;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const h = pos.getY(i);
    const z = pos.getZ(i);
    const slope = 1 - nor.getY(i);

    const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z) / LAKE.radius;
    const shore = lakeD < 1.55 ? smoothstep(WORLD.waterLevel + 1.6, WORLD.waterLevel + 0.4, h) : 0;
    const patches = smoothstep(0.35, 0.6, fbm(x * 0.02, z * 0.02, 3, 301)) * 0.55;
    // Worn ground around the industrial yard.
    const yardEdge = 1 - smoothstep(0, 14, Math.max(Math.abs(x - YARD.x) - YARD.halfX, Math.abs(z - YARD.z) - YARD.halfZ));
    let dirt = clamp01(Math.max(shore, patches * (1 - smoothstep(120, 260, Math.hypot(x, z))), yardEdge * 0.9));
    let rock = clamp01(smoothstep(0.16, 0.36, slope) + smoothstep(58, 80, h) * 0.55);
    let snow = clamp01(smoothstep(84, 104, h) * (1 - smoothstep(0.3, 0.55, slope) * 0.75));
    const total = dirt + rock + snow;
    if (total > 1) {
      dirt /= total;
      rock /= total;
      snow /= total;
    }
    const dry = clamp01(fbm(x * 0.006 + 40, z * 0.006, 3, 311) * 0.9 + 0.35 + smoothstep(20, 60, h) * 0.3);
    splat[i * 4] = dirt;
    splat[i * 4 + 1] = rock;
    splat[i * 4 + 2] = snow;
    splat[i * 4 + 3] = dry;
  }
  g.setAttribute('splat', new BufferAttribute(splat, 4));
}

export interface TerrainTextures {
  grass: Texture;
  dirt: Texture;
  rock: Texture;
}

function terrainMaterial(tex: TerrainTextures): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: new Color(1, 1, 1), roughness: 0.94, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: tex.grass };
    shader.uniforms.tDirt = { value: tex.dirt };
    shader.uniforms.tRock = { value: tex.rock };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 splat;
        varying vec4 vSplat;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = splat;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tGrass;
        uniform sampler2D tDirt;
        uniform sampler2D tRock;
        varying vec4 vSplat;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 wp = vWorldPos.xz;
        // Two scales plus a very low-frequency variation hide any tiling.
        vec3 g1 = texture2D(tGrass, wp * 0.19).rgb;
        vec3 g2 = texture2D(tGrass, wp * 0.037 + 0.31).rgb;
        float macro = texture2D(tGrass, wp * 0.0027).g * 2.2;
        vec3 grass = mix(g1, g2, 0.42);
        vec3 dryGrass = grass * vec3(1.38, 1.22, 0.78);
        grass = mix(grass, dryGrass, clamp(vSplat.w - 0.35, 0.0, 1.0));
        grass *= 0.78 + 0.34 * macro;

        vec3 dirt = mix(texture2D(tDirt, wp * 0.16).rgb, texture2D(tDirt, wp * 0.041).rgb, 0.4);

        // Rock: tri-planar so cliffs do not smear.
        vec3 bn = abs(normalize(vWorldNormal));
        bn /= (bn.x + bn.y + bn.z);
        vec3 rock = texture2D(tRock, vWorldPos.zy * 0.09).rgb * bn.x
                  + texture2D(tRock, vWorldPos.xz * 0.09).rgb * bn.y
                  + texture2D(tRock, vWorldPos.xy * 0.09).rgb * bn.z;

        vec3 snow = vec3(0.86, 0.9, 0.95);
        float wGrass = clamp(1.0 - vSplat.x - vSplat.y - vSplat.z, 0.0, 1.0);
        vec3 ground = grass * wGrass + dirt * vSplat.x + rock * vSplat.y + snow * vSplat.z;
        diffuseColor.rgb *= ground;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness - vSplat.z * 0.35;`,
      );
  };
  return mat;
}

export function buildTerrain(quality: Quality, tex: TerrainTextures): { terrain: Mesh; skirt: Mesh } {
  const [rings, segments] = RINGS[quality];
  const geometry = polarGrid(0, WORLD.half, rings, segments, 1.65);
  computeSplat(geometry);
  const material = terrainMaterial(tex);
  const terrain = new Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.name = 'terrain';

  // Coarse skirt out to the horizon so the map never visibly ends.
  const skirtGeo = polarGrid(WORLD.half - 2, 4200, 26, 128, 1.4);
  computeSplat(skirtGeo);
  const skirt = new Mesh(skirtGeo, material);
  skirt.name = 'terrain-skirt';
  return { terrain, skirt };
}

/** A flat disc used as the lake surface. */
export function lakeGeometry(): BufferGeometry {
  const g = new CircleGeometry(LAKE.radius * 1.35, 96);
  g.rotateX(-Math.PI / 2);
  g.translate(LAKE.x, WORLD.waterLevel, LAKE.z);
  return g;
}
