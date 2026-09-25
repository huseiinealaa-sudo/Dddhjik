import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { MOTOR_SPIN, MOTOR_X, MOTOR_Z } from '../../sim/layout';
import { clamp01, DEG } from '../../sim/math';
import type { QuadPreset } from '../../sim/presets';

/**
 * Procedural airframe, built to the same dimensions the physics uses, so the
 * props you see spinning are exactly where the thrust is applied.
 */

function roundedRect(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Flat part lying in the XZ plane, `thickness` tall, top face at y = 0. */
function plate(shape: Shape, thickness: number): ExtrudeGeometry {
  const g = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 10 });
  g.rotateX(Math.PI / 2);
  return g;
}

function bladeShape(radius: number, rootChord: number, tipChord: number): Shape {
  const s = new Shape();
  const r0 = radius * 0.13;
  s.moveTo(r0, -rootChord * 0.35);
  s.bezierCurveTo(radius * 0.45, -rootChord * 0.55, radius * 0.85, -tipChord * 0.5, radius, 0);
  s.bezierCurveTo(radius * 0.9, tipChord * 0.55, radius * 0.5, rootChord * 0.5, r0, rootChord * 0.4);
  s.lineTo(r0, -rootChord * 0.35);
  return s;
}

function batteryLabel(text: string, sub: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, 0, 256, 20);
  ctx.fillRect(0, 108, 256, 20);
  ctx.fillStyle = '#f8fafc';
  ctx.font = '900 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 66);
  ctx.fillStyle = '#facc15';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.fillText(sub, 128, 96);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Semi-transparent disc that stands in for a spinning prop. */
function blurMaterial(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 0 }, uAngle: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uAngle;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0 || r < 0.12) discard;
        float a = atan(p.y, p.x) + uAngle;
        // Faint blade "ghosts" and a denser band where the blades are widest.
        float blades = 0.55 + 0.45 * pow(abs(cos(a * 1.5)), 6.0);
        float band = smoothstep(0.12, 0.35, r) * (1.0 - smoothstep(0.85, 1.0, r));
        float tip = smoothstep(0.93, 0.99, r) * 0.6;
        float alpha = (band * 0.55 * blades + tip) * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

export interface DroneMeshOptions {
  carbon: Texture;
  ghost?: boolean;
}

export class DroneMesh {
  readonly root = new Group();
  /** Where the FPV camera sits (before up-tilt), in body coordinates. */
  readonly cameraOffset = new Vector3();
  private readonly blades: Group[] = [];
  private readonly discs: Mesh[] = [];
  private readonly discMats: ShaderMaterial[] = [];
  private readonly bladeMats: MeshStandardMaterial[] = [];
  private readonly angles = [0, 0, 0, 0];
  private readonly ledMat: MeshBasicMaterial;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly preset: QuadPreset,
    opts: DroneMeshOptions,
  ) {
    const p = preset;
    const s = p.armLength / 0.1125; // scale relative to the 5" reference
    const a = p.armLength * Math.SQRT1_2;
    const propR = p.propDiameter / 2;
    const ghost = opts.ghost ?? false;

    // ------------------------------------------------------------ materials
    const track = <M extends { dispose(): void }>(m: M): M => {
      this.disposables.push(m);
      return m;
    };
    const ghostMat = ghost
      ? track(new MeshBasicMaterial({ color: new Color(0.3, 1.4, 1.8), transparent: true, opacity: 0.35, depthWrite: false }))
      : null;
    const mat = (m: Material): Material => ghostMat ?? m;

    const carbonMap = opts.carbon.clone();
    carbonMap.repeat.set(3, 3);
    carbonMap.needsUpdate = true;
    this.disposables.push(carbonMap);
    const carbon = mat(
      track(
        new MeshPhysicalMaterial({
          color: new Color(p.look.frame),
          map: carbonMap,
          roughness: 0.42,
          metalness: 0.25,
          clearcoat: 0.85,
          clearcoatRoughness: 0.18,
        }),
      ),
    );
    const accent = mat(track(new MeshStandardMaterial({ color: new Color(p.look.accent), roughness: 0.35, metalness: 0.75 })));
    const aluminium = mat(track(new MeshStandardMaterial({ color: '#c9cdd4', roughness: 0.3, metalness: 0.9 })));
    const blackPlastic = mat(track(new MeshStandardMaterial({ color: '#15171c', roughness: 0.55, metalness: 0.1 })));
    const pcb = mat(track(new MeshStandardMaterial({ color: '#10231a', roughness: 0.5, metalness: 0.3 })));
    const glass = mat(track(new MeshPhysicalMaterial({ color: '#0a1020', roughness: 0.05, metalness: 0.2, clearcoat: 1 })));
    const tpu = mat(track(new MeshStandardMaterial({ color: new Color(p.look.accent).multiplyScalar(0.8), roughness: 0.7 })));

    const add = (g: BufferGeometry, m: Material, x = 0, y = 0, z = 0, cast = true): Mesh => {
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = cast && !ghost;
      mesh.receiveShadow = !ghost;
      this.root.add(mesh);
      this.disposables.push(g);
      return mesh;
    };

    // ---------------------------------------------------------------- frame
    const plateT = 0.005 * Math.max(s, 0.8);
    const center = roundedRect(0.075 * s, 0.13 * s, 0.012 * s);
    add(plate(center, plateT), carbon, 0, 0, 0);
    const armW = (p.ducted ? 0.02 : 0.017) * s;
    for (let i = 0; i < 4; i++) {
      const arm = roundedRect(armW, p.armLength * 1.02, armW * 0.45);
      const g = plate(arm, plateT);
      g.translate(0, 0, -p.armLength * 0.51);
      const mesh = add(g, carbon);
      mesh.rotation.y = Math.atan2(-MOTOR_X[i], -MOTOR_Z[i]) + Math.PI;
      mesh.rotation.y = -Math.atan2(MOTOR_X[i], -MOTOR_Z[i]);
      const pad = new Shape();
      pad.absarc(0, 0, 0.016 * s, 0, Math.PI * 2, false);
      add(plate(pad, plateT), carbon, MOTOR_X[i] * a, 0, MOTOR_Z[i] * a);
    }
    // Top plate + standoffs.
    const topY = 0.032 * s;
    add(plate(roundedRect(0.05 * s, 0.1 * s, 0.01 * s), 0.002 * s), carbon, 0, topY, 0.005 * s);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(new CylinderGeometry(0.0028 * s, 0.0028 * s, topY, 8), accent, sx * 0.02 * s, topY / 2, sz * 0.04 * s + 0.005 * s);
      }
    }
    // Flight controller + ESC stack.
    add(new BoxGeometry(0.036 * s, 0.0016, 0.036 * s), pcb, 0, 0.01 * s, 0.01 * s);
    add(new BoxGeometry(0.036 * s, 0.0016, 0.036 * s), pcb, 0, 0.018 * s, 0.01 * s);
    add(new BoxGeometry(0.01 * s, 0.003 * s, 0.01 * s), blackPlastic, 0.006 * s, 0.021 * s, 0.006 * s);

    // ------------------------------------------------------------ fpv camera
    const camZ = -0.052 * s;
    const camY = 0.017 * s;
    this.cameraOffset.set(0, camY, camZ - 0.012 * s);
    const cam = new Group();
    cam.position.set(0, camY, camZ);
    cam.rotation.x = p.cameraTilt * DEG;
    const camBody = new Mesh(new BoxGeometry(0.019 * s, 0.019 * s, 0.017 * s), ghostMat ?? blackPlastic);
    const lens = new Mesh(new CylinderGeometry(0.0065 * s, 0.0075 * s, 0.01 * s, 16), ghostMat ?? blackPlastic);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -0.013 * s;
    const lensGlass = new Mesh(new CircleGeometry(0.0055 * s, 16), ghostMat ?? glass);
    lensGlass.position.z = -0.0181 * s;
    lensGlass.rotation.y = Math.PI;
    cam.add(camBody, lens, lensGlass);
    this.root.add(cam);
    for (const side of [-1, 1]) add(new BoxGeometry(0.002 * s, 0.03 * s, 0.028 * s), carbon, side * 0.0115 * s, camY, camZ + 0.002 * s);

    // Action camera for the freestyle build.
    if (p.id === 'freestyle5' || p.id === 'longrange7') {
      add(new BoxGeometry(0.03 * s, 0.012 * s, 0.03 * s), tpu, 0, topY + 0.045 * s, -0.03 * s);
      const gp = add(new BoxGeometry(0.062, 0.044, 0.033), blackPlastic, 0, topY + 0.074 * s, -0.035 * s);
      gp.rotation.x = -12 * DEG;
      const gpLens = add(new CylinderGeometry(0.011, 0.012, 0.008, 18), glass, 0.012, topY + 0.076 * s, -0.055 * s);
      gpLens.rotation.x = Math.PI / 2 - 12 * DEG;
    }

    // ---------------------------------------------------------------- battery
    const cells = p.battery.cells;
    const bw = (p.ducted ? 0.03 : 0.036) * s;
    const bl = (p.id === 'longrange7' ? 0.1 : 0.075) * s;
    const bh = (cells >= 6 ? 0.036 : 0.028) * s;
    const label = batteryLabel(`${cells}S ${p.battery.capacityMah}`, p.battery.chemistry === 'liion' ? 'Li-ion 21700' : 'LiPo 120C');
    this.disposables.push(label);
    const batMats = [
      track(new MeshStandardMaterial({ color: '#16181d', roughness: 0.6 })),
      track(new MeshStandardMaterial({ color: '#16181d', roughness: 0.6 })),
      track(new MeshStandardMaterial({ color: '#1b1e25', roughness: 0.5 })),
      track(new MeshStandardMaterial({ color: '#16181d', roughness: 0.6 })),
      track(new MeshStandardMaterial({ map: label, roughness: 0.45 })),
      track(new MeshStandardMaterial({ map: label, roughness: 0.45 })),
    ];
    const battery = new Mesh(new BoxGeometry(bw, bh, bl), ghostMat ?? batMats);
    battery.position.set(0, topY + 0.004 * s + bh / 2, 0.006 * s);
    battery.castShadow = !ghost;
    this.root.add(battery);
    this.disposables.push(battery.geometry);
    add(new BoxGeometry(bw + 0.002, bh + 0.0025, 0.012 * s), blackPlastic, 0, topY + 0.0045 * s + bh / 2, 0.02 * s);
    // Balance lead.
    add(new BoxGeometry(0.004, 0.004, 0.02 * s), ghostMat ?? track(new MeshStandardMaterial({ color: '#dc2626', roughness: 0.6 })), bw / 2 + 0.002, topY + bh * 0.8, bl * 0.3);

    // ---------------------------------------------------------------- antenna
    const ant = new Group();
    ant.position.set(0, topY, 0.06 * s);
    ant.rotation.x = 40 * DEG;
    const tube = new Mesh(new CylinderGeometry(0.0025, 0.0035, 0.05 * s, 8), ghostMat ?? tpu);
    tube.position.y = 0.025 * s;
    const cap = new Mesh(new SphereGeometry(0.009 * s, 12, 8), ghostMat ?? blackPlastic);
    cap.position.y = 0.052 * s;
    cap.scale.set(1, 0.55, 1);
    ant.add(tube, cap);
    this.root.add(ant);
    if (p.id === 'longrange7') {
      add(new CylinderGeometry(0.0015, 0.0015, 0.05, 6), blackPlastic, 0, topY + 0.025, 0.045);
      add(new CylinderGeometry(0.014, 0.014, 0.006, 20), ghostMat ?? track(new MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.4 })), 0, topY + 0.052, 0.045);
    }

    // ------------------------------------------------------------ motors + props
    const bellR = (p.id === 'cinewhoop3' ? 0.011 : p.id === 'longrange7' ? 0.019 : 0.0145) * Math.max(s, 0.75);
    const bladeColor = new Color(p.look.props);
    for (let i = 0; i < 4; i++) {
      const mx = MOTOR_X[i] * a;
      const mz = MOTOR_Z[i] * a;
      add(new CylinderGeometry(bellR * 0.95, bellR, 0.006, 18), blackPlastic, mx, 0.004, mz);
      add(new CylinderGeometry(bellR, bellR * 0.98, 0.012, 20), accent, mx, 0.013, mz);
      add(new CylinderGeometry(bellR * 0.45, bellR * 0.45, 0.004, 12), aluminium, mx, 0.021, mz);

      let bladeMat: Material;
      if (ghostMat) {
        bladeMat = ghostMat;
      } else {
        const m = track(new MeshStandardMaterial({ color: bladeColor, roughness: 0.35, metalness: 0.05, transparent: true, opacity: 0.92, side: DoubleSide }));
        this.bladeMats.push(m);
        bladeMat = m;
      }
      const blades = new Group();
      const count = p.propBlades;
      const chord = (p.propBlades >= 5 ? 0.012 : p.propBlades === 2 ? 0.016 : 0.014) * Math.max(s, 0.7);
      const bladeGeo = new ExtrudeGeometry(bladeShape(propR, chord, chord * 0.45), { depth: 0.0012, bevelEnabled: false, curveSegments: 8 });
      bladeGeo.rotateX(Math.PI / 2);
      this.disposables.push(bladeGeo);
      for (let b = 0; b < count; b++) {
        const holder = new Object3D();
        holder.rotation.y = (b / count) * Math.PI * 2;
        const blade = new Mesh(bladeGeo, bladeMat);
        // Blade pitch, handed per rotation direction.
        blade.rotation.x = MOTOR_SPIN[i] * 12 * DEG;
        blade.castShadow = !ghost;
        holder.add(blade);
        blades.add(holder);
      }
      blades.position.set(mx, p.propHeight, mz);
      this.root.add(blades);
      this.blades.push(blades);
      add(new CylinderGeometry(0.004, 0.005, 0.008, 10), aluminium, mx, p.propHeight + 0.004, mz);

      if (!ghost) {
        const discMat = blurMaterial(bladeColor.clone().lerp(new Color(1, 1, 1), 0.35));
        this.discMats.push(discMat);
        this.disposables.push(discMat);
        const disc = add(new CircleGeometry(propR, 40), discMat, mx, p.propHeight + 0.001, mz, false);
        disc.rotation.x = -Math.PI / 2;
        disc.renderOrder = 10;
        this.discs.push(disc);
      }

      if (p.ducted) {
        const duct = new Mesh(new CylinderGeometry(propR + 0.006, propR + 0.008, 0.028, 32, 1, true), ghostMat ?? track(new MeshStandardMaterial({ color: '#1f2229', roughness: 0.6, side: DoubleSide })));
        duct.position.set(mx, p.propHeight - 0.002, mz);
        duct.castShadow = !ghost;
        this.root.add(duct);
        this.disposables.push(duct.geometry);
        const lip = new Mesh(new TorusGeometry(propR + 0.009, 0.0025, 6, 32), ghostMat ?? blackPlastic);
        lip.rotation.x = Math.PI / 2;
        lip.position.set(mx, p.propHeight + 0.012, mz);
        this.root.add(lip);
        this.disposables.push(lip.geometry);
      }
    }

    // -------------------------------------------------------------------- LEDs
    this.ledMat = track(new MeshBasicMaterial({ color: new Color(3, 0.2, 0.2), toneMapped: false }));
    for (const i of [2, 3]) {
      const led = add(new BoxGeometry(0.004, 0.003, 0.03 * s), ghostMat ?? this.ledMat, MOTOR_X[i] * a * 0.55, -0.003, MOTOR_Z[i] * a * 0.55, false);
      led.rotation.y = -Math.atan2(MOTOR_X[i], -MOTOR_Z[i]);
    }

    this.root.name = ghost ? 'ghost-drone' : 'drone';
  }

  /**
   * @param omega signed motor speeds (rad/s) from the physics
   * @param status 'disarmed' | 'armed' | 'turtle' — drives the LED colour
   */
  update(dt: number, omega: ArrayLike<number>, status: 'disarmed' | 'armed' | 'turtle', time: number): void {
    const p = this.preset;
    for (let i = 0; i < 4; i++) {
      const w = omega[i];
      const aw = Math.abs(w);
      // Real props turn far too fast to draw; show the stroboscopic truth instead:
      // discrete blades while slow, a translucent disc once spinning.
      const blur = clamp01((aw - 250) / 700);
      const visualSpeed = Math.min(aw, 90) * Math.sign(w);
      this.angles[i] -= MOTOR_SPIN[i] * visualSpeed * dt;
      this.blades[i].rotation.y = this.angles[i];
      this.blades[i].visible = blur < 0.98;
      if (this.bladeMats[i]) this.bladeMats[i].opacity = 0.92 * (1 - blur * 0.85);
      if (this.discMats[i]) {
        this.discMats[i].uniforms.uOpacity.value = blur;
        this.discMats[i].uniforms.uAngle.value = (time * (8 + (aw / p.omegaMax) * 6) * -MOTOR_SPIN[i]) % (Math.PI * 2);
      }
    }
    const blink = Math.sin(time * 10) > 0 ? 1 : 0.2;
    if (status === 'armed') this.ledMat.color.setRGB(0.2, 3, 1.4);
    else if (status === 'turtle') this.ledMat.color.setRGB(3 * blink, 1.6 * blink, 0.1);
    else this.ledMat.color.setRGB(3 * (0.35 + 0.65 * blink), 0.15, 0.12);
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
