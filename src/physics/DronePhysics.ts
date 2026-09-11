import { Quaternion, Vector3 } from 'three';
import { DRONE_SPEC, WORLD } from '../core/Defaults';
import { clamp } from '../core/MathUtils';
import type { MotorOutputs } from '../flight/FlightController';
import { Battery } from './Battery';
import { CollisionWorld, createContactResult, type ContactResult } from './Collision';

/**
 * Six-degree-of-freedom rigid body for a quadcopter.
 *
 * Everything that makes a real quad feel like a quad is modelled here:
 *  - four independent motors with realistic spin-up/spin-down lag,
 *  - thrust proportional to RPM squared (which is why hover sits near 35% stick),
 *  - a full inertia tensor with the ω × Iω coupling term,
 *  - anisotropic quadratic aerodynamic drag in the *body* frame,
 *  - battery sag reducing available thrust as the pack drains,
 *  - ground effect, prop unloading in fast descents and propwash turbulence,
 *  - sphere-based collision with restitution and friction.
 */

export interface DroneState {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  /** Body-frame angular velocity in rad/s. */
  angularVelocity: Vector3;
  /** Smoothed motor outputs after ESC/motor lag, 0..1. */
  motorState: MotorOutputs;
  /** Thrust produced by each motor, newtons. */
  motorThrust: MotorOutputs;
  crashed: boolean;
  crashCount: number;
  /** Load factor felt by the airframe, in g. */
  gForce: number;
  /** 0..1 shake amplitude used by the FPV camera. */
  vibration: number;
  /** Set for one step when the frame touches anything. */
  contact: boolean;
  contactTag: string;
  contactSpeed: number;
}

const BODY_UP = new Vector3(0, 1, 0);

export interface SpawnPose {
  position: Vector3;
  headingRad: number;
}

export class DronePhysics {
  readonly state: DroneState = {
    position: new Vector3(0, DRONE_SPEC.radius, 0),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    motorState: [0, 0, 0, 0],
    motorThrust: [0, 0, 0, 0],
    crashed: false,
    crashCount: 0,
    gForce: 1,
    vibration: 0,
    contact: false,
    contactTag: '',
    contactSpeed: 0,
  };

  readonly battery = new Battery();

  /** Effective moment arm of each motor about the pitch and roll axes. */
  private readonly momentArm = DRONE_SPEC.armLength * Math.SQRT1_2;

  private readonly contactResult: ContactResult = createContactResult();

  // Scratch vectors — the physics loop must not allocate.
  private readonly force = new Vector3();
  private readonly torque = new Vector3();
  private readonly bodyVelocity = new Vector3();
  private readonly relativeWind = new Vector3();
  private readonly acceleration = new Vector3();
  private readonly inverseOrientation = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly normal = new Vector3();
  private readonly tangent = new Vector3();
  private readonly windVector = new Vector3();

  private elapsed = 0;
  private spawn: SpawnPose = { position: new Vector3(0, DRONE_SPEC.radius, 6), headingRad: 0 };

  constructor(private readonly collision: CollisionWorld) {}

  setSpawn(position: Vector3, headingRad = 0): void {
    this.spawn.position.copy(position);
    this.spawn.headingRad = headingRad;
  }

  reset(): void {
    const s = this.state;
    s.position.copy(this.spawn.position);
    s.velocity.set(0, 0, 0);
    s.orientation.setFromAxisAngle(BODY_UP, this.spawn.headingRad);
    s.angularVelocity.set(0, 0, 0);
    s.motorState[0] = s.motorState[1] = s.motorState[2] = s.motorState[3] = 0;
    s.motorThrust[0] = s.motorThrust[1] = s.motorThrust[2] = s.motorThrust[3] = 0;
    s.crashed = false;
    s.gForce = 1;
    s.vibration = 0;
    s.contact = false;
    s.contactTag = '';
    s.contactSpeed = 0;
    this.battery.reset();
    this.elapsed = 0;
  }

  /** Full reset including the crash counter — used when restarting a session. */
  hardReset(): void {
    this.reset();
    this.state.crashCount = 0;
  }

  /** Wind is a steady breeze plus a slowly wandering gust component. */
  private updateWind(speed: number): void {
    if (speed <= 0) {
      this.windVector.set(0, 0, 0);
      return;
    }
    const t = this.elapsed;
    const gust = 0.35 * Math.sin(t * 0.37) + 0.22 * Math.sin(t * 1.13 + 2.1) + 0.14 * Math.sin(t * 2.7 - 0.8);
    const direction = 0.5 * Math.sin(t * 0.11) + 0.2 * Math.sin(t * 0.53 + 1.4);
    const magnitude = speed * (1 + gust * 0.6);
    this.windVector.set(
      Math.cos(direction) * magnitude,
      0.18 * magnitude * Math.sin(t * 0.83 + 0.4),
      Math.sin(direction) * magnitude,
    );
  }

  /**
   * Advance the simulation by one fixed step.
   *
   * @param motorCommands normalised mixer output, 0..1 per motor
   * @param dt            fixed timestep in seconds
   */
  step(
    motorCommands: MotorOutputs,
    dt: number,
    options: { batteryEnabled: boolean; windSpeed: number },
  ): void {
    const s = this.state;
    this.elapsed += dt;
    this.updateWind(options.windSpeed);

    // ---------------------------------------------------------------- motors
    // Props spin up faster than they slow down: only the motor can add energy,
    // air drag has to remove it.
    let motorLoad = 0;
    const thrustScale = this.battery.thrustScale(options.batteryEnabled);
    const batteryDead = options.batteryEnabled && this.battery.empty;

    // Prop inflow: descending unloads the props, forward flight gives a little
    // extra lift (translational lift), both scaled by the axial airspeed.
    this.relativeWind.copy(s.velocity).sub(this.windVector);
    this.inverseOrientation.copy(s.orientation).invert();
    this.bodyVelocity.copy(this.relativeWind).applyQuaternion(this.inverseOrientation);

    const axialInflow = this.bodyVelocity.y; // positive = air pushed up through the disc
    const lateralFlow = Math.hypot(this.bodyVelocity.x, this.bodyVelocity.z);
    const unloading = clamp(1 - Math.max(-axialInflow, 0) * 0.028, 0.55, 1);
    const translationalLift = 1 + clamp(lateralFlow * 0.006, 0, 0.09);

    // Ground effect: extra lift within roughly one prop diameter of a surface.
    const groundClearance = Math.max(s.position.y - DRONE_SPEC.radius, 0);
    const groundEffect = 1 + 0.18 * clamp(1 - groundClearance / 0.45, 0, 1);

    for (let i = 0; i < 4; i++) {
      const command = batteryDead ? 0 : clamp(motorCommands[i], 0, 1);
      const rising = command > s.motorState[i];
      const tau = rising
        ? DRONE_SPEC.motorTimeConstant
        : DRONE_SPEC.motorTimeConstant * DRONE_SPEC.motorSpindownFactor;
      const alpha = 1 - Math.exp(-dt / tau);
      s.motorState[i] += (command - s.motorState[i]) * alpha;

      const rpmFraction = s.motorState[i];
      // Thrust is proportional to RPM^2 — this is why hover sits around 35% stick.
      s.motorThrust[i] =
        DRONE_SPEC.maxThrustPerMotor *
        rpmFraction *
        rpmFraction *
        thrustScale *
        unloading *
        translationalLift *
        groundEffect;
      motorLoad += rpmFraction;
    }

    this.battery.update(motorLoad, dt, options.batteryEnabled);

    const totalThrust =
      s.motorThrust[0] + s.motorThrust[1] + s.motorThrust[2] + s.motorThrust[3];

    // ---------------------------------------------------------------- forces
    // Thrust acts along the body up axis.
    this.force.set(0, totalThrust, 0).applyQuaternion(s.orientation);

    // Gravity.
    this.force.y -= DRONE_SPEC.mass * WORLD.gravity;

    // Anisotropic quadratic drag, evaluated in the body frame then rotated out.
    const dragX = -DRONE_SPEC.drag.x * this.bodyVelocity.x * Math.abs(this.bodyVelocity.x);
    const dragY = -DRONE_SPEC.drag.y * this.bodyVelocity.y * Math.abs(this.bodyVelocity.y);
    const dragZ = -DRONE_SPEC.drag.z * this.bodyVelocity.z * Math.abs(this.bodyVelocity.z);
    this.acceleration.set(dragX, dragY, dragZ).applyQuaternion(s.orientation);
    this.force.add(this.acceleration);

    // --------------------------------------------------------------- torques
    const tFL = s.motorThrust[0];
    const tFR = s.motorThrust[1];
    const tRL = s.motorThrust[2];
    const tRR = s.motorThrust[3];

    // See FlightController for the derivation of these signs.
    this.torque.set(
      this.momentArm * (tFL + tFR - tRL - tRR),
      DRONE_SPEC.yawTorqueRatio * (tFL + tRR - tFR - tRL),
      this.momentArm * (tFR + tRR - tFL - tRL),
    );

    // Rotational drag.
    const w = s.angularVelocity;
    this.torque.x -= DRONE_SPEC.angularDrag.x * w.x * Math.abs(w.x);
    this.torque.y -= DRONE_SPEC.angularDrag.y * w.y * Math.abs(w.y);
    this.torque.z -= DRONE_SPEC.angularDrag.z * w.z * Math.abs(w.z);

    // Propwash: descending through your own turbulent air makes the quad
    // twitchy. It only shows up at low forward speed and high descent rate.
    const propwash = clamp((-axialInflow - 2) * 0.09, 0, 1) * clamp(1 - lateralFlow / 9, 0, 1);
    if (propwash > 0.001) {
      const t = this.elapsed;
      this.torque.x += Math.sin(t * 41.3) * propwash * 0.09;
      this.torque.z += Math.sin(t * 37.1 + 1.9) * propwash * 0.09;
      this.torque.y += Math.sin(t * 29.7 + 0.6) * propwash * 0.04;
    }

    // Gyroscopic coupling: omega x (I * omega).
    const Ix = DRONE_SPEC.inertia.x;
    const Iy = DRONE_SPEC.inertia.y;
    const Iz = DRONE_SPEC.inertia.z;
    this.torque.x -= w.y * (Iz * w.z) - w.z * (Iy * w.y);
    this.torque.y -= w.z * (Ix * w.x) - w.x * (Iz * w.z);
    this.torque.z -= w.x * (Iy * w.y) - w.y * (Ix * w.x);

    // ------------------------------------------------------------- integrate
    w.x += (this.torque.x / Ix) * dt;
    w.y += (this.torque.y / Iy) * dt;
    w.z += (this.torque.z / Iz) * dt;

    // Quaternion integration: q' = q + 0.5 * q * omega * dt (body-frame omega).
    this.spin.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
    this.spin.multiplyQuaternions(s.orientation, this.spin);
    s.orientation.x += this.spin.x;
    s.orientation.y += this.spin.y;
    s.orientation.z += this.spin.z;
    s.orientation.w += this.spin.w;
    s.orientation.normalize();

    this.acceleration.copy(this.force).divideScalar(DRONE_SPEC.mass);
    s.velocity.addScaledVector(this.acceleration, dt);
    s.position.addScaledVector(s.velocity, dt);

    // Load factor: the non-gravity part of the acceleration, in g.
    s.gForce = Math.hypot(
      this.acceleration.x,
      this.acceleration.y + WORLD.gravity,
      this.acceleration.z,
    ) / WORLD.gravity;

    // Vibration for the camera shake: motor output plus a bit of propwash.
    const meanMotor = motorLoad * 0.25;
    s.vibration = clamp(meanMotor * 0.55 + propwash * 0.7 + s.gForce * 0.05, 0, 1.2);

    this.resolveCollisions(dt);
    this.clampToWorld();
  }

  private resolveCollisions(dt: number): void {
    const s = this.state;
    s.contact = false;
    s.contactTag = '';
    s.contactSpeed = 0;

    const contact = this.collision.querySphere(s.position, DRONE_SPEC.radius, this.contactResult);
    if (!contact.hit) return;

    this.normal.set(contact.nx, contact.ny, contact.nz);
    const impactSpeed = -s.velocity.dot(this.normal);

    s.contact = true;
    s.contactTag = contact.tag;
    s.contactSpeed = Math.max(impactSpeed, 0);

    // Push the body back out of the surface (with a little slop to avoid jitter).
    s.position.addScaledVector(this.normal, contact.depth);

    if (impactSpeed > 0) {
      // Normal impulse with restitution — softer for gentle touchdowns.
      const restitution = impactSpeed > 1.2 ? DRONE_SPEC.restitution : 0.05;
      s.velocity.addScaledVector(this.normal, impactSpeed * (1 + restitution));

      // Tangential friction.
      this.tangent.copy(s.velocity).addScaledVector(this.normal, -s.velocity.dot(this.normal));
      const tangentSpeed = this.tangent.length();
      if (tangentSpeed > 1e-4) {
        const friction = Math.min(
          tangentSpeed,
          DRONE_SPEC.friction * Math.max(impactSpeed, WORLD.gravity * dt) * 3.2,
        );
        this.tangent.multiplyScalar(friction / tangentSpeed);
        s.velocity.sub(this.tangent);
      }

      // Scrubbing off rotation, plus a kick from the off-centre impact.
      const spinLoss = clamp(1 - impactSpeed * 0.35, 0.1, 0.96);
      s.angularVelocity.multiplyScalar(spinLoss);

      if (impactSpeed > DRONE_SPEC.crashSpeed && !s.crashed) {
        s.crashed = true;
        s.crashCount += 1;
      }
    } else {
      // Resting on a surface: bleed off the sliding and spinning.
      const damping = Math.max(1 - dt * 6, 0);
      this.tangent.copy(s.velocity).addScaledVector(this.normal, -s.velocity.dot(this.normal));
      s.velocity.addScaledVector(this.tangent, damping - 1);
      s.angularVelocity.multiplyScalar(Math.max(1 - dt * 8, 0));
    }
  }

  /** Keep the aircraft inside the playable volume. */
  private clampToWorld(): void {
    const s = this.state;
    const limit = WORLD.size;
    if (s.position.x < -limit) {
      s.position.x = -limit;
      s.velocity.x = Math.abs(s.velocity.x) * 0.2;
    } else if (s.position.x > limit) {
      s.position.x = limit;
      s.velocity.x = -Math.abs(s.velocity.x) * 0.2;
    }
    if (s.position.z < -limit) {
      s.position.z = -limit;
      s.velocity.z = Math.abs(s.velocity.z) * 0.2;
    } else if (s.position.z > limit) {
      s.position.z = limit;
      s.velocity.z = -Math.abs(s.velocity.z) * 0.2;
    }
    if (s.position.y > WORLD.ceiling) {
      s.position.y = WORLD.ceiling;
      if (s.velocity.y > 0) s.velocity.y = 0;
    }
  }
}
