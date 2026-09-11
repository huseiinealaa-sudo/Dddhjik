import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  TorusGeometry,
} from 'three';
import { DRONE_SPEC } from '../core/Defaults';
import { clamp } from '../core/MathUtils';
import type { MotorOutputs } from '../flight/FlightController';

/**
 * The visible airframe.
 *
 * Built entirely from primitives so there is nothing to download: a carbon
 * bottom plate, four arms with motor bells, prop discs that blur with RPM, a
 * canopy holding the FPV camera, and LEDs that show the arming state.
 *
 * Motor order matches the mixer: 0 = front-left, 1 = front-right,
 * 2 = rear-left, 3 = rear-right.
 */

const ARM_ANGLES = [
  { x: -1, z: -1 }, // front-left
  { x: 1, z: -1 }, // front-right
  { x: -1, z: 1 }, // rear-left
  { x: 1, z: 1 }, // rear-right
];

/** Props on the front-left / rear-right diagonal spin clockwise seen from above. */
const PROP_SPIN = [-1, 1, 1, -1];

export class DroneModel {
  readonly object = new Group();
  /** Empty object at the FPV camera position — the render camera is parented here. */
  readonly cameraMount = new Object3D();

  private readonly propDiscs: Mesh[] = [];
  private readonly propBlades: Group[] = [];
  private readonly motorBells: Mesh[] = [];
  private readonly statusLeds: Mesh[] = [];
  private readonly ledLight: PointLight;
  private readonly disposables: Array<{ dispose(): void }> = [];

  private propAngles = [0, 0, 0, 0];

  constructor() {
    this.object.name = 'drone';

    const arm = DRONE_SPEC.armLength * Math.SQRT1_2;

    // ------------------------------------------------------------ materials
    const carbon = new MeshStandardMaterial({
      color: '#1b1f27',
      roughness: 0.42,
      metalness: 0.55,
    });
    const aluminium = new MeshStandardMaterial({
      color: '#9aa4b2',
      roughness: 0.32,
      metalness: 0.85,
    });
    const accent = new MeshStandardMaterial({
      color: '#f97316',
      roughness: 0.4,
      metalness: 0.2,
      emissive: '#7c2d12',
      emissiveIntensity: 0.35,
    });
    const canopyMaterial = new MeshStandardMaterial({
      color: '#111827',
      roughness: 0.35,
      metalness: 0.3,
    });
    this.disposables.push(carbon, aluminium, accent, canopyMaterial);

    // ---------------------------------------------------------- bottom plate
    const plateGeometry = new BoxGeometry(0.085, 0.006, 0.14);
    const plate = new Mesh(plateGeometry, carbon);
    plate.castShadow = true;
    this.object.add(plate);
    this.disposables.push(plateGeometry);

    const topPlateGeometry = new BoxGeometry(0.07, 0.005, 0.10);
    const topPlate = new Mesh(topPlateGeometry, carbon);
    topPlate.position.y = 0.033;
    topPlate.castShadow = true;
    this.object.add(topPlate);
    this.disposables.push(topPlateGeometry);

    // ------------------------------------------------------------------ arms
    const armGeometry = new BoxGeometry(0.014, 0.006, 1);
    this.disposables.push(armGeometry);
    const bellGeometry = new CylinderGeometry(0.014, 0.016, 0.017, 12);
    const statorGeometry = new CylinderGeometry(0.0125, 0.0125, 0.009, 10);
    this.disposables.push(bellGeometry, statorGeometry);

    const discGeometry = new CylinderGeometry(0.064, 0.064, 0.0016, 24);
    this.disposables.push(discGeometry);
    const bladeGeometry = new BoxGeometry(0.118, 0.0018, 0.014);
    this.disposables.push(bladeGeometry);

    for (let i = 0; i < 4; i++) {
      const dir = ARM_ANGLES[i];
      const mx = dir.x * arm;
      const mz = dir.z * arm;

      const armMesh = new Mesh(armGeometry, carbon);
      armMesh.position.set(mx / 2, 0, mz / 2);
      armMesh.scale.z = Math.hypot(mx, mz) * 1.08;
      armMesh.rotation.y = Math.atan2(mx, mz);
      armMesh.castShadow = true;
      this.object.add(armMesh);

      const stator = new Mesh(statorGeometry, carbon);
      stator.position.set(mx, 0.008, mz);
      this.object.add(stator);

      const bell = new Mesh(bellGeometry, i < 2 ? aluminium : accent);
      bell.position.set(mx, 0.019, mz);
      bell.castShadow = true;
      this.object.add(bell);
      this.motorBells.push(bell);

      // Blurred disc shown at speed.
      const discMaterial = new MeshBasicMaterial({
        color: 0xdfe6ef,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      });
      this.disposables.push(discMaterial);
      const disc = new Mesh(discGeometry, discMaterial);
      disc.position.set(mx, 0.03, mz);
      this.object.add(disc);
      this.propDiscs.push(disc);

      // Discrete blades shown when the props are slow.
      const bladeMaterial = new MeshStandardMaterial({
        color: i < 2 ? '#e2e8f0' : '#94a3b8',
        roughness: 0.5,
        metalness: 0.1,
        transparent: true,
        opacity: 1,
        side: DoubleSide,
      });
      this.disposables.push(bladeMaterial);
      const blades = new Group();
      for (let b = 0; b < 3; b++) {
        const blade = new Mesh(bladeGeometry, bladeMaterial);
        blade.rotation.y = (b / 3) * Math.PI * 2;
        blade.rotation.z = 0.16 * PROP_SPIN[i];
        blades.add(blade);
      }
      blades.position.set(mx, 0.03, mz);
      this.object.add(blades);
      this.propBlades.push(blades);
    }

    // ---------------------------------------------------------------- canopy
    const canopyGeometry = new BoxGeometry(0.042, 0.036, 0.055);
    const canopy = new Mesh(canopyGeometry, canopyMaterial);
    canopy.position.set(0, 0.028, -0.012);
    canopy.rotation.x = -0.12;
    canopy.castShadow = true;
    this.object.add(canopy);
    this.disposables.push(canopyGeometry);

    const lensGeometry = new CylinderGeometry(0.011, 0.011, 0.006, 12);
    const lensMaterial = new MeshStandardMaterial({
      color: '#0b1220',
      roughness: 0.08,
      metalness: 0.9,
    });
    const lens = new Mesh(lensGeometry, lensMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.034, -0.04);
    this.object.add(lens);
    this.disposables.push(lensGeometry, lensMaterial);

    // Camera mount sits where the lens is; tilt is applied by the camera rig.
    this.cameraMount.position.set(0, 0.034, -0.03);
    this.object.add(this.cameraMount);

    // ------------------------------------------------------------------ LEDs
    const ledGeometry = new BoxGeometry(0.03, 0.004, 0.008);
    this.disposables.push(ledGeometry);
    for (const side of [-1, 1]) {
      const ledMaterial = new MeshBasicMaterial({ color: 0x3a3a3a });
      this.disposables.push(ledMaterial);
      const led = new Mesh(ledGeometry, ledMaterial);
      led.position.set(side * 0.03, -0.006, 0.06);
      this.object.add(led);
      this.statusLeds.push(led);
    }

    this.ledLight = new PointLight(0xff3b30, 0, 2.2, 2);
    this.ledLight.position.set(0, -0.02, 0.05);
    this.object.add(this.ledLight);

    // ------------------------------------------------------------ antenna + shadow blob
    const antennaGeometry = new CylinderGeometry(0.0015, 0.0015, 0.05, 6);
    const antennaMaterial = new MeshStandardMaterial({ color: '#222831', roughness: 0.7 });
    const antenna = new Mesh(antennaGeometry, antennaMaterial);
    antenna.position.set(0, 0.05, 0.06);
    antenna.rotation.x = -0.45;
    this.object.add(antenna);
    this.disposables.push(antennaGeometry, antennaMaterial);

    const capGeometry = new TorusGeometry(0.008, 0.003, 6, 10);
    const capMaterial = new MeshStandardMaterial({ color: '#e11d48', roughness: 0.5 });
    const cap = new Mesh(capGeometry, capMaterial);
    cap.position.set(0, 0.073, 0.072);
    cap.rotation.x = -0.45;
    this.object.add(cap);
    this.disposables.push(capGeometry, capMaterial);
  }

  /**
   * @param motorState smoothed motor outputs (0..1)
   * @param dt         frame delta in seconds
   * @param armed      drives the LED colour and the prop blur
   */
  update(motorState: MotorOutputs, dt: number, armed: boolean, elapsed: number): void {
    for (let i = 0; i < 4; i++) {
      const rpm = clamp(motorState[i], 0, 1);
      // Up to ~40 000 rpm on 6S; scaled down so the visual does not strobe badly.
      const speed = rpm * 220 * PROP_SPIN[i];
      this.propAngles[i] = (this.propAngles[i] + speed * dt) % (Math.PI * 2);
      this.propBlades[i].rotation.y = this.propAngles[i];

      // Cross-fade between discrete blades and a motion-blurred disc.
      const blur = clamp((rpm - 0.12) / 0.3, 0, 1);
      const discMaterial = this.propDiscs[i].material as MeshBasicMaterial;
      discMaterial.opacity = blur * 0.28;
      const bladeMaterial = this.propBlades[i].children[0] as Mesh;
      const material = bladeMaterial.material as MeshStandardMaterial;
      material.opacity = 1 - blur * 0.82;
      material.transparent = true;

      this.motorBells[i].rotation.y = this.propAngles[i] * 0.4;
    }

    const blink = armed ? (Math.sin(elapsed * 12) > 0 ? 1 : 0.15) : 0.5 + 0.5 * Math.sin(elapsed * 2.2);
    const colour = armed ? 0x22c55e : 0xef4444;
    for (const led of this.statusLeds) {
      const material = led.material as MeshBasicMaterial;
      material.color.setHex(colour);
      material.color.multiplyScalar(0.25 + blink * 0.75);
    }
    this.ledLight.color.setHex(colour);
    this.ledLight.intensity = blink * (armed ? 0.9 : 0.4);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}
