import { describe, expect, it } from 'vitest';
import { actualRate, betaflightRate, rateFor } from '../src/sim/fc/rates';

describe('Betaflight rates', () => {
  it('matches the well-known 1.0 / 0.70 / 0 figure of ~667 deg/s', () => {
    expect(betaflightRate(1, { center: 1, max: 0.7, expo: 0 })).toBeCloseTo(666.67, 1);
  });

  it('is 200 * RC rate with no super rate', () => {
    expect(betaflightRate(1, { center: 1, max: 0, expo: 0 })).toBeCloseTo(200, 6);
    expect(betaflightRate(0.5, { center: 1.2, max: 0, expo: 0 })).toBeCloseTo(120, 6);
  });

  it('expo softens the centre but not the end point', () => {
    const r = { center: 1, max: 0.7, expo: 0.5 };
    const linear = { ...r, expo: 0 };
    expect(Math.abs(betaflightRate(0.3, r))).toBeLessThan(Math.abs(betaflightRate(0.3, linear)));
    expect(betaflightRate(1, r)).toBeCloseTo(betaflightRate(1, linear), 6);
  });

  it('is odd-symmetric', () => {
    const r = { center: 1.1, max: 0.65, expo: 0.2 };
    for (const s of [0.1, 0.4, 0.8, 1]) expect(betaflightRate(-s, r)).toBeCloseTo(-betaflightRate(s, r), 9);
  });
});

describe('Actual rates', () => {
  it('reaches exactly the max rate at full stick', () => {
    expect(actualRate(1, { center: 70, max: 670, expo: 0 })).toBeCloseTo(670, 6);
    expect(actualRate(-1, { center: 200, max: 800, expo: 0.5 })).toBeCloseTo(-800, 6);
  });

  it('starts with the centre sensitivity slope', () => {
    const r = { center: 150, max: 700, expo: 0.6 };
    // For a tiny deflection the rate is ~ centre * stick.
    expect(actualRate(0.001, r) / 0.001).toBeCloseTo(150, 0);
  });

  it('increases monotonically', () => {
    const r = { center: 140, max: 670, expo: 0.4 };
    let last = -Infinity;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const v = actualRate(s, r);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('is clamped to Betaflight\'s 1998 deg/s limit', () => {
    const profile = { type: 'betaflight' as const, roll: { center: 2.55, max: 0.99, expo: 0 }, pitch: { center: 1, max: 0, expo: 0 }, yaw: { center: 1, max: 0, expo: 0 } };
    expect(rateFor(profile, 'roll', 1)).toBe(1998);
  });
});
