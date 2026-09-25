import { Vector3 } from 'three';
import { terrainHeight } from '../sim/world';

export type DrillId = 'hover' | 'landing' | 'orbit';

export interface DrillTarget {
  position: Vector3;
  radius: number;
  kind: 'sphere' | 'pad' | 'pole';
}

export type DrillEvent =
  | { type: 'target'; index: number }
  | { type: 'complete'; time: number; score: number }
  | { type: 'hint'; key: string };

/** The permanent pylon in the meadow used by the orbit drill. */
export const ORBIT_POLE = { x: 0, z: -32, height: 8, radius: 0.22 } as const;

const at = (x: number, z: number, h: number): Vector3 => new Vector3(x, terrainHeight(x, z) + h, z);

/**
 * Training drills for new pilots. Each drill is a small state machine fed with
 * the aircraft state every frame; progress (0..1) drives the HUD bar.
 */
export class DrillSession {
  time = 0;
  progress = 0;
  index = 0;
  done = false;
  targets: DrillTarget[];
  /** Seconds spent inside the target (hover) / settled on the pad (landing). */
  private hold = 0;
  private orbitAngle = 0;
  private lastAngle: number | null = null;

  constructor(readonly id: DrillId) {
    if (id === 'hover') {
      this.targets = [
        { position: at(9, -4, 3), radius: 1.3, kind: 'sphere' },
        { position: at(-12, -22, 6), radius: 1.3, kind: 'sphere' },
        { position: at(14, -30, 2.2), radius: 1.1, kind: 'sphere' },
      ];
    } else if (id === 'landing') {
      this.targets = [
        { position: at(22, -18, 0.03), radius: 1.1, kind: 'pad' },
        { position: at(-26, -34, 0.03), radius: 1.1, kind: 'pad' },
        { position: at(8, -58, 0.03), radius: 1.0, kind: 'pad' },
        { position: at(0, 14, 0.03), radius: 1.2, kind: 'pad' },
      ];
    } else {
      this.targets = [{ position: at(ORBIT_POLE.x, ORBIT_POLE.z, 0), radius: 9, kind: 'pole' }];
    }
  }

  static readonly HOVER_SECONDS = 6;
  static readonly LAND_SECONDS = 1.2;
  static readonly ORBIT_LAPS = 2;

  reset(): void {
    this.time = 0;
    this.progress = 0;
    this.index = 0;
    this.done = false;
    this.hold = 0;
    this.orbitAngle = 0;
    this.lastAngle = null;
  }

  get target(): DrillTarget | null {
    return this.done ? null : (this.targets[this.index] ?? null);
  }

  /** Fraction of the current target's requirement met (for the ring fill). */
  get hold01(): number {
    if (this.id === 'hover') return Math.min(1, this.hold / DrillSession.HOVER_SECONDS);
    if (this.id === 'landing') return Math.min(1, this.hold / DrillSession.LAND_SECONDS);
    return Math.min(1, Math.abs(this.orbitAngle) / (Math.PI * 2 * DrillSession.ORBIT_LAPS));
  }

  update(dt: number, pos: Vector3, vel: Vector3, armed: boolean, grounded: boolean): DrillEvent[] {
    if (this.done) return [];
    const events: DrillEvent[] = [];
    const tgt = this.targets[this.index];
    if (armed || this.time > 0) this.time += dt;

    if (this.id === 'hover') {
      const inside = pos.distanceTo(tgt.position) < tgt.radius;
      this.hold = inside ? this.hold + dt : Math.max(0, this.hold - dt * 0.5);
      if (this.hold >= DrillSession.HOVER_SECONDS) this.advance(events);
    } else if (this.id === 'landing') {
      const d = Math.hypot(pos.x - tgt.position.x, pos.z - tgt.position.z);
      const settled = grounded && d < tgt.radius && vel.length() < 0.35;
      this.hold = settled ? this.hold + dt : 0;
      if (this.hold >= DrillSession.LAND_SECONDS) this.advance(events);
    } else {
      // Orbit: circle the pole at 6–14 m, below 12 m, nose free.
      const dx = pos.x - tgt.position.x;
      const dz = pos.z - tgt.position.z;
      const r = Math.hypot(dx, dz);
      const h = pos.y - tgt.position.y;
      const a = Math.atan2(dz, dx);
      if (r > 5 && r < 15 && h > 0.5 && h < 12) {
        if (this.lastAngle !== null) {
          let da = a - this.lastAngle;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          this.orbitAngle += da;
        }
        this.lastAngle = a;
      } else {
        this.lastAngle = null;
      }
      if (Math.abs(this.orbitAngle) >= Math.PI * 2 * DrillSession.ORBIT_LAPS) this.advance(events);
    }

    const per = 1 / this.targets.length;
    this.progress = this.done ? 1 : this.index * per + this.hold01 * per;
    return events;
  }

  private advance(events: DrillEvent[]): void {
    this.hold = 0;
    this.index++;
    if (this.index >= this.targets.length) {
      this.done = true;
      const par = this.id === 'hover' ? 40 : this.id === 'landing' ? 70 : 45;
      const score = Math.max(1, Math.min(3, Math.round(3 - (this.time - par) / (par * 0.6))));
      events.push({ type: 'complete', time: this.time, score });
    } else {
      events.push({ type: 'target', index: this.index });
    }
  }
}
