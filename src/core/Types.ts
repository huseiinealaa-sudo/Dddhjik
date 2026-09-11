/** Shared vocabulary for the simulator. */

/** Betaflight-style flight modes. */
export type FlightMode = 'angle' | 'acro' | 'horizon';

export type CameraMode = 'fpv' | 'chase' | 'orbit';

/** Transmitter stick assignment. Mode 2 is by far the most common worldwide. */
export type StickMode = 'mode1' | 'mode2' | 'mode3' | 'mode4';

export type QualityLevel = 'low' | 'medium' | 'high';

/**
 * Normalised pilot command coming out of the input layer.
 * roll / pitch / yaw are ±1 and self-centring, throttle is 0..1.
 */
export interface ControlInput {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

export interface ArmingState {
  armed: boolean;
  /** Human readable reason why arming is currently blocked, or null when arming is allowed. */
  blockedBy: string | null;
}

export interface RateProfile {
  /** Betaflight "RC Rate" — base stick-to-rate gain. */
  rcRate: number;
  /** Betaflight "Super Rate" — how aggressively the curve steepens near full stick. */
  superRate: number;
  /** Betaflight "RC Expo" — softens the centre of the stick. */
  expo: number;
}

export interface RatesConfig {
  roll: RateProfile;
  pitch: RateProfile;
  yaw: RateProfile;
}

export interface PidAxisGains {
  p: number;
  i: number;
  d: number;
  /** Feed-forward on stick movement — what makes a real quad feel "connected". */
  f: number;
}

export interface PidConfig {
  roll: PidAxisGains;
  pitch: PidAxisGains;
  yaw: PidAxisGains;
  /** Outer attitude loop gain used by Angle / Horizon mode. */
  angleP: number;
  /** Maximum bank angle (degrees) allowed in Angle mode. */
  angleLimitDeg: number;
}

export interface SimSettings {
  mode: FlightMode;
  cameraMode: CameraMode;
  stickMode: StickMode;
  /** Camera up-tilt in degrees — more tilt means more speed before the horizon drops. */
  cameraTiltDeg: number;
  /** Horizontal field of view of the FPV camera in degrees. */
  fovDeg: number;
  rates: RatesConfig;
  pid: PidConfig;
  deadband: number;
  /** Keeps some authority at zero throttle, exactly like Betaflight's AIR MODE. */
  airMode: boolean;
  /** Throttle stick keeps its position instead of springing back (like a real radio). */
  stickyThrottle: boolean;
  /** Turtle mode / instant recovery after a crash. */
  autoRecover: boolean;
  quality: QualityLevel;
  /** Analogue-video look: barrel distortion, scanlines, chromatic aberration, static. */
  analogLook: boolean;
  showTrail: boolean;
  audioEnabled: boolean;
  masterVolume: number;
  /** Simulated wind speed in m/s. */
  windSpeed: number;
  /** Global slow-motion factor, 1 = realtime. */
  timeScale: number;
  batteryEnabled: boolean;
  invertThrottleStick: boolean;
  stickSize: number;
  hudEnabled: boolean;
}

export interface LapState {
  /** Index of the next gate the pilot has to fly through. */
  nextGate: number;
  totalGates: number;
  currentLapTime: number;
  lastLapTime: number | null;
  bestLapTime: number | null;
  lapsCompleted: number;
  running: boolean;
}

/** Snapshot pushed to the React HUD at a throttled rate. */
export interface Telemetry {
  armed: boolean;
  mode: FlightMode;
  cameraMode: CameraMode;
  /** Ground speed in km/h. */
  speedKmh: number;
  /** Vertical speed in m/s (positive = climbing). */
  verticalSpeed: number;
  /** Altitude above the ground directly below the drone, in metres. */
  altitude: number;
  /** Distance to the take-off point, in metres. */
  distance: number;
  batteryPercent: number;
  voltage: number;
  /** Instantaneous current draw in amps. */
  amps: number;
  /** Consumed capacity in mAh. */
  mah: number;
  throttle: number;
  rollDeg: number;
  pitchDeg: number;
  headingDeg: number;
  /** Body rates in deg/s, used by the rate needles. */
  rollRate: number;
  pitchRate: number;
  yawRate: number;
  gForce: number;
  motors: [number, number, number, number];
  fps: number;
  flightTime: number;
  crashed: boolean;
  crashCount: number;
  blockedBy: string | null;
  lap: LapState;
  /** Radio link quality percentage — degrades with distance for flavour. */
  linkQuality: number;
  /** Bearing to the next gate relative to the nose, degrees (positive = right). */
  gateBearing: number;
  /** Elevation of the next gate relative to the nose, degrees (positive = above). */
  gateElevation: number;
  /** Straight-line distance to the next gate, metres. */
  gateDistance: number;
}
