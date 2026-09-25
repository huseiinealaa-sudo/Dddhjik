import {
  BoxGeometry,
  BufferGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld, SurfaceTag } from '../../sim/collision';

const IDENTITY = new Quaternion();

/**
 * Collects static geometry per material and merges it into one mesh each, so a
 * building made of hundreds of boxes costs a single draw call. Colliders are
 * registered as pieces are added, so visuals and physics cannot drift apart.
 */
export class Batch {
  private readonly groups = new Map<Material, BufferGeometry[]>();
  private readonly matrix = new Matrix4();
  private readonly scale = new Vector3();

  constructor(private readonly world: CollisionWorld) {}

  add(material: Material, geometry: BufferGeometry): void {
    let list = this.groups.get(material);
    if (!list) {
      list = [];
      this.groups.set(material, list);
    }
    list.push(geometry);
  }

  /** Axis-aligned or rotated box; `collider` registers a matching box collider. */
  box(material: Material, center: Vector3, size: Vector3, collider: SurfaceTag | null, quat: Quaternion = IDENTITY): void {
    const g = new BoxGeometry(size.x, size.y, size.z);
    g.applyMatrix4(this.matrix.compose(center, quat, this.scale.set(1, 1, 1)));
    this.add(material, g);
    if (collider) this.world.addBox(center, size.clone().multiplyScalar(0.5), collider, quat === IDENTITY ? undefined : quat);
  }

  /** Place an arbitrary geometry with a transform. */
  place(material: Material, geometry: BufferGeometry, position: Vector3, quat: Quaternion = IDENTITY, scale = 1): void {
    geometry.applyMatrix4(this.matrix.compose(position, quat, this.scale.setScalar(scale)));
    this.add(material, geometry);
  }

  build(parent: Object3D, shadows = true): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [material, parts] of this.groups) {
      // mergeGeometries needs all-indexed or all-non-indexed input.
      const mixed = parts.some((p) => p.index) && parts.some((p) => !p.index);
      const normalized = mixed ? parts.map((p) => (p.index ? p.toNonIndexed() : p)) : parts;
      const merged = mergeGeometries(normalized, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, material);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      parent.add(mesh);
      meshes.push(mesh);
      for (const p of parts) p.dispose();
    }
    this.groups.clear();
    return meshes;
  }
}
