import type { PidProfile, RatesProfile } from './types';

/**
 * Physical description of an aircraft. Every number here is chosen to match a
 * real build of that class, so the feel transfers to hardware.
 *
 * Body frame (matches Three.js object space):
 *   +x right, +y up (thrust), -z forward (nose).
 * Inertia is given as [x (pitch), y (yaw), z (roll)].
 */
export interface QuadPreset {
  id: PresetId;
  name: { en: string; ar: string };
  blurb: { en: string; ar: string };
  mass: number;
  inertia: readonly [number, number, number];
  /** Centre of mass to motor centre, metres. */
  armLength: number;
  /** Height of the prop plane above the centre of mass. */
  propHeight: number;
  propDiameter: number;
  /** Geometric pitch of the prop, metres. */
  propPitch: number;
  propBlades: number;
  /** Static thrust of one motor at full throttle on a full pack, newtons. */
  maxThrust: number;
  /** Motor speed at full throttle on a full pack, rad/s. */
  omegaMax: number;
  /** Rotor drag torque divided by thrust (metres). */
  torqueRatio: number;
  motorTauUp: number;
  motorTauDown: number;
  /** Prop + bell rotational inertia, kg m^2. */
  rotorInertia: number;
  /** Minimum motor output while armed (Betaflight "motor idle"). */
  idle: number;
  /** Quadratic body drag per body axis [x, y, z], N per (m/s)^2. */
  bodyDrag: readonly [number, number, number];
  /** Rotor in-plane drag ("H-force"), N per m/s per unit of summed rpm fraction. */
  rotorDrag: number;
  ducted: boolean;
  battery: {
    cells: number;
    capacityMah: number;
    /** Ohmic resistance of the whole pack. */
    resistance: number;
    chemistry: 'lipo' | 'liion';
  };
  /** Impact speed that counts as a crash, m/s. */
  crashSpeed: number;
  cameraTilt: number;
  pid: PidProfile;
  rates: RatesProfile;
  look: {
    frame: string;
    accent: string;
    props: string;
    wheelbaseLabel: string;
  };
}

export type PresetId = 'freestyle5' | 'racer5' | 'cinewhoop3' | 'longrange7';

const INCH = 0.0254;

export const PRESETS: Record<PresetId, QuadPreset> = {
  freestyle5: {
    id: 'freestyle5',
    name: { en: '5" Freestyle', ar: 'فري ستايل 5 إنش' },
    blurb: {
      en: '6S · 680 g · 8:1 thrust-to-weight. The all-rounder most pilots learn on.',
      ar: '6S · 680 غم · دفع 8:1. الطائرة المتوازنة التي يتعلّم عليها معظم الطيارين.',
    },
    mass: 0.68,
    inertia: [0.0022, 0.0036, 0.002],
    armLength: 0.1125,
    propHeight: 0.022,
    propDiameter: 5.1 * INCH,
    propPitch: 4.3 * INCH,
    propBlades: 3,
    maxThrust: 13.7,
    omegaMax: 3850,
    torqueRatio: 0.012,
    motorTauUp: 0.018,
    motorTauDown: 0.026,
    rotorInertia: 3.5e-6,
    idle: 0.055,
    bodyDrag: [0.011, 0.0075, 0.008],
    rotorDrag: 0.1,
    ducted: false,
    battery: { cells: 6, capacityMah: 1300, resistance: 0.022, chemistry: 'lipo' },
    crashSpeed: 7.5,
    cameraTilt: 25,
    pid: {
      roll: { p: 45, i: 80, d: 30, f: 120 },
      pitch: { p: 47, i: 84, d: 34, f: 125 },
      yaw: { p: 45, i: 80, d: 0, f: 120 },
      levelStrength: 8,
      angleLimit: 55,
      tpaRate: 0.65,
      tpaBreakpoint: 0.35,
      antiGravity: 3.5,
    },
    rates: {
      type: 'actual',
      roll: { center: 140, max: 670, expo: 0.4 },
      pitch: { center: 140, max: 670, expo: 0.4 },
      yaw: { center: 120, max: 520, expo: 0.3 },
    },
    look: { frame: '#1d2129', accent: '#f97316', props: '#e5e7eb', wheelbaseLabel: '225 mm' },
  },

  racer5: {
    id: 'racer5',
    name: { en: '5" Racer', ar: 'سباق 5 إنش' },
    blurb: {
      en: '6S · 560 g · 10:1 thrust-to-weight. Light, twitchy and brutally fast.',
      ar: '6S · 560 غم · دفع 10:1. خفيفة وحادّة وسريعة جداً.',
    },
    mass: 0.56,
    inertia: [0.0017, 0.003, 0.0015],
    armLength: 0.108,
    propHeight: 0.02,
    propDiameter: 5.0 * INCH,
    propPitch: 4.8 * INCH,
    propBlades: 3,
    maxThrust: 14.2,
    omegaMax: 4300,
    torqueRatio: 0.013,
    motorTauUp: 0.016,
    motorTauDown: 0.022,
    rotorInertia: 3.2e-6,
    idle: 0.05,
    bodyDrag: [0.009, 0.0065, 0.0065],
    rotorDrag: 0.09,
    ducted: false,
    battery: { cells: 6, capacityMah: 1100, resistance: 0.02, chemistry: 'lipo' },
    crashSpeed: 8,
    cameraTilt: 35,
    pid: {
      roll: { p: 42, i: 78, d: 28, f: 150 },
      pitch: { p: 44, i: 82, d: 31, f: 155 },
      yaw: { p: 42, i: 78, d: 0, f: 140 },
      levelStrength: 9,
      angleLimit: 60,
      tpaRate: 0.7,
      tpaBreakpoint: 0.35,
      antiGravity: 4,
    },
    rates: {
      type: 'actual',
      roll: { center: 200, max: 780, expo: 0.35 },
      pitch: { center: 200, max: 780, expo: 0.35 },
      yaw: { center: 160, max: 560, expo: 0.3 },
    },
    look: { frame: '#16181d', accent: '#22d3ee', props: '#f43f5e', wheelbaseLabel: '215 mm' },
  },

  cinewhoop3: {
    id: 'cinewhoop3',
    name: { en: '3" Cinewhoop', ar: 'سينيووب 3 إنش' },
    blurb: {
      en: '4S · 360 g · ducted props. Slow, stable and forgiving — perfect for learning.',
      ar: '4S · 360 غم · مراوح محمية. بطيئة ومستقرة ومتسامحة — مثالية للتعلّم.',
    },
    mass: 0.36,
    inertia: [0.00095, 0.0017, 0.0009],
    armLength: 0.074,
    propHeight: 0.018,
    propDiameter: 3.0 * INCH,
    propPitch: 2.0 * INCH,
    propBlades: 5,
    maxThrust: 4.3,
    omegaMax: 5800,
    torqueRatio: 0.009,
    motorTauUp: 0.02,
    motorTauDown: 0.028,
    rotorInertia: 8e-7,
    idle: 0.06,
    bodyDrag: [0.022, 0.038, 0.019],
    rotorDrag: 0.07,
    ducted: true,
    battery: { cells: 4, capacityMah: 850, resistance: 0.032, chemistry: 'lipo' },
    crashSpeed: 9,
    cameraTilt: 12,
    pid: {
      roll: { p: 50, i: 90, d: 36, f: 90 },
      pitch: { p: 52, i: 92, d: 38, f: 95 },
      yaw: { p: 55, i: 90, d: 0, f: 90 },
      levelStrength: 7,
      angleLimit: 45,
      tpaRate: 0.5,
      tpaBreakpoint: 0.45,
      antiGravity: 3,
    },
    rates: {
      type: 'actual',
      roll: { center: 110, max: 480, expo: 0.35 },
      pitch: { center: 110, max: 480, expo: 0.35 },
      yaw: { center: 100, max: 400, expo: 0.3 },
    },
    look: { frame: '#23262d', accent: '#a3e635', props: '#94a3b8', wheelbaseLabel: '140 mm' },
  },

  longrange7: {
    id: 'longrange7',
    name: { en: '7" Long Range', ar: 'مدى بعيد 7 إنش' },
    blurb: {
      en: '6S Li-ion · 950 g · 5:1 thrust-to-weight. Heavy, smooth, huge flight time.',
      ar: '6S ليثيوم أيون · 950 غم · دفع 5:1. ثقيلة وناعمة وزمن طيران طويل.',
    },
    mass: 0.95,
    inertia: [0.0058, 0.0098, 0.0052],
    armLength: 0.15,
    propHeight: 0.026,
    propDiameter: 7.0 * INCH,
    propPitch: 4.0 * INCH,
    propBlades: 2,
    maxThrust: 12.2,
    omegaMax: 2750,
    torqueRatio: 0.016,
    motorTauUp: 0.032,
    motorTauDown: 0.045,
    rotorInertia: 9e-6,
    idle: 0.045,
    bodyDrag: [0.014, 0.014, 0.01],
    rotorDrag: 0.13,
    ducted: false,
    battery: { cells: 6, capacityMah: 4000, resistance: 0.075, chemistry: 'liion' },
    crashSpeed: 7,
    cameraTilt: 18,
    pid: {
      roll: { p: 55, i: 90, d: 42, f: 90 },
      pitch: { p: 58, i: 94, d: 45, f: 95 },
      yaw: { p: 60, i: 90, d: 0, f: 90 },
      levelStrength: 7,
      angleLimit: 45,
      tpaRate: 0.5,
      tpaBreakpoint: 0.45,
      antiGravity: 3,
    },
    rates: {
      type: 'actual',
      roll: { center: 100, max: 460, expo: 0.3 },
      pitch: { center: 100, max: 460, expo: 0.3 },
      yaw: { center: 90, max: 380, expo: 0.25 },
    },
    look: { frame: '#1f2937', accent: '#eab308', props: '#111827', wheelbaseLabel: '300 mm' },
  },
};

export const PRESET_ORDER: PresetId[] = ['freestyle5', 'racer5', 'cinewhoop3', 'longrange7'];

/** Thrust coefficient kT such that T = kT * omega^2. */
export function thrustCoefficient(p: QuadPreset): number {
  return p.maxThrust / (p.omegaMax * p.omegaMax);
}

export function thrustToWeight(p: QuadPreset): number {
  return (p.maxThrust * 4) / (p.mass * 9.80665);
}
