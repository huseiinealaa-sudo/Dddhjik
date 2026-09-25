import { clamp } from '../math';
import type { AxisPid as AxisGains } from '../types';
import { Pt1 } from './filters';

// Betaflight's internal scaling (pid.h / pid_init.c), so configurator numbers
// mean the same thing here. Note feed-forward is scaled by F / 100 in
// pid_init.c, unlike P, I and D.
const PTERM_SCALE = 0.032029;
const ITERM_SCALE = 0.244381;
const DTERM_SCALE = 0.000529;
const FF_SCALE = 0.013754 / 100;
const ITERM_LIMIT = 400;
const ITERM_RELAX_THRESHOLD = 40;

export interface PidTerms {
  p: number;
  i: number;
  d: number;
  f: number;
}

/**
 * One rate-loop axis, following Betaflight's structure:
 *  - D acts on the gyro, not the error (no derivative kick on stick steps),
 *    through two PT1 stages like dterm_lpf1/2;
 *  - feed-forward acts on the *pilot's* setpoint only (never on a
 *    self-levelling correction) and is smoothed;
 *  - I-term relax stops wind-up during fast moves (no bounce-back after flips);
 *  - anti-gravity boosts I while the throttle moves quickly;
 *  - the sum is clamped like pidsum_limit.
 */
export class AxisPid {
  private iterm = 0;
  private lastGyro = 0;
  private lastFfSetpoint = 0;
  private readonly dLpf1: Pt1;
  private readonly dLpf2: Pt1;
  private readonly ffLpf: Pt1;
  private readonly relaxLpf: Pt1;
  readonly terms: PidTerms = { p: 0, i: 0, d: 0, f: 0 };

  constructor(
    private gains: AxisGains,
    private readonly dt: number,
    private readonly relax: boolean,
    private readonly sumLimit: number,
  ) {
    this.dLpf1 = new Pt1(95, dt);
    this.dLpf2 = new Pt1(160, dt);
    this.ffLpf = new Pt1(25, dt);
    this.relaxLpf = new Pt1(15, dt);
  }

  setGains(gains: AxisGains): void {
    this.gains = gains;
  }

  reset(): void {
    this.iterm = 0;
    this.lastGyro = 0;
    this.lastFfSetpoint = 0;
    this.dLpf1.reset();
    this.dLpf2.reset();
    this.ffLpf.reset();
    this.relaxLpf.reset();
  }

  /**
   * @param setpoint    rate to follow, deg/s
   * @param ffSetpoint  pilot-commanded part of the setpoint, drives feed-forward
   * @returns mixer command, roughly [-0.5, 0.5]
   */
  update(
    setpoint: number,
    ffSetpoint: number,
    gyro: number,
    allowI: boolean,
    dAttenuation: number,
    iBoost: number,
  ): number {
    const g = this.gains;
    const dt = this.dt;
    const error = setpoint - gyro;

    const p = PTERM_SCALE * g.p * error;

    if (allowI) {
      let relaxFactor = 1;
      if (this.relax) {
        const hp = Math.abs(setpoint - this.relaxLpf.apply(setpoint));
        relaxFactor = Math.max(0, 1 - hp / ITERM_RELAX_THRESHOLD);
      }
      this.iterm = clamp(this.iterm + ITERM_SCALE * g.i * error * dt * relaxFactor * iBoost, -ITERM_LIMIT, ITERM_LIMIT);
    } else {
      this.iterm = 0;
    }

    const gyroDelta = (gyro - this.lastGyro) / dt;
    this.lastGyro = gyro;
    const d = g.d > 0 ? -DTERM_SCALE * g.d * dAttenuation * this.dLpf2.apply(this.dLpf1.apply(gyroDelta)) : 0;

    const ffDelta = (ffSetpoint - this.lastFfSetpoint) / dt;
    this.lastFfSetpoint = ffSetpoint;
    const f = g.f > 0 ? FF_SCALE * g.f * this.ffLpf.apply(ffDelta) : 0;

    this.terms.p = p;
    this.terms.i = this.iterm;
    this.terms.d = d;
    this.terms.f = f;
    return clamp(p + this.iterm + d + f, -this.sumLimit, this.sumLimit) / 1000;
  }
}
