import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { maxRate } from '../src/sim/fc/rates';
import { PRESET_ORDER, PRESETS } from '../src/sim/presets';
import { terrainHeight } from '../src/sim/world';
import { makeRig, rates, run, stick, upsideDown } from './helpers';

describe('acro rate loop', () => {
  it.each(['roll', 'pitch', 'yaw'] as const)('tracks full-stick %s rate on a 5" freestyle quad', (axis) => {
    const rig = makeRig();
    const target = maxRate(rig.settings.rates, axis);
    run(rig, stick({ [axis]: 1, throttle: 0.4 }), axis === 'yaw' ? 1.5 : 1);
    const achieved = rates(rig.quad)[axis];
    expect(Math.abs(achieved - target) / target).toBeLessThan(0.06);
  });

  it.each(PRESET_ORDER)('%s tracks roll and pitch within 10%%', (id) => {
    const rig = makeRig(id);
    const target = maxRate(rig.settings.rates, 'roll');
    run(rig, stick({ roll: 0.8, throttle: 0.45 }), 1.2);
    const expected = rig.fc.setpoint.roll;
    expect(Math.abs(rates(rig.quad).roll - expected) / Math.abs(expected)).toBeLessThan(0.1);
    expect(target).toBeGreaterThan(0);
  });

  it.each(PRESET_ORDER)('%s answers a rate step without ringing', (id) => {
    const rig = makeRig(id);
    run(rig, stick({ throttle: 0.4 }), 0.4);
    let peak = 0;
    const samples: number[] = [];
    run(rig, stick({ roll: 0.5, throttle: 0.4 }), 0.8, {
      onStep: (t) => {
        const r = rates(rig.quad).roll;
        peak = Math.max(peak, r);
        if (t > 0.5) samples.push(r - rig.fc.setpoint.roll);
      },
    });
    const sp = rig.fc.setpoint.roll;
    expect(peak / sp).toBeLessThan(1.25);
    const rms = Math.sqrt(samples.reduce((a, e) => a + e * e, 0) / samples.length);
    expect(rms).toBeLessThan(sp * 0.05);
  });

  it.each(PRESET_ORDER)('%s stays calm at full throttle (no high-throttle oscillation)', (id) => {
    const rig = makeRig(id);
    let worst = 0;
    run(rig, stick({ throttle: 1 }), 2, {
      onStep: (t) => {
        if (t > 0.5) {
          const r = rates(rig.quad);
          worst = Math.max(worst, Math.abs(r.roll), Math.abs(r.pitch));
        }
      },
    });
    expect(worst).toBeLessThan(15);
  });

  it('holds attitude in acro when the sticks are centred', () => {
    const rig = makeRig();
    run(rig, stick({ roll: 0.6, throttle: 0.4 }), 0.12);
    run(rig, stick({ throttle: 0.4 }), 0.6);
    const r = rates(rig.quad);
    expect(Math.abs(r.roll)).toBeLessThan(8);
  });
});

describe('angle mode', () => {
  it('banks to the angle limit and holds it', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    run(rig, stick({ roll: 1, throttle: 0.45 }), 2);
    expect(rig.fc.attitude.roll).toBeGreaterThan(PRESETS.freestyle5.pid.angleLimit - 3);
    expect(rig.fc.attitude.roll).toBeLessThan(PRESETS.freestyle5.pid.angleLimit + 3);
  });

  it('pitch forward tilts the nose down', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    run(rig, stick({ pitch: 0.5, throttle: 0.45 }), 1.5);
    expect(rig.fc.attitude.pitch).toBeLessThan(-20);
  });

  it('returns to level after the stick is released', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    run(rig, stick({ roll: 1, pitch: -0.6, throttle: 0.45 }), 1.5);
    run(rig, stick({ throttle: 0.45 }), 1.2);
    expect(Math.abs(rig.fc.attitude.roll)).toBeLessThan(2.5);
    expect(Math.abs(rig.fc.attitude.pitch)).toBeLessThan(2.5);
  });

  it('yaws about the vertical without losing the bank', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    run(rig, stick({ roll: 0.5, throttle: 0.5 }), 1.5);
    const bank = rig.fc.attitude.roll;
    let turned = 0;
    let worstBankError = 0;
    let last = rig.fc.attitude.heading;
    run(rig, stick({ roll: 0.5, yaw: 1, throttle: 0.5 }), 0.4, {
      onStep: () => {
        const h = rig.fc.attitude.heading;
        turned += ((h - last + 540) % 360) - 180;
        last = h;
        worstBankError = Math.max(worstBankError, Math.abs(rig.fc.attitude.roll - bank));
      },
    });
    expect(worstBankError).toBeLessThan(6);
    expect(turned).toBeGreaterThan(120);
  });
});

describe('horizon mode', () => {
  it('flips at full stick', () => {
    const rig = makeRig('freestyle5', { mode: 'horizon' });
    let rotated = 0;
    run(rig, stick({ roll: 1, throttle: 0.5 }), 1.2, {
      onStep: () => (rotated += rates(rig.quad).roll * 0.001),
    });
    expect(rotated).toBeGreaterThan(360);
  });

  it('self-levels near centre stick', () => {
    const rig = makeRig('freestyle5', { mode: 'horizon' });
    run(rig, stick({ roll: 0.35, throttle: 0.45 }), 1);
    run(rig, stick({ throttle: 0.45 }), 1.5);
    expect(Math.abs(rig.fc.attitude.roll)).toBeLessThan(3);
  });
});

describe('turtle mode', () => {
  it('flips an upside-down quad back onto its feet', () => {
    const rig = makeRig();
    const ground = terrainHeight(0, 0);
    rig.quad.reset(new Vector3(0, ground + 0.4, 0), 0);
    upsideDown(rig.quad.orientation);
    run(rig, stick({}), 2, { armed: false });
    expect(rig.quad.upright).toBeLessThan(-0.8);
    let flipped = false;
    run(rig, stick({ roll: 1 }), 3, {
      armed: true,
      turtle: true,
      onStep: () => {
        if (rig.quad.upright > 0.7) flipped = true;
      },
    });
    expect(flipped).toBe(true);
  });
});
