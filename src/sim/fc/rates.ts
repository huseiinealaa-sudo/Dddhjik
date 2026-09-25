import { clampUnit } from '../math';
import type { AxisRate, RatesProfile } from '../types';

/** Betaflight clamps every axis to this rate. */
export const RATE_LIMIT = 1998;
const RC_RATE_INCREMENTAL = 14.54;

/**
 * Betaflight's classic curve (applyBetaflightRates in rc.c).
 * center = RC Rate, max = Super Rate.
 */
export function betaflightRate(stick: number, r: AxisRate): number {
  let rc = clampUnit(stick);
  const abs = Math.abs(rc);
  if (r.expo > 0) {
    const e = Math.min(r.expo, 1);
    rc = rc * abs * abs * abs * e + rc * (1 - e);
  }
  let rcRate = r.center;
  if (rcRate > 2) rcRate += RC_RATE_INCREMENTAL * (rcRate - 2);
  let rate = 200 * rcRate * rc;
  if (r.max > 0) {
    // Note: the super-factor uses the raw stick, not the expo-shaped value.
    const factor = 1 / Math.min(Math.max(1 - abs * r.max, 0.01), 1);
    rate *= factor;
  }
  return rate;
}

/**
 * "Actual" rates, the Betaflight default since 4.3 (applyActualRates).
 * center = centre sensitivity (deg/s), max = rate at full stick (deg/s).
 */
export function actualRate(stick: number, r: AxisRate): number {
  const rc = clampUnit(stick);
  const abs = Math.abs(rc);
  const e = Math.min(Math.max(r.expo, 0), 1);
  const rc5 = rc * rc * rc * rc * rc;
  const expof = abs * (rc5 * e + rc * (1 - e));
  const stickMovement = Math.max(0, r.max - r.center);
  return rc * r.center + stickMovement * expof;
}

export function rateFor(profile: RatesProfile, axis: 'roll' | 'pitch' | 'yaw', stick: number): number {
  const r = profile[axis];
  const rate = profile.type === 'actual' ? actualRate(stick, r) : betaflightRate(stick, r);
  return Math.max(-RATE_LIMIT, Math.min(RATE_LIMIT, rate));
}

export function maxRate(profile: RatesProfile, axis: 'roll' | 'pitch' | 'yaw'): number {
  return Math.abs(rateFor(profile, axis, 1));
}
