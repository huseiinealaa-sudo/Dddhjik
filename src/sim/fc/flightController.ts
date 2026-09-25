import { Quaternion, Vector3 } from 'three';
import { MOTOR_SPIN, MOTOR_X, MOTOR_Z } from '../layout';
import { clamp, clamp01, RAD, smoothstep } from '../math';
import type { QuadPreset } from '../presets';
import type { FcSettings, Sticks } from '../types';
import { Pt1 } from './filters';
import { mixQuadX } from './mixer';
import { AxisPid } from './pid';
import { maxRate, rateFor } from './rates';

export interface Attitude {
  /** Bank angle, degrees, right wing down positive. */
  roll: number;
  /** Nose elevation, degrees, nose up positive (as drawn on an OSD horizon). */
  pitch: number;
  /** Compass heading, degrees, 0 = -Z, clockwise. */
  heading: number;
}

export interface AxisTriple {
  roll: number;
  pitch: number;
  yaw: number;
}

/** Betaflight throttle curve (rcLookupThrottle). */
export function throttleCurve(t: number, mid: number, expo: number): number {
  const tmp = t - mid;
  const y = tmp > 0 ? 1 - mid : tmp < 0 ? mid : 1;
  return mid + tmp * (1 - expo + (expo * tmp * tmp) / (y * y));
}

const WORLD_UP = new Vector3(0, 1, 0);

/**
 * Flight controller.
 *
 * Pilot axes (rates in deg/s): roll right +, pitch forward (nose down) +,
 * yaw right +. Body angular velocity maps to them as
 *   roll = -w.z,  pitch = -w.x,  yaw = -w.y.
 *
 * Angle and Horizon work the way modern Betaflight does: tilt is measured in a
 * heading-aligned frame and yaw is applied about the world vertical ("earth
 * referenced"), so yawing while banked does not drag the nose up or down.
 */
export class FlightController {
  /** Motor commands for QuadBody.step, in [-1, 1]. */
  readonly motors = new Float64Array(4);
  readonly setpoint: AxisTriple = { roll: 0, pitch: 0, yaw: 0 };
  readonly gyro: AxisTriple = { roll: 0, pitch: 0, yaw: 0 };
  readonly attitude: Attitude = { roll: 0, pitch: 0, heading: 0 };
  saturated = false;
  /** Throttle after the curve, 0..1. */
  throttleOut = 0;

  private settings: FcSettings;
  private readonly rollPid: AxisPid;
  private readonly pitchPid: AxisPid;
  private readonly yawPid: AxisPid;
  private readonly mix = new Float64Array(4);
  private readonly throttleLpf: Pt1;
  private readonly rollTargetLpf: Pt1;
  private readonly pitchTargetLpf: Pt1;
  private lastRollTarget = 0;
  private lastPitchTarget = 0;
  private readonly rcSmooth: Pt1[] = [];
  private readonly ff: AxisTriple = { roll: 0, pitch: 0, yaw: 0 };

  // Heading-frame decomposition of the current attitude (degrees / radians).
  private tiltPitch = 0;
  private tiltRoll = 0;
  private psi = 0;

  private readonly yawQ = new Quaternion();
  private readonly invYaw = new Quaternion();
  private readonly invBody = new Quaternion();
  private readonly up = new Vector3();
  private readonly rightH = new Vector3();
  private readonly fwdH = new Vector3();
  private readonly wWorld = new Vector3();
  private readonly tmp = new Vector3();

  constructor(
    private readonly preset: QuadPreset,
    settings: FcSettings,
    private readonly dt: number,
  ) {
    this.settings = settings;
    // pidsum_limit / pidsum_limit_yaw
    this.rollPid = new AxisPid(settings.pid.roll, dt, true, 500);
    this.pitchPid = new AxisPid(settings.pid.pitch, dt, true, 500);
    this.yawPid = new AxisPid(settings.pid.yaw, dt, false, 400);
    this.throttleLpf = new Pt1(4, dt);
    // RC smoothing: sticks arrive in discrete jumps (touch, keyboard, radio
    // frames); a PT2 on each axis turns them into something a motor can follow.
    for (let i = 0; i < 6; i++) this.rcSmooth.push(new Pt1(38, dt));
    this.rollTargetLpf = new Pt1(18, dt);
    this.pitchTargetLpf = new Pt1(18, dt);
  }

  configure(settings: FcSettings): void {
    this.settings = settings;
    this.rollPid.setGains(settings.pid.roll);
    this.pitchPid.setGains(settings.pid.pitch);
    this.yawPid.setGains(settings.pid.yaw);
  }

  get mode(): FcSettings['mode'] {
    return this.settings.mode;
  }

  get maxRates(): AxisTriple {
    const r = this.settings.rates;
    return { roll: maxRate(r, 'roll'), pitch: maxRate(r, 'pitch'), yaw: maxRate(r, 'yaw') };
  }

  reset(): void {
    this.rollPid.reset();
    this.pitchPid.reset();
    this.yawPid.reset();
    this.motors.fill(0);
    this.throttleLpf.reset();
    this.rollTargetLpf.reset();
    this.pitchTargetLpf.reset();
    this.lastRollTarget = 0;
    this.lastPitchTarget = 0;
    for (const f of this.rcSmooth) f.reset();
  }

  /** Refresh `attitude` (and the heading-frame tilt) from an orientation. */
  computeAttitude(q: Quaternion): Attitude {
    // Swing-twist: the twist about world Y is the heading.
    const psi = 2 * Math.atan2(q.y, q.w);
    this.psi = psi;
    this.yawQ.setFromAxisAngle(WORLD_UP, psi);
    this.invYaw.copy(this.yawQ).invert();
    // Body up expressed in the heading frame gives the tilt.
    this.up.set(0, 1, 0).applyQuaternion(q).applyQuaternion(this.invYaw);
    this.tiltPitch = Math.atan2(-this.up.z, this.up.y) * RAD;
    this.tiltRoll = Math.atan2(this.up.x, this.up.y) * RAD;

    this.tmp.set(0, 0, -1).applyQuaternion(q);
    const heading = -psi * RAD;
    this.attitude.roll = this.tiltRoll;
    this.attitude.pitch = Math.asin(clamp(this.tmp.y, -1, 1)) * RAD;
    this.attitude.heading = ((heading % 360) + 360) % 360;
    return this.attitude;
  }

  /**
   * One control-loop iteration.
   * @param orientation     body -> world
   * @param angularVelocity body frame, rad/s
   */
  update(sticks: Sticks, orientation: Quaternion, angularVelocity: Vector3, armed: boolean, turtle: boolean): Float64Array {
    const s = this.settings;
    this.computeAttitude(orientation);
    this.invBody.copy(orientation).invert();

    this.gyro.roll = -angularVelocity.z * RAD;
    this.gyro.pitch = -angularVelocity.x * RAD;
    this.gyro.yaw = -angularVelocity.y * RAD;

    const throttle = clamp01(throttleCurve(clamp01(sticks.throttle), s.throttleMid, s.throttleExpo));

    if (!armed) {
      this.reset();
      this.throttleOut = 0;
      this.saturated = false;
      this.setpoint.roll = this.setpoint.pitch = this.setpoint.yaw = 0;
      return this.motors;
    }
    this.throttleOut = throttle;

    if (turtle) {
      this.runTurtle(sticks);
      return this.motors;
    }

    const sm = this.rcSmooth;
    const rollStick = sm[1].apply(sm[0].apply(clamp(sticks.roll, -1, 1)));
    const pitchStick = sm[3].apply(sm[2].apply(clamp(sticks.pitch, -1, 1)));
    const yawStick = sm[5].apply(sm[4].apply(clamp(sticks.yaw, -1, 1)));

    const acroRoll = rateFor(s.rates, 'roll', rollStick);
    const acroPitch = rateFor(s.rates, 'pitch', pitchStick);
    const acroYaw = rateFor(s.rates, 'yaw', yawStick);

    if (s.mode === 'acro') {
      this.setpoint.roll = this.ff.roll = acroRoll;
      this.setpoint.pitch = this.ff.pitch = acroPitch;
      this.setpoint.yaw = this.ff.yaw = acroYaw;
    } else {
      this.levelLoop(rollStick, pitchStick, acroRoll, acroPitch, acroYaw);
    }

    const tpa = 1 - s.pid.tpaRate * clamp01((throttle - s.pid.tpaBreakpoint) / (1 - s.pid.tpaBreakpoint));
    const throttleHpf = throttle - this.throttleLpf.apply(throttle);
    const iBoost = 1 + s.pid.antiGravity * clamp01(Math.abs(throttleHpf) * 8);
    const allowI = s.airmode || throttle > 0.05;

    const r = this.rollPid.update(this.setpoint.roll, this.ff.roll, this.gyro.roll, allowI, tpa, iBoost);
    const p = this.pitchPid.update(this.setpoint.pitch, this.ff.pitch, this.gyro.pitch, allowI, tpa, iBoost);
    const y = this.yawPid.update(this.setpoint.yaw, this.ff.yaw, this.gyro.yaw, allowI, 1, iBoost);

    this.saturated = mixQuadX(throttle, r, p, y, s.airmode, this.mix);
    const idle = this.preset.idle;
    for (let i = 0; i < 4; i++) this.motors[i] = idle + (1 - idle) * this.mix[i];
    return this.motors;
  }

  /** Angle / Horizon: tilt error in the heading frame, yaw about world vertical. */
  private levelLoop(rollStick: number, pitchStick: number, acroRoll: number, acroPitch: number, acroYaw: number): void {
    const s = this.settings;
    const limit = s.pid.angleLimit;
    const k = s.pid.levelStrength;

    const rollTarget = rollStick * limit;
    const pitchTarget = pitchStick * limit;

    // Angle feed-forward: react to stick motion before an error builds up.
    const rollFf = this.rollTargetLpf.apply((rollTarget - this.lastRollTarget) / this.dt) * 0.35;
    const pitchFf = this.pitchTargetLpf.apply((pitchTarget - this.lastPitchTarget) / this.dt) * 0.35;
    this.lastRollTarget = rollTarget;
    this.lastPitchTarget = pitchTarget;

    const maxRoll = maxRate(s.rates, 'roll');
    const maxPitch = maxRate(s.rates, 'pitch');
    const rollRate = clamp((rollTarget - this.tiltRoll) * k + rollFf, -maxRoll, maxRoll);
    const pitchRate = clamp((pitchTarget - this.tiltPitch) * k + pitchFf, -maxPitch, maxPitch);

    // Full command, and the pilot-driven part alone (for the rate-loop
    // feed-forward — feeding it the corrective part would amplify every
    // disturbance, which is why Betaflight keeps the two apart).
    const body = this.headingRatesToBody(pitchRate, rollRate, acroYaw, this.tmp);
    let roll = -body.z;
    let pitch = -body.x;
    let yaw = -body.y;
    const ffBody = this.headingRatesToBody(pitchFf * 0.5, rollFf * 0.5, acroYaw, this.tmp);
    let ffRoll = -ffBody.z;
    let ffPitch = -ffBody.x;
    let ffYaw = -ffBody.y;

    if (s.mode === 'horizon') {
      // Self-levelling near centre stick, pure acro at full deflection and
      // once the aircraft is well past vertical, so flips can be finished.
      const deflection = Math.max(Math.abs(rollStick), Math.abs(pitchStick));
      const tilt = Math.max(Math.abs(this.tiltRoll), Math.abs(this.tiltPitch));
      const level = (1 - smoothstep(0.05, 0.8, deflection)) * (1 - smoothstep(75, 110, tilt));
      roll = roll * level + acroRoll * (1 - level);
      pitch = pitch * level + acroPitch * (1 - level);
      yaw = yaw * level + acroYaw * (1 - level);
      ffRoll = ffRoll * level + acroRoll * (1 - level);
      ffPitch = ffPitch * level + acroPitch * (1 - level);
      ffYaw = ffYaw * level + acroYaw * (1 - level);
    }

    this.setpoint.roll = roll;
    this.setpoint.pitch = pitch;
    this.setpoint.yaw = yaw;
    this.ff.roll = ffRoll;
    this.ff.pitch = ffPitch;
    this.ff.yaw = ffYaw;
  }

  /**
   * Heading-frame rates (pitch about heading-right, roll about heading-forward,
   * yaw about world up; deg/s, pilot sign convention) expressed in the body frame.
   */
  private headingRatesToBody(pitchRate: number, rollRate: number, yawRate: number, out: Vector3): Vector3 {
    this.rightH.set(Math.cos(this.psi), 0, -Math.sin(this.psi));
    this.fwdH.set(-Math.sin(this.psi), 0, -Math.cos(this.psi));
    this.wWorld
      .set(0, 0, 0)
      .addScaledVector(this.rightH, -pitchRate)
      .addScaledVector(this.fwdH, rollRate)
      .addScaledVector(WORLD_UP, -yawRate);
    return out.copy(this.wWorld).applyQuaternion(this.invBody);
  }

  /**
   * Betaflight "flip over after crash": motors spin backwards; the stick
   * direction picks the motors and the aircraft rolls over that way.
   */
  private runTurtle(sticks: Sticks): void {
    const r = clamp(sticks.roll, -1, 1);
    const p = clamp(sticks.pitch, -1, 1);
    const y = clamp(sticks.yaw, -1, 1);
    const mag = Math.max(Math.abs(r), Math.abs(p), Math.abs(y));
    this.setpoint.roll = this.setpoint.pitch = this.setpoint.yaw = 0;
    if (mag < 0.15) {
      this.motors.fill(0);
      return;
    }
    const power = clamp01((mag - 0.15) / 0.85) * 0.85;
    for (let i = 0; i < 4; i++) {
      // Reverse thrust on the right side rolls right; on the front, pitches forward.
      const score = (MOTOR_X[i] * r - MOTOR_Z[i] * p) * 0.7 + MOTOR_SPIN[i] * y * 0.7;
      this.motors[i] = score > 0.2 ? -clamp01(score) * power : 0;
    }
  }
}
