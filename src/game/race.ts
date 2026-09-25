import type { Quaternion, Vector3 } from 'three';
import type { GateState } from '../engine/world/gates';
import { crossGate, type GateTrigger, type TrackDef } from '../sim/tracks';
import { GhostRecorder, type GhostData } from './ghost';
import type { TrackRecord } from './records';

export type RacePhase = 'ready' | 'countdown' | 'running' | 'finished';

export type RaceEvent =
  | { type: 'tick'; value: number }
  | { type: 'go' }
  | { type: 'gate'; gate: number; split: number; delta: number | null }
  | { type: 'lap'; lap: number; time: number; best: boolean; delta: number | null }
  | { type: 'finish'; total: number; bestLap: number; newRecord: boolean };

/**
 * Race rules: arm to start a 3-second countdown, then fly the gates in order.
 * A lap ends at the last gate; the race ends after the track's lap count.
 * Pure logic — the caller feeds it positions and renders what it reports.
 */
export class RaceSession {
  phase: RacePhase = 'ready';
  countdown = 0;
  /** Race clock, seconds since GO. */
  time = 0;
  lap = 0;
  nextGate = 0;
  lapStart = 0;
  readonly lapTimes: number[] = [];
  splits: number[] = [];
  bestLap: number | null;
  bestRace: number | null;
  bestSplits: number[];
  ghost: GhostData | null;
  newGhost: GhostData | null = null;
  missed = 0;
  private readonly recorder = new GhostRecorder();
  private lastTick = 4;
  private dirty = false;

  constructor(
    readonly track: TrackDef,
    readonly triggers: GateTrigger[],
    record: TrackRecord | null,
  ) {
    this.bestLap = record?.bestLap ?? null;
    this.bestRace = record?.bestRace ?? null;
    this.bestSplits = record?.bestSplits ?? [];
    this.ghost = record?.ghost ?? null;
  }

  get laps(): number {
    return this.track.laps;
  }

  get lapTime(): number {
    return this.phase === 'running' ? this.time - this.lapStart : 0;
  }

  /** True while the pilot must hold still (countdown). */
  get holding(): boolean {
    return this.phase === 'countdown';
  }

  /** Has anything changed that should be persisted? Clears the flag. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  reset(): void {
    this.phase = 'ready';
    this.countdown = 0;
    this.time = 0;
    this.lap = 0;
    this.nextGate = 0;
    this.lapStart = 0;
    this.lapTimes.length = 0;
    this.splits = [];
    this.missed = 0;
    this.lastTick = 4;
    this.recorder.reset();
  }

  begin(): RaceEvent[] {
    if (this.phase !== 'ready') return [];
    this.phase = 'countdown';
    this.countdown = 3;
    this.lastTick = 4;
    return this.update(0);
  }

  update(dt: number): RaceEvent[] {
    const events: RaceEvent[] = [];
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const tick = Math.ceil(this.countdown);
      if (tick < this.lastTick && tick > 0) {
        this.lastTick = tick;
        events.push({ type: 'tick', value: tick });
      }
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.time = 0;
        this.lapStart = 0;
        this.recorder.reset();
        events.push({ type: 'go' });
      }
    } else if (this.phase === 'running') {
      this.time += dt;
    }
    return events;
  }

  record(dt: number, pos: Vector3, q: Quaternion): void {
    if (this.phase === 'running') this.recorder.record(dt, pos, q);
  }

  /** Test the path segment a→b against the next gate. */
  move(a: Vector3, b: Vector3, stepTime: number): RaceEvent[] {
    if (this.phase !== 'running') return [];
    const gate = this.triggers[this.nextGate];
    if (!gate) return [];
    const t = crossGate(a, b, gate);
    if (t === null) return [];
    // Interpolate the crossing inside the step for millisecond-accurate splits.
    const at = this.time - stepTime * (1 - t);
    const split = at - this.lapStart;
    const events: RaceEvent[] = [];
    this.splits[this.nextGate] = split;
    const ref = this.bestSplits[this.nextGate];
    const delta = ref !== undefined ? split - ref : null;
    const last = this.nextGate === this.triggers.length - 1;
    if (!last) {
      events.push({ type: 'gate', gate: this.nextGate, split, delta });
      this.nextGate++;
      return events;
    }

    // Lap complete.
    const lapTime = split;
    this.lapTimes.push(lapTime);
    const best = this.bestLap === null || lapTime < this.bestLap;
    const lapDelta = this.bestLap !== null ? lapTime - this.bestLap : null;
    if (best) {
      this.bestLap = lapTime;
      this.bestSplits = this.splits.slice();
      this.newGhost = this.recorder.finish();
      this.ghost = this.newGhost;
      this.dirty = true;
    }
    this.lap++;
    events.push({ type: 'lap', lap: this.lap, time: lapTime, best, delta: lapDelta });
    this.splits = [];
    this.nextGate = 0;
    this.lapStart = at;
    this.recorder.reset();

    if (this.lap >= this.track.laps) {
      this.phase = 'finished';
      const total = at;
      const newRecord = this.bestRace === null || total < this.bestRace;
      if (newRecord) {
        this.bestRace = total;
        this.dirty = true;
      }
      events.push({ type: 'finish', total, bestLap: Math.min(...this.lapTimes), newRecord });
    }
    return events;
  }

  gateStates(out: GateState[]): GateState[] {
    out.length = this.triggers.length;
    for (let i = 0; i < this.triggers.length; i++) {
      if (this.phase === 'finished') out[i] = 'passed';
      else if (i === this.nextGate) out[i] = 'next';
      else if (i < this.nextGate) out[i] = 'passed';
      else out[i] = i === this.nextGate + 1 ? 'upcoming' : 'idle';
    }
    return out;
  }

  toRecord(): TrackRecord {
    return {
      bestLap: this.bestLap,
      bestRace: this.bestRace,
      bestSplits: this.bestSplits,
      ghost: this.ghost,
      date: Date.now(),
    };
  }
}
