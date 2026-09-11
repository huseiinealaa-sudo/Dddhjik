import { clamp } from '../core/MathUtils';
import type { MotorOutputs } from '../flight/FlightController';

/**
 * Fully synthesised motor and wind audio — no sample files, no downloads.
 *
 * Each motor gets its own sawtooth oscillator whose pitch tracks RPM. Because
 * the four motors are never at exactly the same RPM, the beating between them
 * produces the warbling "quad growl" that real footage has. A filtered noise
 * source on top provides prop wash and airspeed rush.
 *
 * iOS/iPadOS only allows audio to start from a user gesture, so `resume()` is
 * called from the first tap on the start screen.
 */

const MOTOR_BASE_HZ = 42;
const MOTOR_RANGE_HZ = 330;
const DETUNE_CENTS = [-14, 9, -5, 17];

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private motorBus: GainNode | null = null;

  private oscillators: OscillatorNode[] = [];
  private motorGains: GainNode[] = [];
  private motorFilters: BiquadFilterNode[] = [];

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;

  private started = false;
  private volume = 0.5;
  private enabled = true;

  get isRunning(): boolean {
    return this.started && this.context?.state === 'running';
  }

  /** Must be called from inside a user-gesture handler on iOS. */
  async resume(): Promise<void> {
    try {
      if (!this.context) this.build();
      if (!this.context) return;
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      /* audio is a nicety, never let it break the simulator */
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.context.currentTime, 0.05);
    }
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    if (this.master && this.context && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.05);
    }
  }

  private build(): void {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const context = new Ctor();
    this.context = context;

    this.master = context.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(context.destination);

    // Gentle compression keeps the mix from clipping during full-throttle punches.
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;
    compressor.connect(this.master);

    this.motorBus = context.createGain();
    this.motorBus.gain.value = 0.34;
    this.motorBus.connect(compressor);

    for (let i = 0; i < 4; i++) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = MOTOR_BASE_HZ;
      oscillator.detune.value = DETUNE_CENTS[i];

      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      filter.Q.value = 1.4;

      const gain = context.createGain();
      gain.gain.value = 0;

      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(this.motorBus);
      oscillator.start();

      this.oscillators.push(oscillator);
      this.motorFilters.push(filter);
      this.motorGains.push(gain);
    }

    // Looping white-noise buffer for wind and prop wash.
    const length = Math.floor(context.sampleRate * 2);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Light pinking makes the noise sound like air rather than static.
      last = 0.94 * last + 0.06 * white;
      data[i] = last * 3.2;
    }

    this.windSource = context.createBufferSource();
    this.windSource.buffer = buffer;
    this.windSource.loop = true;

    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;

    this.windGain = context.createGain();
    this.windGain.gain.value = 0;

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(compressor);
    this.windSource.start();

    this.started = true;
  }

  /**
   * @param motors     smoothed motor outputs 0..1
   * @param airspeed   metres per second
   * @param proximity  0 = far away (orbit cam), 1 = onboard
   */
  update(motors: MotorOutputs, airspeed: number, proximity: number): void {
    if (!this.context || !this.started || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const smoothing = 0.03;

    for (let i = 0; i < 4; i++) {
      const rpm = clamp(motors[i], 0, 1);
      const frequency = MOTOR_BASE_HZ + rpm * MOTOR_RANGE_HZ;
      this.oscillators[i].frequency.setTargetAtTime(frequency, now, smoothing);
      this.motorFilters[i].frequency.setTargetAtTime(420 + rpm * 3400, now, smoothing);
      // Perceived loudness rises faster than RPM.
      const level = rpm > 0.01 ? 0.055 + rpm ** 1.4 * 0.5 : 0;
      this.motorGains[i].gain.setTargetAtTime(level * proximity, now, smoothing);
    }

    if (this.windGain && this.windFilter) {
      const rush = clamp(airspeed / 32, 0, 1);
      this.windGain.gain.setTargetAtTime(rush ** 1.6 * 0.42 * proximity, now, 0.06);
      this.windFilter.frequency.setTargetAtTime(380 + rush * 2600, now, 0.06);
    }
  }

  /** Short percussive burst when the airframe hits something. */
  playImpact(strength: number): void {
    if (!this.context || !this.started || this.context.state !== 'running') return;
    const context = this.context;
    const now = context.currentTime;
    const amount = clamp(strength, 0, 1);

    const length = Math.floor(context.sampleRate * 0.28);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const decay = (1 - i / length) ** 3;
      data[i] = (Math.random() * 2 - 1) * decay;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900 + amount * 3200;

    const gain = context.createGain();
    gain.gain.value = 0.12 + amount * 0.55;

    source.connect(filter);
    filter.connect(gain);
    if (this.master) gain.connect(this.master);
    source.start(now);
    source.stop(now + 0.3);
  }

  /** Confirmation blip used for arming, gates and lap completion. */
  playBeep(frequency: number, duration = 0.09, level = 0.16): void {
    if (!this.context || !this.started || this.context.state !== 'running') return;
    const context = this.context;
    const now = context.currentTime;

    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(gain);
    if (this.master) gain.connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  dispose(): void {
    try {
      for (const oscillator of this.oscillators) oscillator.stop();
      this.windSource?.stop();
      void this.context?.close();
    } catch {
      /* ignore */
    }
    this.oscillators = [];
    this.motorGains = [];
    this.motorFilters = [];
    this.context = null;
    this.started = false;
  }
}
