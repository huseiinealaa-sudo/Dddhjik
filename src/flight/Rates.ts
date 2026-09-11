import { clampUnit } from '../core/MathUtils';
import type { RateProfile, RatesConfig } from '../core/Types';

/**
 * Betaflight's stick-to-rate curve.
 *
 * The curve has three knobs:
 *  - `rcRate`   sets the overall gain (how fast full stick is),
 *  - `expo`     softens the centre so small corrections are precise,
 *  - `superRate` bends the end of the travel upwards for very fast flips.
 *
 * Returns the commanded body rate in degrees per second.
 */
export function stickToRate(stick: number, profile: RateProfile): number {
  const rc = clampUnit(stick);
  const expo = Math.min(Math.max(profile.expo, 0), 0.95);

  // RC expo — cubic blend, exactly like the flight controller.
  const shaped = rc * (Math.abs(rc) ** 3 * expo + (1 - expo));

  let rcRate = profile.rcRate;
  if (rcRate > 2.0) rcRate += 14.54 * (rcRate - 2.0);

  let rate = 200 * rcRate * shaped;

  const superRate = Math.min(Math.max(profile.superRate, 0), 0.99);
  if (superRate > 0) {
    const superFactor = 1 / Math.min(Math.max(1 - Math.abs(shaped) * superRate, 0.01), 1);
    rate *= superFactor;
  }

  return rate;
}

/** Maximum achievable rate for an axis — handy for the HUD rate gauges. */
export function maxRate(profile: RateProfile): number {
  return Math.abs(stickToRate(1, profile));
}

export interface RateSetpoint {
  roll: number;
  pitch: number;
  yaw: number;
}

export function computeRateSetpoint(
  roll: number,
  pitch: number,
  yaw: number,
  rates: RatesConfig,
  target: RateSetpoint,
): RateSetpoint {
  target.roll = stickToRate(roll, rates.roll);
  target.pitch = stickToRate(pitch, rates.pitch);
  target.yaw = stickToRate(yaw, rates.yaw);
  return target;
}
