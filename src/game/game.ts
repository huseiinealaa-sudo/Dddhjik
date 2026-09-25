import { Quaternion, Scene, Vector3 } from 'three';
import { CameraRig, type CameraMode } from '../engine/cameraRig';
import { DroneMesh } from '../engine/drone/droneMesh';
import { RenderPipeline } from '../engine/renderPipeline';
import { GameWorld } from '../engine/world';
import type { GateState } from '../engine/world/gates';
import { onCommand, type Command } from '../input/bus';
import { InputManager } from '../input/inputManager';
import { FlightController } from '../sim/fc/flightController';
import { clamp, DEG, smoothstep } from '../sim/math';
import { PRESETS } from '../sim/presets';
import { QuadBody } from '../sim/quad';
import { trackById, type TrackDef } from '../sim/tracks';
import type { FlightMode, Sticks } from '../sim/types';
import { Wind } from '../sim/wind';
import { PAD, PILOT, terrainHeight, YARD } from '../sim/world';
import { YARD_ENTRANCE } from '../sim/yardLayout';
import { AudioEngine } from './audio';
import { DrillSession, type DrillId } from './drills';
import { sampleGhost } from './ghost';
import { RaceSession, type RaceEvent } from './race';
import { getRecord, saveRecord } from './records';
import { fcSettings, type Settings } from './settings';
import { Store } from './store';

export const PHYSICS_DT = 1 / 1000;
const MAX_STEPS_PER_FRAME = 60;

export type Screen = 'loading' | 'menu' | 'flight' | 'results';

export type SessionSpec =
  | { kind: 'free'; area: 'field' | 'yard' }
  | { kind: 'race'; track: TrackDef['id'] }
  | { kind: 'drill'; drill: DrillId };

export type ToastTone = 'info' | 'good' | 'warn' | 'bad';

export interface Toast {
  id: number;
  key: string;
  params?: Record<string, string | number>;
  tone: ToastTone;
}

export interface RaceResult {
  kind: 'race';
  track: TrackDef['id'];
  total: number;
  laps: number[];
  bestLap: number;
  newRecord: boolean;
  recordLap: number | null;
}

export interface DrillResult {
  kind: 'drill';
  drill: DrillId;
  time: number;
  score: number;
}

export interface UiState {
  screen: Screen;
  paused: boolean;
  session: SessionSpec;
  armed: boolean;
  crashed: boolean;
  turtle: boolean;
  mode: FlightMode;
  camera: CameraMode;
  hud: boolean;
  muted: boolean;
  toasts: Toast[];
  result: RaceResult | DrillResult | null;
  /** Physically upside down and resting: suggest turtle mode. */
  canTurtle: boolean;
  inputSource: 'touch' | 'keyboard' | 'gamepad';
  gamepad: string | null;
}

/** Numbers for the OSD, published ~15 times a second. */
export interface Telemetry {
  speed: number;
  climb: number;
  altitude: number;
  voltage: number;
  cellVoltage: number;
  cells: number;
  batteryPercent: number;
  mah: number;
  current: number;
  throttle: number;
  flightTime: number;
  roll: number;
  pitch: number;
  heading: number;
  gForce: number;
  signal: number;
  distanceHome: number;
  fps: number;
  lowBattery: 0 | 1 | 2;
  race: {
    phase: RaceSession['phase'];
    countdown: number;
    time: number;
    lapTime: number;
    lap: number;
    laps: number;
    gate: number;
    gates: number;
    bestLap: number | null;
    lastLap: number | null;
    delta: number | null;
  } | null;
  drill: { id: DrillId; progress: number; hold: number; index: number; count: number; time: number } | null;
}

/** High-rate values for the canvas OSD (artificial horizon) — read every animation frame. */
export const live = { roll: 0, pitch: 0, heading: 0, armed: false, fov: 90, tilt: 0, cameraMode: 'fpv' as CameraMode };

const initialTelemetry = (): Telemetry => ({
  speed: 0,
  climb: 0,
  altitude: 0,
  voltage: 0,
  cellVoltage: 0,
  cells: 6,
  batteryPercent: 100,
  mah: 0,
  current: 0,
  throttle: 0,
  flightTime: 0,
  roll: 0,
  pitch: 0,
  heading: 0,
  gForce: 1,
  signal: 1,
  distanceHome: 0,
  fps: 60,
  lowBattery: 0,
  race: null,
  drill: null,
});

/**
 * The game: owns the renderer, world, aircraft and session, and runs the
 * fixed-step simulation (1 kHz physics + flight controller) under a
 * variable-rate render loop.
 */
export class Game {
  readonly ui: Store<UiState>;
  readonly telemetry = new Store<Telemetry>(initialTelemetry());
  readonly audio = new AudioEngine();
  readonly input = new InputManager();
  private readonly pipeline: RenderPipeline;
  private readonly scene = new Scene();
  private readonly world: GameWorld;
  private readonly rig: CameraRig;
  private readonly wind = new Wind();
  private quad!: QuadBody;
  private fc!: FlightController;
  private drone!: DroneMesh;
  private ghostMesh: DroneMesh | null = null;
  private settings: Settings;

  private race: RaceSession | null = null;
  private drill: DrillSession | null = null;
  private readonly gateStates: GateState[] = [];
  private readonly spawnPos = new Vector3();
  private spawnHeading = 0;
  private readonly home = new Vector3();

  private armed = false;
  private crashed = false;
  private turtle = false;
  private respawnTimer = 0;
  private flightTime = 0;
  private accumulator = 0;
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private flash = 0;
  private lowBatteryBeep = 0;
  private telemetryTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private lastArmSwitch: boolean | null = null;
  private lastTurtleSwitch: boolean | null = null;
  private lastModeSwitch: FlightMode | null = null;
  private lastDelta: number | null = null;
  private toastId = 0;
  private readonly unsub: Array<() => void> = [];

  private readonly prevPos = new Vector3();
  private readonly stepSticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private readonly ghostPos = new Vector3();
  private readonly ghostQ = new Quaternion();
  private readonly tmp = new Vector3();
  private readonly env: { world: GameWorld['collision']; wind: Wind; batteryDrain: boolean };

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.settings = settings;
    // Handy for debugging from the console and for automated browser tests.
    (window as unknown as { __fpv?: Game }).__fpv = this;
    this.pipeline = new RenderPipeline(canvas);
    this.pipeline.configure(settings.quality);
    this.world = new GameWorld(this.pipeline.renderer, this.scene, settings.quality);
    this.env = { world: this.world.collision, wind: this.wind, batteryDrain: true };
    this.rig = new CameraRig({ fpvFov: settings.fpvFov, tilt: settings.cameraTilt, shake: settings.cameraShake });
    this.ui = new Store<UiState>({
      screen: 'menu',
      paused: false,
      session: { kind: 'free', area: 'field' },
      armed: false,
      crashed: false,
      turtle: false,
      mode: settings.flightMode,
      camera: 'fpv',
      hud: true,
      muted: false,
      toasts: [],
      result: null,
      canTurtle: false,
      inputSource: 'touch',
      gamepad: null,
    });
    this.buildAircraft();
    this.applySettings(settings);
    this.setSpawn({ kind: 'free', area: 'field' });
    this.respawn();
    this.input.attach();
    this.unsub.push(onCommand((c) => this.command(c)));
    const vis = (): void => {
      if (document.hidden && this.ui.get().screen === 'flight') this.setPaused(true);
      this.audio.suspend(document.hidden);
    };
    document.addEventListener('visibilitychange', vis);
    this.unsub.push(() => document.removeEventListener('visibilitychange', vis));
  }

  /** Compile every shader up front so the first seconds of flight don't stutter. */
  async warmup(): Promise<void> {
    this.rig.orbit(0, this.quad.position, this.pipeline.aspect);
    try {
      await this.pipeline.renderer.compileAsync(this.scene, this.rig.camera);
    } catch {
      /* optional: older browsers compile on first draw */
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min((now - this.last) / 1000, 0.1);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    for (const u of this.unsub) u();
    this.drone.dispose();
    this.ghostMesh?.dispose();
    this.pipeline.dispose();
  }

  // ------------------------------------------------------------------ setup

  private buildAircraft(): void {
    const preset = PRESETS[this.settings.quad];
    this.quad = new QuadBody(preset);
    this.fc = new FlightController(preset, fcSettings(this.settings), PHYSICS_DT);
    this.drone?.dispose();
    this.drone = new DroneMesh(preset, { carbon: this.world.textures.carbon });
    this.scene.add(this.drone.root);
    this.ghostMesh?.dispose();
    this.ghostMesh = new DroneMesh(preset, { carbon: this.world.textures.carbon, ghost: true });
    this.ghostMesh.root.visible = false;
    this.scene.add(this.ghostMesh.root);
  }

  applySettings(next: Settings): void {
    const prev = this.settings;
    this.settings = next;
    if (next.quad !== prev.quad || !this.quad) {
      this.buildAircraft();
      this.respawn();
    }
    this.fc.configure(fcSettings(next));
    this.rig.settings = { fpvFov: next.fpvFov, tilt: next.cameraTilt, shake: next.cameraShake };
    this.wind.configure(next.windSpeed, next.windFrom, next.turbulence);
    this.quad.propwashGain = next.propwash;
    this.env.batteryDrain = next.batterySag;
    this.audio.configure(next.masterVolume, next.motorVolume, next.beeps);
    if (next.quality !== prev.quality) {
      this.pipeline.configure(next.quality);
      this.world.environment.configureShadows(next.quality);
    }
    if (this.ui.get().mode !== next.flightMode) this.ui.update({ mode: next.flightMode });
  }

  // ---------------------------------------------------------------- sessions

  private setSpawn(spec: SessionSpec): void {
    let x: number = PAD.x;
    let z: number = PAD.z;
    let heading = 0;
    // Stand in front of the safety net, not under the tent.
    const losZ = PILOT.z - 4.6;
    this.rig.losAnchor.set(PILOT.x, terrainHeight(PILOT.x, losZ) + PILOT.eye, losZ);
    if (spec.kind === 'race') {
      const t = trackById(spec.track);
      x = t.spawn.x;
      z = t.spawn.z;
      heading = t.spawn.heading;
      if (t.id === 'bando') this.rig.losAnchor.set(x - 6, terrainHeight(x - 6, z + 4) + PILOT.eye, z + 4);
    } else if (spec.kind === 'free' && spec.area === 'yard') {
      x = YARD_ENTRANCE.x + 6;
      z = YARD_ENTRANCE.z;
      heading = 90;
      this.rig.losAnchor.set(x - 4, YARD.height + PILOT.eye, z + 6);
    }
    this.spawnPos.set(x, terrainHeight(x, z), z);
    this.spawnHeading = heading;
    this.home.copy(this.spawnPos);
  }

  startSession(spec: SessionSpec): void {
    this.audio.unlock();
    this.setSpawn(spec);
    this.race = null;
    this.drill = null;
    if (spec.kind === 'race') {
      this.world.setTrack(spec.track);
      const t = trackById(spec.track);
      this.race = new RaceSession(t, this.world.triggers, getRecord(t.id, this.settings.quad));
    } else if (spec.kind === 'drill') {
      this.world.setTrack(null);
      this.drill = new DrillSession(spec.drill);
    } else {
      this.world.setTrack(spec.area === 'yard' ? 'bando' : 'meadow');
    }
    this.lastDelta = null;
    this.respawn();
    this.rig.snap();
    this.ui.update({ screen: 'flight', paused: false, session: spec, result: null });
    this.toast(
      spec.kind === 'race' ? 'toast.armToStart' : spec.kind === 'drill' ? `drill.${spec.drill}.hint` : 'toast.armToFly',
      'info',
    );
  }

  restartSession(): void {
    this.startSession(this.ui.get().session);
  }

  toMenu(): void {
    this.disarm(false);
    this.race = null;
    this.drill = null;
    this.world.setTrack('meadow');
    this.setSpawn({ kind: 'free', area: 'field' });
    this.respawn();
    this.audio.quiet();
    this.ui.update({ screen: 'menu', paused: false, result: null });
  }

  setPaused(paused: boolean): void {
    if (this.ui.get().screen !== 'flight') return;
    this.ui.update({ paused });
    if (paused) this.audio.quiet();
  }

  private respawn(): void {
    let minY = Infinity;
    for (const s of this.quad.contactSpheres) minY = Math.min(minY, s.y - s.r);
    const onPad = Math.hypot(this.spawnPos.x - PAD.x, this.spawnPos.z - PAD.z) < 1.5;
    const pos = this.tmp.copy(this.spawnPos);
    pos.y += -minY + (onPad ? 0.045 : 0.01);
    this.quad.reset(pos, -this.spawnHeading * DEG);
    this.fc.reset();
    this.armed = false;
    this.crashed = false;
    this.turtle = false;
    this.respawnTimer = 0;
    this.flightTime = 0;
    this.accumulator = 0;
    this.prevPos.copy(this.quad.position);
    this.race?.reset();
    this.drill?.reset();
    this.input.zeroTouchThrottle(this.settings.stickMode);
    this.rig.snap();
    this.ui.update({ armed: false, crashed: false, turtle: false, canTurtle: false });
  }

  // ---------------------------------------------------------------- commands

  command(c: Command): void {
    const ui = this.ui.get();
    if (c === 'pause') {
      if (ui.screen === 'flight') this.setPaused(!ui.paused);
      return;
    }
    if (c === 'audio') {
      this.audio.unlock();
      this.audio.setMuted(!ui.muted);
      this.ui.update({ muted: !ui.muted });
      return;
    }
    if (c === 'hud') {
      this.ui.update({ hud: !ui.hud });
      return;
    }
    if (c === 'camera') {
      const mode = this.rig.cycle();
      this.ui.update({ camera: mode });
      this.toast(`camera.${mode}`, 'info');
      return;
    }
    if (ui.screen !== 'flight' || ui.paused) return;
    this.audio.unlock();
    switch (c) {
      case 'arm':
        if (this.armed) this.disarm(true);
        else this.tryArm();
        break;
      case 'reset':
        this.respawn();
        break;
      case 'restart':
        this.restartSession();
        break;
      case 'mode':
        this.cycleMode();
        break;
      case 'turtle':
        this.toggleTurtle();
        break;
    }
  }

  private cycleMode(): void {
    const order: FlightMode[] = ['angle', 'horizon', 'acro'];
    this.setMode(order[(order.indexOf(this.settings.flightMode) + 1) % order.length]);
  }

  setMode(mode: FlightMode): void {
    if (mode === this.settings.flightMode) return;
    this.settings = { ...this.settings, flightMode: mode };
    this.fc.configure(fcSettings(this.settings));
    this.ui.update({ mode });
    this.toast(`mode.${mode}`, 'info');
  }

  /** The settings object the game currently runs with (mode may change in flight). */
  get currentSettings(): Settings {
    return this.settings;
  }

  private tryArm(): void {
    if (this.crashed) {
      this.toast('toast.crashedReset', 'warn');
      this.audio.beep('error');
      return;
    }
    if (this.input.sticks.throttle > 0.06) {
      this.toast('toast.throttleHigh', 'warn');
      this.audio.beep('error');
      return;
    }
    if (this.quad.upright < 0.2 && this.quad.inContact) {
      this.toast('toast.upsideDown', 'warn');
      this.audio.beep('error');
      this.ui.update({ canTurtle: true });
      return;
    }
    this.armed = true;
    this.turtle = false;
    this.audio.beep('arm');
    this.ui.update({ armed: true, turtle: false, canTurtle: false });
    if (this.race && this.race.phase === 'ready') this.handleRaceEvents(this.race.begin());
  }

  private disarm(beep: boolean): void {
    if (!this.armed) return;
    this.armed = false;
    this.turtle = false;
    if (beep) this.audio.beep('disarm');
    this.ui.update({ armed: false, turtle: false });
  }

  private toggleTurtle(): void {
    if (this.turtle) {
      this.disarm(true);
      return;
    }
    if (this.crashed) this.crashed = false;
    if (this.quad.upright > 0.3) {
      this.toast('toast.notUpsideDown', 'info');
      return;
    }
    this.turtle = true;
    this.armed = true;
    this.audio.beep('arm');
    this.ui.update({ armed: true, turtle: true, crashed: false, canTurtle: false });
    this.toast('toast.turtle', 'info');
  }

  private crash(speed: number): void {
    this.crashed = true;
    this.flash = 1;
    this.disarm(false);
    this.audio.impact(speed * 1.4);
    this.audio.quiet();
    this.rig.bump(speed);
    this.respawnTimer = this.settings.autoRespawn ? 1.6 : 0;
    this.ui.update({ crashed: true });
    this.toast(this.quad.inWater ? 'toast.water' : 'toast.crash', 'bad', { speed: Math.round(speed * 3.6) });
    if (navigator.vibrate && this.settings.haptics) navigator.vibrate(60);
  }

  toast(key: string, tone: ToastTone, params?: Record<string, string | number>): void {
    const id = ++this.toastId;
    const toasts = [...this.ui.get().toasts.filter((t) => t.key !== key), { id, key, tone, params }].slice(-3);
    this.ui.update({ toasts });
    window.setTimeout(() => {
      this.ui.update({ toasts: this.ui.get().toasts.filter((t) => t.id !== id) });
    }, tone === 'bad' ? 2600 : 2200);
  }

  // -------------------------------------------------------------- the loop

  private handleSwitches(): void {
    const sw = this.input.switches;
    if (sw.arm !== null && sw.arm !== this.lastArmSwitch) {
      if (this.lastArmSwitch !== null || sw.arm) {
        if (sw.arm && !this.armed) this.tryArm();
        else if (!sw.arm && this.armed) this.disarm(true);
      }
      this.lastArmSwitch = sw.arm;
    }
    if (sw.mode !== null && sw.mode !== this.lastModeSwitch) {
      this.lastModeSwitch = sw.mode;
      this.setMode(sw.mode);
    }
    if (sw.turtle !== null && sw.turtle !== this.lastTurtleSwitch) {
      if (this.lastTurtleSwitch !== null && sw.turtle !== this.turtle) this.toggleTurtle();
      this.lastTurtleSwitch = sw.turtle;
    }
  }

  private handleRaceEvents(events: RaceEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'tick':
          this.audio.beep('tick');
          break;
        case 'go':
          this.audio.beep('go');
          this.toast('race.go', 'good');
          break;
        case 'gate':
          this.audio.beep('gate');
          this.lastDelta = e.delta;
          break;
        case 'lap':
          this.audio.beep(e.best ? 'best' : 'lap');
          this.lastDelta = e.delta;
          this.toast(e.best ? 'race.bestLap' : 'race.lap', e.best ? 'good' : 'info', { lap: e.lap, time: e.time.toFixed(2) });
          break;
        case 'finish': {
          this.audio.beep('finish');
          const race = this.race!;
          const prevRecord = getRecord(race.track.id, this.settings.quad);
          this.ui.update({
            result: {
              kind: 'race',
              track: race.track.id,
              total: e.total,
              laps: race.lapTimes.slice(),
              bestLap: e.bestLap,
              newRecord: e.newRecord,
              recordLap: prevRecord?.bestLap ?? null,
            },
          });
          window.setTimeout(() => {
            if (this.race === race && race.phase === 'finished') {
              this.disarm(false);
              this.ui.update({ screen: 'results' });
            }
          }, 1800);
          break;
        }
      }
    }
    if (this.race?.takeDirty()) saveRecord(this.race.track.id, this.settings.quad, this.race.toRecord());
  }

  private frame(dt: number): void {
    this.time += dt;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const ui = this.ui.get();
    const flying = ui.screen === 'flight' && !ui.paused;

    const sticks = this.input.update(dt, this.settings);
    if (this.input.throttleSource !== ui.inputSource || (this.input.gamepad.snapshot.connected ? this.input.gamepad.snapshot.id : null) !== ui.gamepad) {
      this.ui.update({
        inputSource: this.input.throttleSource,
        gamepad: this.input.gamepad.snapshot.connected ? this.input.gamepad.snapshot.id : null,
      });
    }
    if (flying) this.handleSwitches();

    if (ui.screen !== 'loading' && !ui.paused) this.simulate(dt, sticks, flying);

    // ---- presentation
    const aspect = this.pipeline.aspect;
    if (ui.screen === 'menu' || ui.screen === 'results') {
      this.rig.orbit(dt, this.quad.position, aspect, ui.screen === 'menu' ? 1.6 : 2.4, 0.45);
    } else {
      this.rig.update(ui.paused ? 0 : dt, this.quad, this.drone.cameraOffset, aspect);
    }
    this.drone.root.position.copy(this.quad.position);
    this.drone.root.quaternion.copy(this.quad.orientation);
    this.drone.update(ui.paused ? 0 : dt, this.quad.omega, this.turtle ? 'turtle' : this.armed ? 'armed' : 'disarmed', this.time);
    // Hide our own airframe from the FPV camera (it sits inside it).
    this.drone.root.visible = !(ui.screen === 'flight' && this.rig.mode === 'fpv');
    this.updateGhost();

    if (this.race) this.world.setGateStates(this.race.gateStates(this.gateStates), this.time);
    else if (!this.drill) {
      this.gateStates.length = this.world.triggers.length;
      this.gateStates.fill('upcoming');
      this.world.setGateStates(this.gateStates, this.time);
    }
    this.world.markers.show(this.drill?.target ?? null, this.drill?.hold01 ?? 0, this.time);
    this.world.update(dt, this.time, this.quad.position, this.rig.camera.position, this.wind);

    this.flash = Math.max(0, this.flash - dt * 2.2);
    const fpv = this.rig.mode === 'fpv' && ui.screen === 'flight';
    const signal = this.signalQuality();
    this.pipeline.render(this.scene, this.rig.camera, dt, {
      look: fpv ? this.settings.videoLook : 'clean',
      distortion: fpv && this.settings.lensDistortion ? clamp((this.settings.fpvFov - 90) / 120, 0, 0.45) : 0,
      signal: fpv ? signal : 1,
      flash: fpv ? this.flash : 0,
    });

    live.roll = this.fc.attitude.roll;
    live.pitch = this.fc.attitude.pitch;
    live.heading = this.fc.attitude.heading;
    live.armed = this.armed;
    live.fov = this.rig.camera.fov;
    live.tilt = this.settings.cameraTilt ?? this.quad.preset.cameraTilt;
    live.cameraMode = this.rig.mode;

    this.telemetryTimer -= dt;
    if (this.telemetryTimer <= 0) {
      this.telemetryTimer = 1 / 15;
      this.publishTelemetry(signal);
    }

    // Audio: onboard in FPV, from the pilot's position otherwise.
    if (ui.screen === 'flight' && !ui.paused) {
      const dist = this.rig.mode === 'fpv' ? 0 : this.rig.camera.position.distanceTo(this.quad.position);
      this.audio.updateFlight(this.quad.omega, this.quad.preset.omegaMax, this.quad.preset.propBlades, this.quad.airspeed, dist, this.quad.propwash);
    }
  }

  private simulate(dt: number, sticks: Sticks, flying: boolean): void {
    this.wind.advance(dt);
    this.accumulator += dt;
    let steps = Math.floor(this.accumulator / PHYSICS_DT);
    if (steps > MAX_STEPS_PER_FRAME * 2) {
      // Too far behind (tab switch, debugger): drop time rather than spiral.
      steps = MAX_STEPS_PER_FRAME * 2;
      this.accumulator = steps * PHYSICS_DT;
    }
    this.accumulator -= steps * PHYSICS_DT;

    const race = this.race;
    const hold = race?.holding ?? false;
    const s = this.stepSticks;
    s.roll = sticks.roll;
    s.pitch = sticks.pitch;
    s.yaw = sticks.yaw;
    s.throttle = sticks.throttle;
    if (hold) s.roll = s.pitch = s.yaw = s.throttle = 0;

    const armed = this.armed && flying;
    let maxImpact = 0;
    for (let i = 0; i < steps; i++) {
      const cmd = this.fc.update(s, this.quad.orientation, this.quad.angularVelocity, armed, this.turtle);
      this.prevPos.copy(this.quad.position);
      this.quad.step(cmd, PHYSICS_DT, this.env);
      if (hold) {
        // Pinned on the start line during the countdown.
        this.quad.velocity.set(0, Math.min(0, this.quad.velocity.y), 0);
      }
      if (race && flying) {
        race.update(PHYSICS_DT).forEach((e) => this.handleRaceEvents([e]));
        const ev = race.move(this.prevPos, this.quad.position, PHYSICS_DT);
        if (ev.length) this.handleRaceEvents(ev);
      }
      if (this.quad.impactSpeed > maxImpact) maxImpact = this.quad.impactSpeed;
      if (!this.crashed && flying && this.isCrash()) {
        this.crash(this.quad.impactSpeed);
      }
    }
    if (race && flying) race.record(dt, this.quad.position, this.quad.orientation);

    if (!flying) return;
    if (maxImpact > 2.2 && !this.crashed) {
      this.audio.impact(maxImpact);
      this.rig.bump(maxImpact * 0.5);
    }
    if (this.armed) this.flightTime += dt;

    // Turtle: done once the right way up; Betaflight disarms after the flip.
    if (this.turtle && this.quad.upright > 0.75) {
      this.disarm(false);
      this.toast('toast.flipped', 'good');
    }
    const canTurtle = !this.armed && this.quad.inContact && this.quad.upright < -0.2 && this.quad.velocity.lengthSq() < 0.05;
    if (canTurtle !== this.ui.get().canTurtle) this.ui.update({ canTurtle });

    if (this.crashed && this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
    }

    if (this.drill) {
      const events = this.drill.update(dt, this.quad.position, this.quad.velocity, this.armed, this.quad.inContact);
      for (const e of events) {
        if (e.type === 'target') {
          this.audio.beep('target');
          this.toast('drill.next', 'good', { n: e.index + 1, total: this.drill.targets.length });
        } else if (e.type === 'complete') {
          this.audio.beep('finish');
          const drill = this.drill;
          this.ui.update({ result: { kind: 'drill', drill: drill.id, time: e.time, score: e.score } });
          window.setTimeout(() => {
            if (this.drill === drill) {
              this.disarm(false);
              this.ui.update({ screen: 'results' });
            }
          }, 1500);
        }
      }
    }

    // Low battery warning (under load, like a real OSD).
    const cell = this.quad.battery.cellVoltage;
    this.lowBatteryBeep -= dt;
    if (this.armed && cell < 3.3 && this.lowBatteryBeep <= 0) {
      this.audio.beep('lowBattery');
      this.lowBatteryBeep = cell < 3.1 ? 1.2 : 4;
    }
  }

  private isCrash(): boolean {
    const q = this.quad;
    if (q.inWater) return true;
    if (!this.settings.crashDetection) return false;
    const limit = q.preset.crashSpeed;
    if (q.impactSpeed > limit) return true;
    // A prop strike at speed shatters blades even when the frame survives.
    return q.propStrike && q.impactSpeed > limit * 0.65 && this.armed;
  }

  private updateGhost(): void {
    const g = this.ghostMesh;
    if (!g) return;
    const race = this.race;
    const show =
      this.settings.ghost && race !== null && race.phase === 'running' && race.ghost !== null && this.ui.get().screen === 'flight';
    if (show && race.ghost && sampleGhost(race.ghost, race.lapTime, this.ghostPos, this.ghostQ)) {
      g.root.visible = true;
      g.root.position.copy(this.ghostPos);
      g.root.quaternion.copy(this.ghostQ);
      const w = this.quad.preset.omegaMax * 0.5;
      g.update(1 / 60, [w, -w, -w, w], 'armed', this.time);
    } else {
      g.root.visible = false;
    }
  }

  /**
   * Video link quality: range from the pilot plus obstruction by terrain and
   * the concrete of the bando. Drives the analog/digital breakup.
   */
  private signalQuality(): number {
    const p = this.quad.position;
    const a = this.rig.losAnchor;
    const dist = p.distanceTo(a);
    let s = 1 - smoothstep(420, 760, dist);
    // Terrain between pilot and aircraft.
    let blocked = 0;
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const x = a.x + (p.x - a.x) * t;
      const y = a.y + 1 + (p.y - a.y - 1) * t;
      const z = a.z + (p.z - a.z) * t;
      if (terrainHeight(x, z) > y) blocked++;
    }
    s -= blocked * 0.09;
    // Inside the yard buildings at low level.
    if (Math.abs(p.x - YARD.x) < YARD.halfX && Math.abs(p.z - YARD.z) < YARD.halfZ && p.y - YARD.height < 10) {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      s -= smoothstep(30, 90, d) * 0.3;
    }
    return clamp(s, 0, 1);
  }

  private publishTelemetry(signal: number): void {
    const q = this.quad;
    const b = q.battery;
    const race = this.race;
    const drill = this.drill;
    const cell = b.cellVoltage;
    const t: Telemetry = {
      speed: q.velocity.length(),
      climb: q.velocity.y,
      altitude: q.position.y - this.home.y,
      voltage: b.voltage,
      cellVoltage: cell,
      cells: q.preset.battery.cells,
      batteryPercent: b.percent,
      mah: b.mahUsed,
      current: b.current,
      throttle: this.fc.throttleOut,
      flightTime: this.flightTime,
      roll: this.fc.attitude.roll,
      pitch: this.fc.attitude.pitch,
      heading: this.fc.attitude.heading,
      gForce: q.gForce,
      signal,
      distanceHome: Math.hypot(q.position.x - this.home.x, q.position.z - this.home.z),
      fps: this.fps,
      lowBattery: cell < 3.3 ? 2 : cell < 3.5 ? 1 : 0,
      race: race
        ? {
            phase: race.phase,
            countdown: race.countdown,
            time: race.time,
            lapTime: race.lapTime,
            lap: Math.min(race.lap + 1, race.laps),
            laps: race.laps,
            gate: race.nextGate,
            gates: race.triggers.length,
            bestLap: race.bestLap,
            lastLap: race.lapTimes.length ? race.lapTimes[race.lapTimes.length - 1] : null,
            delta: this.lastDelta,
          }
        : null,
      drill: drill
        ? { id: drill.id, progress: drill.progress, hold: drill.hold01, index: drill.index, count: drill.targets.length, time: drill.time }
        : null,
    };
    this.telemetry.set(t);
  }
}
