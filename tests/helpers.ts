import { Quaternion, Vector3 } from 'three';
import { CollisionWorld } from '../src/sim/collision';
import { FlightController } from '../src/sim/fc/flightController';
import { PRESETS, type PresetId } from '../src/sim/presets';
import { QuadBody, type StepEnvironment } from '../src/sim/quad';
import type { FcSettings, Sticks } from '../src/sim/types';
import { Wind } from '../src/sim/wind';

export const DT = 1 / 1000;

export interface Rig {
  quad: QuadBody;
  fc: FlightController;
  settings: FcSettings;
  env: StepEnvironment;
  world: CollisionWorld;
}

export function makeRig(presetId: PresetId = 'freestyle5', overrides: Partial<FcSettings> = {}, world?: CollisionWorld): Rig {
  const preset = PRESETS[presetId];
  const settings: FcSettings = {
    mode: 'acro',
    rates: preset.rates,
    pid: preset.pid,
    airmode: true,
    throttleMid: 0.5,
    throttleExpo: 0,
    ...overrides,
  };
  const w = world ?? new CollisionWorld();
  if (!world) w.build();
  const quad = new QuadBody(preset);
  const fc = new FlightController(preset, settings, DT);
  quad.reset(new Vector3(0, 60, 0), 0);
  return { quad, fc, settings, world: w, env: { world: w, wind: new Wind(), batteryDrain: false } };
}

export function stick(partial: Partial<Sticks>): Sticks {
  return { roll: 0, pitch: 0, yaw: 0, throttle: 0, ...partial };
}

export function run(
  rig: Rig,
  sticks: Sticks,
  seconds: number,
  opts: { armed?: boolean; turtle?: boolean; onStep?: (t: number) => void } = {},
): void {
  const armed = opts.armed ?? true;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const motors = rig.fc.update(sticks, rig.quad.orientation, rig.quad.angularVelocity, armed, opts.turtle ?? false);
    rig.quad.step(motors, DT, rig.env);
    opts.onStep?.(i * DT);
  }
}

/** Pilot-axis body rates in deg/s. */
export function rates(q: QuadBody): { roll: number; pitch: number; yaw: number } {
  const w = q.angularVelocity;
  return { roll: (-w.z * 180) / Math.PI, pitch: (-w.x * 180) / Math.PI, yaw: (-w.y * 180) / Math.PI };
}

export function findHoverThrottle(presetId: PresetId): number {
  let lo = 0;
  let hi = 1;
  for (let iter = 0; iter < 20; iter++) {
    const mid = (lo + hi) / 2;
    const rig = makeRig(presetId, { mode: 'angle' });
    run(rig, stick({ throttle: mid }), 2.5);
    if (rig.quad.velocity.y > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function upsideDown(q: Quaternion): Quaternion {
  return q.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
}
