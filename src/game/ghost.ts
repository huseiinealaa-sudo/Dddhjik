import { Quaternion, Vector3 } from 'three';

/** Samples per second stored in a ghost. */
export const GHOST_RATE = 20;

/**
 * A recorded flight path: position (cm) and orientation (×10⁴) at a fixed
 * rate, packed as integers so a whole lap fits comfortably in localStorage.
 */
export interface GhostData {
  rate: number;
  samples: number[];
}

const STRIDE = 7;

export class GhostRecorder {
  private samples: number[] = [];
  private acc = 0;

  reset(): void {
    this.samples = [];
    this.acc = 0;
  }

  /** Call every frame; stores a sample whenever a slot is due. */
  record(dt: number, pos: Vector3, q: Quaternion): void {
    this.acc -= dt;
    if (this.acc > 0 && this.samples.length > 0) return;
    this.acc += 1 / GHOST_RATE;
    if (this.acc < 0) this.acc = 1 / GHOST_RATE;
    this.samples.push(
      Math.round(pos.x * 100),
      Math.round(pos.y * 100),
      Math.round(pos.z * 100),
      Math.round(q.x * 1e4),
      Math.round(q.y * 1e4),
      Math.round(q.z * 1e4),
      Math.round(q.w * 1e4),
    );
  }

  finish(): GhostData {
    return { rate: GHOST_RATE, samples: this.samples.slice() };
  }
}

const qa = new Quaternion();
const qb = new Quaternion();

/** Interpolated pose of a ghost at time `t` seconds; false once it has ended. */
export function sampleGhost(g: GhostData, t: number, pos: Vector3, q: Quaternion): boolean {
  const n = Math.floor(g.samples.length / STRIDE);
  if (n === 0 || t < 0) return false;
  const f = t * g.rate;
  const i = Math.floor(f);
  if (i >= n - 1) return false;
  const u = f - i;
  const s = g.samples;
  const a = i * STRIDE;
  const b = a + STRIDE;
  pos.set(
    (s[a] + (s[b] - s[a]) * u) / 100,
    (s[a + 1] + (s[b + 1] - s[a + 1]) * u) / 100,
    (s[a + 2] + (s[b + 2] - s[a + 2]) * u) / 100,
  );
  qa.set(s[a + 3], s[a + 4], s[a + 5], s[a + 6]).normalize();
  qb.set(s[b + 3], s[b + 4], s[b + 5], s[b + 6]).normalize();
  q.slerpQuaternions(qa, qb, u);
  return true;
}
