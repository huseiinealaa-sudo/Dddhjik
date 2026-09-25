import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, DEG } from '../sim/math';
import { terrainHeight } from '../sim/world';
import type { QuadBody } from '../sim/quad';

export type CameraMode = 'fpv' | 'chase' | 'los';
export const CAMERA_MODES: CameraMode[] = ['fpv', 'chase', 'los'];

export interface CameraSettings {
  /** Horizontal field of view of the FPV camera, degrees. */
  fpvFov: number;
  /** Uptilt override in degrees, or null for the preset's value. */
  tilt: number | null;
  /** Camera shake from vibration and prop wash, 0..1. */
  shake: number;
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

/**
 * Places the scene camera each frame from the aircraft state. Nothing is
 * parented: every mode computes a world transform from scratch, so switching
 * modes, respawning or swapping airframes can never leave the camera stranded.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(90, 1, 0.03, 6000);
  mode: CameraMode = 'fpv';
  /** Where a line-of-sight pilot stands (eye position). */
  readonly losAnchor = new Vector3(-7, 1.7, 24);
  private readonly chasePos = new Vector3();
  private readonly chaseLook = new Vector3();
  private chaseInit = false;
  private readonly losLook = new Vector3();
  private losFov = 50;
  private readonly tiltQ = new Quaternion();
  private readonly shakeQ = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly offset = new Vector3();
  private shakeT = 0;
  private impact = 0;
  private orbitAngle = 0;

  constructor(public settings: CameraSettings) {}

  setMode(mode: CameraMode): void {
    if (mode !== this.mode) this.chaseInit = false;
    this.mode = mode;
  }

  cycle(): CameraMode {
    const next = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
    this.setMode(next);
    return next;
  }

  /** Kick the camera after a hit (m/s of impact). */
  bump(speed: number): void {
    this.impact = Math.min(1, this.impact + speed / 12);
  }

  snap(): void {
    this.chaseInit = false;
  }

  private setFovHorizontal(hDeg: number, aspect: number, maxV = 140): void {
    const v = 2 * Math.atan(Math.tan((hDeg * DEG) / 2) / aspect) / DEG;
    this.camera.fov = clamp(v, 20, maxV);
  }

  update(dt: number, quad: QuadBody, cameraOffset: Vector3, aspect: number): void {
    const cam = this.camera;
    cam.aspect = aspect;
    this.shakeT += dt;
    this.impact *= Math.exp(-dt * 6);

    if (this.mode === 'fpv') {
      const tilt = (this.settings.tilt ?? quad.preset.cameraTilt) * DEG;
      this.offset.copy(cameraOffset).applyQuaternion(quad.orientation);
      cam.position.copy(quad.position).add(this.offset);
      this.tiltQ.setFromAxisAngle(X, tilt);
      cam.quaternion.copy(quad.orientation).multiply(this.tiltQ);
      // Vibration: a little high-frequency jitter from the motors, more in prop wash and after hits.
      const amp =
        this.settings.shake * (0.0009 * quad.motorLoad + 0.006 * quad.propwash) + this.impact * 0.03;
      if (amp > 1e-5) {
        const s = this.shakeT;
        this.tmp.set(Math.sin(s * 97.3) + Math.sin(s * 151.7) * 0.5, Math.sin(s * 83.1 + 1.3) * 0.6, Math.sin(s * 121.9 + 2.1));
        const angle = this.tmp.length() * amp;
        if (angle > 0) {
          this.shakeQ.setFromAxisAngle(this.tmp.normalize(), angle);
          cam.quaternion.multiply(this.shakeQ);
        }
      }
      this.setFovHorizontal(this.settings.fpvFov, aspect);
      cam.near = 0.02;
    } else if (this.mode === 'chase') {
      // Trail behind the direction of travel (or the nose when slow), slightly above.
      this.tmp.set(0, 0, -1).applyQuaternion(quad.orientation);
      this.tmp.y = 0;
      if (this.tmp.lengthSq() < 1e-4) this.tmp.set(0, 0, -1);
      this.tmp.normalize();
      const v = quad.velocity;
      const hv = Math.hypot(v.x, v.z);
      if (hv > 2) {
        const w = clamp((hv - 2) / 8, 0, 0.85);
        this.tmp2.set(v.x / hv, 0, v.z / hv);
        this.tmp.lerp(this.tmp2, w).normalize();
      }
      const dist = 2.6 + quad.preset.armLength * 6;
      const desired = this.tmp2.copy(quad.position).addScaledVector(this.tmp, -dist);
      desired.y += 0.9 + clamp(-v.y * 0.05, -0.6, 0.6);
      const ground = terrainHeight(desired.x, desired.z) + 0.4;
      if (desired.y < ground) desired.y = ground;
      if (!this.chaseInit) {
        this.chasePos.copy(desired);
        this.chaseLook.copy(quad.position);
        this.chaseInit = true;
      }
      this.chasePos.lerp(desired, 1 - Math.exp(-dt * 6));
      // Never let the lag stretch the camera out of reach at race speed.
      const d = this.chasePos.distanceTo(quad.position);
      if (d > dist * 2.2) this.chasePos.sub(quad.position).multiplyScalar((dist * 2.2) / d).add(quad.position);
      this.chaseLook.lerp(quad.position, 1 - Math.exp(-dt * 18));
      cam.position.copy(this.chasePos);
      cam.up.copy(Y);
      cam.lookAt(this.tmp.copy(this.chaseLook).addScaledVector(Y, 0.25));
      this.setFovHorizontal(95, aspect, 90);
      cam.near = 0.05;
    } else {
      // Line of sight: stand at the pilot position and track the aircraft with a zoom that keeps it readable.
      cam.position.copy(this.losAnchor);
      this.losLook.lerp(quad.position, 1 - Math.exp(-dt * 12));
      if (this.losLook.distanceToSquared(quad.position) > 400) this.losLook.copy(quad.position);
      cam.up.copy(Y);
      cam.lookAt(this.losLook);
      const dist = this.losAnchor.distanceTo(quad.position);
      const targetFov = clamp((2 * Math.atan(9 / Math.max(dist, 1))) / DEG, 18, 62);
      this.losFov += (targetFov - this.losFov) * (1 - Math.exp(-dt * 2));
      cam.fov = this.losFov;
      cam.near = 0.1;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Slow cinematic orbit used behind the menus. */
  orbit(dt: number, focus: Vector3, aspect: number, radius = 7, height = 2.2): void {
    this.orbitAngle += dt * 0.12;
    const cam = this.camera;
    cam.aspect = aspect;
    const x = focus.x + Math.cos(this.orbitAngle) * radius;
    const z = focus.z + Math.sin(this.orbitAngle) * radius;
    const ground = terrainHeight(x, z);
    cam.position.set(x, Math.max(focus.y + height, ground + 0.8), z);
    cam.up.copy(Y);
    cam.lookAt(this.tmp.copy(focus).addScaledVector(Y, 0.3));
    this.setFovHorizontal(MathUtils.clamp(70 * Math.max(1, aspect / 1.4), 60, 95), aspect, 75);
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
