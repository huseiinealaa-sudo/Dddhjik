import { Group, Quaternion, Vector3, type Scene, type Texture, type WebGLRenderer } from 'three';
import { CollisionWorld } from '../../sim/collision';
import { buildTriggers, TRACKS, type GateTrigger, type TrackDef } from '../../sim/tracks';
import { isOverWater, LAKE, PAD, PILOT, terrainHeight, YARD } from '../../sim/world';
import type { Wind } from '../../sim/wind';
import { Environment, type Quality } from '../environment';
import { worldClock } from '../materials';
import {
  carbonTexture,
  concreteTexture,
  corrugatedTexture,
  dirtTexture,
  fenceTexture,
  graffitiTexture,
  grassTexture,
  metalTexture,
  rockTexture,
  waterNormalTexture,
  yardTexture,
} from '../textures';
import { ORBIT_POLE } from '../../game/drills';
import { buildField } from './field';
import { DrillMarkers } from './markers';
import { GateSet, type GateState } from './gates';
import { Grass } from './grass';
import { buildTerrain } from './terrain';
import { buildVegetation } from './vegetation';
import { buildWater } from './water';
import { buildYard } from './yard';

export interface WorldTextures {
  carbon: Texture;
}

/** Everything static in the world: terrain, props, lighting, and the active track's gates. */
export class GameWorld {
  readonly collision = new CollisionWorld();
  readonly environment: Environment;
  readonly textures: WorldTextures;
  readonly pads: Vector3[];
  readonly markers = new DrillMarkers();
  private readonly grass: Grass;
  private readonly windsock: Group;
  private readonly staticColliders: number;
  private gates: GateSet | null = null;
  private currentTrack: TrackDef['id'] | null = null;
  triggers: GateTrigger[] = [];

  private readonly windSample = new Vector3();
  private readonly sockQ = new Quaternion();
  private readonly sockTarget = new Quaternion();
  private readonly sockDir = new Vector3();

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    quality: Quality,
  ) {
    this.environment = new Environment(renderer, scene, quality);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const aniso = quality === 'high' ? Math.min(8, maxAniso) : quality === 'medium' ? Math.min(4, maxAniso) : 1;
    const withAniso = (t: Texture): Texture => {
      t.anisotropy = aniso;
      return t;
    };
    const texSize = quality === 'low' ? 256 : 512;

    const grass = withAniso(grassTexture(texSize));
    const dirt = withAniso(dirtTexture(texSize));
    const rock = withAniso(rockTexture(texSize));
    const { terrain, skirt } = buildTerrain(quality, { grass, dirt, rock });
    scene.add(terrain, skirt);
    scene.add(buildWater(waterNormalTexture()));

    const field = buildField(scene, this.collision, { dirt });
    this.windsock = field.windsock;
    this.pads = field.pads;

    buildYard(scene, this.collision, {
      yard: withAniso(yardTexture(quality === 'low' ? 512 : 1024)),
      concrete: withAniso(concreteTexture(texSize)),
      corrugated: withAniso(corrugatedTexture()),
      metal: withAniso(metalTexture()),
      fence: fenceTexture(),
      graffiti: [1, 2, 3, 4].map((s) => graffitiTexture(s)),
    });

    // Keep trees and bushes off every race line, the yard and the lake shore.
    const gateSpots = TRACKS.flatMap((t) => t.gates.map((g) => [g.x, g.z] as const));
    const inYard = (x: number, z: number, margin: number): boolean =>
      Math.abs(x - YARD.x) < YARD.halfX + margin && Math.abs(z - YARD.z) < YARD.halfZ + margin;
    buildVegetation(scene, this.collision, {
      quality,
      blocked: (x, z, r) => {
        if (inYard(x, z, 10 + r)) return true;
        for (const [gx, gz] of gateSpots) if (Math.hypot(x - gx, z - gz) < 12 + r) return true;
        return false;
      },
    });

    this.grass = new Grass(scene, quality, (x, z) => {
      if (inYard(x, z, 1)) return true;
      if (isOverWater(x, z) || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius * 1.05) return true;
      if (Math.abs(x - PAD.x) < 1.6 && Math.abs(z - PAD.z) < 1.6) return true;
      if (Math.hypot(x - PILOT.x, z - PILOT.z) < 4.5) return true;
      return terrainHeight(x, z) > 60;
    });

    scene.add(this.markers.group);
    const poleY = terrainHeight(ORBIT_POLE.x, ORBIT_POLE.z);
    this.collision.addCylinder(
      new Vector3(ORBIT_POLE.x, poleY + ORBIT_POLE.height / 2, ORBIT_POLE.z),
      ORBIT_POLE.radius,
      ORBIT_POLE.height / 2,
      'wood',
    );

    this.textures = { carbon: carbonTexture() };
    this.staticColliders = this.collision.colliders.length;
    this.collision.build();
  }

  /** Swap the gates for another track's (or none for pure free flight). */
  setTrack(id: TrackDef['id'] | null): GateTrigger[] {
    if (id === this.currentTrack) return this.triggers;
    this.gates?.dispose();
    this.gates = null;
    this.collision.truncate(this.staticColliders);
    this.currentTrack = id;
    this.triggers = [];
    if (id) {
      const track = TRACKS.find((t) => t.id === id);
      if (track) {
        this.triggers = buildTriggers(track);
        this.gates = new GateSet(this.triggers, this.collision);
        this.scene.add(this.gates.group);
        this.collision.build();
      }
    }
    return this.triggers;
  }

  setGateStates(states: GateState[], time: number): void {
    this.gates?.setStates(states, time);
  }

  setGatesVisible(visible: boolean): void {
    if (this.gates) this.gates.group.visible = visible;
  }

  update(dt: number, time: number, focus: Vector3, camera: Vector3, wind: Wind): void {
    worldClock.value = time;
    this.environment.update(dt, focus, camera);

    // The grass bends with the wind at the camera; the windsock shows it at 5 m.
    const ground = terrainHeight(camera.x, camera.z);
    wind.sample(camera, Math.max(0.5, camera.y - ground), this.windSample);
    this.grass.update(camera, ground, this.windSample);

    wind.sample(this.windsock.position, 5, this.windSample);
    const speed = Math.hypot(this.windSample.x, this.windSample.z);
    const droop = Math.max(0, 1 - speed / 7) * 1.2; // limp at calm, horizontal from ~7 m/s
    const yaw = Math.atan2(-this.windSample.z, this.windSample.x);
    this.sockTarget.setFromAxisAngle(this.sockDir.set(0, 1, 0), yaw);
    this.sockQ.setFromAxisAngle(this.sockDir.set(0, 0, 1), -droop);
    this.sockTarget.multiply(this.sockQ);
    this.windsock.quaternion.slerp(this.sockTarget, 1 - Math.exp(-dt * 2.5));
  }
}
