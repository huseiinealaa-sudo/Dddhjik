import { Vector3 } from 'three';
import { terrainHeight, terrainNormal } from '../core/Terrain';

/**
 * Broad-phase + narrow-phase collision for the drone against the static world.
 *
 * The drone is treated as a sphere, which is a good approximation for a
 * quadcopter (props sticking out in every direction) and keeps the maths cheap
 * enough to run inside the 500 Hz physics loop on a tablet.
 *
 * Static geometry is stored in a uniform grid; with a few hundred obstacles the
 * broad phase costs a handful of array lookups per step.
 */

export type ColliderKind = 'box' | 'cylinder';

export interface Collider {
  kind: ColliderKind;
  /** Centre of the collider in world space. */
  cx: number;
  cy: number;
  cz: number;
  /** Box: half extents. Cylinder: hx = radius, hy = half height, hz unused. */
  hx: number;
  hy: number;
  hz: number;
  /** Yaw rotation of a box collider, radians. */
  rotY: number;
  /** Bounding radius used by the broad phase. */
  boundingRadius: number;
  /** Free-form tag so gameplay code can react to what was hit. */
  tag: string;
}

export interface ContactResult {
  hit: boolean;
  /** Unit normal pointing away from the surface, towards the drone. */
  nx: number;
  ny: number;
  nz: number;
  /** How deep the sphere is inside the surface, metres. */
  depth: number;
  tag: string;
}

const CELL_SIZE = 12;

function cellKey(ix: number, iz: number): number {
  // Cantor-ish pairing that tolerates negative indices.
  const a = ix < 0 ? -2 * ix - 1 : 2 * ix;
  const b = iz < 0 ? -2 * iz - 1 : 2 * iz;
  return ((a + b) * (a + b + 1)) / 2 + b;
}

export class CollisionWorld {
  private readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, number[]>();

  clear(): void {
    this.colliders.length = 0;
    this.grid.clear();
  }

  addBox(
    center: Vector3,
    halfExtents: Vector3,
    rotY = 0,
    tag = 'obstacle',
  ): void {
    this.colliders.push({
      kind: 'box',
      cx: center.x,
      cy: center.y,
      cz: center.z,
      hx: halfExtents.x,
      hy: halfExtents.y,
      hz: halfExtents.z,
      rotY,
      boundingRadius: Math.hypot(halfExtents.x, halfExtents.y, halfExtents.z),
      tag,
    });
  }

  addCylinder(center: Vector3, radius: number, halfHeight: number, tag = 'obstacle'): void {
    this.colliders.push({
      kind: 'cylinder',
      cx: center.x,
      cy: center.y,
      cz: center.z,
      hx: radius,
      hy: halfHeight,
      hz: radius,
      rotY: 0,
      boundingRadius: Math.hypot(radius, halfHeight),
      tag,
    });
  }

  /** Bucket every collider into the uniform grid. Call once after populating. */
  build(): void {
    this.grid.clear();
    for (let index = 0; index < this.colliders.length; index++) {
      const c = this.colliders[index];
      const r = c.boundingRadius;
      const minX = Math.floor((c.cx - r) / CELL_SIZE);
      const maxX = Math.floor((c.cx + r) / CELL_SIZE);
      const minZ = Math.floor((c.cz - r) / CELL_SIZE);
      const maxZ = Math.floor((c.cz + r) / CELL_SIZE);
      for (let ix = minX; ix <= maxX; ix++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const key = cellKey(ix, iz);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(index);
        }
      }
    }
  }

  get count(): number {
    return this.colliders.length;
  }

  /**
   * Test a sphere against the static world and the terrain.
   * Returns the deepest contact found, if any.
   */
  querySphere(position: Vector3, radius: number, out: ContactResult): ContactResult {
    out.hit = false;
    out.depth = 0;
    out.nx = 0;
    out.ny = 1;
    out.nz = 0;
    out.tag = '';

    // --- Terrain ---
    const ground = terrainHeight(position.x, position.z);
    const groundDepth = ground + radius - position.y;
    if (groundDepth > 0) {
      terrainNormal(position.x, position.z, normalScratch);
      out.hit = true;
      out.depth = groundDepth;
      out.nx = normalScratch[0];
      out.ny = normalScratch[1];
      out.nz = normalScratch[2];
      out.tag = 'ground';
    }

    // --- Static obstacles ---
    const ix = Math.floor(position.x / CELL_SIZE);
    const iz = Math.floor(position.z / CELL_SIZE);
    const bucket = this.grid.get(cellKey(ix, iz));
    if (!bucket) return out;

    for (let b = 0; b < bucket.length; b++) {
      const c = this.colliders[bucket[b]];
      const dx = position.x - c.cx;
      const dy = position.y - c.cy;
      const dz = position.z - c.cz;
      const reach = c.boundingRadius + radius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;

      const contact = c.kind === 'box'
        ? sphereVsBox(dx, dy, dz, c, radius)
        : sphereVsCylinder(dx, dy, dz, c, radius);

      if (contact && contactScratch.depth > out.depth) {
        out.hit = true;
        out.depth = contactScratch.depth;
        out.nx = contactScratch.nx;
        out.ny = contactScratch.ny;
        out.nz = contactScratch.nz;
        out.tag = c.tag;
      }
    }

    return out;
  }
}

const normalScratch: [number, number, number] = [0, 1, 0];
const contactScratch = { nx: 0, ny: 1, nz: 0, depth: 0 };

/** Sphere vs yaw-rotated box. `dx/dy/dz` is the sphere centre relative to the box centre. */
function sphereVsBox(dx: number, dy: number, dz: number, c: Collider, radius: number): boolean {
  // Rotate into the box's local frame.
  let lx = dx;
  let lz = dz;
  if (c.rotY !== 0) {
    const cos = Math.cos(-c.rotY);
    const sin = Math.sin(-c.rotY);
    lx = dx * cos - dz * sin;
    lz = dx * sin + dz * cos;
  }
  const ly = dy;

  // Closest point on the box to the sphere centre.
  const px = Math.max(-c.hx, Math.min(c.hx, lx));
  const py = Math.max(-c.hy, Math.min(c.hy, ly));
  const pz = Math.max(-c.hz, Math.min(c.hz, lz));

  let nx = lx - px;
  let ny = ly - py;
  let nz = lz - pz;
  let distSq = nx * nx + ny * ny + nz * nz;

  if (distSq > radius * radius) return false;

  if (distSq > 1e-10) {
    const dist = Math.sqrt(distSq);
    nx /= dist;
    ny /= dist;
    nz /= dist;
    contactScratch.depth = radius - dist;
  } else {
    // Centre is inside the box — push out along the shallowest face.
    const ox = c.hx - Math.abs(lx);
    const oy = c.hy - Math.abs(ly);
    const oz = c.hz - Math.abs(lz);
    if (ox <= oy && ox <= oz) {
      nx = Math.sign(lx) || 1;
      ny = 0;
      nz = 0;
      contactScratch.depth = ox + radius;
    } else if (oy <= oz) {
      nx = 0;
      ny = Math.sign(ly) || 1;
      nz = 0;
      contactScratch.depth = oy + radius;
    } else {
      nx = 0;
      ny = 0;
      nz = Math.sign(lz) || 1;
      contactScratch.depth = oz + radius;
    }
    distSq = 0;
  }

  // Rotate the normal back into world space.
  if (c.rotY !== 0) {
    const cos = Math.cos(c.rotY);
    const sin = Math.sin(c.rotY);
    const wx = nx * cos - nz * sin;
    const wz = nx * sin + nz * cos;
    nx = wx;
    nz = wz;
  }

  contactScratch.nx = nx;
  contactScratch.ny = ny;
  contactScratch.nz = nz;
  return true;
}

/** Sphere vs vertical capped cylinder. */
function sphereVsCylinder(dx: number, dy: number, dz: number, c: Collider, radius: number): boolean {
  const radial = Math.hypot(dx, dz);
  const radialOverlap = c.hx + radius - radial;
  const verticalOverlap = c.hy + radius - Math.abs(dy);

  if (radialOverlap <= 0 || verticalOverlap <= 0) return false;

  if (radialOverlap < verticalOverlap) {
    const inv = radial > 1e-6 ? 1 / radial : 0;
    contactScratch.nx = radial > 1e-6 ? dx * inv : 1;
    contactScratch.ny = 0;
    contactScratch.nz = radial > 1e-6 ? dz * inv : 0;
    contactScratch.depth = radialOverlap;
  } else {
    contactScratch.nx = 0;
    contactScratch.ny = Math.sign(dy) || 1;
    contactScratch.nz = 0;
    contactScratch.depth = verticalOverlap;
  }
  return true;
}

export function createContactResult(): ContactResult {
  return { hit: false, nx: 0, ny: 1, nz: 0, depth: 0, tag: '' };
}
