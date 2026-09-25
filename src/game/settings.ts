import type { Quality } from '../engine/environment';
import type { VideoLook } from '../engine/renderPipeline';
import { cloneMapping, GAMEPAD_MODE2, type GamepadMapping } from '../input/mapping';
import type { StickMode } from '../input/inputManager';
import { PRESETS, type PresetId } from '../sim/presets';
import type { FcSettings, FlightMode, RatesProfile } from '../sim/types';

export type Language = 'ar' | 'en';
export type RateStyle = 'preset' | 'beginner' | 'smooth' | 'freestyle' | 'race' | 'custom';

export interface Settings {
  version: number;
  language: Language;
  // flight
  quad: PresetId;
  flightMode: FlightMode;
  rateStyle: RateStyle;
  customRates: RatesProfile;
  airmode: boolean;
  throttleMid: number;
  throttleExpo: number;
  angleLimit: number;
  // controls
  stickMode: StickMode;
  deadband: number;
  stickyThrottle: boolean;
  touchSize: number;
  touchOpacity: number;
  /** Self-centring throttle stick (like a game pad) instead of a sprung-free radio gimbal. */
  touchThrottleCentering: boolean;
  haptics: boolean;
  mapping: GamepadMapping;
  // camera & video
  fpvFov: number;
  /** null = the airframe's own uptilt. */
  cameraTilt: number | null;
  cameraShake: number;
  videoLook: VideoLook;
  lensDistortion: boolean;
  // simulation
  windSpeed: number;
  windFrom: number;
  turbulence: number;
  propwash: number;
  batterySag: boolean;
  crashDetection: boolean;
  autoRespawn: boolean;
  // graphics & sound
  quality: Quality;
  showFps: boolean;
  masterVolume: number;
  motorVolume: number;
  beeps: boolean;
  // hud
  osd: boolean;
  osdUnits: 'metric' | 'imperial';
  ghost: boolean;
}

const rates = (type: RatesProfile['type'], rp: [number, number, number], y: [number, number, number]): RatesProfile => ({
  type,
  roll: { center: rp[0], max: rp[1], expo: rp[2] },
  pitch: { center: rp[0], max: rp[1], expo: rp[2] },
  yaw: { center: y[0], max: y[1], expo: y[2] },
});

/** Rate styles, as Actual rates (centre deg/s, max deg/s, expo). */
export const RATE_STYLES: Record<Exclude<RateStyle, 'preset' | 'custom'>, RatesProfile> = {
  beginner: rates('actual', [110, 360, 0.35], [100, 300, 0.3]),
  smooth: rates('actual', [140, 520, 0.45], [120, 420, 0.35]),
  freestyle: rates('actual', [200, 780, 0.54], [180, 600, 0.45]),
  race: rates('actual', [260, 720, 0.25], [220, 560, 0.2]),
};

export function resolveRates(s: Settings): RatesProfile {
  if (s.rateStyle === 'preset') return PRESETS[s.quad].rates;
  if (s.rateStyle === 'custom') return s.customRates;
  return RATE_STYLES[s.rateStyle];
}

export function fcSettings(s: Settings): FcSettings {
  const p = PRESETS[s.quad];
  return {
    mode: s.flightMode,
    rates: resolveRates(s),
    pid: { ...p.pid, angleLimit: s.angleLimit },
    airmode: s.airmode,
    throttleMid: s.throttleMid,
    throttleExpo: s.throttleExpo,
  };
}

function detectLanguage(): Language {
  try {
    const l = (navigator.languages?.[0] ?? navigator.language ?? 'ar').toLowerCase();
    return l.startsWith('en') ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

function detectQuality(): Quality {
  try {
    const touch = navigator.maxTouchPoints > 1;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (touch) return cores >= 8 ? 'medium' : 'low';
    return cores >= 8 ? 'high' : 'medium';
  } catch {
    return 'medium';
  }
}

const VERSION = 2;

export function defaultSettings(): Settings {
  return {
    version: VERSION,
    language: detectLanguage(),
    quad: 'freestyle5',
    flightMode: 'angle',
    rateStyle: 'smooth',
    customRates: rates('actual', [200, 670, 0.5], [180, 500, 0.4]),
    airmode: true,
    throttleMid: 0.5,
    throttleExpo: 0.1,
    angleLimit: 55,
    stickMode: 'mode2',
    deadband: 0.02,
    stickyThrottle: true,
    touchSize: 1,
    touchOpacity: 0.85,
    touchThrottleCentering: false,
    haptics: true,
    mapping: cloneMapping(GAMEPAD_MODE2),
    fpvFov: 120,
    cameraTilt: null,
    cameraShake: 0.6,
    videoLook: 'digital',
    lensDistortion: true,
    windSpeed: 2.5,
    windFrom: 250,
    turbulence: 0.35,
    propwash: 1,
    batterySag: true,
    crashDetection: true,
    autoRespawn: true,
    quality: detectQuality(),
    showFps: false,
    masterVolume: 0.7,
    motorVolume: 0.8,
    beeps: true,
    osd: true,
    osdUnits: 'metric',
    ghost: true,
  };
}

const KEY = 'fpv-sim.settings.v2';

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!parsed || typeof parsed !== 'object') return d;
    const merged = { ...d, ...parsed, version: VERSION } as Settings;
    if (!(merged.quad in PRESETS)) merged.quad = d.quad;
    if (!merged.mapping?.channels) merged.mapping = d.mapping;
    return merged;
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // storage full or blocked (private mode): settings just won't persist
  }
}
