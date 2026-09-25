import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildTriggers, crossGate, TRACKS } from '../src/sim/tracks';

describe('gate crossing', () => {
  const meadow = TRACKS[0];
  const g = buildTriggers(meadow)[0]; // heading north, centred on the opening

  it('detects a fast pass through the opening', () => {
    const a = g.center.clone().addScaledVector(g.normal, -3);
    const b = g.center.clone().addScaledVector(g.normal, 3);
    const t = crossGate(a, b, g);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 6);
  });

  it('ignores a pass in the wrong direction', () => {
    const a = g.center.clone().addScaledVector(g.normal, 3);
    const b = g.center.clone().addScaledVector(g.normal, -3);
    expect(crossGate(a, b, g)).toBeNull();
  });

  it('ignores a pass beside or above the opening', () => {
    const beside = g.center.clone().addScaledVector(g.right, g.halfWidth + 0.3);
    expect(crossGate(beside.clone().addScaledVector(g.normal, -1), beside.clone().addScaledVector(g.normal, 1), g)).toBeNull();
    const above = g.center.clone().addScaledVector(g.up, g.halfHeight + 0.3);
    expect(crossGate(above.clone().addScaledVector(g.normal, -1), above.clone().addScaledVector(g.normal, 1), g)).toBeNull();
  });

  it('works for a dive gate flown downwards', () => {
    const pro = buildTriggers(TRACKS[1]);
    const dive = pro.find((x) => x.kind === 'dive')!;
    expect(dive.normal.y).toBe(-1);
    const a = dive.center.clone().add(new Vector3(0, 2, 0));
    const b = dive.center.clone().add(new Vector3(0, -2, 0));
    expect(crossGate(a, b, dive)).not.toBeNull();
    expect(crossGate(b, a, dive)).toBeNull();
  });

  it('gives every gate of every track a sane opening', () => {
    for (const track of TRACKS) {
      const triggers = buildTriggers(track);
      expect(triggers.length).toBeGreaterThanOrEqual(8);
      for (const t of triggers) {
        expect(t.halfWidth).toBeGreaterThan(0.6);
        expect(t.halfHeight).toBeGreaterThan(0.6);
        expect(Math.abs(t.normal.length() - 1)).toBeLessThan(1e-9);
        expect(Number.isFinite(t.center.y)).toBe(true);
      }
    }
  });
});
