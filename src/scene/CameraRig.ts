import { Euler, MathUtils as ThreeMath, Object3D, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp, DEG2RAD } from '../core/MathUtils';
import type { CameraMode } from '../core/Types';
import type { DroneState } from '../physics/DronePhysics';

/**
 * Camera handling for the three viewing modes.
 *
 * FPV is the important one: the camera is rigidly attached to the airframe with
 * a fixed up-tilt, exactly like a real FPV camera. Nothing is smoothed — a real
 * quad's video feed shows every single degree of rotation, and that raw,
 * unfiltered motion is precisely what makes FPV feel the way it does.
 * The only addition is a small vibration offset driven by motor RPM.
 */

const CHASE_OFFSET = new Vector3(0, 0.9, 3.4);
const MIN_ORBIT_DISTANCE = 2;
const MAX_ORBIT_DISTANCE = 60;

export class CameraRig {
  readonly camera: PerspectiveCamera;

  /** Horizontal field of view in degrees; converted to vertical on resize. */
  private horizontalFov = 118;
  private aspect = 16 / 9;

  private mode: CameraMode = 'fpv';
  private tiltRad = 25 * DEG2RAD;

  // FPV shake state.
  private shakeTime = 0;
  private readonly shakeEuler = new Euler();
  private readonly shakeQuat = new Quaternion();

  // Chase camera state.
  private readonly chasePosition = new Vector3(0, 3, 8);
  private readonly chaseTarget = new Vector3();
  private readonly desiredChase = new Vector3();
  private readonly yawOnly = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  // Orbit camera state.
  private orbitYaw = 0.6;
  private orbitPitch = 0.35;
  private orbitDistance = 9;
  private readonly orbitPosition = new Vector3();

  private readonly scratch = new Vector3();

  constructor(private readonly mount: Object3D) {
    this.camera = new PerspectiveCamera(90, this.aspect, 0.05, 3000);
    this.camera.name = 'flight-camera';
    this.applyFov();
  }

  /**
   * Idempotent on purpose: the very first call selects the default mode, so an
   * early return on "already in this mode" would leave the FPV camera sitting
   * unparented at the world origin instead of bolted to the airframe.
   */
  setMode(mode: CameraMode, dronePosition: Vector3): void {
    const changed = this.mode !== mode;
    this.mode = mode;

    if (mode === 'fpv') {
      if (this.camera.parent !== this.mount) this.mount.add(this.camera);
      this.camera.position.set(0, 0, 0);
      this.camera.rotation.set(0, 0, 0);
      return;
    }

    if (this.camera.parent === this.mount) this.mount.remove(this.camera);
    if (mode === 'chase' && changed) {
      this.chasePosition.copy(dronePosition).add(CHASE_OFFSET);
    }
  }

  get currentMode(): CameraMode {
    return this.mode;
  }

  setTilt(degrees: number): void {
    this.tiltRad = clamp(degrees, 0, 60) * DEG2RAD;
  }

  setHorizontalFov(degrees: number): void {
    this.horizontalFov = clamp(degrees, 60, 160);
    this.applyFov();
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.applyFov();
  }

  /** Convert the pilot-facing horizontal FOV into the vertical FOV three.js wants. */
  private applyFov(): void {
    const horizontal = this.horizontalFov * DEG2RAD;
    const vertical = 2 * Math.atan(Math.tan(horizontal / 2) / Math.max(this.aspect, 0.1));
    this.camera.fov = ThreeMath.clamp(vertical / DEG2RAD, 20, 160);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Pointer drag from the canvas, used by the orbit camera. */
  orbitDrag(dx: number, dy: number): void {
    this.orbitYaw -= dx * 0.005;
    this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, -1.2, 1.35);
  }

  orbitZoom(delta: number): void {
    this.orbitDistance = clamp(this.orbitDistance * (1 + delta * 0.0015), MIN_ORBIT_DISTANCE, MAX_ORBIT_DISTANCE);
  }

  update(state: DroneState, droneObject: Object3D, dt: number): void {
    switch (this.mode) {
      case 'fpv':
        this.updateFpv(state, dt);
        break;
      case 'chase':
        this.updateChase(state, droneObject, dt);
        break;
      case 'orbit':
        this.updateOrbit(state, dt);
        break;
    }
  }

  private updateFpv(state: DroneState, dt: number): void {
    this.shakeTime += dt;

    // Vibration: a couple of incommensurable sine waves read as mechanical
    // buzz far better than white noise, and they cost nothing.
    const amount = clamp(state.vibration, 0, 1.2) * 0.0016;
    const t = this.shakeTime;
    const pitchShake = (Math.sin(t * 137.1) + 0.6 * Math.sin(t * 219.7)) * amount;
    const yawShake = (Math.sin(t * 151.3 + 1.1) + 0.6 * Math.sin(t * 197.9)) * amount;
    const rollShake = Math.sin(t * 173.7 + 0.4) * amount * 0.7;

    this.shakeEuler.set(this.tiltRad + pitchShake, yawShake, rollShake, 'YXZ');
    this.shakeQuat.setFromEuler(this.shakeEuler);
    this.camera.quaternion.copy(this.shakeQuat);
    this.camera.position.set(0, 0, 0);
  }

  private updateChase(state: DroneState, droneObject: Object3D, dt: number): void {
    // Follow the drone's heading but ignore its roll and pitch, otherwise the
    // chase view becomes unwatchable during flips.
    const forward = this.scratch.set(0, 0, -1).applyQuaternion(state.orientation);
    const heading = Math.atan2(forward.x, forward.z);
    this.yawOnly.setFromAxisAngle(this.up, heading);

    this.desiredChase.copy(CHASE_OFFSET).applyQuaternion(this.yawOnly).add(droneObject.position);
    // Keep the camera above the ground.
    this.desiredChase.y = Math.max(this.desiredChase.y, droneObject.position.y * 0.25 + 0.6);

    const halfLife = 0.09;
    this.chasePosition.set(
      damp(this.chasePosition.x, this.desiredChase.x, halfLife, dt),
      damp(this.chasePosition.y, this.desiredChase.y, halfLife, dt),
      damp(this.chasePosition.z, this.desiredChase.z, halfLife, dt),
    );

    // Look slightly ahead of the aircraft so fast passes stay framed.
    this.scratch.copy(state.velocity).multiplyScalar(0.12);
    this.chaseTarget.copy(droneObject.position).add(this.scratch);

    this.camera.position.copy(this.chasePosition);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.chaseTarget);
  }

  private updateOrbit(state: DroneState, dt: number): void {
    const cosPitch = Math.cos(this.orbitPitch);
    this.orbitPosition.set(
      Math.sin(this.orbitYaw) * cosPitch,
      Math.sin(this.orbitPitch),
      Math.cos(this.orbitYaw) * cosPitch,
    );
    this.orbitPosition.multiplyScalar(this.orbitDistance).add(state.position);
    this.orbitPosition.y = Math.max(this.orbitPosition.y, 0.4);

    const halfLife = 0.05;
    this.camera.position.set(
      damp(this.camera.position.x, this.orbitPosition.x, halfLife, dt),
      damp(this.camera.position.y, this.orbitPosition.y, halfLife, dt),
      damp(this.camera.position.z, this.orbitPosition.z, halfLife, dt),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(state.position);
  }
}
