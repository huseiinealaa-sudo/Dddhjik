import { YARD } from './world';

/**
 * Where things stand in the industrial yard. Shared by the builder (meshes and
 * colliders) and the "Bando Line" track, so gates line up with real openings.
 */
export const BANDO = {
  x0: 250,
  z0: -72,
  sx: 36,
  sz: 20,
  floors: 3,
  floorH: 4,
  /** Column spacing along x and z. */
  bayX: 6,
  bayZ: 5,
  baseY: YARD.height,
} as const;

/** Centre line of the container canyon, aligned with the bando's doors. */
export const CANYON_Z = -59.5;
export const CANYON_X0 = 199;

export const TOWER = { x: 324, z: -84, height: 40, base: 5.2, top: 1.6 } as const;

export const WAREHOUSE = { x0: 290, z0: -34, sx: 32, sz: 22, height: 9 } as const;

export const YARD_ENTRANCE = { x: YARD.x - YARD.halfX, z: -40, width: 22 } as const;
