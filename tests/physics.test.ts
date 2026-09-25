import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PRESET_ORDER, PRESETS, thrustToWeight } from '../src/sim/presets';
import { terrainHeight } from '../src/sim/world';
import { findHoverThrottle, makeRig, run, stick, upsideDown } from './helpers';

describe('airframe physics', () => {
  it('hovers around a third of stick on a 5" freestyle quad', () => {
    const hover = findHoverThrottle('freestyle5');
    expect(hover).toBeGreaterThan(0.25);
    expect(hover).toBeLessThan(0.42);
  });

  it.each(PRESET_ORDER)('%s can hover and has a plausible thrust-to-weight', (id) => {
    const hover = findHoverThrottle(id);
    expect(hover).toBeGreaterThan(0.15);
    expect(hover).toBeLessThan(0.6);
    const tw = thrustToWeight(PRESETS[id]);
    expect(tw).toBeGreaterThan(4);
    expect(tw).toBeLessThan(11);
  });

  it('produces the rated static thrust at full throttle (on a thrust stand)', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    // Clamp it in place like a thrust stand, so there is no inflow.
    run(rig, stick({ throttle: 1 }), 0.4, {
      onStep: () => {
        rig.quad.velocity.set(0, 0, 0);
        rig.quad.position.set(0, 60, 0);
      },
    });
    const total = rig.quad.thrust.reduce((a, b) => a + b, 0);
    // Thrust goes with rpm squared and rpm with the (sagging) pack voltage.
    const vRatio = rig.quad.battery.voltage / rig.quad.battery.fullVoltage;
    const expected = 4 * PRESETS.freestyle5.maxThrust * vRatio * vRatio;
    expect(Math.abs(total - expected) / expected).toBeLessThan(0.03);
    expect(vRatio).toBeLessThan(0.97);
  });

  it('falls at 1 g when disarmed', () => {
    const rig = makeRig();
    run(rig, stick({}), 0.3, { armed: false });
    // v = g t minus a whisker of drag.
    expect(-rig.quad.velocity.y).toBeGreaterThan(2.85);
    expect(-rig.quad.velocity.y).toBeLessThan(2.96);
  });

  it('falls flat at a realistic terminal speed with props idling', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    rig.quad.position.set(0, 400, 0);
    run(rig, stick({ throttle: 0 }), 10);
    const v = -rig.quad.velocity.y;
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThan(22);
  });

  it('reaches a realistic top speed in level flight', () => {
    const rig = makeRig('freestyle5', { mode: 'angle', pid: { ...PRESETS.freestyle5.pid, angleLimit: 72 } });
    rig.quad.position.set(0, 300, 0);
    run(rig, stick({ throttle: 1, pitch: 1 }), 6); // short enough to stay clear of the world boundary
    const v = rig.quad.velocity;
    const kmh = Math.hypot(v.x, v.z) * 3.6;
    expect(kmh).toBeGreaterThan(110);
    expect(kmh).toBeLessThan(220);
  });

  it('climbs at full throttle but not without limit', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    rig.quad.position.set(0, 50, 0);
    run(rig, stick({ throttle: 1 }), 6);
    expect(rig.quad.velocity.y).toBeGreaterThan(20);
    expect(rig.quad.velocity.y).toBeLessThan(70);
  });

  it('comes to rest on its feet after a drop and stays put', () => {
    const rig = makeRig();
    const ground = terrainHeight(0, 0);
    rig.quad.reset(new Vector3(0, ground + 1, 0), 0);
    run(rig, stick({}), 4, { armed: false });
    const q = rig.quad;
    expect(Number.isFinite(q.position.y)).toBe(true);
    expect(q.upright).toBeGreaterThan(0.97);
    expect(q.velocity.length()).toBeLessThan(0.05);
    const restY = q.position.y;
    run(rig, stick({}), 3, { armed: false });
    expect(Math.abs(q.position.y - restY)).toBeLessThan(0.004);
    expect(Math.hypot(q.position.x, q.position.z)).toBeLessThan(0.05);
    // Resting on the motor bottoms: the centre of mass is a couple of cm up.
    expect(restY - ground).toBeGreaterThan(0.01);
    expect(restY - ground).toBeLessThan(0.05);
  });

  it('can end up upside down after tumbling', () => {
    const rig = makeRig();
    const ground = terrainHeight(0, 0);
    rig.quad.reset(new Vector3(0, ground + 0.5, 0), 0);
    upsideDown(rig.quad.orientation);
    run(rig, stick({}), 4, { armed: false });
    expect(rig.quad.upright).toBeLessThan(-0.8);
    expect(rig.quad.velocity.length()).toBeLessThan(0.05);
  });

  it('survives a violent tumble without numerical blow-up', () => {
    const rig = makeRig();
    const ground = terrainHeight(0, 0);
    rig.quad.reset(new Vector3(0, ground + 3, 0), 0);
    rig.quad.velocity.set(9, -6, 4);
    rig.quad.angularVelocity.set(20, 8, -25);
    run(rig, stick({}), 6, { armed: false });
    const q = rig.quad;
    expect(Number.isFinite(q.position.x + q.position.y + q.position.z)).toBe(true);
    expect(q.velocity.length()).toBeLessThan(0.1);
    expect(q.position.y).toBeGreaterThan(ground - 0.05);
  });

  it('reports a hard impact', () => {
    const rig = makeRig();
    const ground = terrainHeight(0, 0);
    rig.quad.reset(new Vector3(0, ground + 0.4, 0), 0);
    rig.quad.velocity.set(0, -12, 0);
    let peak = 0;
    run(rig, stick({}), 0.2, { armed: false, onStep: () => (peak = Math.max(peak, rig.quad.impactSpeed)) });
    expect(peak).toBeGreaterThan(10);
  });

  it('drains the pack and sags the voltage under load', () => {
    const rig = makeRig('freestyle5', { mode: 'angle' });
    rig.env.batteryDrain = true;
    const full = rig.quad.battery.voltage;
    run(rig, stick({ throttle: 0.9 }), 1);
    expect(rig.quad.battery.voltage).toBeLessThan(full - 1);
    expect(rig.quad.battery.current).toBeGreaterThan(60);
    run(rig, stick({ throttle: 0.33 }), 30);
    expect(rig.quad.battery.mahUsed).toBeGreaterThan(40);
    expect(rig.quad.battery.percent).toBeLessThan(97);
  });
});
