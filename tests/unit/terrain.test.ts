import { describe, it, expect } from 'vitest';
import { generateCrystal, generateTerrain, SEA_LEVEL } from '../../src/simulation/terrain';
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

  it('moisture on land is a mosaic: >=15% dry (<0.45) and >=15% wet (>=0.6)', () => {
    const n = 128;
    const { elevation, moistureBase } = generateTerrain(42, n);
    let land = 0;
    let dry = 0;
    let wet = 0;
    for (let i = 0; i < n * n; i++) {
      if (elevation[i] < SEA_LEVEL) continue;
      land++;
      if (moistureBase[i] < 0.45) dry++;
      if (moistureBase[i] >= 0.6) wet++;
    }
    expect(dry / land).toBeGreaterThanOrEqual(0.15);
    expect(wet / land).toBeGreaterThanOrEqual(0.15);
  });

  it('has at least one lake (water not connected to the border)', () => {
    const n = 64;
    const { elevation } = generateTerrain(42, n);
    const water = (i: number) => elevation[i] < SEA_LEVEL;
    const seen = new Uint8Array(n * n);
    const q: number[] = [];
    for (let k = 0; k < n; k++) {
      for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) {
        if (water(i) && !seen[i]) {
          seen[i] = 1;
          q.push(i);
        }
      }
    }
    while (q.length) {
      const i = q.pop() as number;
      const x = i % n;
      const y = (i - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const j = ny * n + nx;
        if (water(j) && !seen[j]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    let lake = 0;
    for (let i = 0; i < n * n; i++) if (water(i) && !seen[i]) lake++;
    expect(lake).toBeGreaterThan(0);
  });
});

describe('generateCrystal (M8-01)', () => {
  it('same seed gives same crystal、海は必ず 0', () => {
    const size = 32;
    const { elevation } = generateTerrain(42, size);
    const a = generateCrystal(42, elevation, size);
    const b = generateCrystal(42, elevation, size);
    expect(Array.from(a)).toEqual(Array.from(b));
    for (let i = 0; i < size * size; i++) {
      if (elevation[i] < SEA_LEVEL) expect(a[i]).toBe(0);
    }
  });

  it('陸地の 2%〜15% 程度に塊状に置かれる (複数シードで確認)', () => {
    const size = 32;
    for (const seed of [1, 2, 3, 42, 99]) {
      const { elevation } = generateTerrain(seed, size);
      const crystal = generateCrystal(seed, elevation, size);
      let land = 0;
      let has = 0;
      for (let i = 0; i < size * size; i++) {
        if (elevation[i] < SEA_LEVEL) continue;
        land++;
        if (crystal[i] > 0) has++;
      }
      const ratio = has / land;
      expect(ratio).toBeGreaterThan(0.02);
      expect(ratio).toBeLessThan(0.15);
    }
  });
});
