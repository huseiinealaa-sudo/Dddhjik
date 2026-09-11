import {
  BufferAttribute,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { DRONE_SPEC, MAX_FRAME_TIME, PHYSICS_DT, WORLD } from '../core/Defaults';
import { clamp, RAD2DEG } from '../core/MathUtils';
import { getSettings, settingsStore, updateSettings } from '../core/SettingsStore';
import { terrainHeight } from '../core/Terrain';
import { telemetryStore } from '../core/TelemetryStore';
import type { CameraMode, FlightMode, SimSettings, Telemetry } from '../core/Types';
import { computeAttitude, FlightController, type Attitude } from '../flight/FlightController';
import { InputManager } from '../input/InputManager';
import { onCommand, resetTouchSticks, type SimCommand } from '../input/InputState';
import { CollisionWorld } from '../physics/Collision';
import { DronePhysics } from '../physics/DronePhysics';
import { CameraRig } from '../scene/CameraRig';
import { Course } from '../scene/Course';
import { DroneModel } from '../scene/DroneModel';
import { Environment } from '../scene/Environment';
import { PostFX } from '../scene/PostFX';

const CAMERA_ORDER: CameraMode[] = ['fpv', 'chase', 'orbit'];
const MODE_ORDER: FlightMode[] = ['angle', 'horizon', 'acro'];

const TELEMETRY_INTERVAL = 1 / 20;
const TRAIL_LENGTH = 900;
const RECOVERY_DELAY = 1.3;

export interface SimulatorEvents {
  onGate?: (index: number, correct: boolean) => void;
  onLap?: (time: number, best: boolean) => void;
  onCrash?: () => void;
}

/**
 * Owns the render loop and wires every subsystem together.
 *
 * Timing model: the renderer runs at whatever the display gives us, while the
 * physics and the flight controller always advance in fixed 2 ms steps. That
 * decoupling is what keeps the PID loop stable whether the tablet is drawing
 * at 120 fps or struggling at 30.
 */
export class Simulator {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly audio = new AudioEngine();

  private readonly collision = new CollisionWorld();
  private readonly physics = new DronePhysics(this.collision);
  private readonly controller: FlightController;
  private readonly input = new InputManager();
  private readonly droneModel = new DroneModel();
  private readonly cameraRig: CameraRig;
  private readonly environment: Environment;
  private readonly course: Course;
  private postFx: PostFX;

  private settings: SimSettings;
  private unsubscribeSettings: () => void;
  private unsubscribeCommands: () => void;

  private running = false;
  private frameHandle = 0;
  private lastTime = 0;
  private accumulator = 0;
  private elapsed = 0;
  private flightTime = 0;

  private armed = false;
  private recoveryTimer = 0;
  private wasArmedBeforeCrash = false;

  private telemetryTimer = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private fps = 0;

  private lapStart = 0;
  private lapRunning = false;
  private lastLapTime: number | null = null;
  private bestLapTime: number | null = null;
  private lapsCompleted = 0;

  private trail: Line | null = null;
  private trailPositions: Float32Array | null = null;
  private trailCount = 0;

  private pointerId: number | null = null;
  private pointerLast = { x: 0, y: 0 };

  private readonly homePosition = new Vector3();
  private readonly scratch = new Vector3();
  /** Reused attitude read-out — the controller must not be stepped just to read angles. */
  private readonly attitude: Attitude = { rollDeg: 0, pitchDeg: 0, headingDeg: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: SimulatorEvents = {},
  ) {
    this.settings = getSettings();

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: this.settings.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Khronos PBR Neutral keeps the daylight palette intact; ACES pulls all the
    // saturation out of a bright outdoor scene and makes the grass read grey.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(0x9fc0dc, 1);

    this.environment = new Environment(this.scene, this.collision, this.settings.quality);
    this.course = new Course(this.scene, this.collision);
    this.collision.build();

    this.scene.add(this.droneModel.object);
    this.cameraRig = new CameraRig(this.droneModel.cameraMount);
    this.cameraRig.setMode('fpv', this.course.spawnPosition);
    this.cameraRig.setTilt(this.settings.cameraTiltDeg);
    this.cameraRig.setHorizontalFov(this.settings.fovDeg);

    this.controller = new FlightController(this.settings.pid, this.settings.rates, PHYSICS_DT);

    this.physics.setSpawn(
      new Vector3(this.course.spawnPosition.x, DRONE_SPEC.radius + 0.32, this.course.spawnPosition.z),
      this.course.spawnHeading,
    );
    this.physics.reset();
    this.homePosition.copy(this.physics.state.position);
    this.course.primeAt(this.physics.state.position);

    this.postFx = new PostFX(this.renderer);
    this.postFx.enabled = this.settings.analogLook;

    this.input.attach();
    this.unsubscribeCommands = onCommand(this.handleCommand);
    this.unsubscribeSettings = settingsStore.subscribe(this.handleSettingsChange);

    this.attachPointerHandlers();
    this.handleResize();
    this.applyCameraMode(this.settings.cameraMode, true);
    this.setTrailEnabled(this.settings.showTrail);
  }

  // ------------------------------------------------------------- lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.frameHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  dispose(): void {
    this.stop();
    this.unsubscribeCommands();
    this.unsubscribeSettings();
    this.detachPointerHandlers();
    this.input.detach();
    this.audio.dispose();
    this.postFx.dispose();
    this.course.dispose();
    this.environment.dispose();
    this.droneModel.dispose();
    this.renderer.dispose();
  }

  handleResize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    const maxRatio = this.settings.quality === 'high' ? 2 : this.settings.quality === 'medium' ? 1.5 : 1;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, maxRatio);

    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.cameraRig.setAspect(width / Math.max(height, 1));
    this.postFx.setSize(width, height, pixelRatio);
  }

  // ---------------------------------------------------------------- input

  private readonly handleCommand = (command: SimCommand): void => {
    switch (command) {
      case 'toggleArm':
        this.toggleArm();
        break;
      case 'reset':
        this.resetToCheckpoint();
        break;
      case 'cycleCamera': {
        const next = CAMERA_ORDER[(CAMERA_ORDER.indexOf(this.settings.cameraMode) + 1) % CAMERA_ORDER.length];
        updateSettings({ cameraMode: next });
        break;
      }
      case 'cycleMode': {
        const next = MODE_ORDER[(MODE_ORDER.indexOf(this.settings.mode) + 1) % MODE_ORDER.length];
        updateSettings({ mode: next });
        this.audio.playBeep(next === 'acro' ? 780 : 520, 0.08);
        break;
      }
      case 'toggleHud':
        updateSettings({ hudEnabled: !this.settings.hudEnabled });
        break;
      case 'restartCourse':
        this.restartCourse();
        break;
      case 'toggleAudio':
        updateSettings({ audioEnabled: !this.settings.audioEnabled });
        break;
      case 'toggleMenu':
        // Handled by the React layer.
        break;
    }
  };

  private readonly handleSettingsChange = (): void => {
    const next = getSettings();
    const previous = this.settings;
    this.settings = next;

    this.controller.configure(next);
    this.cameraRig.setTilt(next.cameraTiltDeg);
    this.cameraRig.setHorizontalFov(next.fovDeg);
    this.postFx.enabled = next.analogLook;
    this.audio.setEnabled(next.audioEnabled);
    this.audio.setVolume(next.masterVolume);

    if (next.cameraMode !== previous.cameraMode) this.applyCameraMode(next.cameraMode, false);
    if (next.showTrail !== previous.showTrail) this.setTrailEnabled(next.showTrail);
    if (next.quality !== previous.quality) {
      this.renderer.shadowMap.enabled = next.quality !== 'low';
      this.handleResize();
    }
  };

  private applyCameraMode(mode: CameraMode, initial: boolean): void {
    this.cameraRig.setMode(mode, this.physics.state.position);
    // The airframe is invisible from inside the goggles.
    this.droneModel.object.visible = mode !== 'fpv';
    if (!initial) this.audio.playBeep(660, 0.05, 0.1);
  }

  private attachPointerHandlers(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private detachPointerHandlers(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.settings.cameraMode !== 'orbit') return;
    this.pointerId = event.pointerId;
    this.pointerLast.x = event.clientX;
    this.pointerLast.y = event.clientY;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.pointerId !== event.pointerId) return;
    this.cameraRig.orbitDrag(event.clientX - this.pointerLast.x, event.clientY - this.pointerLast.y);
    this.pointerLast.x = event.clientX;
    this.pointerLast.y = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.pointerId === event.pointerId) this.pointerId = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.settings.cameraMode !== 'orbit') return;
    event.preventDefault();
    this.cameraRig.orbitZoom(event.deltaY);
  };

  // ------------------------------------------------------------- gameplay

  toggleArm(): void {
    if (this.armed) {
      this.disarm();
      return;
    }
    if (this.armingBlocker()) {
      // Arming refused — same angry beep a real flight controller gives you.
      this.audio.playBeep(220, 0.14, 0.14);
      return;
    }
    this.armed = true;
    this.controller.reset();
    void this.audio.resume();
    this.audio.playBeep(880, 0.07);
    setTimeout(() => this.audio.playBeep(1180, 0.09), 90);
  }

  private disarm(): void {
    this.armed = false;
    this.controller.reset();
    this.audio.playBeep(520, 0.07);
    setTimeout(() => this.audio.playBeep(320, 0.1), 80);
  }

  /** Betaflight-style arming checks. */
  private armingBlocker(): string | null {
    if (this.physics.state.crashed) return 'CRASHED - PRESS RESET';
    if (this.settings.batteryEnabled && this.physics.battery.charge <= 0.01) return 'BATTERY EMPTY';
    if (this.input.control.throttle > 0.06) return 'THROTTLE HIGH';
    computeAttitude(this.physics.state.orientation, this.attitude);
    if (Math.abs(this.attitude.rollDeg) > 45 || Math.abs(this.attitude.pitchDeg) > 45) return 'NOT LEVEL';
    return null;
  }

  /** Put the aircraft back at the gate it was heading for. */
  resetToCheckpoint(): void {
    const gate = this.course.nextGate;
    if (gate && this.lapRunning) {
      this.scratch.copy(gate.forward).multiplyScalar(-5);
      // Yaw that points the nose (body -Z) along the gate's direction of travel.
      this.physics.setSpawn(
        new Vector3(gate.center.x + this.scratch.x, Math.max(gate.centerY, 1.6), gate.center.z + this.scratch.z),
        Math.atan2(-gate.forward.x, -gate.forward.z),
      );
    } else {
      this.physics.setSpawn(
        new Vector3(this.course.spawnPosition.x, DRONE_SPEC.radius + 0.32, this.course.spawnPosition.z),
        this.course.spawnHeading,
      );
    }

    const keepArmed = this.wasArmedBeforeCrash && this.settings.autoRecover;
    this.physics.reset();
    this.course.primeAt(this.physics.state.position);
    this.controller.reset();
    this.input.reset();
    resetTouchSticks();
    this.recoveryTimer = 0;
    this.armed = false;
    this.flightTime = 0;

    if (keepArmed) {
      this.armed = true;
      this.audio.playBeep(880, 0.06);
    }
    this.wasArmedBeforeCrash = false;
  }

  /** Full restart: back on the pad, lap timer cleared, fresh battery. */
  restartCourse(): void {
    this.physics.setSpawn(
      new Vector3(this.course.spawnPosition.x, DRONE_SPEC.radius + 0.32, this.course.spawnPosition.z),
      this.course.spawnHeading,
    );
    this.physics.hardReset();
    this.course.resetProgress();
    this.course.primeAt(this.physics.state.position);
    this.controller.reset();
    this.input.reset();
    resetTouchSticks();
    this.armed = false;
    this.lapRunning = false;
    this.lapStart = 0;
    this.lastLapTime = null;
    this.lapsCompleted = 0;
    this.flightTime = 0;
    this.trailCount = 0;
    this.audio.playBeep(600, 0.1);
  }

  // ------------------------------------------------------------- main loop

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.tick);

    const rawDelta = Math.min((now - this.lastTime) / 1000, MAX_FRAME_TIME);
    this.lastTime = now;
    if (rawDelta <= 0) return;

    // FPS is measured on wall-clock time, unaffected by the time scale.
    this.fpsAccumulator += rawDelta;
    this.fpsFrames += 1;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    const delta = rawDelta * clamp(this.settings.timeScale, 0.1, 1);
    this.elapsed += delta;

    this.input.update(delta, this.settings);
    this.stepPhysics(delta);
    this.updateVisuals(delta);
    this.publishTelemetry(delta);

    this.postFx.render(this.renderer, this.scene, this.cameraRig.camera, this.elapsed);
  };

  private stepPhysics(delta: number): void {
    this.accumulator += delta;
    let steps = 0;
    const maxSteps = Math.ceil(MAX_FRAME_TIME / PHYSICS_DT);

    while (this.accumulator >= PHYSICS_DT && steps < maxSteps) {
      this.accumulator -= PHYSICS_DT;
      steps += 1;

      const output = this.controller.update(
        this.input.control,
        this.physics.state.orientation,
        this.physics.state.angularVelocity,
        this.armed,
        this.settings,
      );

      this.physics.step(output.motors, PHYSICS_DT, {
        batteryEnabled: this.settings.batteryEnabled,
        windSpeed: this.settings.windSpeed,
      });

      if (this.armed) this.flightTime += PHYSICS_DT;

      this.handleContacts();
      this.handleGates();
    }

    if (this.settings.batteryEnabled && this.physics.battery.empty && this.armed) {
      this.disarm();
    }
  }

  private handleContacts(): void {
    const state = this.physics.state;

    if (state.contact && state.contactSpeed > 0.9) {
      this.audio.playImpact(clamp(state.contactSpeed / 10, 0.1, 1));
    }

    if (state.crashed && this.recoveryTimer === 0) {
      this.wasArmedBeforeCrash = this.armed;
      this.armed = false;
      this.controller.reset();
      this.recoveryTimer = 1e-6;
      this.events.onCrash?.();
      this.audio.playBeep(180, 0.35, 0.2);
    }

    if (this.recoveryTimer > 0) {
      this.recoveryTimer += PHYSICS_DT;
      if (this.settings.autoRecover && this.recoveryTimer > RECOVERY_DELAY) {
        this.resetToCheckpoint();
      }
    }
  }

  private handleGates(): void {
    const event = this.course.update(this.physics.state.position);
    if (!event) return;

    this.events.onGate?.(event.index, event.correct);
    if (!event.correct) {
      this.audio.playBeep(300, 0.08, 0.1);
      return;
    }

    this.audio.playBeep(1046, 0.06, 0.12);

    // Gate 0 is the start/finish line.
    if (event.index === 0) {
      if (this.lapRunning) {
        const lapTime = this.elapsed - this.lapStart;
        this.lastLapTime = lapTime;
        this.lapsCompleted += 1;
        const isBest = this.bestLapTime === null || lapTime < this.bestLapTime;
        if (isBest) this.bestLapTime = lapTime;
        this.events.onLap?.(lapTime, isBest);
        this.audio.playBeep(isBest ? 1568 : 1318, 0.16, 0.15);
      }
      this.lapRunning = true;
      this.lapStart = this.elapsed;
    }
  }

  private updateVisuals(delta: number): void {
    const state = this.physics.state;

    this.droneModel.object.position.copy(state.position);
    this.droneModel.object.quaternion.copy(state.orientation);
    this.droneModel.update(state.motorState, delta, this.armed, this.elapsed);

    this.cameraRig.update(state, this.droneModel.object, delta);
    this.course.animate(this.elapsed);

    // Keep the shadow frustum centred on the aircraft so shadows stay crisp.
    this.environment.sun.position.set(
      state.position.x + 120,
      state.position.y + 190,
      state.position.z + 150,
    );
    this.environment.sun.target.position.copy(state.position);
    this.environment.sun.target.updateMatrixWorld();

    // The FPV camera is a child of the airframe, so its `.position` is local —
    // the sky dome has to follow the world position or it drifts off centre.
    this.cameraRig.camera.getWorldPosition(this.scratch);
    this.environment.sky.mesh.position.copy(this.scratch);

    this.updateTrail(state.position);

    // Video link quality falls off with distance, which drives the static.
    const distance = state.position.distanceTo(this.homePosition);
    const linkQuality = clamp(100 - (distance / (WORLD.size * 0.55)) * 100, 0, 100);
    const degradation = 1 - linkQuality / 100;
    this.postFx.setParams({
      staticAmount: degradation ** 2.4 * 0.4,
      glitch: degradation > 0.7 ? (degradation - 0.7) * 2.0 : 0,
      distortion: this.settings.cameraMode === 'fpv' ? 0.15 : 0.03,
      vignette: this.settings.cameraMode === 'fpv' ? 0.5 : 0.22,
      scanline: this.settings.cameraMode === 'fpv' ? 0.35 : 0.08,
      aberration: this.settings.cameraMode === 'fpv' ? 1 : 0.35,
    });

    const proximity = this.settings.cameraMode === 'orbit' ? 0.45 : 1;
    this.audio.update(state.motorState, state.velocity.length(), proximity);
  }

  private setTrailEnabled(enabled: boolean): void {
    if (enabled && !this.trail) {
      const geometry = new BufferGeometry();
      this.trailPositions = new Float32Array(TRAIL_LENGTH * 3);
      geometry.setAttribute('position', new BufferAttribute(this.trailPositions, 3));
      geometry.setDrawRange(0, 0);
      const material = new LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.65 });
      this.trail = new Line(geometry, material);
      this.trail.frustumCulled = false;
      this.scene.add(this.trail);
      this.trailCount = 0;
    } else if (!enabled && this.trail) {
      this.scene.remove(this.trail);
      this.trail.geometry.dispose();
      (this.trail.material as LineBasicMaterial).dispose();
      this.trail = null;
      this.trailPositions = null;
      this.trailCount = 0;
    }
  }

  private updateTrail(position: Vector3): void {
    if (!this.trail || !this.trailPositions) return;
    const positions = this.trailPositions;

    if (this.trailCount >= TRAIL_LENGTH) {
      positions.copyWithin(0, 3);
      this.trailCount = TRAIL_LENGTH - 1;
    }
    const offset = this.trailCount * 3;
    positions[offset] = position.x;
    positions[offset + 1] = position.y;
    positions[offset + 2] = position.z;
    this.trailCount += 1;

    const attribute = this.trail.geometry.getAttribute('position') as BufferAttribute;
    attribute.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailCount);
  }

  // ------------------------------------------------------------ telemetry

  private publishTelemetry(delta: number): void {
    this.telemetryTimer += delta;
    if (this.telemetryTimer < TELEMETRY_INTERVAL) return;
    this.telemetryTimer = 0;

    const state = this.physics.state;
    const attitude = computeAttitude(state.orientation, this.attitude);

    const groundHeight = state.position.y - terrainHeight(state.position.x, state.position.z) - DRONE_SPEC.radius;
    const distance = state.position.distanceTo(this.homePosition);
    const linkQuality = clamp(100 - (distance / (WORLD.size * 0.55)) * 100, 0, 100);

    const telemetry: Telemetry = {
      armed: this.armed,
      mode: this.settings.mode,
      cameraMode: this.settings.cameraMode,
      speedKmh: state.velocity.length() * 3.6,
      verticalSpeed: state.velocity.y,
      altitude: Math.max(groundHeight, 0),
      distance,
      batteryPercent: this.physics.battery.charge * 100,
      voltage: this.physics.battery.voltage,
      amps: this.physics.battery.amps,
      mah: this.physics.battery.mah,
      throttle: this.input.control.throttle,
      rollDeg: attitude.rollDeg,
      pitchDeg: attitude.pitchDeg,
      headingDeg: attitude.headingDeg,
      rollRate: -state.angularVelocity.z * RAD2DEG,
      pitchRate: state.angularVelocity.x * RAD2DEG,
      yawRate: -state.angularVelocity.y * RAD2DEG,
      gForce: state.gForce,
      motors: [state.motorState[0], state.motorState[1], state.motorState[2], state.motorState[3]],
      fps: this.fps,
      flightTime: this.flightTime,
      crashed: state.crashed,
      crashCount: state.crashCount,
      blockedBy: this.armed ? null : this.armingBlocker(),
      lap: {
        nextGate: this.course.nextGateIndex,
        totalGates: this.course.totalGates,
        currentLapTime: this.lapRunning ? this.elapsed - this.lapStart : 0,
        lastLapTime: this.lastLapTime,
        bestLapTime: this.bestLapTime,
        lapsCompleted: this.lapsCompleted,
        running: this.lapRunning,
      },
      linkQuality,
      ...this.computeGateGuidance(),
    };

    telemetryStore.set(telemetry);
  }

  /**
   * Bearing / elevation / range to the next gate, expressed in the aircraft's
   * own frame so the HUD can draw a "fly this way" chevron.
   */
  private computeGateGuidance(): { gateBearing: number; gateElevation: number; gateDistance: number } {
    const gate = this.course.nextGate;
    if (!gate) return { gateBearing: 0, gateElevation: 0, gateDistance: 0 };

    const state = this.physics.state;
    this.scratch.subVectors(gate.center, state.position);
    const distance = this.scratch.length();
    if (distance < 1e-3) return { gateBearing: 0, gateElevation: 0, gateDistance: 0 };

    // Heading of the aircraft, ignoring roll and pitch — a bearing indicator
    // that tumbles with the airframe would be unreadable.
    const heading = this.attitude.headingDeg * (Math.PI / 180);
    const forwardX = Math.sin(heading);
    const forwardZ = -Math.cos(heading);

    const horizontal = Math.hypot(this.scratch.x, this.scratch.z) || 1e-6;
    const dirX = this.scratch.x / horizontal;
    const dirZ = this.scratch.z / horizontal;

    const cos = dirX * forwardX + dirZ * forwardZ;
    // Right of the nose is `forward` turned 90 degrees clockwise seen from
    // above, i.e. (-fz, fx); this is that dot product.
    const cross = forwardX * dirZ - forwardZ * dirX;

    return {
      gateBearing: Math.atan2(cross, cos) * RAD2DEG,
      gateElevation: Math.atan2(this.scratch.y, horizontal) * RAD2DEG,
      gateDistance: distance,
    };
  }

  get gamepadConnected(): boolean {
    return this.input.gamepad.connected;
  }
}
