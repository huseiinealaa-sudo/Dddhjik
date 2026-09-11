/**
 * Small numeric helpers shared by the physics, flight-control and input layers.
 * Everything here is allocation free so it is safe to call from the fixed-step
 * physics loop that runs at 500 Hz.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp to the [-1, 1] range used by every normalised control channel. */
export function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `halfLife` is the time (seconds) needed to close half of the remaining gap.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(2, -dt / halfLife);
}

/** Radio-style dead-band around the stick centre, rescaled so the output still reaches ±1. */
export function applyDeadband(value: number, deadband: number): number {
  if (deadband <= 0) return value;
  const magnitude = Math.abs(value);
  if (magnitude <= deadband) return 0;
  return Math.sign(value) * ((magnitude - deadband) / (1 - deadband));
}

export function moveTowards(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Deterministic pseudo random generator so the world layout is identical on every load. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x2f6e2b1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
