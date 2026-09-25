/** Vocabulary shared by the flight controller, the game layer and the UI. */

export type FlightMode = 'acro' | 'angle' | 'horizon';
export type RatesType = 'betaflight' | 'actual';

/**
 * Pilot command, already mapped from whichever input device is in use.
 *
 * roll  +1 = stick right (right wing down)
 * pitch +1 = stick forward (nose down)
 * yaw   +1 = stick right (nose turns right)
 * throttle 0..1
 */
export interface Sticks {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

/**
 * One axis of a rate profile. The meaning depends on the profile type:
 *  - betaflight: center = RC Rate (e.g. 1.0), max = Super Rate (e.g. 0.70)
 *  - actual:     center = centre sensitivity (deg/s), max = max rate (deg/s)
 * `expo` is 0..1 in both cases.
 */
export interface AxisRate {
  center: number;
  max: number;
  expo: number;
}

export interface RatesProfile {
  type: RatesType;
  roll: AxisRate;
  pitch: AxisRate;
  yaw: AxisRate;
}

/** PID gains on the same numeric scale as the Betaflight configurator. */
export interface AxisPid {
  p: number;
  i: number;
  d: number;
  f: number;
}

export interface PidProfile {
  roll: AxisPid;
  pitch: AxisPid;
  yaw: AxisPid;
  /** Angle/Horizon self-levelling: deg/s of commanded rate per degree of error. */
  levelStrength: number;
  /** Maximum bank angle in Angle mode, degrees. */
  angleLimit: number;
  /** Throttle PID attenuation applied to D above the breakpoint (0..1). */
  tpaRate: number;
  tpaBreakpoint: number;
  /** I-term boost during fast throttle changes. */
  antiGravity: number;
}

export interface FcSettings {
  mode: FlightMode;
  rates: RatesProfile;
  pid: PidProfile;
  airmode: boolean;
  /** Betaflight throttle curve: mid point and expo (both 0..1). */
  throttleMid: number;
  throttleExpo: number;
}
