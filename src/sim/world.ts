import type { Vector3 } from 'three';
import { smoothstep } from './math';
import { fbm, ridged } from './noise';

/**
 * World layout and the analytic height field.
 *
 * The rendered terrain mesh and the physics both sample `terrainHeight`, so
 * the aircraft can never sink into, or hover above, the ground you can see.
 */

export const WORLD = {
  /** The terrain mesh spans [-half, half] on both axes (metres). */
  half: 720,
  /** Soft boundary: the drone is gently pushed back beyond this radius. */
  playRadius: 620,
  ceiling: 450,
  waterLevel: -1.4,
} as const;

/** Meadow in the middle of the map: race circuits and training drills. */
export const FIELD = { x: 0, z: 0, radius: 175 } as const;

/** Industrial yard with the abandoned building ("bando") for freestyle. */
export const YARD = { x: 262, z: -40, halfX: 78, halfZ: 58, height: 0.3 } as const;

export const LAKE = { x: -220, z: 178, radius: 72, depth: 5.5 } as const;

/** Launch pad and the spot where a line-of-sight pilot stands. */
export const PAD = { x: 0, z: 14 } as const;
export const PILOT = { x: -7, z: 24, eye: 1.7 } as const;

function sdRoundRect(px: number, pz: number, hx: number, hz: number, r: number): number {
  const qx = Math.abs(px) - hx + r;
  const qz = Math.abs(pz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
}

export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);

  // Rolling relief everywhere, with a ridged mountain ring towards the edge.
  const relief = fbm(x * 0.0038, z * 0.0038, 4, 11) * 16 + fbm(x * 0.014, z * 0.014, 3, 23) * 3.2;
  const ring = smoothstep(250, 660, r);
  const mountains = ring * ring * (38 + ridged(x * 0.0042, z * 0.0042, 4, 37) * 78);
  let h = relief * (0.25 + 0.75 * ring) + mountains;

  // Meadow: a gentle undulation, flat enough to race on.
  const meadow = fbm(x * 0.012, z * 0.012, 3, 5) * 1.05 + fbm(x * 0.05, z * 0.05, 2, 7) * 0.16;
  const fieldD = Math.hypot(x - FIELD.x, z - FIELD.z);
  const fieldMask = 1 - smoothstep(FIELD.radius * 0.72, FIELD.radius * 1.3, fieldD);
  h += (meadow - h) * fieldMask;

  // Industrial yard: compacted, perfectly flat ground.
  const yardD = sdRoundRect(x - YARD.x, z - YARD.z, YARD.halfX, YARD.halfZ, 6);
  const yardMask = 1 - smoothstep(0, 24, yardD);
  h += (YARD.height - h) * yardMask;

  // Lake basin with a shelving shore.
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (lakeD < LAKE.radius * 1.6) {
    const t = lakeD / LAKE.radius;
    const basin =
      WORLD.waterLevel - LAKE.depth * Math.max(0, 1 - t * t) + smoothstep(0.85, 1.45, t) * 3.2;
    const lakeMask = 1 - smoothstep(1.0, 1.6, t);
    h += (basin - h) * lakeMask;
  }

  return h;
}

/** Surface normal by central differences, written into `out`. */
export function terrainNormal(x: number, z: number, out: Vector3): Vector3 {
  const e = 0.5;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  out.set(-dx, 2 * e, -dz).normalize();
  return out;
}

/** True where the lake surface sits above the ground. */
export function isOverWater(x: number, z: number): boolean {
  const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
  return lakeD < LAKE.radius * 1.2 && terrainHeight(x, z) < WORLD.waterLevel;
}
