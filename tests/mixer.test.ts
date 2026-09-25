import { describe, expect, it } from 'vitest';
import { mixQuadX } from '../src/sim/fc/mixer';

// Motor order: 0 FL, 1 FR, 2 RL, 3 RR
describe('Quad-X mixer', () => {
  it('passes throttle straight through with no PID demand', () => {
    const out = new Float64Array(4);
    mixQuadX(0.4, 0, 0, 0, true, out);
    expect([...out]).toEqual([0.4, 0.4, 0.4, 0.4]);
  });

  it('rolls right by speeding up the left motors', () => {
    const out = new Float64Array(4);
    mixQuadX(0.5, 0.1, 0, 0, true, out);
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[2]).toBeGreaterThan(out[3]);
  });

  it('pitches forward by speeding up the rear motors', () => {
    const out = new Float64Array(4);
    mixQuadX(0.5, 0, 0.1, 0, true, out);
    expect(out[2]).toBeGreaterThan(out[0]);
    expect(out[3]).toBeGreaterThan(out[1]);
  });

  it('yaws right by speeding up front-right and rear-left', () => {
    const out = new Float64Array(4);
    mixQuadX(0.5, 0, 0, 0.1, true, out);
    expect(out[1]).toBeGreaterThan(out[0]);
    expect(out[2]).toBeGreaterThan(out[3]);
  });

  it('air mode keeps full differential authority at zero throttle', () => {
    const out = new Float64Array(4);
    mixQuadX(0, 0.2, 0, 0, true, out);
    expect(Math.min(...out)).toBeCloseTo(0, 9);
    expect(out[0] - out[1]).toBeCloseTo(0.4, 9);
  });

  it('without air mode the differential clips at zero throttle', () => {
    const out = new Float64Array(4);
    mixQuadX(0, 0.2, 0, 0, false, out);
    expect(out[1]).toBe(0);
    expect(out[0]).toBeCloseTo(0.2, 9);
  });

  it('scales an oversized demand down while keeping the ratios', () => {
    const out = new Float64Array(4);
    const saturated = mixQuadX(0.5, 0.6, 0.3, 0, true, out);
    expect(saturated).toBe(true);
    expect(Math.max(...out) - Math.min(...out)).toBeCloseTo(1, 9);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
