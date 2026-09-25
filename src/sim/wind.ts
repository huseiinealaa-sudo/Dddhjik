import { Vector3 } from 'three';
import { clamp, DEG } from './math';

/**
 * Wind with a logarithmic boundary-layer profile (calm near the grass,
 * stronger aloft), slow gusts and faster turbulence that also varies in space,
 * so two drones a few metres apart do not feel identical air.
 */
export class Wind {
  speed = 0;
  /** Compass direction the wind blows FROM, degrees (0 = from the north, -Z). */
  fromDeg = 45;
  /** 0 = laminar, 1 = very gusty. */
  turbulence = 0.5;

  private time = 0;
  private readonly mean = new Vector3();

  configure(speed: number, fromDeg: number, turbulence: number): void {
    this.speed = Math.max(0, speed);
    this.fromDeg = fromDeg;
    this.turbulence = clamp(turbulence, 0, 1);
    const a = fromDeg * DEG;
    // Blowing towards the opposite of where it comes from.
    this.mean.set(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(this.speed);
  }

  advance(dt: number): void {
    this.time += dt;
  }

  /** Air velocity (world frame) at `pos`, written into `out`. */
  sample(pos: Vector3, heightAboveGround: number, out: Vector3): Vector3 {
    if (this.speed <= 0) return out.set(0, 0, 0);
    const t = this.time;
    const z0 = 0.03;
    const h = Math.max(heightAboveGround, 0.25);
    const profile = clamp(Math.log(h / z0) / Math.log(10 / z0), 0.25, 1.45);

    const px = pos.x * 0.045;
    const pz = pos.z * 0.045;
    const gust =
      1 +
      this.turbulence *
        (0.32 * Math.sin(0.19 * t + 1.3) + 0.22 * Math.sin(0.61 * t + 0.2 + px) + 0.12 * Math.sin(1.7 * t + pz));

    const sigma = this.turbulence * this.speed * 0.32 * profile;
    out.copy(this.mean).multiplyScalar(profile * gust);
    out.x += sigma * (0.55 * Math.sin(1.6 * t + px * 1.3 + 0.4) + 0.3 * Math.sin(4.1 * t + pz) + 0.15 * Math.sin(10.7 * t + px));
    out.y += sigma * 0.45 * (0.6 * Math.sin(2.3 * t + pz * 1.7) + 0.4 * Math.sin(7.9 * t + px));
    out.z += sigma * (0.55 * Math.sin(1.3 * t + pz * 1.1 + 2.1) + 0.3 * Math.sin(3.7 * t + px) + 0.15 * Math.sin(12.3 * t + pz));
    return out;
  }
}
