import { MIX_PITCH, MIX_ROLL, MIX_YAW } from '../layout';

/**
 * Betaflight Quad-X mixer with AIR MODE.
 *
 * The differential (PID) part is computed first. If it does not fit into the
 * 0..1 range it is scaled down as a whole, which keeps the ratio between
 * motors — and therefore the direction of rotation — intact. With AIR MODE
 * the collective throttle is shifted instead of clipping, which is what lets
 * a real quad keep full control at zero throttle.
 *
 * Writes 0..1 motor outputs (before idle) into `out`. Returns true when the
 * mixer saturated.
 */
export function mixQuadX(
  throttle: number,
  roll: number,
  pitch: number,
  yaw: number,
  airmode: boolean,
  out: Float64Array,
): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 4; i++) {
    const m = roll * MIX_ROLL[i] + pitch * MIX_PITCH[i] + yaw * MIX_YAW[i];
    out[i] = m;
    if (m < lo) lo = m;
    if (m > hi) hi = m;
  }

  const range = hi - lo;
  let t = throttle;
  let saturated = false;
  if (range > 1) {
    const scale = 1 / range;
    for (let i = 0; i < 4; i++) out[i] *= scale;
    lo *= scale;
    hi *= scale;
    t = airmode ? -lo : Math.min(Math.max(t, -lo), 1 - hi);
    saturated = true;
  } else if (airmode) {
    t = Math.min(Math.max(t, -lo), 1 - hi);
  }

  for (let i = 0; i < 4; i++) {
    const v = t + out[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return saturated;
}
