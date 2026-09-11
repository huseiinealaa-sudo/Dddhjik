import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { WORLD } from '../core/Defaults';
import { clamp, createRandom } from '../core/MathUtils';
import { terrainHeight, terrainNormal } from '../core/Terrain';
import type { CollisionWorld } from '../physics/Collision';
import type { QualityLevel } from '../core/Types';
import { Sky } from './Sky';
import { createGrassTexture } from './Textures';

/** Direction the sun comes from (normalised in the constructor). */
export const SUN_DIRECTION = new Vector3(0.42, 0.72, 0.55).normalize();

const CLOUD_SHADOW = new Color('#9db4cc');

const TERRAIN_SEGMENTS: Record<QualityLevel, number> = { low: 96, medium: 160, high: 240 };
const SHADOW_MAP_SIZE: Record<QualityLevel, number> = { low: 0, medium: 1024, high: 2048 };

/**
 * The static, non-interactive part of the world: sky, lighting, ground mesh,
 * distant hills, trees and the low cloud layer.
 *
 * Everything that the drone can actually collide with lives in `Course.ts`.
 */
export class Environment {
  readonly sky: Sky;
  readonly sun: DirectionalLight;
  readonly ambient: HemisphereLight;
  readonly ground: Mesh;

  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly scene: Scene,
    private readonly collision: CollisionWorld,
    quality: QualityLevel,
  ) {
    scene.background = new Color('#a9c7e0');
    scene.fog = new FogExp2(0xb4cde2, 0.0016);

    this.sky = new Sky(SUN_DIRECTION);
    this.sky.mesh.scale.setScalar(WORLD.size * 2.4);
    scene.add(this.sky.mesh);
    this.disposables.push(this.sky);

    this.ambient = new HemisphereLight(0xcfe4f7, 0x7d8a5c, 1.55);
    scene.add(this.ambient);

    this.sun = new DirectionalLight(0xfff4e2, 3.1);
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(160);
    this.sun.target.position.set(0, 0, 0);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.configureShadows(quality);

    this.ground = this.buildTerrain(quality);
    scene.add(this.ground);

    this.buildDistantHills();
    this.buildTreeBelt();
    this.buildClouds();
    this.buildBoundaryMarkers();
  }

  private configureShadows(quality: QualityLevel): void {
    const size = SHADOW_MAP_SIZE[quality];
    if (size === 0) {
      this.sun.castShadow = false;
      return;
    }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(size, size);
    const extent = 130;
    this.sun.shadow.camera.left = -extent;
    this.sun.shadow.camera.right = extent;
    this.sun.shadow.camera.top = extent;
    this.sun.shadow.camera.bottom = -extent;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /**
   * Displaced plane driven by the shared `terrainHeight` function, tinted per
   * vertex so slopes read as rock and the flat centre reads as mown grass.
   */
  private buildTerrain(quality: QualityLevel): Mesh {
    const segments = TERRAIN_SEGMENTS[quality];
    const extent = WORLD.size * 2;
    const geometry = new PlaneGeometry(extent, extent, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position as BufferAttribute;
    const colours = new Float32Array(position.count * 3);
    const normal: [number, number, number] = [0, 1, 0];

    // These are *tints*, not colours: they multiply the grass albedo, so they
    // are all close to white. Painting the real colour here as well would
    // multiply two dark greens together and leave the ground almost black.
    const neutral = new Color('#ffffff');
    const dryGrass = new Color('#d9d49a');
    const rock = new Color('#bdb4a6');
    const tint = new Color();

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const height = terrainHeight(x, z);
      position.setY(i, height);

      terrainNormal(x, z, normal);
      const slope = 1 - normal[1];
      const dryness = clamp(0.5 + 0.5 * Math.sin(x * 0.021) * Math.cos(z * 0.017), 0, 1);

      tint.copy(neutral).lerp(dryGrass, dryness * 0.6).lerp(rock, clamp(slope * 6, 0, 0.9));
      colours[i * 3] = tint.r;
      colours[i * 3 + 1] = tint.g;
      colours[i * 3 + 2] = tint.b;
    }

    geometry.setAttribute('color', new BufferAttribute(colours, 3));
    geometry.computeVertexNormals();

    const grassTexture = createGrassTexture(512, 140);
    this.disposables.push(grassTexture);

    const material = new MeshStandardMaterial({
      map: grassTexture,
      vertexColors: true,
      roughness: 0.97,
      metalness: 0,
    });
    this.disposables.push(material);

    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  /** A ring of low-poly peaks that closes the horizon without costing anything. */
  private buildDistantHills(): void {
    const count = 46;
    const geometry = new ConeGeometry(1, 1, 6, 1);
    const material = new MeshStandardMaterial({
      color: new Color('#93a3ab'),
      roughness: 1,
      metalness: 0,
      flatShading: true,
      fog: true,
    });
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;

    const rand = createRandom(0x5eed1234);
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand() * 0.08;
      const radius = WORLD.size * (1.15 + rand() * 0.42);
      const height = 90 + rand() * 190;
      const width = 130 + rand() * 210;
      position.set(Math.cos(angle) * radius, height * 0.34, Math.sin(angle) * radius);
      quaternion.setFromAxisAngle(new Vector3(0, 1, 0), rand() * Math.PI);
      scale.set(width, height, width);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  /**
   * Trees around the edge of the flying field. They are solid: each one gets a
   * cylinder collider so clipping a trunk actually ends your run.
   */
  private buildTreeBelt(): void {
    const count = 210;
    const rand = createRandom(0xa17c33);

    const trunkGeometry = new CylinderGeometry(0.22, 0.34, 1, 6, 1);
    const trunkMaterial = new MeshStandardMaterial({ color: '#6a5138', roughness: 0.95 });
    const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, count);

    const crownGeometry = new ConeGeometry(1, 1, 7, 2);
    const crownMaterial = new MeshStandardMaterial({
      color: '#4e7a2e',
      roughness: 0.9,
      flatShading: true,
    });
    const crowns = new InstancedMesh(crownGeometry, crownMaterial, count);

    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const yAxis = new Vector3(0, 1, 0);

    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 168 + rand() * 300;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const base = terrainHeight(x, z);
      const height = 6 + rand() * 11;
      const crownRadius = 1.9 + rand() * 2.1;

      quaternion.setFromAxisAngle(yAxis, rand() * Math.PI * 2);

      position.set(x, base + height * 0.3, z);
      scale.set(1, height * 0.6, 1);
      matrix.compose(position, quaternion, scale);
      trunks.setMatrixAt(i, matrix);

      position.set(x, base + height * 0.72, z);
      scale.set(crownRadius, height * 0.85, crownRadius);
      matrix.compose(position, quaternion, scale);
      crowns.setMatrixAt(i, matrix);

      this.collision.addCylinder(
        new Vector3(x, base + height * 0.5, z),
        Math.max(crownRadius * 0.45, 0.5),
        height * 0.5,
        'tree',
      );
    }

    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.scene.add(trunks, crowns);
    this.disposables.push(trunkGeometry, trunkMaterial, crownGeometry, crownMaterial);
  }

  /** Flat, soft cloud puffs high above the field — pure visual depth cue. */
  private buildClouds(): void {
    const rand = createRandom(0xc10ad5);
    const geometry = new SphereGeometry(1, 14, 9);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      fog: false,
    });

    const puffsPerCloud = 6;
    const clouds = 18;
    const mesh = new InstancedMesh(geometry, material, clouds * puffsPerCloud);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();

    // Shading each puff slightly differently is what stops a cloud reading as
    // one flat white blob — the underside picks up the cool ground bounce.
    const puffColour = new Color();
    let index = 0;
    for (let c = 0; c < clouds; c++) {
      const angle = rand() * Math.PI * 2;
      const radius = 120 + rand() * WORLD.size * 0.9;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;
      const cy = 240 + rand() * 160;
      const spread = 17 + rand() * 22;
      for (let p = 0; p < puffsPerCloud; p++) {
        position.set(
          cx + (rand() - 0.5) * spread * 2,
          cy + (rand() - 0.5) * spread * 0.25,
          cz + (rand() - 0.5) * spread * 2,
        );
        const s = spread * (0.4 + rand() * 0.5);
        scale.set(s, s * 0.42, s);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        puffColour.setRGB(1, 1, 1).lerp(CLOUD_SHADOW, rand() * 0.45);
        mesh.setColorAt(index, puffColour);
        index += 1;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  /** Faint boundary ring so the pilot can tell where the playable area ends. */
  private buildBoundaryMarkers(): void {
    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({
      color: 0xff7a4c,
      transparent: true,
      opacity: 0.055,
      side: DoubleSide,
      depthWrite: false,
      fog: true,
    });
    const segments = 72;
    const mesh = new InstancedMesh(geometry, material, segments);
    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const helper = new Object3D();

    const radius = WORLD.size * 0.94;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      helper.position.set(x, terrainHeight(x, z) + 11, z);
      helper.lookAt(0, helper.position.y, 0);
      helper.updateMatrix();
      helper.matrix.decompose(position, quaternion, scale);
      scale.set((Math.PI * 2 * radius) / segments, 22, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.disposables.push(geometry, material);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
