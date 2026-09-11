/**
 * The digital filters a real flight controller runs on its gyro and D-term.
 * Without them the D-term amplifies motor noise and the quad oscillates.
 */

/** First-order (PT1) low-pass — the workhorse filter in Betaflight. */
export class Pt1Filter {
  private state = 0;
  private k = 1;

  constructor(cutoffHz: number, dt: number) {
    this.setCutoff(cutoffHz, dt);
  }

  setCutoff(cutoffHz: number, dt: number): void {
    const rc = 1 / (2 * Math.PI * Math.max(cutoffHz, 0.01));
    this.k = dt / (rc + dt);
  }

  apply(input: number): number {
    this.state += this.k * (input - this.state);
    return this.state;
  }

  reset(value = 0): void {
    this.state = value;
  }
}

/** Second-order Butterworth low-pass, used for the gyro signal. */
export class BiquadFilter {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(cutoffHz: number, dt: number, q = Math.SQRT1_2) {
    this.setCutoff(cutoffHz, dt, q);
  }

  setCutoff(cutoffHz: number, dt: number, q = Math.SQRT1_2): void {
    const sampleRate = 1 / dt;
    const omega = (2 * Math.PI * Math.min(cutoffHz, sampleRate * 0.45)) / sampleRate;
    const sn = Math.sin(omega);
    const cs = Math.cos(omega);
    const alpha = sn / (2 * q);

    const a0 = 1 + alpha;
    this.b0 = ((1 - cs) / 2) / a0;
    this.b1 = (1 - cs) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  apply(input: number): number {
    const output =
      this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** Limits how fast a signal can change — used to soften raw stick steps. */
export class SlewLimiter {
  private value = 0;

  constructor(private maxRatePerSecond: number) {}

  apply(target: number, dt: number): number {
    const maxDelta = this.maxRatePerSecond * dt;
    const diff = target - this.value;
    this.value += Math.abs(diff) <= maxDelta ? diff : Math.sign(diff) * maxDelta;
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
  }
}
