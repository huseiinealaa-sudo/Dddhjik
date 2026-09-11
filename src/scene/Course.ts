import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { createRandom, DEG2RAD } from '../core/MathUtils';
import type { CollisionWorld } from '../physics/Collision';
import { createConcreteTexture, createContainerTexture, createHazardTexture } from './Textures';

/**
 * The training course: a timed circuit of gates plus a freestyle area full of
 * solid obstacles (containers, crates, pylons and a limbo bar).
 *
 * Gate crossings are detected analytically — the drone's signed distance to the
 * gate plane is tracked between frames, so even at 150 km/h a gate can never be
 * "tunnelled" through without registering.
 */

interface GateDefinition {
  x: number;
  z: number;
  /** Yaw of the gate in degrees. The pilot flies along the gate's local -Z. */
  rotationDeg: number;
  /** Clear width of the opening, metres. */
  width: number;
  /** Clear height of the opening, metres. */
  height: number;
  /** Height of the bottom bar above the ground, metres. */
  base: number;
  label?: string;
}

/**
 * Circuit layout. It starts over the launch pad, opens with two easy gates,
 * tightens through a low limbo, climbs into a high gate and comes back around.
 */
const GATE_LAYOUT: GateDefinition[] = [
  { x: 0, z: -14, rotationDeg: 0, width: 6, height: 5, base: 1.2, label: 'START' },
  { x: 0, z: -44, rotationDeg: 0, width: 5, height: 4.5, base: 1.4 },
  { x: -18, z: -70, rotationDeg: -38, width: 4.5, height: 4, base: 1.4 },
  { x: -48, z: -78, rotationDeg: -82, width: 4, height: 3.4, base: 0.9, label: 'LOW' },
  { x: -70, z: -50, rotationDeg: -134, width: 4.5, height: 4, base: 6.5, label: 'HIGH' },
  { x: -66, z: -12, rotationDeg: -170, width: 5, height: 4.5, base: 1.4 },
  { x: -40, z: 16, rotationDeg: 145, width: 4.2, height: 3.8, base: 1.4 },
  { x: -6, z: 30, rotationDeg: 108, width: 4.6, height: 4.2, base: 2.6 },
  { x: 30, z: 26, rotationDeg: 78, width: 5, height: 4.5, base: 1.4 },
  { x: 52, z: -6, rotationDeg: 34, width: 4.4, height: 4, base: 1.4 },
  { x: 40, z: -40, rotationDeg: 8, width: 4.6, height: 4.2, base: 4.5 },
  { x: 16, z: -30, rotationDeg: -12, width: 5.4, height: 5, base: 1.2, label: 'FINISH' },
];

export interface Gate {
  index: number;
  center: Vector3;
  /** Unit vector along the direction of travel through the gate. */
  forward: Vector3;
  /** Unit vector across the opening. */
  right: Vector3;
  halfWidth: number;
  halfHeight: number;
  /** Centre height of the opening. */
  centerY: number;
  group: Group;
  ringMaterial: MeshStandardMaterial;
  definition: GateDefinition;
}

export interface GateEvent {
  index: number;
  /** True when the pilot flew through the correct next gate. */
  correct: boolean;
}

const ACTIVE_COLOUR = new Color('#22d3ee');
const ACTIVE_EMISSIVE = new Color('#0e7490');
const IDLE_COLOUR = new Color('#7c8794');
const IDLE_EMISSIVE = new Color('#1b2430');
const DONE_COLOUR = new Color('#4ade80');
const DONE_EMISSIVE = new Color('#166534');

export class Course {
  readonly gates: Gate[] = [];
  readonly spawnPosition = new Vector3(0, 0.2, 6);
  readonly spawnHeading = 0;

  private readonly previousSide: number[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly group = new Group();

  private activeGate = 0;

  constructor(
    private readonly scene: Scene,
    private readonly collision: CollisionWorld,
  ) {
    this.group.name = 'course';
    scene.add(this.group);

    this.buildLaunchPad();
    this.buildGates();
    this.buildObstacles();
    this.buildSlalom();
    this.setActiveGate(0);
  }

  // ---------------------------------------------------------------- geometry

  private buildLaunchPad(): void {
    const concrete = createConcreteTexture(512, 5);
    this.disposables.push(concrete);

    // Deliberately small: the FPV camera sits 15 cm above it, so a big pad
    // would fill a third of the frame with flat grey on every spawn.
    const padSize = 9;
    const padGeometry = new BoxGeometry(padSize, 0.3, padSize);
    const padMaterial = new MeshStandardMaterial({ map: concrete, roughness: 0.95, metalness: 0.02 });
    const pad = new Mesh(padGeometry, padMaterial);
    pad.position.set(0, 0.15, 6);
    pad.receiveShadow = true;
    this.group.add(pad);
    this.disposables.push(padGeometry, padMaterial);
    this.collision.addBox(
      new Vector3(0, 0.15, 6),
      new Vector3(padSize / 2, 0.15, padSize / 2),
      0,
      'pad',
    );

    // Landing circle painted on the pad.
    const markGeometry = new PlaneGeometry(4.4, 4.4);
    const markMaterial = new MeshBasicMaterial({
      map: createHelipadTexture(),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    const mark = new Mesh(markGeometry, markMaterial);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(0, 0.31, 6);
    this.group.add(mark);
    this.disposables.push(markGeometry, markMaterial);
  }

  private buildGates(): void {
    const hazard = createHazardTexture(128, 1);
    this.disposables.push(hazard);

    const barGeometry = new BoxGeometry(1, 1, 1);
    this.disposables.push(barGeometry);

    GATE_LAYOUT.forEach((definition, index) => {
      const group = new Group();
      const rotation = definition.rotationDeg * DEG2RAD;
      group.position.set(definition.x, 0, definition.z);
      group.rotation.y = rotation;

      const post = 0.16;
      const halfWidth = definition.width / 2;
      const centerY = definition.base + definition.height / 2;

      const ringMaterial = new MeshStandardMaterial({
        color: IDLE_COLOUR.clone(),
        emissive: IDLE_EMISSIVE.clone(),
        emissiveIntensity: 1.4,
        roughness: 0.45,
        metalness: 0.25,
      });
      this.disposables.push(ringMaterial);

      const frameMaterial = new MeshStandardMaterial({
        map: hazard,
        roughness: 0.7,
        metalness: 0.1,
      });
      this.disposables.push(frameMaterial);

      // Two uprights + top and bottom bars form the opening.
      const uprightHeight = definition.height + post * 2;
      for (const side of [-1, 1]) {
        const upright = new Mesh(barGeometry, ringMaterial);
        upright.scale.set(post * 2, uprightHeight, post * 2);
        upright.position.set(side * (halfWidth + post), centerY, 0);
        upright.castShadow = true;
        group.add(upright);
      }

      for (const [offset, material] of [
        [definition.height / 2 + post, ringMaterial],
        [-definition.height / 2 - post, frameMaterial],
      ] as const) {
        const bar = new Mesh(barGeometry, material);
        bar.scale.set(definition.width + post * 4, post * 2, post * 2);
        bar.position.set(0, centerY + offset, 0);
        bar.castShadow = true;
        group.add(bar);
      }

      // Legs down to the ground when the gate is raised.
      if (definition.base > 0.4) {
        for (const side of [-1, 1]) {
          const leg = new Mesh(barGeometry, frameMaterial);
          leg.scale.set(post * 1.6, definition.base, post * 1.6);
          leg.position.set(side * (halfWidth + post), definition.base / 2, 0);
          leg.castShadow = true;
          group.add(leg);
          this.collision.addBox(
            new Vector3(
              definition.x + Math.cos(rotation) * side * (halfWidth + post),
              definition.base / 2,
              definition.z - Math.sin(rotation) * side * (halfWidth + post),
            ),
            new Vector3(post * 0.8, definition.base / 2, post * 0.8),
            rotation,
            'gate',
          );
        }
      }

      // Number plate above the gate.
      const plate = this.createGatePlate(index + 1, definition.label);
      plate.position.set(0, centerY + definition.height / 2 + 1.0, 0);
      group.add(plate);

      this.group.add(group);

      // --- colliders for the frame itself ---
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const worldOffset = (localX: number, localY: number): Vector3 =>
        new Vector3(definition.x + localX * cos, localY, definition.z - localX * sin);

      for (const side of [-1, 1]) {
        this.collision.addBox(
          worldOffset(side * (halfWidth + post), centerY),
          new Vector3(post, uprightHeight / 2, post),
          rotation,
          'gate',
        );
      }
      this.collision.addBox(
        worldOffset(0, centerY + definition.height / 2 + post),
        new Vector3(definition.width / 2 + post * 2, post, post),
        rotation,
        'gate',
      );
      this.collision.addBox(
        worldOffset(0, centerY - definition.height / 2 - post),
        new Vector3(definition.width / 2 + post * 2, post, post),
        rotation,
        'gate',
      );

      const forward = new Vector3(-Math.sin(rotation), 0, -Math.cos(rotation)).normalize();
      const right = new Vector3(Math.cos(rotation), 0, -Math.sin(rotation)).normalize();

      this.gates.push({
        index,
        center: new Vector3(definition.x, centerY, definition.z),
        forward,
        right,
        halfWidth,
        halfHeight: definition.height / 2,
        centerY,
        group,
        ringMaterial,
        definition,
      });
      this.previousSide.push(0);
    });
  }

  private createGatePlate(number: number, label?: string): Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(8,12,18,0.86)';
      ctx.fillRect(0, 0, 256, 128);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, 250, 122);
      ctx.fillStyle = '#e6f6ff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (label) {
        ctx.font = 'bold 54px system-ui, sans-serif';
        ctx.fillText(String(number), 78, 66);
        ctx.font = 'bold 34px system-ui, sans-serif';
        ctx.fillStyle = '#22d3ee';
        ctx.fillText(label, 168, 68);
      } else {
        ctx.font = 'bold 78px system-ui, sans-serif';
        ctx.fillText(String(number), 128, 68);
      }
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const geometry = new PlaneGeometry(2.2, 1.1);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide });
    this.disposables.push(texture, geometry, material);
    return new Mesh(geometry, material);
  }

  /** Shipping containers, crates and a limbo bar for the freestyle area. */
  private buildObstacles(): void {
    const palette = ['#b04a3a', '#2f6ea5', '#3f7a4a', '#c8a13a', '#7a4b8f'];
    const boxGeometry = new BoxGeometry(1, 1, 1);
    this.disposables.push(boxGeometry);

    const containerMaterials = palette.map((colour) => {
      const texture = createContainerTexture(colour, 256, 1);
      const material = new MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.28 });
      this.disposables.push(texture, material);
      return material;
    });

    interface BoxSpec {
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
      d: number;
      rot?: number;
      material?: number;
    }

    const containers: BoxSpec[] = [
      // A canyon the pilot can dive through, just wide enough for a 5".
      { x: 22, y: 1.3, z: -62, w: 12, h: 2.6, d: 2.6, rot: 0, material: 0 },
      { x: 22, y: 1.3, z: -55, w: 12, h: 2.6, d: 2.6, rot: 0, material: 1 },
      { x: 22, y: 3.9, z: -62, w: 12, h: 2.6, d: 2.6, rot: 0, material: 2 },
      { x: 22, y: 3.9, z: -55, w: 12, h: 2.6, d: 2.6, rot: 0, material: 3 },
      // Stacked block near the pad.
      { x: -26, y: 1.3, z: 44, w: 12, h: 2.6, d: 2.6, rot: 0.35, material: 4 },
      { x: -26, y: 3.9, z: 44, w: 9, h: 2.6, d: 2.6, rot: 0.35, material: 1 },
      { x: -14, y: 1.3, z: 52, w: 12, h: 2.6, d: 2.6, rot: -0.2, material: 2 },
      // Long wall to carve around.
      { x: 62, y: 2.6, z: 36, w: 24, h: 5.2, d: 2.4, rot: -0.6, material: 3 },
      { x: 78, y: 1.3, z: 8, w: 12, h: 2.6, d: 2.6, rot: 1.1, material: 0 },
    ];

    for (const spec of containers) {
      const material = containerMaterials[(spec.material ?? 0) % containerMaterials.length];
      const mesh = new Mesh(boxGeometry, material);
      mesh.scale.set(spec.w, spec.h, spec.d);
      mesh.position.set(spec.x, spec.y, spec.z);
      mesh.rotation.y = spec.rot ?? 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.collision.addBox(
        new Vector3(spec.x, spec.y, spec.z),
        new Vector3(spec.w / 2, spec.h / 2, spec.d / 2),
        spec.rot ?? 0,
        'container',
      );
    }

    // Scattered crates for low-altitude proximity flying.
    const crateMaterial = new MeshStandardMaterial({ color: '#8a6a44', roughness: 0.94 });
    this.disposables.push(crateMaterial);
    const rand = createRandom(0xcaffe1);
    for (let i = 0; i < 34; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 24 + rand() * 96;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.hypot(x, z - 6) < 14) continue; // keep the launch pad clear
      const size = 0.9 + rand() * 1.8;
      const mesh = new Mesh(boxGeometry, crateMaterial);
      mesh.scale.setScalar(size);
      mesh.position.set(x, size / 2, z);
      mesh.rotation.y = rand() * Math.PI;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.collision.addBox(
        new Vector3(x, size / 2, z),
        new Vector3(size / 2, size / 2, size / 2),
        mesh.rotation.y,
        'crate',
      );
    }

    // Limbo bar: fly under it without clipping the deck.
    const barMaterial = new MeshStandardMaterial({
      color: '#e2e8f0',
      emissive: '#334155',
      roughness: 0.4,
      metalness: 0.4,
    });
    this.disposables.push(barMaterial);
    const bar = new Mesh(boxGeometry, barMaterial);
    bar.scale.set(14, 0.24, 0.24);
    bar.position.set(-52, 1.5, 22);
    bar.rotation.y = 0.5;
    bar.castShadow = true;
    this.group.add(bar);
    this.collision.addBox(
      new Vector3(-52, 1.5, 22),
      new Vector3(7, 0.12, 0.12),
      0.5,
      'limbo',
    );
    for (const side of [-1, 1]) {
      const legX = -52 + Math.cos(0.5) * side * 7;
      const legZ = 22 - Math.sin(0.5) * side * 7;
      const leg = new Mesh(boxGeometry, barMaterial);
      leg.scale.set(0.22, 1.5, 0.22);
      leg.position.set(legX, 0.75, legZ);
      leg.castShadow = true;
      this.group.add(leg);
      this.collision.addBox(new Vector3(legX, 0.75, legZ), new Vector3(0.11, 0.75, 0.11), 0, 'limbo');
    }
  }

  /** Slalom pylons — no gates to trigger, just cones to weave through. */
  private buildSlalom(): void {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({
      color: '#f97316',
      emissive: '#7c2d12',
      emissiveIntensity: 0.5,
      roughness: 0.6,
    });
    this.disposables.push(geometry, material);

    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const x = -100 + t * 34;
      const z = 70 - t * 84;
      const height = 5 + (i % 3) * 1.6;
      const mesh = new Mesh(geometry, material);
      mesh.scale.set(0.3, height, 0.3);
      mesh.position.set(x, height / 2, z);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.collision.addCylinder(new Vector3(x, height / 2, z), 0.22, height / 2, 'pylon');
    }
  }

  // ------------------------------------------------------------- gameplay

  get totalGates(): number {
    return this.gates.length;
  }

  get nextGateIndex(): number {
    return this.activeGate;
  }

  get nextGate(): Gate | undefined {
    return this.gates[this.activeGate];
  }

  setActiveGate(index: number): void {
    this.activeGate = index % this.gates.length;
    for (const gate of this.gates) {
      const material = gate.ringMaterial;
      if (gate.index === this.activeGate) {
        material.color.copy(ACTIVE_COLOUR);
        material.emissive.copy(ACTIVE_EMISSIVE);
        material.emissiveIntensity = 2.2;
      } else if (gate.index < this.activeGate) {
        material.color.copy(DONE_COLOUR);
        material.emissive.copy(DONE_EMISSIVE);
        material.emissiveIntensity = 0.8;
      } else {
        material.color.copy(IDLE_COLOUR);
        material.emissive.copy(IDLE_EMISSIVE);
        material.emissiveIntensity = 0.6;
      }
    }
  }

  resetProgress(): void {
    for (let i = 0; i < this.previousSide.length; i++) this.previousSide[i] = 0;
    this.setActiveGate(0);
  }

  /** Seed the crossing detector so spawning behind a gate does not trigger it. */
  primeAt(position: Vector3): void {
    for (const gate of this.gates) {
      this.previousSide[gate.index] = Math.sign(toGateLocal(position, gate).z) || -1;
    }
  }

  /**
   * Feed the drone position each frame. Returns a gate event when the aircraft
   * passes through the opening of a gate.
   */
  update(position: Vector3): GateEvent | null {
    let event: GateEvent | null = null;

    for (const gate of this.gates) {
      const local = toGateLocal(position, gate);
      const side = Math.sign(local.z) || this.previousSide[gate.index] || -1;
      const previous = this.previousSide[gate.index];
      this.previousSide[gate.index] = side;

      if (previous === 0 || side === previous) continue;
      // Only count a crossing in the intended direction of travel.
      if (!(previous < 0 && side > 0)) continue;
      if (Math.abs(local.x) > gate.halfWidth) continue;
      if (Math.abs(local.y) > gate.halfHeight) continue;

      const correct = gate.index === this.activeGate;
      event = { index: gate.index, correct };
      if (correct) {
        this.setActiveGate((this.activeGate + 1) % this.gates.length);
      }
      break;
    }

    return event;
  }

  /** Pulse the active gate so it is easy to spot from a distance. */
  animate(elapsed: number): void {
    const gate = this.nextGate;
    if (!gate) return;
    gate.ringMaterial.emissiveIntensity = 1.6 + Math.sin(elapsed * 5) * 0.9;
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const item of this.disposables) item.dispose();
  }
}

const localScratch = new Vector3();

/** Project a world position into a gate's local frame (x = across, y = up, z = along travel). */
function toGateLocal(position: Vector3, gate: Gate): Vector3 {
  localScratch.subVectors(position, gate.center);
  const x = localScratch.dot(gate.right);
  const y = localScratch.y;
  const z = localScratch.dot(gate.forward);
  return localScratch.set(x, y, z);
}

function createHelipadTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(236,240,245,0.62)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(128, 128, 96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(236,240,245,0.66)';
    ctx.font = 'bold 130px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('H', 128, 136);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
