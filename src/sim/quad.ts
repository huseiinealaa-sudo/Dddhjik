import { Quaternion, Vector3 } from 'three';
import { Battery } from './battery';
import { createContact, sphereVsCollider, SURFACE, type Collider, type CollisionWorld, type Contact, type SurfaceTag } from './collision';
import { MOTOR_SPIN, MOTOR_X, MOTOR_Z } from './layout';
import { AIR_DENSITY, clamp, G, smoothstep } from './math';
import { thrustCoefficient, type QuadPreset } from './presets';
import type { Wind } from './wind';
import { isOverWater, LAKE, terrainHeight, terrainNormal, WORLD } from './world';

/**
 * Six-degree-of-freedom quadcopter.
 *
 * What is modelled, and why it matters for the feel:
 *  - four motors with first-order RPM dynamics (faster up than down); thrust
 *    and drag torque go with RPM squared, so hover sits around a third of stick;
 *  - prop advance ratio: thrust falls as air rushes through the disc, which is
 *    what gives a quad a real top speed and a finite climb rate;
 *  - per-rotor inflow including the body's own rotation, which produces the
 *    natural aerodynamic damping of a real airframe;
 *  - rotor in-plane drag ("H-force") — the reason a levelled quad bleeds speed;
 *  - quadratic body drag, windmilling-disc drag in a flat fall, ground effect,
 *    vortex-ring/propwash thrust loss with its characteristic shake;
 *  - rotor inertia (yaw kick on throttle changes) and gyroscopic coupling;
 *  - battery sag reducing available RPM;
 *  - rigid-body contacts on ~20 small spheres with friction, restitution and
 *    angular response, so the frame lands on its arms, tips, tumbles and can
 *    come to rest upside down (hence turtle mode).
 */

export interface ContactSphere {
  x: number;
  y: number;
  z: number;
  r: number;
  prop: boolean;
}

export interface StepEnvironment {
  world: CollisionWorld;
  wind: Wind;
  batteryDrain: boolean;
}

const MAX_CONTACTS = 48;
const MAX_CANDIDATES = 256;
const SOLVER_ITERATIONS = 6;

/** Collision spheres rigidly attached to the airframe, generated from the preset. */
export function buildContactSpheres(p: QuadPreset): ContactSphere[] {
  const a = p.armLength * Math.SQRT1_2;
  const s = p.armLength / 0.1125;
  const propR = p.propDiameter / 2;
  const out: ContactSphere[] = [];

  for (let i = 0; i < 4; i++) {
    const mx = MOTOR_X[i] * a;
    const mz = MOTOR_Z[i] * a;
    // Motor bottom ("feet") and motor top.
    out.push({ x: mx, y: -0.008 * s, z: mz, r: 0.014 * s, prop: false });
    out.push({ x: mx, y: p.propHeight + 0.004, z: mz, r: 0.012 * s, prop: false });

    // Prop tips, or the full duct rim for a cinewhoop.
    const baseAngle = Math.atan2(MOTOR_Z[i], MOTOR_X[i]);
    const angles = p.ducted ? [0, Math.PI / 2, Math.PI, -Math.PI / 2] : [0, 0.75, -0.75];
    const tipR = p.ducted ? 0.02 * s : 0.017 * s;
    const reach = p.ducted ? propR + 0.006 - tipR * 0.3 : propR - tipR * 0.9;
    for (const off of angles) {
      const ang = baseAngle + off;
      out.push({
        x: mx + Math.cos(ang) * reach,
        y: p.ducted ? p.propHeight * 0.4 : p.propHeight,
        z: mz + Math.sin(ang) * reach,
        r: tipR,
        prop: !p.ducted,
      });
    }
  }

  // Frame centre bottom, camera, tail, flanks and the battery on top.
  out.push({ x: 0, y: -0.012 * s, z: 0, r: 0.012 * s, prop: false });
  out.push({ x: 0, y: 0.012 * s, z: -0.064 * s, r: 0.022 * s, prop: false });
  out.push({ x: 0, y: 0.016 * s, z: 0.064 * s, r: 0.022 * s, prop: false });
  out.push({ x: -0.064 * s, y: 0.012 * s, z: 0, r: 0.018 * s, prop: false });
  out.push({ x: 0.064 * s, y: 0.012 * s, z: 0, r: 0.018 * s, prop: false });
  out.push({ x: 0, y: 0.05 * s, z: 0.006 * s, r: 0.03 * s, prop: false });
  return out;
}

export class QuadBody {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  /** Body-frame angular velocity, rad/s (x = pitch, y = yaw, z = roll). */
  readonly angularVelocity = new Vector3();
  /** Signed motor speeds, rad/s (negative = reversed, turtle mode). */
  readonly omega = new Float64Array(4);
  /** Per-motor thrust, newtons (negative when reversed). */
  readonly thrust = new Float64Array(4);
  readonly battery: Battery;
  readonly contactSpheres: ContactSphere[];
  readonly boundingRadius: number;

  // ---- telemetry, refreshed every step
  gForce = 1;
  airspeed = 0;
  heightAboveGround = 0;
  inContact = false;
  /** Peak normal impact speed during the last step, m/s. */
  impactSpeed = 0;
  impactTag: SurfaceTag = 'ground';
  propStrike = false;
  inWater = false;
  /** Body up · world up: 1 upright, -1 upside down. */
  upright = 1;
  /** Mean motor speed as a fraction of the maximum. */
  motorLoad = 0;
  /** 0..1 vortex-ring / propwash severity. */
  propwash = 0;
  groundEffect = 1;
  /** Scales the propwash shake (0 = off, 1 = realistic). Exposed as a setting. */
  propwashGain = 1;

  private readonly kT: number;
  private readonly kQ: number;
  private readonly arm: number;
  private readonly pitchConst: number;
  private readonly hoverInducedVelocity: number;
  private readonly discDrag: number;
  private readonly inertia: [number, number, number];
  private time = 0;

  // scratch
  private readonly windVel = new Vector3();
  private readonly relAir = new Vector3();
  private readonly vb = new Vector3();
  private readonly invQ = new Quaternion();
  private readonly force = new Vector3();
  private readonly tmp = new Vector3();
  private readonly spin = new Quaternion();
  private readonly groundN = new Vector3();
  private readonly wWorld = new Vector3();
  private readonly contacts: Contact[] = [];
  private readonly contactIsProp = new Uint8Array(MAX_CONTACTS);
  private readonly candidates: Collider[] = new Array(MAX_CANDIDATES);
  private readonly scratchContact = createContact();
  private readonly iw = new Float64Array(9);
  private readonly accN = new Float64Array(MAX_CONTACTS);
  private readonly accT1 = new Float64Array(MAX_CONTACTS);
  private readonly accT2 = new Float64Array(MAX_CONTACTS);
  private readonly target = new Float64Array(MAX_CONTACTS);
  private readonly kn = new Float64Array(MAX_CONTACTS);
  private readonly rArr = new Float64Array(MAX_CONTACTS * 3);
  private readonly t1Arr = new Float64Array(MAX_CONTACTS * 3);
  private readonly t2Arr = new Float64Array(MAX_CONTACTS * 3);
  private readonly kt1 = new Float64Array(MAX_CONTACTS);
  private readonly kt2 = new Float64Array(MAX_CONTACTS);

  constructor(readonly preset: QuadPreset) {
    this.kT = thrustCoefficient(preset);
    this.kQ = this.kT * preset.torqueRatio;
    this.arm = preset.armLength * Math.SQRT1_2;
    // Real props stop producing thrust roughly 20% above their geometric
    // pitch speed (blade twist and the aerofoil's zero-lift angle).
    this.pitchConst = (2 * Math.PI) / (preset.propPitch * 1.2);
    const discArea = Math.PI * (preset.propDiameter / 2) ** 2;
    this.hoverInducedVelocity = Math.sqrt((preset.mass * G) / 4 / (2 * AIR_DENSITY * discArea));
    this.discDrag = 0.5 * AIR_DENSITY * 1.0 * 4 * discArea;
    this.inertia = [preset.inertia[0], preset.inertia[1], preset.inertia[2]];
    this.battery = new Battery(preset.battery);
    this.contactSpheres = buildContactSpheres(preset);
    let r = 0;
    for (const s of this.contactSpheres) r = Math.max(r, Math.hypot(s.x, s.y, s.z) + s.r);
    this.boundingRadius = r + 0.02;
    for (let i = 0; i < MAX_CONTACTS; i++) this.contacts.push(createContact());
  }

  reset(position: Vector3, headingRad: number, keepBattery = false): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.orientation.setFromAxisAngle(this.tmp.set(0, 1, 0), headingRad);
    this.angularVelocity.set(0, 0, 0);
    this.omega.fill(0);
    this.thrust.fill(0);
    if (!keepBattery) this.battery.reset();
    this.gForce = 1;
    this.impactSpeed = 0;
    this.inContact = false;
    this.propStrike = false;
    this.inWater = false;
    this.propwash = 0;
  }

  /** Compass heading (degrees, 0 = -Z, clockwise) of the nose, ignoring tilt. */
  get headingDeg(): number {
    this.tmp.set(0, 0, -1).applyQuaternion(this.orientation);
    let h = (Math.atan2(this.tmp.x, -this.tmp.z) * 180) / Math.PI;
    if (h < 0) h += 360;
    return h;
  }

  /**
   * Advance by one fixed step.
   * @param cmd motor commands in [-1, 1]; negative spins a motor in reverse.
   */
  step(cmd: ArrayLike<number>, dt: number, env: StepEnvironment): void {
    const p = this.preset;
    this.time += dt;

    const groundY = terrainHeight(this.position.x, this.position.z);
    this.heightAboveGround = this.position.y - groundY;

    // ------------------------------------------------------------------ air
    env.wind.advance(dt);
    env.wind.sample(this.position, this.heightAboveGround, this.windVel);
    this.relAir.copy(this.velocity).sub(this.windVel);
    this.invQ.copy(this.orientation).invert();
    const vb = this.vb.copy(this.relAir).applyQuaternion(this.invQ);
    this.airspeed = this.relAir.length();

    this.tmp.set(0, 1, 0).applyQuaternion(this.orientation);
    this.upright = this.tmp.y;

    // Propwash / vortex ring: sinking through your own downwash.
    const inPlane = Math.hypot(vb.x, vb.z);
    const descent = -vb.y / this.hoverInducedVelocity;
    this.propwash =
      smoothstep(0.25, 0.75, descent) *
      (1 - smoothstep(1.4, 2.2, descent)) *
      (1 - smoothstep(0.35 * this.hoverInducedVelocity, 1.1 * this.hoverInducedVelocity, inPlane)) *
      smoothstep(0.08, 0.3, this.motorLoad);

    // Ground effect: a cushion within about one prop diameter of the ground.
    const propClearance = Math.max(this.heightAboveGround, 0.02);
    const ge = 1 - smoothstep(0, 1.6 * p.propDiameter, propClearance);
    this.groundEffect = this.upright > 0.5 ? 1 + 0.16 * ge * ge : 1;

    // -------------------------------------------------------------- motors
    const vRatio = clamp(this.battery.voltage / this.battery.fullVoltage, 0.2, 1.05);
    const omegaMaxEff = p.omegaMax * vRatio;
    const w = this.angularVelocity;
    const a = this.arm;
    const ry = p.propHeight;
    const thrustScale = this.groundEffect * (1 - 0.28 * this.propwash);

    let fy = 0;
    let fx = 0;
    let fz = 0;
    let tx = 0;
    let ty = 0;
    let tz = 0;
    let sumW = 0;
    let power = 0;
    let hRotor = 0;

    for (let i = 0; i < 4; i++) {
      const target = clamp(cmd[i], -1, 1) * omegaMaxEff;
      const om = this.omega[i];
      const sameDirection = target === 0 || om === 0 || Math.sign(target) === Math.sign(om);
      const spinningUp = sameDirection && Math.abs(target) > Math.abs(om);
      const tau = spinningUp ? p.motorTauUp : p.motorTauDown;
      const next = om + (target - om) * (1 - Math.exp(-dt / tau));
      const alpha = (next - om) / dt;
      this.omega[i] = next;
      const aw = Math.abs(next);
      sumW += aw;

      const rx = MOTOR_X[i] * a;
      const rz = MOTOR_Z[i] * a;
      // Local airflow at this rotor includes the body's own rotation (w x r).
      const axial = vb.y + (w.z * rx - w.x * rz);
      const inX = vb.x + (w.y * rz - w.z * ry);
      const inZ = vb.z + (w.x * ry - w.y * rx);

      let t = 0;
      if (aw > 1) {
        if (next > 0) {
          const staticThrust = this.kT * aw * aw;
          t = this.kT * aw * (aw - this.pitchConst * axial);
          if (t > staticThrust * 1.2) t = staticThrust * 1.2;
          if (t < 0) t = 0;
        } else {
          // Props spinning backwards are far less efficient.
          t = -0.55 * this.kT * aw * aw;
        }
      }
      t *= thrustScale;
      this.thrust[i] = t;

      fy += t;
      tx += -rz * t;
      tz += rx * t;
      // Drag torque plus the reaction of accelerating the rotor.
      ty += MOTOR_SPIN[i] * (this.kQ * next * aw + p.rotorInertia * alpha);

      // Rotor in-plane drag (H-force), applied at the rotor.
      const h = -p.rotorDrag * (aw / p.omegaMax);
      const hx = h * inX;
      const hz = h * inZ;
      fx += hx;
      fz += hz;
      tx += ry * hz;
      ty += rz * hx - rx * hz;
      tz += -ry * hx;

      power += this.kQ * aw * aw * aw;
      hRotor += -MOTOR_SPIN[i] * next * p.rotorInertia;
    }
    this.motorLoad = sumW / (4 * p.omegaMax);

    // Propwash shake: smooth pseudo-random torques while in the wash.
    if (this.propwash > 0.01 && this.propwashGain > 0) {
      const amp = this.propwash * this.propwashGain * 0.012 * p.maxThrust * p.armLength * 8;
      const tt = this.time;
      tx += amp * (Math.sin(tt * 61.3) + 0.6 * Math.sin(tt * 97.1 + 1.1) + 0.4 * Math.sin(tt * 23.7 + 2.3));
      tz += amp * (Math.sin(tt * 57.9 + 0.7) + 0.6 * Math.sin(tt * 103.3 + 2.9) + 0.4 * Math.sin(tt * 29.1));
      ty += amp * 0.3 * Math.sin(tt * 41.7 + 0.4);
    }

    // ---------------------------------------------------------- body drag
    const [cx, cy, cz] = p.bodyDrag;
    fx -= cx * vb.x * Math.abs(vb.x);
    fy -= cy * vb.y * Math.abs(vb.y);
    fz -= cz * vb.z * Math.abs(vb.z);
    if (vb.y < 0) {
      // Slow-spinning props act like a windmilling disc in a flat fall.
      const disc = clamp(this.motorLoad / 0.1, 0, 1) * (1 - smoothstep(0.22, 0.45, this.motorLoad));
      fy += this.discDrag * disc * vb.y * vb.y;
    }

    // Aerodynamic rotational damping of the frame itself (small).
    const ad = 2.2e-5 * (p.armLength / 0.1125) ** 3;
    tx -= ad * w.x * Math.abs(w.x);
    ty -= ad * w.y * Math.abs(w.y);
    tz -= ad * w.z * Math.abs(w.z);

    // Gyroscopic coupling of the spinning rotors (H along body y).
    tx += w.z * hRotor;
    tz -= w.x * hRotor;

    // ------------------------------------------------------------ battery
    const amps = power / (0.78 * Math.max(this.battery.voltage, 1)) + 0.6;
    this.battery.update(amps, dt, env.batteryDrain);

    // ---------------------------------------------------------- integrate
    const [ix, iy, iz] = this.inertia;
    // Euler's equations: I dw/dt = tau - w x (I w)
    const gx = w.y * iz * w.z - w.z * iy * w.y;
    const gy = w.z * ix * w.x - w.x * iz * w.z;
    const gz = w.x * iy * w.y - w.y * ix * w.x;
    w.x += ((tx - gx) / ix) * dt;
    w.y += ((ty - gy) / iy) * dt;
    w.z += ((tz - gz) / iz) * dt;

    const q = this.orientation;
    this.spin.set(w.x * 0.5 * dt, w.y * 0.5 * dt, w.z * 0.5 * dt, 0);
    this.spin.premultiply(q); // q * (0, w)
    q.set(q.x + this.spin.x, q.y + this.spin.y, q.z + this.spin.z, q.w + this.spin.w).normalize();

    this.force.set(fx, fy, fz).applyQuaternion(q);
    this.gForce = this.force.length() / (p.mass * G);
    this.velocity.x += (this.force.x / p.mass) * dt;
    this.velocity.y += (this.force.y / p.mass - G) * dt;
    this.velocity.z += (this.force.z / p.mass) * dt;
    this.position.addScaledVector(this.velocity, dt);

    this.resolveContacts(env, dt);
    this.keepInsideWorld(dt);
  }

  // ---------------------------------------------------------------------
  // Contacts: sequential impulses with Baumgarte stabilisation.
  // ---------------------------------------------------------------------

  private resolveContacts(env: StepEnvironment, dt: number): void {
    this.inContact = false;
    this.impactSpeed = 0;
    this.propStrike = false;
    this.inWater = false;

    const pos = this.position;
    const R = this.boundingRadius;
    const groundY = terrainHeight(pos.x, pos.z);
    const nearGround = pos.y - R < groundY + 0.02;
    const nearLake = Math.hypot(pos.x - LAKE.x, pos.z - LAKE.z) < LAKE.radius * 1.25;
    const nearWater = nearLake && pos.y - R < WORLD.waterLevel;
    const nCand = env.world.gather(pos.x, pos.y, pos.z, R, this.candidates);
    if (!nearGround && !nearWater && nCand === 0) return;

    if (nearGround) terrainNormal(pos.x, pos.z, this.groundN);
    const gn = this.groundN;
    const q = this.orientation;
    let n = 0;

    for (const s of this.contactSpheres) {
      if (n >= MAX_CONTACTS) break;
      const c = this.tmp.set(s.x, s.y, s.z).applyQuaternion(q).add(pos);

      if (nearGround) {
        const dist = (c.x - pos.x) * gn.x + (c.y - groundY) * gn.y + (c.z - pos.z) * gn.z - s.r;
        if (dist < 0) {
          const k = this.contacts[n];
          k.nx = gn.x;
          k.ny = gn.y;
          k.nz = gn.z;
          k.depth = -dist;
          k.px = c.x - gn.x * s.r;
          k.py = c.y - gn.y * s.r;
          k.pz = c.z - gn.z * s.r;
          k.tag = 'ground';
          this.contactIsProp[n] = s.prop ? 1 : 0;
          n++;
          if (n >= MAX_CONTACTS) break;
        }
      }

      if (nearWater && c.y - s.r < WORLD.waterLevel && isOverWater(c.x, c.z)) {
        const k = this.contacts[n];
        k.nx = 0;
        k.ny = 1;
        k.nz = 0;
        k.depth = WORLD.waterLevel - (c.y - s.r);
        k.px = c.x;
        k.py = c.y - s.r;
        k.pz = c.z;
        k.tag = 'water';
        this.contactIsProp[n] = s.prop ? 1 : 0;
        this.inWater = true;
        n++;
        if (n >= MAX_CONTACTS) break;
      }

      for (let j = 0; j < nCand && n < MAX_CONTACTS; j++) {
        if (sphereVsCollider(this.candidates[j], c.x, c.y, c.z, s.r, this.scratchContact)) {
          const k = this.contacts[n];
          const sc = this.scratchContact;
          k.nx = sc.nx;
          k.ny = sc.ny;
          k.nz = sc.nz;
          k.depth = sc.depth;
          k.px = sc.px;
          k.py = sc.py;
          k.pz = sc.pz;
          k.tag = sc.tag;
          this.contactIsProp[n] = s.prop ? 1 : 0;
          n++;
        }
      }
    }

    if (n === 0) return;
    this.inContact = true;
    this.solve(n, dt);
  }

  private solve(n: number, dt: number): void {
    const p = this.preset;
    const invM = 1 / p.mass;
    const pos = this.position;
    const v = this.velocity;
    const q = this.orientation;
    const [ix, iy, iz] = this.inertia;

    // World-space inverse inertia: R diag(1/I) R^T.
    const { x: qx, y: qy, z: qz, w: qw } = q;
    const r00 = 1 - 2 * (qy * qy + qz * qz);
    const r01 = 2 * (qx * qy - qz * qw);
    const r02 = 2 * (qx * qz + qy * qw);
    const r10 = 2 * (qx * qy + qz * qw);
    const r11 = 1 - 2 * (qx * qx + qz * qz);
    const r12 = 2 * (qy * qz - qx * qw);
    const r20 = 2 * (qx * qz - qy * qw);
    const r21 = 2 * (qy * qz + qx * qw);
    const r22 = 1 - 2 * (qx * qx + qy * qy);
    const a = 1 / ix;
    const b = 1 / iy;
    const c = 1 / iz;
    const iw = this.iw;
    iw[0] = r00 * r00 * a + r01 * r01 * b + r02 * r02 * c;
    iw[1] = r00 * r10 * a + r01 * r11 * b + r02 * r12 * c;
    iw[2] = r00 * r20 * a + r01 * r21 * b + r02 * r22 * c;
    iw[3] = iw[1];
    iw[4] = r10 * r10 * a + r11 * r11 * b + r12 * r12 * c;
    iw[5] = r10 * r20 * a + r11 * r21 * b + r12 * r22 * c;
    iw[6] = iw[2];
    iw[7] = iw[5];
    iw[8] = r20 * r20 * a + r21 * r21 * b + r22 * r22 * c;

    const wv = this.wWorld.copy(this.angularVelocity).applyQuaternion(q);

    // Effective mass along direction d applied at r: 1/m + d . ((Iw^-1 (r x d)) x r)
    const effective = (rx: number, ry: number, rz: number, dx: number, dy: number, dz: number): number => {
      const cx = ry * dz - rz * dy;
      const cy = rz * dx - rx * dz;
      const cz = rx * dy - ry * dx;
      const ax = iw[0] * cx + iw[1] * cy + iw[2] * cz;
      const ay = iw[3] * cx + iw[4] * cy + iw[5] * cz;
      const az = iw[6] * cx + iw[7] * cy + iw[8] * cz;
      const ex = ay * rz - az * ry;
      const ey = az * rx - ax * rz;
      const ez = ax * ry - ay * rx;
      return invM + dx * ex + dy * ey + dz * ez;
    };

    const applyImpulse = (rx: number, ry: number, rz: number, jx: number, jy: number, jz: number): void => {
      v.x += jx * invM;
      v.y += jy * invM;
      v.z += jz * invM;
      const cx = ry * jz - rz * jy;
      const cy = rz * jx - rx * jz;
      const cz = rx * jy - ry * jx;
      wv.x += iw[0] * cx + iw[1] * cy + iw[2] * cz;
      wv.y += iw[3] * cx + iw[4] * cy + iw[5] * cz;
      wv.z += iw[6] * cx + iw[7] * cy + iw[8] * cz;
    };

    let deepest = 0;
    let deepestIndex = 0;

    for (let k = 0; k < n; k++) {
      const ct = this.contacts[k];
      const rx = ct.px - pos.x;
      const ry = ct.py - pos.y;
      const rz = ct.pz - pos.z;
      this.rArr[k * 3] = rx;
      this.rArr[k * 3 + 1] = ry;
      this.rArr[k * 3 + 2] = rz;

      const vpx = v.x + (wv.y * rz - wv.z * ry);
      const vpy = v.y + (wv.z * rx - wv.x * rz);
      const vpz = v.z + (wv.x * ry - wv.y * rx);
      const vn = vpx * ct.nx + vpy * ct.ny + vpz * ct.nz;
      const impact = -vn;
      if (impact > this.impactSpeed) {
        this.impactSpeed = impact;
        this.impactTag = ct.tag;
      }
      if (this.contactIsProp[k] && impact > 2.5) this.propStrike = true;

      const surface = SURFACE[ct.tag];
      const e = impact > 1.2 ? surface.restitution : 0;
      const bias = Math.min(0.45, (0.08 / dt) * Math.max(ct.depth - 0.0015, 0));
      this.target[k] = Math.max(e * impact, bias);
      this.kn[k] = effective(rx, ry, rz, ct.nx, ct.ny, ct.nz);

      // Two tangent directions orthogonal to the normal.
      let t1x: number;
      let t1y: number;
      let t1z: number;
      if (Math.abs(ct.ny) < 0.9) {
        // t1 = n x up
        t1x = -ct.nz;
        t1y = 0;
        t1z = ct.nx;
      } else {
        // t1 = n x right
        t1x = 0;
        t1y = ct.nz;
        t1z = -ct.ny;
      }
      const tl = Math.hypot(t1x, t1y, t1z);
      t1x /= tl;
      t1y /= tl;
      t1z /= tl;
      const t2x = ct.ny * t1z - ct.nz * t1y;
      const t2y = ct.nz * t1x - ct.nx * t1z;
      const t2z = ct.nx * t1y - ct.ny * t1x;
      this.t1Arr[k * 3] = t1x;
      this.t1Arr[k * 3 + 1] = t1y;
      this.t1Arr[k * 3 + 2] = t1z;
      this.t2Arr[k * 3] = t2x;
      this.t2Arr[k * 3 + 1] = t2y;
      this.t2Arr[k * 3 + 2] = t2z;
      this.kt1[k] = effective(rx, ry, rz, t1x, t1y, t1z);
      this.kt2[k] = effective(rx, ry, rz, t2x, t2y, t2z);
      this.accN[k] = 0;
      this.accT1[k] = 0;
      this.accT2[k] = 0;

      if (ct.depth > deepest) {
        deepest = ct.depth;
        deepestIndex = k;
      }
    }

    for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
      for (let k = 0; k < n; k++) {
        const ct = this.contacts[k];
        const rx = this.rArr[k * 3];
        const ry = this.rArr[k * 3 + 1];
        const rz = this.rArr[k * 3 + 2];

        // Normal impulse.
        let vpx = v.x + (wv.y * rz - wv.z * ry);
        let vpy = v.y + (wv.z * rx - wv.x * rz);
        let vpz = v.z + (wv.x * ry - wv.y * rx);
        const vn = vpx * ct.nx + vpy * ct.ny + vpz * ct.nz;
        let dj = (this.target[k] - vn) / this.kn[k];
        const old = this.accN[k];
        this.accN[k] = Math.max(old + dj, 0);
        dj = this.accN[k] - old;
        if (dj !== 0) applyImpulse(rx, ry, rz, ct.nx * dj, ct.ny * dj, ct.nz * dj);

        // Friction (box-clamped along two tangents).
        const mu = SURFACE[ct.tag].friction;
        const maxF = mu * this.accN[k];
        vpx = v.x + (wv.y * rz - wv.z * ry);
        vpy = v.y + (wv.z * rx - wv.x * rz);
        vpz = v.z + (wv.x * ry - wv.y * rx);

        const t1x = this.t1Arr[k * 3];
        const t1y = this.t1Arr[k * 3 + 1];
        const t1z = this.t1Arr[k * 3 + 2];
        const vt1 = vpx * t1x + vpy * t1y + vpz * t1z;
        let d1 = -vt1 / this.kt1[k];
        const o1 = this.accT1[k];
        this.accT1[k] = clamp(o1 + d1, -maxF, maxF);
        d1 = this.accT1[k] - o1;
        if (d1 !== 0) applyImpulse(rx, ry, rz, t1x * d1, t1y * d1, t1z * d1);

        vpx = v.x + (wv.y * rz - wv.z * ry);
        vpy = v.y + (wv.z * rx - wv.x * rz);
        vpz = v.z + (wv.x * ry - wv.y * rx);
        const t2x = this.t2Arr[k * 3];
        const t2y = this.t2Arr[k * 3 + 1];
        const t2z = this.t2Arr[k * 3 + 2];
        const vt2 = vpx * t2x + vpy * t2y + vpz * t2z;
        let d2 = -vt2 / this.kt2[k];
        const o2 = this.accT2[k];
        this.accT2[k] = clamp(o2 + d2, -maxF, maxF);
        d2 = this.accT2[k] - o2;
        if (d2 !== 0) applyImpulse(rx, ry, rz, t2x * d2, t2y * d2, t2z * d2);
      }
    }

    // Back to the body frame.
    this.invQ.copy(q).invert();
    this.angularVelocity.copy(wv).applyQuaternion(this.invQ);

    // Deep penetrations (spawning inside something, tunnelling) get pushed out directly.
    if (deepest > 0.04) {
      const ct = this.contacts[deepestIndex];
      const push = deepest - 0.04;
      pos.x += ct.nx * push;
      pos.y += ct.ny * push;
      pos.z += ct.nz * push;
    }

    // Settle when resting with the motors (nearly) stopped, so it does not creep.
    if (n >= 3 && this.motorLoad < 0.08 && v.lengthSq() < 0.01 && this.angularVelocity.lengthSq() < 0.09) {
      v.multiplyScalar(0.85);
      this.angularVelocity.multiplyScalar(0.85);
    }
  }

  private keepInsideWorld(dt: number): void {
    const pos = this.position;
    const r = Math.hypot(pos.x, pos.z);
    if (r > WORLD.playRadius) {
      const push = (r - WORLD.playRadius) * 6 * dt;
      this.velocity.x -= (pos.x / r) * push;
      this.velocity.z -= (pos.z / r) * push;
    }
    if (pos.y > WORLD.ceiling) {
      this.velocity.y -= (pos.y - WORLD.ceiling) * 6 * dt;
    }
  }
}
