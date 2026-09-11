import type { PidConfig, RatesConfig, SimSettings } from './Types';

/**
 * Physical description of a 5" freestyle quad (roughly a 220 mm frame on 6S).
 * The numbers are deliberately close to a real build so the simulator's feel
 * transfers to actual hardware.
 */
export const DRONE_SPEC = {
  /** All-up weight in kg (frame + 6S 1300 mAh pack). */
  mass: 0.68,
  /** Motor-to-motor diagonal, in metres. */
  diagonal: 0.22,
  /** Diagonal moment arm from the centre of mass to each motor, in metres. */
  armLength: 0.11,
  /**
   * Body-frame inertia tensor (diagonal) in kg*m^2.
   * x = pitch axis, y = yaw axis, z = roll axis.
   */
  inertia: { x: 0.0055, y: 0.0095, z: 0.0048 },
  /** Peak thrust of one motor/prop combo, in newtons (~1.35 kg each). */
  maxThrustPerMotor: 13.2,
  /** Yaw reaction torque per newton of thrust (prop drag coefficient ratio). */
  yawTorqueRatio: 0.021,
  /** Time constant of the motor + prop spin-up, in seconds. */
  motorTimeConstant: 0.035,
  /** Extra lag when the motors have to slow down (props are not braked). */
  motorSpindownFactor: 1.8,
  /**
   * Quadratic translational drag coefficients per body axis (0.5 * rho * Cd * A).
   * The disc of the props makes the vertical axis draggier than the nose, which
   * is why a quad falls much slower flat than it flies forwards.
   */
  drag: { x: 0.048, y: 0.034, z: 0.030 },
  /** Quadratic rotational damping per body axis. */
  angularDrag: { x: 0.0035, y: 0.0055, z: 0.0032 },
  /** Collision radius of the airframe, in metres. */
  radius: 0.13,
  /** Impact speed (m/s) above which the airframe is considered crashed. */
  crashSpeed: 6.5,
  /** Bounce factor when the frame hits something. */
  restitution: 0.28,
  friction: 0.62,
} as const;

export const BATTERY_SPEC = {
  cells: 6,
  /** Nominal capacity in mAh. */
  capacityMah: 1300,
  /** Fully charged voltage per cell. */
  cellFullVolts: 4.2,
  /** Voltage per cell at which the pack is considered empty. */
  cellEmptyVolts: 3.3,
  /** Internal resistance of the whole pack, in ohms (drives the sag under load). */
  internalResistance: 0.028,
  /** Current drawn at full throttle on all four motors, in amps. */
  maxAmps: 96,
  /** Idle draw of FC / VTX / camera, in amps. */
  idleAmps: 0.9,
} as const;

export const WORLD = {
  gravity: 9.80665,
  /** Air density at sea level, kg/m^3. */
  airDensity: 1.225,
  /** Half-size of the playable area in metres. */
  size: 600,
  /** Height of the invisible ceiling in metres. */
  ceiling: 320,
} as const;

/** Fixed physics step: 500 Hz keeps the rate PIDs stable even at 30 fps rendering. */
export const PHYSICS_HZ = 500;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this much wall-clock time in one frame (spiral-of-death guard). */
export const MAX_FRAME_TIME = 0.1;

export const DEFAULT_RATES: RatesConfig = {
  roll: { rcRate: 1.05, superRate: 0.72, expo: 0.12 },
  pitch: { rcRate: 1.05, superRate: 0.72, expo: 0.12 },
  yaw: { rcRate: 0.95, superRate: 0.6, expo: 0.1 },
};

export const BEGINNER_RATES: RatesConfig = {
  roll: { rcRate: 0.6, superRate: 0.4, expo: 0.25 },
  pitch: { rcRate: 0.6, superRate: 0.4, expo: 0.25 },
  yaw: { rcRate: 0.55, superRate: 0.35, expo: 0.2 },
};

/**
 * PID gains use the same numeric scale a pilot sees in Betaflight's
 * configurator, so the values below are directly comparable with a real tune.
 * `Pid.ts` converts them into internal units with the stock scaling factors.
 */
export const DEFAULT_PID: PidConfig = {
  roll: { p: 46, i: 84, d: 32, f: 115 },
  pitch: { p: 50, i: 88, d: 34, f: 120 },
  yaw: { p: 45, i: 90, d: 0, f: 100 },
  /** Angle-mode outer loop: degrees/second of commanded rate per degree of error. */
  angleP: 9.5,
  angleLimitDeg: 48,
};

export const DEFAULT_SETTINGS: SimSettings = {
  mode: 'angle',
  cameraMode: 'fpv',
  stickMode: 'mode2',
  cameraTiltDeg: 25,
  fovDeg: 118,
  rates: DEFAULT_RATES,
  pid: DEFAULT_PID,
  deadband: 0.03,
  airMode: true,
  stickyThrottle: true,
  autoRecover: true,
  quality: 'high',
  analogLook: true,
  showTrail: false,
  audioEnabled: true,
  masterVolume: 0.5,
  windSpeed: 1.5,
  timeScale: 1,
  batteryEnabled: true,
  invertThrottleStick: false,
  stickSize: 1,
  hudEnabled: true,
};
