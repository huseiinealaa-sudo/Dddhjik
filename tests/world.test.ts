import { describe, expect, it } from 'vitest';
import { FIELD, isOverWater, LAKE, terrainHeight, WORLD, YARD } from '../src/sim/world';

describe('height field', () => {
  it('is deterministic and finite everywhere on the map', () => {
    for (let x = -WORLD.half; x <= WORLD.half; x += 37) {
      for (let z = -WORLD.half; z <= WORLD.half; z += 41) {
        const h = terrainHeight(x, z);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBe(terrainHeight(x, z));
      }
    }
  });

  it('keeps the meadow gentle for racing', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      for (const r of [0, 40, 80, 110]) {
        const h = terrainHeight(FIELD.x + Math.cos(a) * r, FIELD.z + Math.sin(a) * r);
        expect(Math.abs(h)).toBeLessThan(2);
      }
    }
  });

  it('keeps the industrial yard perfectly flat', () => {
    for (const [dx, dz] of [
      [0, 0],
      [50, 30],
      [-60, -40],
    ]) {
      expect(terrainHeight(YARD.x + dx, YARD.z + dz)).toBeCloseTo(YARD.height, 6);
    }
  });

  it('has a lake below the water line with a dry shore', () => {
    expect(terrainHeight(LAKE.x, LAKE.z)).toBeLessThan(WORLD.waterLevel - 3);
    expect(isOverWater(LAKE.x, LAKE.z)).toBe(true);
    expect(terrainHeight(LAKE.x + LAKE.radius * 1.3, LAKE.z)).toBeGreaterThan(WORLD.waterLevel);
  });

  it('raises mountains around the edge of the map', () => {
    expect(terrainHeight(0, 640)).toBeGreaterThan(20);
  });
});
