import { Vector3 } from 'three';
import { DEG } from './math';
import { BANDO, CANYON_Z, WAREHOUSE } from './yardLayout';
import { terrainHeight } from './world';

/**
 * Race tracks: ordered gates with an exact crossing test, so lap times are
 * measured to the millisecond at any speed.
 */

export type GateKind = 'square' | 'arch' | 'dive' | 'portal';

export interface GateDef {
  kind: GateKind;
  x: number;
  z: number;
  /** Bottom of the opening above the ground (dive: platform height). */
  elevation?: number;
  /** Compass heading of travel, degrees (0 = north/-Z). Auto from neighbours if omitted. */
  heading?: number;
  /** Opening width (square/dive/portal) or radius (arch), metres. */
  size?: number;
  /** Opening height for squares and portals. */
  height?: number;
  /** Draw a second, non-scoring frame below (a "ladder" look). */
  ladder?: boolean;
}

export interface TrackDef {
  id: 'meadow' | 'pro' | 'bando';
  name: { en: string; ar: string };
  blurb: { en: string; ar: string };
  difficulty: 1 | 2 | 3;
  spawn: { x: number; z: number; heading: number };
  laps: number;
  gates: GateDef[];
}

export interface GateTrigger {
  index: number;
  kind: GateKind;
  /** Centre of the opening. */
  center: Vector3;
  /** Direction of travel through the opening (unit). */
  normal: Vector3;
  right: Vector3;
  up: Vector3;
  halfWidth: number;
  halfHeight: number;
  headingRad: number;
  groundY: number;
  def: GateDef;
}

export const TRACKS: TrackDef[] = [
  {
    id: 'meadow',
    name: { en: 'Meadow Loop', ar: 'حلقة المرج' },
    blurb: {
      en: 'Eight wide gates on a flowing loop. Perfect for a first race.',
      ar: 'ثماني بوابات واسعة في حلقة انسيابية. مثالية لأول سباق.',
    },
    difficulty: 1,
    spawn: { x: 0, z: 14, heading: 0 },
    laps: 3,
    gates: [
      { kind: 'square', x: 0, z: -12, size: 2.8, height: 2.3, elevation: 0.35, heading: 0 },
      { kind: 'arch', x: 18, z: -54, size: 2.5 },
      { kind: 'square', x: 54, z: -82, size: 2.8, height: 2.3, elevation: 0.35 },
      { kind: 'arch', x: 94, z: -66, size: 2.5 },
      { kind: 'square', x: 110, z: -24, size: 2.8, height: 2.3, elevation: 0.35 },
      { kind: 'arch', x: 88, z: 20, size: 2.5 },
      { kind: 'square', x: 46, z: 40, size: 2.8, height: 2.3, elevation: 0.35 },
      { kind: 'arch', x: 16, z: 32, size: 2.5 },
    ],
  },
  {
    id: 'pro',
    name: { en: 'Pro Series', ar: 'السلسلة الاحترافية' },
    blurb: {
      en: 'Regulation 1.5 m gates, a tower dive and a raised ladder gate.',
      ar: 'بوابات قياسية 1.5 م، وغطسة من برج، وبوابة سلّم مرتفعة.',
    },
    difficulty: 2,
    spawn: { x: 0, z: 14, heading: 0 },
    laps: 3,
    gates: [
      { kind: 'square', x: -6, z: -14, size: 1.6, height: 1.6, elevation: 0.4, heading: 330 },
      { kind: 'square', x: -34, z: -44, size: 1.6, height: 1.6, elevation: 0.4 },
      { kind: 'dive', x: -62, z: -58, size: 1.9, elevation: 5.5, heading: 270 },
      { kind: 'square', x: -98, z: -44, size: 1.6, height: 1.6, elevation: 0.4 },
      { kind: 'square', x: -114, z: -6, size: 1.6, height: 1.6, elevation: 2.4, heading: 180, ladder: true },
      { kind: 'arch', x: -88, z: 28, size: 2.1 },
      { kind: 'square', x: -52, z: 42, size: 1.6, height: 1.6, elevation: 0.4 },
      { kind: 'square', x: -24, z: 20, size: 1.6, height: 1.6, elevation: 1.1 },
    ],
  },
  {
    id: 'bando',
    name: { en: 'Bando Line', ar: 'خط المبنى المهجور' },
    blurb: {
      en: 'Through the container canyon, straight through the abandoned building and around the tower.',
      ar: 'عبر ممر الحاويات، ثم مباشرة عبر المبنى المهجور وحول البرج.',
    },
    difficulty: 3,
    spawn: { x: 188, z: -30, heading: 110 },
    laps: 2,
    gates: [
      { kind: 'square', x: 201, z: CANYON_Z, size: 2.2, height: 2.2, elevation: 0.5, heading: 90 },
      { kind: 'square', x: 240, z: CANYON_Z, size: 2.2, height: 2.2, elevation: 0.5, heading: 90 },
      { kind: 'portal', x: BANDO.x0, z: CANYON_Z, size: 3.2, height: 3, elevation: 0.1, heading: 90 },
      { kind: 'portal', x: BANDO.x0 + BANDO.sx, z: CANYON_Z, size: 3.2, height: 3, elevation: 0.1, heading: 90 },
      { kind: 'arch', x: 306, z: -96, size: 2.6, heading: 60 },
      { kind: 'square', x: 334, z: -60, size: 2.2, height: 2.2, elevation: 0.5, heading: 180 },
      { kind: 'portal', x: WAREHOUSE.x0 + WAREHOUSE.sx, z: WAREHOUSE.z0 + WAREHOUSE.sz / 2, size: 5, height: 5, elevation: 0.2, heading: 270 },
      { kind: 'portal', x: WAREHOUSE.x0, z: WAREHOUSE.z0 + WAREHOUSE.sz / 2, size: 5, height: 5, elevation: 0.2, heading: 270 },
      { kind: 'arch', x: 214, z: -8, size: 2.6, heading: 300 },
    ],
  },
];

export function trackById(id: TrackDef['id']): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}

/** World-space trigger geometry for every gate of a track. */
export function buildTriggers(track: TrackDef): GateTrigger[] {
  const g = track.gates;
  return g.map((def, index) => {
    const prev = g[(index - 1 + g.length) % g.length];
    const next = g[(index + 1) % g.length];
    const headingRad =
      def.heading !== undefined ? def.heading * DEG : headingOf(next.x - prev.x, next.z - prev.z);
    const groundY = terrainHeight(def.x, def.z);
    const fwd = new Vector3(Math.sin(headingRad), 0, -Math.cos(headingRad));
    const right = new Vector3(Math.cos(headingRad), 0, Math.sin(headingRad));
    const size = def.size ?? 2;
    const elevation = def.elevation ?? 0.3;

    if (def.kind === 'dive') {
      // A horizontal opening flown downwards.
      return {
        index,
        kind: def.kind,
        center: new Vector3(def.x, groundY + elevation, def.z),
        normal: new Vector3(0, -1, 0),
        right,
        up: fwd.clone(),
        halfWidth: size / 2,
        halfHeight: size / 2,
        headingRad,
        groundY,
        def,
      };
    }
    if (def.kind === 'arch') {
      // Rectangle inscribed in the arch.
      const inner = size - 0.2;
      return {
        index,
        kind: def.kind,
        center: new Vector3(def.x, groundY + inner * 0.42, def.z),
        normal: fwd,
        right,
        up: new Vector3(0, 1, 0),
        halfWidth: inner * 0.8,
        halfHeight: inner * 0.42,
        headingRad,
        groundY,
        def,
      };
    }
    const height = def.height ?? size;
    return {
      index,
      kind: def.kind,
      center: new Vector3(def.x, groundY + elevation + height / 2, def.z),
      normal: fwd,
      right,
      up: new Vector3(0, 1, 0),
      halfWidth: size / 2,
      halfHeight: height / 2,
      headingRad,
      groundY,
      def,
    };
  });
}

const rel = new Vector3();

/**
 * Does the segment a -> b pass through the gate in its direction of travel?
 * Returns the fraction along the segment where it crossed, or null.
 */
export function crossGate(a: Vector3, b: Vector3, g: GateTrigger): number | null {
  const da = rel.subVectors(a, g.center).dot(g.normal);
  const db = rel.subVectors(b, g.center).dot(g.normal);
  if (!(da < 0 && db >= 0)) return null;
  const t = da / (da - db);
  rel.subVectors(b, a).multiplyScalar(t).add(a).sub(g.center);
  if (Math.abs(rel.dot(g.right)) > g.halfWidth) return null;
  if (Math.abs(rel.dot(g.up)) > g.halfHeight) return null;
  return t;
}
