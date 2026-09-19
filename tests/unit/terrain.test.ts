import { describe, it, expect } from 'vitest';
import { generateTerrain, SEA_LEVEL } from '../../src/simulation/terrain';
import { mulberry32 } from '../../src/simulation/rng';

describe('mulberry32', () => {
  it('is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateTerrain', () => {
  it('same seed gives same terrain', () => {
    const a = generateTerrain(7, 32);
    const b = generateTerrain(7, 32);
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
  });

  it('values in [0,1], border is sea, has land', () => {
    const n = 64;
    const { elevation, moistureBase } = generateTerrain(1, n);
    let land = 0;
    for (let i = 0; i < n * n; i++) {
      expect(elevation[i]).toBeGreaterThanOrEqual(0);
      expect(elevation[i]).toBeLessThanOrEqual(1);
      expect(moistureBase[i]).toBeGreaterThanOrEqual(0);
      expect(moistureBase[i]).toBeLessThanOrEqual(1);
      if (elevation[i] >= SEA_LEVEL) land++;
    }
    for (let x = 0; x < n; x++) {
      expect(elevation[x]).toBeLessThan(SEA_LEVEL);
      expect(elevation[(n - 1) * n + x]).toBeLessThan(SEA_LEVEL);
    }
    expect(land / (n * n)).toBeGreaterThan(0.2);
    expect(land / (n * n)).toBeLessThan(0.8);
  });
});
