import {
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PMREMGenerator,
  Scene,
  Vector3,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { DEG } from '../sim/math';

export type Quality = 'low' | 'medium' | 'high';

const SHADOW_SIZE: Record<Quality, number> = { low: 0, medium: 1024, high: 2048 };

/**
 * Sky, sun and the image-based lighting derived from them.
 *
 * The Preetham sky is rendered once into a pre-filtered environment map, so
 * every PBR surface in the world is lit by the same sky it is seen against —
 * that single step is what makes procedural geometry read as "real".
 */
export class Environment {
  readonly sky = new Sky();
  readonly sun = new DirectionalLight(0xfff1dc, 3.1);
  readonly fill = new HemisphereLight(0xcfe2ff, 0x5b5a3c, 0.25);
  readonly sunDirection = new Vector3();
  envMap: Texture | null = null;
  private time = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    quality: Quality,
  ) {
    const elevation = 38 * DEG;
    const azimuth = 128 * DEG; // compass: sun in the south-east, behind-right of the start line
    this.sunDirection
      .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
      .normalize();

    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.2;
    u.rayleigh.value = 1.35;
    u.mieCoefficient.value = 0.0045;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(this.sunDirection);
    u.cloudCoverage.value = 0.32;
    u.cloudDensity.value = 0.55;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00004;
    u.cloudElevation.value = 0.55;
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;

    this.buildEnvironmentMap();
    scene.add(this.sky);

    scene.fog = new FogExp2(new Color('#b7c9d9'), 0.00085);

    this.sun.position.copy(this.sunDirection).multiplyScalar(250);
    scene.add(this.sun, this.sun.target, this.fill);
    this.configureShadows(quality);
  }

  private buildEnvironmentMap(): void {
    const envScene = new Scene();
    const u = this.sky.material.uniforms;
    u.showSunDisc.value = 0;
    envScene.add(this.sky);
    const pmrem = new PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(envScene, 0, 0.1, 5000);
    pmrem.dispose();
    envScene.remove(this.sky);
    u.showSunDisc.value = 1;
    this.envMap = target.texture;
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.9;
  }

  configureShadows(quality: Quality): void {
    const size = SHADOW_SIZE[quality];
    this.sun.castShadow = size > 0;
    if (size === 0) return;
    const s = this.sun.shadow;
    s.mapSize.set(size, size);
    const extent = quality === 'high' ? 60 : 45;
    s.camera.left = -extent;
    s.camera.right = extent;
    s.camera.top = extent;
    s.camera.bottom = -extent;
    s.camera.near = 20;
    s.camera.far = 520;
    s.bias = -0.00035;
    s.normalBias = 0.03;
    s.radius = 2;
    s.camera.updateProjectionMatrix();
    s.needsUpdate = true;
  }

  /** Keep the shadow frustum centred on the aircraft and the sky around the camera. */
  update(dt: number, focus: Vector3, cameraPosition: Vector3): void {
    this.time += dt;
    this.sky.material.uniforms.time.value = this.time;
    this.sky.position.copy(cameraPosition);
    // Snap to shadow texels to stop shimmering as the drone moves.
    const snap = 0.25;
    const fx = Math.round(focus.x / snap) * snap;
    const fy = Math.round(focus.y / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx, fy, fz).addScaledVector(this.sunDirection, 250);
    this.sun.target.updateMatrixWorld();
  }
}
