import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import { buildTerrain } from '../src/engine/world/terrain';

// Real Texture objects are not needed to build the geometry.
const fakeTex = {} as never;

describe('terrain mesh', () => {
  it('faces up so it is not back-face culled from above', () => {
    const { terrain } = buildTerrain('low', { grass: fakeTex, dirt: fakeTex, rock: fakeTex });
    const n = terrain.geometry.attributes.normal as BufferAttribute;
    let up = 0;
    for (let i = 0; i < n.count; i += 7) if (n.getY(i) > 0) up++;
    expect(up / Math.ceil(n.count / 7)).toBeGreaterThan(0.99);
  });
});
