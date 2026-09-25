/** First-order low-pass (Betaflight's PT1). */
export class Pt1 {
  private y = 0;
  private k = 1;

  constructor(cutoffHz: number, dt: number) {
    this.setCutoff(cutoffHz, dt);
  }

  setCutoff(cutoffHz: number, dt: number): void {
    const rc = 1 / (2 * Math.PI * Math.max(cutoffHz, 0.01));
    this.k = dt / (rc + dt);
  }

  apply(x: number): number {
    this.y += this.k * (x - this.y);
    return this.y;
  }

  reset(value = 0): void {
    this.y = value;
  }

  get value(): number {
    return this.y;
  }
}

/** Second-order Butterworth low-pass. */
export class Biquad {
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
    const fs = 1 / dt;
    const w0 = (2 * Math.PI * Math.min(cutoffHz, fs * 0.45)) / fs;
    const sn = Math.sin(w0);
    const cs = Math.cos(w0);
    const alpha = sn / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = (1 - cs) / 2 / a0;
    this.b1 = (1 - cs) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cs) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  apply(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}
