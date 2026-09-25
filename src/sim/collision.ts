import type { Quaternion, Vector3 } from 'three';

/**
 * Static collision geometry for the drone to hit.
 *
 * The drone is represented by a handful of small spheres (see `quad.ts`), so
 * the only narrow-phase test needed is sphere-vs-shape. Shapes are bucketed in
 * a uniform grid; a query touches only the cells around the aircraft, which
 * keeps the 1 kHz physics loop cheap even with hundreds of obstacles.
 */

export type ColliderShape = 'sphere' | 'box' | 'capsule' | 'cylinder';

export type SurfaceTag =
  | 'ground'
  | 'water'
  | 'concrete'
  | 'metal'
  | 'wood'
  | 'foliage'
  | 'gate'
  | 'net'
  | 'fabric';

export interface Collider {
  shape: ColliderShape;
  tag: SurfaceTag;
  /** Centre (sphere, box, cylinder) or segment start (capsule). */
  x: number;
  y: number;
  z: number;
  /** Capsule segment end. */
  bx: number;
  by: number;
  bz: number;
  radius: number;
  /** Box half extents; cylinder uses hy as half height. */
  hx: number;
  hy: number;
  hz: number;
  /** Box rotation, row-major: world = R * local. */
  m: Float64Array;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface Contact {
  /** Surface normal, pointing out of the obstacle towards the sphere. */
  nx: number;
  ny: number;
  nz: number;
  depth: number;
  /** Deepest point of the sphere, on its surface. */
  px: number;
  py: number;
  pz: number;
  tag: SurfaceTag;
}

export function createContact(): Contact {
  return { nx: 0, ny: 1, nz: 0, depth: 0, px: 0, py: 0, pz: 0, tag: 'ground' };
}

const CELL = 8;
const IDENTITY = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function cellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}

function baseCollider(shape: ColliderShape, tag: SurfaceTag): Collider {
  return {
    shape,
    tag,
    x: 0,
    y: 0,
    z: 0,
    bx: 0,
    by: 0,
    bz: 0,
    radius: 0,
    hx: 0,
    hy: 0,
    hz: 0,
    m: IDENTITY,
    minX: 0,
    minY: 0,
    minZ: 0,
    maxX: 0,
    maxY: 0,
    maxZ: 0,
  };
}

export class CollisionWorld {
  readonly colliders: Collider[] = [];
  private readonly grid = new Map<number, number[]>();
  private stamps = new Uint32Array(64);
  private queryId = 0;

  clear(): void {
    this.colliders.length = 0;
    this.grid.clear();
  }

  /** Drop every collider added after the first `count` (e.g. a previous track's gates) and rebuild. */
  truncate(count: number): void {
    this.colliders.length = Math.min(this.colliders.length, count);
    this.build();
  }

  addSphere(center: Vector3, radius: number, tag: SurfaceTag): void {
    const c = baseCollider('sphere', tag);
    c.x = center.x;
    c.y = center.y;
    c.z = center.z;
    c.radius = radius;
    this.push(c, radius, radius, radius);
  }

  /** Oriented box. `rotation` may be omitted for an axis-aligned box. */
  addBox(center: Vector3, halfExtents: Vector3, tag: SurfaceTag, rotation?: Quaternion): void {
    const c = baseCollider('box', tag);
    c.x = center.x;
    c.y = center.y;
    c.z = center.z;
    c.hx = halfExtents.x;
    c.hy = halfExtents.y;
    c.hz = halfExtents.z;
    if (rotation) {
      const { x, y, z, w } = rotation;
      const m = new Float64Array(9);
      m[0] = 1 - 2 * (y * y + z * z);
      m[1] = 2 * (x * y - z * w);
      m[2] = 2 * (x * z + y * w);
      m[3] = 2 * (x * y + z * w);
      m[4] = 1 - 2 * (x * x + z * z);
      m[5] = 2 * (y * z - x * w);
      m[6] = 2 * (x * z - y * w);
      m[7] = 2 * (y * z + x * w);
      m[8] = 1 - 2 * (x * x + y * y);
      c.m = m;
    }
    // World AABB of the rotated box.
    const m = c.m;
    const ex = Math.abs(m[0]) * c.hx + Math.abs(m[1]) * c.hy + Math.abs(m[2]) * c.hz;
    const ey = Math.abs(m[3]) * c.hx + Math.abs(m[4]) * c.hy + Math.abs(m[5]) * c.hz;
    const ez = Math.abs(m[6]) * c.hx + Math.abs(m[7]) * c.hy + Math.abs(m[8]) * c.hz;
    this.push(c, ex, ey, ez);
  }

  addCapsule(a: Vector3, b: Vector3, radius: number, tag: SurfaceTag): void {
    const c = baseCollider('capsule', tag);
    c.x = a.x;
    c.y = a.y;
    c.z = a.z;
    c.bx = b.x;
    c.by = b.y;
    c.bz = b.z;
    c.radius = radius;
    c.minX = Math.min(a.x, b.x) - radius;
    c.minY = Math.min(a.y, b.y) - radius;
    c.minZ = Math.min(a.z, b.z) - radius;
    c.maxX = Math.max(a.x, b.x) + radius;
    c.maxY = Math.max(a.y, b.y) + radius;
    c.maxZ = Math.max(a.z, b.z) + radius;
    this.colliders.push(c);
  }

  /** Vertical cylinder (flat caps). */
  addCylinder(center: Vector3, radius: number, halfHeight: number, tag: SurfaceTag): void {
    const c = baseCollider('cylinder', tag);
    c.x = center.x;
    c.y = center.y;
    c.z = center.z;
    c.radius = radius;
    c.hy = halfHeight;
    this.push(c, radius, halfHeight, radius);
  }

  private push(c: Collider, ex: number, ey: number, ez: number): void {
    c.minX = c.x - ex;
    c.minY = c.y - ey;
    c.minZ = c.z - ez;
    c.maxX = c.x + ex;
    c.maxY = c.y + ey;
    c.maxZ = c.z + ez;
    this.colliders.push(c);
  }

  /** Bucket every collider into the grid. Call after all shapes are added. */
  build(): void {
    this.grid.clear();
    this.stamps = new Uint32Array(Math.max(this.colliders.length, 1));
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const x0 = Math.floor(c.minX / CELL);
      const x1 = Math.floor(c.maxX / CELL);
      const z0 = Math.floor(c.minZ / CELL);
      const z1 = Math.floor(c.maxZ / CELL);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = cellKey(ix, iz);
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  /**
   * Collect every collider whose AABB overlaps the sphere into `out`.
   * Returns the number collected.
   */
  gather(x: number, y: number, z: number, radius: number, out: Collider[]): number {
    this.queryId = (this.queryId + 1) >>> 0;
    if (this.queryId === 0) {
      this.stamps.fill(0);
      this.queryId = 1;
    }
    let n = 0;
    const x0 = Math.floor((x - radius) / CELL);
    const x1 = Math.floor((x + radius) / CELL);
    const z0 = Math.floor((z - radius) / CELL);
    const z1 = Math.floor((z + radius) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const bucket = this.grid.get(cellKey(ix, iz));
        if (!bucket) continue;
        for (let b = 0; b < bucket.length; b++) {
          const index = bucket[b];
          if (this.stamps[index] === this.queryId) continue;
          this.stamps[index] = this.queryId;
          const c = this.colliders[index];
          if (
            x + radius < c.minX ||
            x - radius > c.maxX ||
            y + radius < c.minY ||
            y - radius > c.maxY ||
            z + radius < c.minZ ||
            z - radius > c.maxZ
          ) {
            continue;
          }
          out[n++] = c;
        }
      }
    }
    return n;
  }
}

/**
 * Sphere (sx, sy, sz, r) against one collider. On overlap fills `out` and
 * returns true.
 */
export function sphereVsCollider(c: Collider, sx: number, sy: number, sz: number, r: number, out: Contact): boolean {
  switch (c.shape) {
    case 'sphere':
      return sphereVsPoint(sx, sy, sz, r, c.x, c.y, c.z, c.radius, c.tag, out);
    case 'capsule': {
      const abx = c.bx - c.x;
      const aby = c.by - c.y;
      const abz = c.bz - c.z;
      const lenSq = abx * abx + aby * aby + abz * abz;
      let t = lenSq > 1e-12 ? ((sx - c.x) * abx + (sy - c.y) * aby + (sz - c.z) * abz) / lenSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      return sphereVsPoint(sx, sy, sz, r, c.x + abx * t, c.y + aby * t, c.z + abz * t, c.radius, c.tag, out);
    }
    case 'cylinder':
      return sphereVsCylinder(c, sx, sy, sz, r, out);
    case 'box':
      return sphereVsBox(c, sx, sy, sz, r, out);
  }
}

function sphereVsPoint(
  sx: number,
  sy: number,
  sz: number,
  r: number,
  cx: number,
  cy: number,
  cz: number,
  cr: number,
  tag: SurfaceTag,
  out: Contact,
): boolean {
  let dx = sx - cx;
  let dy = sy - cy;
  let dz = sz - cz;
  const reach = r + cr;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 >= reach * reach) return false;
  const d = Math.sqrt(d2);
  if (d > 1e-9) {
    dx /= d;
    dy /= d;
    dz /= d;
  } else {
    dx = 0;
    dy = 1;
    dz = 0;
  }
  out.nx = dx;
  out.ny = dy;
  out.nz = dz;
  out.depth = reach - d;
  out.px = sx - dx * r;
  out.py = sy - dy * r;
  out.pz = sz - dz * r;
  out.tag = tag;
  return true;
}

function sphereVsCylinder(c: Collider, sx: number, sy: number, sz: number, r: number, out: Contact): boolean {
  const dx = sx - c.x;
  const dy = sy - c.y;
  const dz = sz - c.z;
  const radial = Math.hypot(dx, dz);
  // Closest point on the solid cylinder.
  const clampR = radial > c.radius ? c.radius / radial : 1;
  const qx = dx * clampR;
  const qz = dz * clampR;
  const qy = dy < -c.hy ? -c.hy : dy > c.hy ? c.hy : dy;
  const ex = dx - qx;
  const ey = dy - qy;
  const ez = dz - qz;
  const d2 = ex * ex + ey * ey + ez * ez;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    out.nx = ex / d;
    out.ny = ey / d;
    out.nz = ez / d;
    out.depth = r - d;
  } else {
    // Centre inside: push out through the nearest side or cap.
    const side = c.radius - radial;
    const cap = c.hy - Math.abs(dy);
    if (side < cap) {
      const inv = radial > 1e-9 ? 1 / radial : 0;
      out.nx = radial > 1e-9 ? dx * inv : 1;
      out.ny = 0;
      out.nz = radial > 1e-9 ? dz * inv : 0;
      out.depth = side + r;
    } else {
      out.nx = 0;
      out.ny = dy >= 0 ? 1 : -1;
      out.nz = 0;
      out.depth = cap + r;
    }
  }
  out.px = sx - out.nx * r;
  out.py = sy - out.ny * r;
  out.pz = sz - out.nz * r;
  out.tag = c.tag;
  return true;
}

function sphereVsBox(c: Collider, sx: number, sy: number, sz: number, r: number, out: Contact): boolean {
  const m = c.m;
  const wx = sx - c.x;
  const wy = sy - c.y;
  const wz = sz - c.z;
  // local = R^T * world
  const lx = m[0] * wx + m[3] * wy + m[6] * wz;
  const ly = m[1] * wx + m[4] * wy + m[7] * wz;
  const lz = m[2] * wx + m[5] * wy + m[8] * wz;

  const qx = lx < -c.hx ? -c.hx : lx > c.hx ? c.hx : lx;
  const qy = ly < -c.hy ? -c.hy : ly > c.hy ? c.hy : ly;
  const qz = lz < -c.hz ? -c.hz : lz > c.hz ? c.hz : lz;
  let nx = lx - qx;
  let ny = ly - qy;
  let nz = lz - qz;
  const d2 = nx * nx + ny * ny + nz * nz;

  let depth: number;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;
    depth = r - d;
  } else {
    const ox = c.hx - Math.abs(lx);
    const oy = c.hy - Math.abs(ly);
    const oz = c.hz - Math.abs(lz);
    if (ox <= oy && ox <= oz) {
      nx = lx >= 0 ? 1 : -1;
      ny = 0;
      nz = 0;
      depth = ox + r;
    } else if (oy <= oz) {
      nx = 0;
      ny = ly >= 0 ? 1 : -1;
      nz = 0;
      depth = oy + r;
    } else {
      nx = 0;
      ny = 0;
      nz = lz >= 0 ? 1 : -1;
      depth = oz + r;
    }
  }

  // Back to world.
  out.nx = m[0] * nx + m[1] * ny + m[2] * nz;
  out.ny = m[3] * nx + m[4] * ny + m[5] * nz;
  out.nz = m[6] * nx + m[7] * ny + m[8] * nz;
  out.depth = depth;
  out.px = sx - out.nx * r;
  out.py = sy - out.ny * r;
  out.pz = sz - out.nz * r;
  out.tag = c.tag;
  return true;
}

/** Friction and bounciness per surface. */
export const SURFACE: Record<SurfaceTag, { friction: number; restitution: number }> = {
  ground: { friction: 0.85, restitution: 0.22 },
  water: { friction: 0.15, restitution: 0.02 },
  concrete: { friction: 0.7, restitution: 0.32 },
  metal: { friction: 0.45, restitution: 0.38 },
  wood: { friction: 0.65, restitution: 0.3 },
  foliage: { friction: 0.9, restitution: 0.1 },
  gate: { friction: 0.5, restitution: 0.3 },
  net: { friction: 0.9, restitution: 0.05 },
  fabric: { friction: 0.8, restitution: 0.12 },
};
