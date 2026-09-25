import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CollisionWorld, createContact, sphereVsCollider, type Collider } from '../src/sim/collision';
import { makeRig, run, stick } from './helpers';

function single(world: CollisionWorld): Collider {
  world.build();
  return world.colliders[0];
}

describe('narrow phase', () => {
  it('sphere vs axis-aligned box face', () => {
    const w = new CollisionWorld();
    w.addBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1), 'concrete');
    const c = createContact();
    expect(sphereVsCollider(single(w), 0, 1.2, 0, 0.3, c)).toBe(true);
    expect(c.ny).toBeCloseTo(1, 6);
    expect(c.depth).toBeCloseTo(0.1, 6);
    expect(sphereVsCollider(single(w), 0, 1.4, 0, 0.3, c)).toBe(false);
  });

  it('sphere vs rotated box uses the rotated face normal', () => {
    const w = new CollisionWorld();
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    w.addBox(new Vector3(0, 0, 0), new Vector3(1, 1, 1), 'metal', q);
    const c = createContact();
    // Along the rotated +x face normal (cos45, 0, -sin45).
    const n = new Vector3(1, 0, 0).applyQuaternion(q);
    expect(sphereVsCollider(single(w), n.x * 1.2, 0, n.z * 1.2, 0.3, c)).toBe(true);
    expect(c.nx).toBeCloseTo(n.x, 5);
    expect(c.nz).toBeCloseTo(n.z, 5);
    expect(c.depth).toBeCloseTo(0.1, 5);
  });

  it('sphere inside a box is pushed out through the nearest face', () => {
    const w = new CollisionWorld();
    w.addBox(new Vector3(0, 0, 0), new Vector3(2, 0.5, 2), 'concrete');
    const c = createContact();
    expect(sphereVsCollider(single(w), 0.3, 0.3, 0.1, 0.1, c)).toBe(true);
    expect(c.ny).toBe(1);
    expect(c.depth).toBeCloseTo(0.3, 6);
  });

  it('sphere vs capsule', () => {
    const w = new CollisionWorld();
    w.addCapsule(new Vector3(0, 0, 0), new Vector3(0, 10, 0), 0.2, 'metal');
    const c = createContact();
    expect(sphereVsCollider(single(w), 0.35, 5, 0, 0.2, c)).toBe(true);
    expect(c.nx).toBeCloseTo(1, 6);
    expect(c.depth).toBeCloseTo(0.05, 6);
  });

  it('sphere vs cylinder side and cap', () => {
    const w = new CollisionWorld();
    w.addCylinder(new Vector3(0, 1, 0), 0.5, 1, 'wood');
    const c = createContact();
    expect(sphereVsCollider(single(w), 0.6, 1, 0, 0.2, c)).toBe(true);
    expect(c.nx).toBeCloseTo(1, 6);
    expect(sphereVsCollider(single(w), 0, 2.1, 0, 0.2, c)).toBe(true);
    expect(c.ny).toBeCloseTo(1, 6);
  });
});

describe('broad phase', () => {
  it('gathers only nearby colliders, each once', () => {
    const w = new CollisionWorld();
    w.addBox(new Vector3(0, 1, 0), new Vector3(20, 1, 20), 'concrete'); // spans many cells
    w.addSphere(new Vector3(3, 1, 0), 0.5, 'metal');
    w.addSphere(new Vector3(200, 1, 0), 0.5, 'metal');
    w.build();
    const out: Collider[] = [];
    const n = w.gather(2, 1, 0, 2, out);
    expect(n).toBe(2);
    expect(new Set(out.slice(0, n)).size).toBe(2);
  });
});

describe('the quad against obstacles', () => {
  it('does not tunnel through a wall at race speed', () => {
    const world = new CollisionWorld();
    world.addBox(new Vector3(0, 60, -20), new Vector3(10, 10, 0.1), 'concrete');
    world.build();
    const rig = makeRig('freestyle5', { mode: 'acro' }, world);
    rig.quad.velocity.set(0, 0, -45);
    let peak = 0;
    run(rig, stick({}), 1, { armed: false, onStep: () => (peak = Math.max(peak, rig.quad.impactSpeed)) });
    expect(rig.quad.position.z).toBeGreaterThan(-20);
    expect(peak).toBeGreaterThan(30);
  });

  it('lands on a box and stays on top of it', () => {
    const world = new CollisionWorld();
    world.addBox(new Vector3(0, 55, 0), new Vector3(3, 1, 3), 'concrete');
    world.build();
    const rig = makeRig('freestyle5', {}, world);
    rig.quad.position.set(0, 57, 0);
    run(rig, stick({}), 3, { armed: false });
    expect(rig.quad.position.y).toBeGreaterThan(56);
    expect(rig.quad.position.y).toBeLessThan(56.1);
    expect(rig.quad.velocity.length()).toBeLessThan(0.05);
  });
});
