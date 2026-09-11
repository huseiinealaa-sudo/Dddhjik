import { Quaternion, Vector3 } from 'three';
import { clamp, clampUnit, RAD2DEG } from '../core/MathUtils';
import type { ControlInput, PidConfig, RatesConfig, SimSettings } from '../core/Types';
import { AxisPid } from './Pid';
import { computeRateSetpoint, maxRate, type RateSetpoint } from './Rates';

/**
 * Body-frame axis convention used everywhere in this project — it matches
 * Three.js object space so the FPV camera can simply be parented to the frame:
 *
 *   +x = right wing        +y = up (thrust direction)      -z = nose
 *
 * Which makes the angular velocity components:
 *   omega.x = pitch rate (positive = nose up)
 *   omega.y = yaw rate   (positive = nose left)
 *   omega.z = roll rate  (positive = roll left)
 *
 * The controller itself works in "pilot axes" (roll-right, pitch-up and
 * yaw-right are all positive) and converts at the boundary.
 */

const BODY_UP = new Vector3(0, 1, 0);
const BODY_FORWARD = new Vector3(0, 0, -1);
const BODY_RIGHT = new Vector3(1, 0, 0);

export interface Attitude {
  /** Bank angle in degrees, positive = right wing down. */
  rollDeg: number;
  /** Elevation of the nose in degrees, positive = nose up. */
  pitchDeg: number;
  /** Compass heading in degrees, 0 = -Z, increasing clockwise. */
  headingDeg: number;
}

const tmpRight = new Vector3();
const tmpUp = new Vector3();
const tmpForward = new Vector3();

/** Decompose an orientation quaternion into pilot-facing Euler angles. */
export function computeAttitude(orientation: Quaternion, out: Attitude): Attitude {
  tmpRight.copy(BODY_RIGHT).applyQuaternion(orientation);
  tmpUp.copy(BODY_UP).applyQuaternion(orientation);
  tmpForward.copy(BODY_FORWARD).applyQuaternion(orientation);

  out.rollDeg = Math.atan2(-tmpRight.y, tmpUp.y) * RAD2DEG;
  out.pitchDeg = Math.asin(clamp(tmpForward.y, -1, 1)) * RAD2DEG;
  let heading = Math.atan2(tmpForward.x, -tmpForward.z) * RAD2DEG;
  if (heading < 0) heading += 360;
  out.headingDeg = heading;
  return out;
}

/** Motor order used by the mixer and the 3D model. */
export const MOTOR_FRONT_LEFT = 0;
export const MOTOR_FRONT_RIGHT = 1;
export const MOTOR_REAR_LEFT = 2;
export const MOTOR_REAR_RIGHT = 3;

export type MotorOutputs = [number, number, number, number];

export interface FlightControllerOutput {
  motors: MotorOutputs;
  /** Rate setpoints in deg/s (pilot axes) — exposed for the HUD and for logging. */
  setpoint: RateSetpoint;
  attitude: Attitude;
  /** True when the mixer had to scale the PID authority down to fit. */
  saturated: boolean;
}

export class FlightController {
  private readonly rollPid: AxisPid;
  private readonly pitchPid: AxisPid;
  private readonly yawPid: AxisPid;

  private readonly setpoint: RateSetpoint = { roll: 0, pitch: 0, yaw: 0 };
  private readonly attitude: Attitude = { rollDeg: 0, pitchDeg: 0, headingDeg: 0 };
  private readonly motors: MotorOutputs = [0, 0, 0, 0];
  private readonly mix: MotorOutputs = [0, 0, 0, 0];

  private readonly output: FlightControllerOutput;

  /** Idle spin so the props keep authority (Betaflight's "motor idle"). */
  private readonly idleThrottle = 0.055;

  constructor(
    pid: PidConfig,
    private rates: RatesConfig,
    private readonly dt: number,
  ) {
    this.rollPid = new AxisPid(pid.roll, dt);
    this.pitchPid = new AxisPid(pid.pitch, dt);
    this.yawPid = new AxisPid(pid.yaw, dt, 120, 140);
    this.output = {
      motors: this.motors,
      setpoint: this.setpoint,
      attitude: this.attitude,
      saturated: false,
    };
  }

  configure(settings: SimSettings): void {
    this.rates = settings.rates;
    this.rollPid.setGains(settings.pid.roll);
    this.pitchPid.setGains(settings.pid.pitch);
    this.yawPid.setGains(settings.pid.yaw);
  }

  reset(): void {
    this.rollPid.reset();
    this.pitchPid.reset();
    this.yawPid.reset();
    this.motors[0] = this.motors[1] = this.motors[2] = this.motors[3] = 0;
  }

  /**
   * Run one controller iteration.
   *
   * @param input        pilot sticks (already shaped by the input layer)
   * @param orientation  body → world rotation
   * @param angularVel   body-frame angular velocity in rad/s
   * @param armed        motors allowed to spin
   * @param settings     live settings (mode, air mode, ...)
   */
  update(
    input: ControlInput,
    orientation: Quaternion,
    angularVel: Vector3,
    armed: boolean,
    settings: SimSettings,
  ): FlightControllerOutput {
    computeAttitude(orientation, this.attitude);

    // Gyro readings converted into pilot axes (deg/s).
    const gyroRoll = -angularVel.z * RAD2DEG;
    const gyroPitch = angularVel.x * RAD2DEG;
    const gyroYaw = -angularVel.y * RAD2DEG;

    computeRateSetpoint(input.roll, input.pitch, input.yaw, this.rates, this.setpoint);

    if (settings.mode !== 'acro') {
      this.applyAttitudeOuterLoop(input, settings);
    }

    if (!armed) {
      this.rollPid.reset();
      this.pitchPid.reset();
      this.yawPid.reset();
      this.motors[0] = this.motors[1] = this.motors[2] = this.motors[3] = 0;
      this.output.saturated = false;
      return this.output;
    }

    const allowI = input.throttle > 0.02 || settings.airMode;

    const pidRoll = this.rollPid.update(this.setpoint.roll, gyroRoll, this.dt, allowI);
    const pidPitch = this.pitchPid.update(this.setpoint.pitch, gyroPitch, this.dt, allowI);
    const pidYaw = this.yawPid.update(this.setpoint.yaw, gyroYaw, this.dt, allowI);

    this.output.saturated = this.mixMotors(input.throttle, pidRoll, pidPitch, pidYaw, settings.airMode);
    return this.output;
  }

  /**
   * Angle / Horizon mode: an outer proportional loop turns the stick position
   * into a *bank angle* target and the resulting angle error into a rate
   * command that the normal acro inner loop then flies.
   */
  private applyAttitudeOuterLoop(input: ControlInput, settings: SimSettings): void {
    const limit = settings.pid.angleLimitDeg;
    const targetRoll = clampUnit(input.roll) * limit;
    const targetPitch = clampUnit(input.pitch) * limit;

    const rollError = targetRoll - this.attitude.rollDeg;
    // Attitude pitch is "nose up positive", exactly like the pitch stick.
    const pitchError = targetPitch - this.attitude.pitchDeg;

    const maxRoll = maxRate(this.rates.roll);
    const maxPitch = maxRate(this.rates.pitch);

    const angleRollRate = clamp(rollError * settings.pid.angleP, -maxRoll, maxRoll);
    const anglePitchRate = clamp(pitchError * settings.pid.angleP, -maxPitch, maxPitch);

    if (settings.mode === 'angle') {
      this.setpoint.roll = angleRollRate;
      this.setpoint.pitch = anglePitchRate;
      return;
    }

    // Horizon: self-levelling around centre, full acro authority at the edges.
    const deflection = clamp(Math.max(Math.abs(input.roll), Math.abs(input.pitch)), 0, 1);
    const acroBlend = deflection * deflection;
    this.setpoint.roll = angleRollRate * (1 - acroBlend) + this.setpoint.roll * acroBlend;
    this.setpoint.pitch = anglePitchRate * (1 - acroBlend) + this.setpoint.pitch * acroBlend;
  }

  /**
   * Betaflight-style mixer with AIR MODE.
   *
   * The differential (PID) part of every motor command is computed first. If it
   * does not fit inside the available 0..1 range the whole differential is
   * scaled down — that keeps the *ratio* between motors intact so the aircraft
   * still rotates the way the pilot asked, it just loses some thrust authority.
   * With AIR MODE on we slide the collective throttle instead of clipping, which
   * is what lets a real quad keep control at zero throttle.
   */
  private mixMotors(
    throttle: number,
    pidRoll: number,
    pidPitch: number,
    pidYaw: number,
    airMode: boolean,
  ): boolean {
    // See the axis convention at the top of the file for the sign derivation.
    this.mix[MOTOR_FRONT_LEFT] = pidPitch + pidRoll - pidYaw;
    this.mix[MOTOR_FRONT_RIGHT] = pidPitch - pidRoll + pidYaw;
    this.mix[MOTOR_REAR_LEFT] = -pidPitch + pidRoll + pidYaw;
    this.mix[MOTOR_REAR_RIGHT] = -pidPitch - pidRoll - pidYaw;

    let mixMin = this.mix[0];
    let mixMax = this.mix[0];
    for (let i = 1; i < 4; i++) {
      if (this.mix[i] < mixMin) mixMin = this.mix[i];
      if (this.mix[i] > mixMax) mixMax = this.mix[i];
    }

    const range = mixMax - mixMin;
    let saturated = false;
    let collective = this.idleThrottle + throttle * (1 - this.idleThrottle);

    if (range > 1) {
      const scale = 1 / range;
      for (let i = 0; i < 4; i++) this.mix[i] *= scale;
      mixMin *= scale;
      mixMax *= scale;
      collective = 0.5;
      saturated = true;
    } else if (airMode) {
      collective = clamp(collective, -mixMin, 1 - mixMax);
    }

    for (let i = 0; i < 4; i++) {
      this.motors[i] = clamp(collective + this.mix[i], 0, 1);
    }

    return saturated;
  }
}
