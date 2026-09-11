import { clamp } from '../core/MathUtils';
import type { PidAxisGains } from '../core/Types';
import { Pt1Filter } from './Filters';

/**
 * Betaflight's internal gain scaling. Keeping these constants means the numbers
 * a pilot types into the settings panel behave like the ones in a real tune.
 */
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FF_SCALE = 0.013754;

/** The mixer works in ±1 units, the PID sum is computed in ±1000 units. */
const PID_MIXER_SCALING = 1000;

/** How much I-term is allowed to accumulate, in mixer units. */
const ITERM_LIMIT = 400;

export interface PidDebug {
  p: number;
  i: number;
  d: number;
  f: number;
  sum: number;
}

/**
 * Single-axis rate controller.
 *
 * Design notes that matter for the feel of the aircraft:
 *  - the D-term is taken on the *measurement*, not the error, so a stick step
 *    does not produce a derivative kick;
 *  - the D-term is low-pass filtered, otherwise gyro noise would be amplified;
 *  - feed-forward acts on stick movement and is what makes the quad respond
 *    instantly instead of lagging behind the pilot;
 *  - "I-term relax" stops the integrator from winding up during fast flips,
 *    which is what causes the classic bounce-back at the end of a roll.
 */
export class AxisPid {
  private iTerm = 0;
  private previousMeasurement = 0;
  private previousSetpoint = 0;
  private readonly dFilter: Pt1Filter;
  private readonly ffFilter: Pt1Filter;
  private readonly relaxFilter: Pt1Filter;

  readonly debug: PidDebug = { p: 0, i: 0, d: 0, f: 0, sum: 0 };

  constructor(
    private gains: PidAxisGains,
    dt: number,
    dTermCutoffHz = 90,
    ffCutoffHz = 120,
  ) {
    this.dFilter = new Pt1Filter(dTermCutoffHz, dt);
    this.ffFilter = new Pt1Filter(ffCutoffHz, dt);
    this.relaxFilter = new Pt1Filter(15, dt);
  }

  setGains(gains: PidAxisGains): void {
    this.gains = gains;
  }

  reset(): void {
    this.iTerm = 0;
    this.previousMeasurement = 0;
    this.previousSetpoint = 0;
    this.dFilter.reset();
    this.ffFilter.reset();
    this.relaxFilter.reset();
  }

  /**
   * @param setpoint    desired body rate, deg/s
   * @param measurement measured body rate, deg/s
   * @param dt          fixed physics step, seconds
   * @param allowI      false while disarmed or when the mixer is saturated
   * @returns normalised mixer command in roughly [-1, 1]
   */
  update(setpoint: number, measurement: number, dt: number, allowI: boolean): number {
    const error = setpoint - measurement;

    const kp = PTERM_SCALE * this.gains.p;
    const ki = ITERM_SCALE * this.gains.i;
    const kd = DTERM_SCALE * this.gains.d;
    const kf = FF_SCALE * this.gains.f;

    // --- P ---
    const p = kp * error;

    // --- I with relax + windup clamp ---
    if (allowI && ki > 0) {
      // I-term relax: fade the integrator out while the stick is moving quickly.
      const smoothedSetpoint = this.relaxFilter.apply(setpoint);
      const setpointActivity = Math.abs(setpoint - smoothedSetpoint);
      const relax = clamp(1 - setpointActivity / 40, 0, 1);
      this.iTerm = clamp(this.iTerm + ki * error * dt * relax, -ITERM_LIMIT, ITERM_LIMIT);
    } else if (!allowI) {
      this.iTerm = 0;
    }
    const i = this.iTerm;

    // --- D on measurement (negated: we damp the aircraft, not the command) ---
    const measurementDelta = (measurement - this.previousMeasurement) / dt;
    this.previousMeasurement = measurement;
    const d = kd > 0 ? -kd * this.dFilter.apply(measurementDelta) : 0;

    // --- Feed-forward on stick movement ---
    const setpointDelta = (setpoint - this.previousSetpoint) / dt;
    this.previousSetpoint = setpoint;
    const f = kf > 0 ? kf * this.ffFilter.apply(setpointDelta) : 0;

    const sum = p + i + d + f;

    this.debug.p = p;
    this.debug.i = i;
    this.debug.d = d;
    this.debug.f = f;
    this.debug.sum = sum;

    return sum / PID_MIXER_SCALING;
  }
}
