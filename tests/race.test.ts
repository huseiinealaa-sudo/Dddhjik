import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GhostRecorder, sampleGhost } from '../src/game/ghost';
import { RaceSession } from '../src/game/race';
import { buildTriggers, trackById } from '../src/sim/tracks';

function flyThrough(race: RaceSession, gate: number, dt = 0.001): ReturnType<RaceSession['move']> {
  const g = race.triggers[gate];
  const a = g.center.clone().addScaledVector(g.normal, -0.01);
  const b = g.center.clone().addScaledVector(g.normal, 0.01);
  return race.move(a, b, dt);
}

describe('race session', () => {
  const track = trackById('meadow');
  const triggers = buildTriggers(track);

  it('counts down, then times laps gate by gate', () => {
    const race = new RaceSession(track, triggers, null);
    const ticks = race.begin();
    expect(ticks.some((e) => e.type === 'tick')).toBe(true);
    expect(race.holding).toBe(true);
    let go = false;
    for (let i = 0; i < 3100 && !go; i++) go = race.update(0.001).some((e) => e.type === 'go');
    expect(go).toBe(true);
    expect(race.phase).toBe('running');

    // Skipping a gate does nothing.
    expect(flyThrough(race, 3)).toEqual([]);
    for (let lap = 0; lap < track.laps; lap++) {
      for (let gi = 0; gi < triggers.length; gi++) {
        race.update(1);
        const ev = flyThrough(race, gi);
        expect(ev.length).toBeGreaterThan(0);
      }
    }
    expect(race.phase).toBe('finished');
    expect(race.lapTimes.length).toBe(track.laps);
    expect(race.lapTimes[0]).toBeGreaterThan(triggers.length - 1);
    expect(race.bestLap).not.toBeNull();
    expect(race.takeDirty()).toBe(true);
  });

  it('flying backwards through a gate does not count', () => {
    const race = new RaceSession(track, triggers, null);
    race.begin();
    race.update(3.1);
    const g = triggers[0];
    const a = g.center.clone().addScaledVector(g.normal, 0.01);
    const b = g.center.clone().addScaledVector(g.normal, -0.01);
    expect(race.move(a, b, 0.001)).toEqual([]);
  });
});

describe('ghost', () => {
  it('replays a recorded path with interpolation', () => {
    const rec = new GhostRecorder();
    const q = new Quaternion();
    for (let i = 0; i <= 100; i++) rec.record(0.01, new Vector3(i * 0.1, 2, 0), q);
    const data = rec.finish();
    const p = new Vector3();
    const oq = new Quaternion();
    expect(sampleGhost(data, 0.5, p, oq)).toBe(true);
    expect(p.x).toBeCloseTo(5, 0);
    expect(p.y).toBeCloseTo(2, 5);
    expect(sampleGhost(data, 50, p, oq)).toBe(false);
  });
});
