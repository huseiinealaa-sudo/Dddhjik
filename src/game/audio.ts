import { clamp, clamp01 } from '../sim/math';

type Beep = 'arm' | 'disarm' | 'tick' | 'go' | 'gate' | 'lap' | 'best' | 'finish' | 'error' | 'lowBattery' | 'target' | 'click';

interface MotorVoice {
  osc: OscillatorNode;
  harm: OscillatorNode;
  gain: GainNode;
  harmGain: GainNode;
}

/**
 * Procedural sound: four motor voices whose pitch follows each rotor's speed
 * (rotation + blade-pass harmonics), broadband prop/air noise, wind rush from
 * airspeed, impact thumps and the flight controller's beeper tunes.
 * Everything is synthesised — no audio files to download.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorBus: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private voices: MotorVoice[] = [];
  private noiseGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.7;
  private motorVolume = 0.8;
  private beepsOn = true;
  muted = false;

  /** Must be called from a user gesture (Safari). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) this.build();
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  configure(volume: number, motorVolume: number, beeps: boolean): void {
    this.volume = volume;
    this.motorVolume = motorVolume;
    this.beepsOn = beeps;
    this.applyMaster();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyMaster();
  }

  /** Pause output (menus, background tab) without tearing down the graph. */
  suspend(on: boolean): void {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  private applyMaster(): void {
    if (!this.ctx || !this.master) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    this.motorBus?.gain.setTargetAtTime(this.motorVolume, this.ctx.currentTime, 0.05);
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return;
    }
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.motorBus = ctx.createGain();
    this.motorBus.connect(this.master);
    this.fxBus = ctx.createGain();
    this.fxBus.gain.value = 0.9;
    this.fxBus.connect(this.master);

    // Motors: rotation fundamental (sawtooth, buzzy like a real BLDC) + blade-pass harmonic.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    tone.Q.value = 0.4;
    tone.connect(this.motorBus);
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const harm = ctx.createOscillator();
      harm.type = 'triangle';
      const gain = ctx.createGain();
      const harmGain = ctx.createGain();
      gain.gain.value = 0;
      harmGain.gain.value = 0;
      osc.connect(gain).connect(tone);
      harm.connect(harmGain).connect(tone);
      osc.start();
      harm.start();
      this.voices.push({ osc, harm, gain, harmGain });
    }

    // Shared white-noise source for prop wash and wind.
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.motorBus);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.start();
    this.applyMaster();
  }

  /**
   * @param omega rotor speeds (rad/s, signed)
   * @param omegaMax the airframe's top rotor speed
   * @param blades blades per prop
   * @param airspeed m/s
   * @param distance metres from the listener (0 = onboard)
   */
  updateFlight(omega: ArrayLike<number>, omegaMax: number, blades: number, airspeed: number, distance: number, propwash: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const att = distance <= 0 ? 1 : clamp(3 / (distance + 2), 0.02, 1);
    let mean = 0;
    for (let i = 0; i < 4; i++) {
      const w = Math.abs(omega[i]);
      mean += w / 4;
      const f = w / (Math.PI * 2);
      const load = clamp01(w / omegaMax);
      const v = this.voices[i];
      v.osc.frequency.setTargetAtTime(Math.max(20, f), t, 0.012);
      v.harm.frequency.setTargetAtTime(Math.max(30, f * blades), t, 0.012);
      const on = w > 30 ? 1 : 0;
      v.gain.gain.setTargetAtTime(on * (0.018 + load * 0.05) * att, t, 0.03);
      v.harmGain.gain.setTargetAtTime(on * (0.01 + load * load * 0.07) * att, t, 0.03);
    }
    const load = clamp01(mean / omegaMax);
    if (this.noiseFilter && this.noiseGain) {
      this.noiseFilter.frequency.setTargetAtTime(400 + load * 3500, t, 0.05);
      this.noiseGain.gain.setTargetAtTime((load * 0.16 + propwash * 0.12) * att * (mean > 30 ? 1 : 0), t, 0.05);
    }
    if (this.windFilter && this.windGain) {
      const a = clamp01(airspeed / 45);
      this.windFilter.frequency.setTargetAtTime(250 + a * 1600, t, 0.1);
      this.windGain.gain.setTargetAtTime(distance <= 0 ? a * a * 0.35 : 0, t, 0.1);
    }
  }

  /** Silence the motors immediately (menus, crash). */
  quiet(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(0, t, 0.05);
      v.harmGain.gain.setTargetAtTime(0, t, 0.05);
    }
    this.noiseGain?.gain.setTargetAtTime(0, t, 0.05);
    this.windGain?.gain.setTargetAtTime(0, t, 0.1);
  }

  impact(speed: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.fxBus || !this.noiseBuffer || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + clamp(speed, 0, 20) * 180;
    const g = ctx.createGain();
    const peak = clamp(speed / 10, 0.05, 1) * 0.8;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + speed * 0.015);
    src.connect(f).connect(g).connect(this.fxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.5);
  }

  beep(kind: Beep): void {
    const ctx = this.ctx;
    if (!ctx || !this.fxBus || ctx.state !== 'running') return;
    if (!this.beepsOn && kind !== 'tick' && kind !== 'go') return;
    const seq: Array<[number, number, number]> = (() => {
      switch (kind) {
        case 'arm':
          return [[880, 0, 0.07], [1320, 0.09, 0.09]];
        case 'disarm':
          return [[1320, 0, 0.07], [880, 0.09, 0.09]];
        case 'tick':
          return [[880, 0, 0.14]];
        case 'go':
          return [[1760, 0, 0.45]];
        case 'gate':
          return [[1568, 0, 0.06], [2093, 0.05, 0.08]];
        case 'target':
          return [[1047, 0, 0.08], [1319, 0.08, 0.08], [1568, 0.16, 0.12]];
        case 'lap':
          return [[1047, 0, 0.09], [1568, 0.1, 0.14]];
        case 'best':
          return [[1047, 0, 0.08], [1319, 0.08, 0.08], [1568, 0.16, 0.08], [2093, 0.24, 0.2]];
        case 'finish':
          return [[784, 0, 0.12], [1047, 0.13, 0.12], [1319, 0.26, 0.12], [1568, 0.39, 0.35]];
        case 'error':
          return [[330, 0, 0.12], [262, 0.14, 0.18]];
        case 'lowBattery':
          return [[2200, 0, 0.05], [2200, 0.1, 0.05], [2200, 0.2, 0.05]];
        default:
          return [[1400, 0, 0.025]];
      }
    })();
    const t0 = ctx.currentTime + 0.005;
    for (const [freq, at, dur] of seq) {
      const o = ctx.createOscillator();
      o.type = kind === 'lowBattery' || kind === 'arm' || kind === 'disarm' ? 'square' : 'sine';
      o.frequency.value = freq;
      const g = ctx.createGain();
      const level = o.type === 'square' ? 0.06 : 0.16;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(level, t0 + at + 0.008);
      g.gain.setValueAtTime(level, t0 + at + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0005, t0 + at + dur);
      o.connect(g).connect(this.fxBus);
      o.start(t0 + at);
      o.stop(t0 + at + dur + 0.02);
    }
  }
}
