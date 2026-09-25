import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { ORBIT_POLE, type DrillTarget } from '../../game/drills';
import { terrainHeight } from '../../sim/world';

/**
 * Visual targets for the training drills: a glowing bubble to hover in, a
 * landing ring on the grass, or a striped pylon to orbit. The fill level shows
 * how much of the target's requirement is met.
 */
export class DrillMarkers {
  readonly group = new Group();
  private readonly bubble: Mesh;
  private readonly bubbleMat: MeshBasicMaterial;
  private readonly equator: Mesh;
  private readonly pad: Mesh;
  private readonly padFill: Mesh;
  private readonly padMat: MeshBasicMaterial;
  private readonly fillMat: MeshBasicMaterial;
  private readonly pole: Group;
  private readonly poleRing: Mesh;
  private readonly color = new Color();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor() {
    this.group.name = 'drill-markers';
    this.bubbleMat = new MeshBasicMaterial({
      color: new Color(0.2, 1.2, 1.6),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.bubble = new Mesh(new SphereGeometry(1, 32, 16), this.bubbleMat);
    this.equator = new Mesh(new TorusGeometry(1, 0.025, 8, 64), new MeshBasicMaterial({ color: new Color(0.4, 2.5, 3), toneMapped: false }));
    this.equator.rotation.x = Math.PI / 2;
    this.bubble.add(this.equator);

    this.padMat = new MeshBasicMaterial({ color: new Color(0.3, 2, 2.4), transparent: true, opacity: 0.9, side: DoubleSide, toneMapped: false });
    this.pad = new Mesh(new RingGeometry(0.86, 1, 48), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    this.fillMat = new MeshBasicMaterial({ color: new Color(0.2, 1.5, 0.5), transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false });
    this.padFill = new Mesh(new RingGeometry(0, 0.86, 48), this.fillMat);
    this.pad.add(this.padFill);

    this.pole = new Group();
    const stripes = new MeshStandardMaterial({ color: '#f97316', roughness: 0.5 });
    const white = new MeshStandardMaterial({ color: '#f8fafc', roughness: 0.5 });
    for (let i = 0; i < 8; i++) {
      const seg = new Mesh(new CylinderGeometry(0.22, 0.22, 1, 16), i % 2 ? white : stripes);
      seg.position.y = 0.5 + i;
      seg.castShadow = true;
      this.pole.add(seg);
      this.disposables.push(seg.geometry);
    }
    this.poleRing = new Mesh(new RingGeometry(0.97, 1, 96), this.padMat);
    this.poleRing.rotation.x = -Math.PI / 2;
    this.poleRing.position.y = 0.05;
    this.pole.add(this.poleRing);
    this.pole.position.set(ORBIT_POLE.x, terrainHeight(ORBIT_POLE.x, ORBIT_POLE.z), ORBIT_POLE.z);
    this.disposables.push(stripes, white);

    this.group.add(this.bubble, this.pad, this.pole);
    this.disposables.push(
      this.bubble.geometry,
      this.bubbleMat,
      this.equator.geometry,
      this.equator.material as MeshBasicMaterial,
      this.pad.geometry,
      this.padMat,
      this.padFill.geometry,
      this.fillMat,
      this.poleRing.geometry,
    );
    this.show(null, 0, 0);
  }

  show(target: DrillTarget | null, fill: number, time: number): void {
    this.bubble.visible = target?.kind === 'sphere';
    this.pad.visible = target?.kind === 'pad';
    this.poleRing.visible = target?.kind === 'pole';
    if (!target) return;
    const pulse = 0.75 + 0.25 * Math.sin(time * 4);
    if (target.kind === 'sphere') {
      this.bubble.position.copy(target.position);
      this.bubble.scale.setScalar(target.radius);
      this.color.setRGB(0.2 + fill * 0.2, 1.2 + fill * 0.8, 1.6 - fill * 1.1);
      this.bubbleMat.color.copy(this.color);
      this.bubbleMat.opacity = 0.1 + 0.12 * pulse + fill * 0.2;
      this.equator.rotation.z = time * 0.8;
    } else if (target.kind === 'pad') {
      this.pad.position.copy(target.position);
      this.pad.scale.setScalar(target.radius);
      this.padFill.scale.setScalar(Math.max(0.001, fill));
      this.padMat.opacity = 0.55 + 0.4 * pulse;
    } else {
      this.poleRing.scale.setScalar(target.radius);
      this.padMat.opacity = 0.4 + 0.3 * pulse;
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
