/**
 * Analytic height field.
 *
 * Both the rendered terrain mesh and the physics collision use this exact
 * function, which guarantees the drone can never sink into (or hover above)
 * the visible ground.
 *
 * The centre of the map is deliberately flat so the training course sits on
 * level ground; rolling hills start beyond `FLAT_RADIUS` and grow towards the
 * edges of the map to frame the arena.
 */

export const FLAT_RADIUS = 145;
const BLEND_RADIUS = 130;

function hills(x: number, z: number): number {
  return (
    9.5 * Math.sin(x * 0.0067) * Math.cos(z * 0.0059) +
    4.2 * Math.sin(x * 0.0153 + 1.7) * Math.cos(z * 0.0131 - 0.6) +
    1.9 * Math.sin(x * 0.0402 - 2.4) * Math.cos(z * 0.0357 + 1.1) +
    0.55 * Math.sin(x * 0.11 + 0.3) * Math.cos(z * 0.098 - 1.9)
  );
}

export function terrainHeight(x: number, z: number): number {
  const distance = Math.hypot(x, z);
  if (distance <= FLAT_RADIUS) return 0;

  // Smoothstep blend so there is no visible seam where the hills begin.
  const t = Math.min((distance - FLAT_RADIUS) / BLEND_RADIUS, 1);
  const blend = t * t * (3 - 2 * t);
  return hills(x, z) * blend;
}

/** Central-difference surface normal, written into `out` (a 3-tuple). */
export function terrainNormal(x: number, z: number, out: [number, number, number]): [number, number, number] {
  const e = 0.6;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  const nx = -dx / (2 * e);
  const nz = -dz / (2 * e);
  const len = Math.hypot(nx, 1, nz);
  out[0] = nx / len;
  out[1] = 1 / len;
  out[2] = nz / len;
  return out;
}
