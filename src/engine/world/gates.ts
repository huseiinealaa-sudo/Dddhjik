import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,

  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollisionWorld } from '../../sim/collision';
import type { GateTrigger } from '../../sim/tracks';

export type GateState = 'next' | 'upcoming' | 'passed' | 'idle';

const PAD_COLORS = ['#f97316', '#2563eb', '#ec4899', '#16a34a', '#eab308', '#7c3aed'];
const BAR = 0.16;

interface BarSpec {
  center: Vector3;
  size: Vector3;
  quat: Quaternion;
  color: Color;
}

function numberAtlas(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    const x = (i % 4) * 256;
    const y = Math.floor(i / 4) * 128;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(x + 4, y + 4, 248, 120);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 7, y + 7, 242, 114);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), x + 128, y + 70);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * Builds every gate of a track: padded frames, inflatable arches, a dive tower,
 * LED outlines (which double as the "fly here next" indicator) and number
 * boards — a handful of instanced draw calls in total.
 */
export class GateSet {
  readonly group = new Group();
  private readonly ledMesh: InstancedMesh;
  private readonly archLedMesh: InstancedMesh | null;
  /** For each gate, the LED instances that belong to it. */
  private readonly ledRanges: Array<{ box: number[]; arch: number[] }> = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly color = new Color();

  constructor(triggers: GateTrigger[], world: CollisionWorld) {
    this.group.name = 'gates';
    const bars: BarSpec[] = [];
    const leds: Array<{ matrix: Matrix4; gate: number }> = [];
    const arches: Array<{ matrix: Matrix4; color: Color; radius: number; gate: number }> = [];
    const tube = new Vector3();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);

    const addBar = (center: Vector3, size: Vector3, quat: Quaternion, color: Color, collide: boolean): void => {
      bars.push({ center: center.clone(), size: size.clone(), quat: quat.clone(), color });
      if (collide) world.addBox(center, size.clone().multiplyScalar(0.5), 'gate', quat);
    };
    const addLed = (center: Vector3, size: Vector3, quat: Quaternion, gate: number): void => {
      leds.push({ matrix: new Matrix4().compose(center, quat, size), gate });
    };

    triggers.forEach((t, gi) => {
      const color = new Color(PAD_COLORS[gi % PAD_COLORS.length]);
      q.setFromAxisAngle(up, -t.headingRad);
      const at = (lx: number, ly: number, lz = 0): Vector3 =>
        new Vector3().copy(t.center).addScaledVector(t.right, lx).addScaledVector(t.up, ly).addScaledVector(t.normal, lz);

      if (t.kind === 'square') {
        const w = t.halfWidth * 2;
        const h = t.halfHeight * 2;
        const bottomY = t.center.y - t.halfHeight;
        const topY = t.center.y + t.halfHeight;
        const postHeight = topY + BAR - t.groundY;
        for (const s of [-1, 1]) {
          const x = s * (t.halfWidth + BAR / 2);
          const c = at(x, 0);
          c.y = t.groundY + postHeight / 2;
          addBar(c, tube.set(BAR, postHeight, BAR), q, color, true);
          const foot = at(x, 0);
          foot.y = t.groundY + 0.03;
          addBar(foot, tube.set(0.5, 0.06, 0.7), q, color.clone().multiplyScalar(0.4), false);
        }
        addBar(at(0, t.halfHeight + BAR / 2), tube.set(w + BAR * 2, BAR, BAR), q, color, true);
        if (bottomY - t.groundY > 0.2) addBar(at(0, -t.halfHeight - BAR / 2), tube.set(w + BAR * 2, BAR, BAR), q, color, true);
        if (t.def.ladder) {
          const lowTop = bottomY - 0.35;
          const lowBottom = t.groundY + 0.35;
          const mid = at(0, 0);
          mid.y = lowTop;
          addBar(mid, tube.set(w + BAR * 2, BAR, BAR), q, color, true);
          mid.y = lowBottom;
          addBar(mid, tube.set(w + BAR * 2, BAR, BAR), q, color, true);
        }
        // LED strip just inside the opening.
        const inset = 0.05;
        addLed(at(0, t.halfHeight - inset), tube.set(w - 0.1, 0.035, 0.05), q, gi);
        addLed(at(0, -t.halfHeight + inset), tube.set(w - 0.1, 0.035, 0.05), q, gi);
        addLed(at(-t.halfWidth + inset, 0), tube.set(0.035, h - 0.1, 0.05), q, gi);
        addLed(at(t.halfWidth - inset, 0), tube.set(0.035, h - 0.1, 0.05), q, gi);
      } else if (t.kind === 'arch') {
        const r = (t.def.size ?? 2.4) as number;
        const base = new Vector3(t.center.x, t.groundY, t.center.z);
        const m = new Matrix4().compose(base, q, new Vector3(r, r, r));
        arches.push({ matrix: m, color, radius: r, gate: gi });
        // Colliders around the arc.
        const segments = 9;
        for (let k = 0; k < segments; k++) {
          const a0 = (k / segments) * Math.PI;
          const a1 = ((k + 1) / segments) * Math.PI;
          const p0 = base.clone().addScaledVector(t.right, Math.cos(a0) * r).add(new Vector3(0, Math.sin(a0) * r, 0));
          const p1 = base.clone().addScaledVector(t.right, Math.cos(a1) * r).add(new Vector3(0, Math.sin(a1) * r, 0));
          world.addCapsule(p0, p1, 0.2, 'fabric');
        }
      } else if (t.kind === 'dive') {
        const s = t.halfWidth;
        const y = t.center.y;
        // Scaffold legs.
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const x0 = new Vector3().copy(t.center).addScaledVector(t.right, sx * (s + 0.25)).addScaledVector(t.up, sz * (s + 0.25));
            const top = x0.clone();
            top.y = y;
            const bottom = x0.clone();
            bottom.y = t.groundY;
            const c = top.clone().add(bottom).multiplyScalar(0.5);
            addBar(c, tube.set(0.08, y - t.groundY, 0.08), q, new Color('#9ca3af'), false);
            world.addCapsule(bottom, top, 0.06, 'metal');
          }
        }
        // Horizontal padded frame.
        const flat = new Quaternion().copy(q);
        for (const side of [-1, 1]) {
          addBar(new Vector3().copy(t.center).addScaledVector(t.up, side * (s + BAR / 2)), tube.set(s * 2 + BAR * 2, BAR, BAR), flat, color, true);
          const c2 = new Vector3().copy(t.center).addScaledVector(t.right, side * (s + BAR / 2));
          addBar(c2, tube.set(BAR, BAR, s * 2), flat, color, true);
        }
        addLed(new Vector3().copy(t.center).addScaledVector(t.up, s - 0.05), tube.set(s * 2 - 0.1, 0.05, 0.035), flat, gi);
        addLed(new Vector3().copy(t.center).addScaledVector(t.up, -s + 0.05), tube.set(s * 2 - 0.1, 0.05, 0.035), flat, gi);
        addLed(new Vector3().copy(t.center).addScaledVector(t.right, -s + 0.05), tube.set(0.035, 0.05, s * 2 - 0.1), flat, gi);
        addLed(new Vector3().copy(t.center).addScaledVector(t.right, s - 0.05), tube.set(0.035, 0.05, s * 2 - 0.1), flat, gi);
      } else {
        // Portal: an opening in a building. Only an LED outline marks it.
        const w = t.halfWidth * 2;
        const h = t.halfHeight * 2;
        addLed(at(0, t.halfHeight - 0.08, -0.25), tube.set(w - 0.2, 0.05, 0.05), q, gi);
        addLed(at(0, -t.halfHeight + 0.08, -0.25), tube.set(w - 0.2, 0.05, 0.05), q, gi);
        addLed(at(-t.halfWidth + 0.08, 0, -0.25), tube.set(0.05, h - 0.2, 0.05), q, gi);
        addLed(at(t.halfWidth - 0.08, 0, -0.25), tube.set(0.05, h - 0.2, 0.05), q, gi);
      }
    });

    // ------------------------------------------------------------ frames
    const unit = new BoxGeometry(1, 1, 1);
    const padMat = new MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 });
    this.disposables.push(unit, padMat);
    if (bars.length > 0) {
      const mesh = new InstancedMesh(unit, padMat, bars.length);
      const m = new Matrix4();
      bars.forEach((b, i) => {
        mesh.setMatrixAt(i, m.compose(b.center, b.quat, b.size));
        mesh.setColorAt(i, b.color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }

    // --------------------------------------------------------------- arches
    if (arches.length > 0) {
      const torus = new TorusGeometry(1, 0.085, 12, 40, Math.PI);
      const archMat = new MeshStandardMaterial({ roughness: 0.38, metalness: 0.02 });
      this.disposables.push(torus, archMat);
      const mesh = new InstancedMesh(torus, archMat, arches.length);
      arches.forEach((a, i) => {
        mesh.setMatrixAt(i, a.matrix);
        mesh.setColorAt(i, a.color);
      });
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);

      const ledTorus = new TorusGeometry(0.9, 0.018, 6, 40, Math.PI);
      const ledMat = new MeshBasicMaterial({ toneMapped: false });
      this.disposables.push(ledTorus, ledMat);
      this.archLedMesh = new InstancedMesh(ledTorus, ledMat, arches.length);
      arches.forEach((a, i) => {
        this.archLedMesh!.setMatrixAt(i, a.matrix);
        this.archLedMesh!.setColorAt(i, new Color(0x111111));
      });
      this.group.add(this.archLedMesh);
    } else {
      this.archLedMesh = null;
    }

    // ------------------------------------------------------------------ LEDs
    const ledMat = new MeshBasicMaterial({ toneMapped: false });
    this.disposables.push(ledMat);
    this.ledMesh = new InstancedMesh(unit, ledMat, Math.max(leds.length, 1));
    leds.forEach((l, i) => {
      this.ledMesh.setMatrixAt(i, l.matrix);
      this.ledMesh.setColorAt(i, new Color(0x111111));
    });
    this.ledMesh.computeBoundingSphere();
    this.group.add(this.ledMesh);

    for (let i = 0; i < triggers.length; i++) this.ledRanges.push({ box: [], arch: [] });
    leds.forEach((l, i) => this.ledRanges[l.gate].box.push(i));
    arches.forEach((a, i) => this.ledRanges[a.gate].arch.push(i));

    // ------------------------------------------------------- number boards
    this.group.add(this.buildNumberBoards(triggers));
  }

  private buildNumberBoards(triggers: GateTrigger[]): Mesh {
    const atlas = numberAtlas();
    const pieces: BufferGeometry[] = [];
    const tmp = new Object3D();
    triggers.forEach((t, i) => {
      if (t.kind === 'portal' || i >= 16) return;
      const plane = new PlaneGeometry(1.1, 0.55);
      const uv = plane.attributes.uv as BufferAttribute;
      const col = i % 4;
      const row = Math.floor(i / 4);
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, (col + uv.getX(k)) / 4, 1 - (row + 1 - uv.getY(k)) / 4);
      }
      const top =
        t.kind === 'dive'
          ? t.center.y + 0.9
          : t.kind === 'arch'
            ? t.groundY + (t.def.size ?? 2.4) + 0.55
            : t.center.y + t.halfHeight + 0.6;
      tmp.position.set(t.center.x, top, t.center.z);
      // Face the approaching pilot (a plane faces +Z; heading 0 is flown towards -Z).
      tmp.rotation.set(0, -t.headingRad, 0);
      tmp.updateMatrix();
      plane.applyMatrix4(tmp.matrix);
      pieces.push(plane);
    });
    const geometry = pieces.length > 0 ? mergeGeometries(pieces)! : new PlaneGeometry(0.01, 0.01);
    const material = new MeshBasicMaterial({ map: atlas, side: DoubleSide });
    this.disposables.push(atlas, geometry, material);
    return new Mesh(geometry, material);
  }

  /** Recolour the LED outlines from the race state. */
  setStates(states: GateState[], time: number): void {
    const pulse = 0.65 + 0.35 * Math.sin(time * 6);
    states.forEach((s, gi) => {
      const range = this.ledRanges[gi];
      if (!range) return;
      switch (s) {
        case 'next':
          this.color.setRGB(0.25 * 3 * pulse, 1.1 * 3 * pulse, 1.3 * 3 * pulse);
          break;
        case 'upcoming':
          this.color.setRGB(0.1, 0.45, 0.55);
          break;
        case 'passed':
          this.color.setRGB(0.15, 0.9, 0.35);
          break;
        default:
          this.color.setRGB(0.04, 0.05, 0.06);
      }
      for (const i of range.box) this.ledMesh.setColorAt(i, this.color);
      if (this.archLedMesh) for (const i of range.arch) this.archLedMesh.setColorAt(i, this.color);
    });
    if (this.ledMesh.instanceColor) this.ledMesh.instanceColor.needsUpdate = true;
    if (this.archLedMesh?.instanceColor) this.archLedMesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}

