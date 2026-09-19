import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { amplitudeRatio, countPeaks, secondHalf } from '../../src/simulation/oscillation';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

describe('assets/data', () => {
  const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
  const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;

  it('has two plant species with required fields', () => {
    expect(species.filter((s) => s.trophic === 'plant').length).toBeGreaterThanOrEqual(2);
    for (const s of species) {
      expect(s.id).toBeTruthy();
      expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(s.tempRange[0]).toBeLessThan(s.tempRange[1]);
    }
  });
  it('all three trophic levels coexist for 100 years (seed 42, size 64)', { timeout: 120_000 }, () => {
    const w = World.create({ ...base, size: 64, species }, { log: createMemorySink() });
    const deer: number[] = [];
    for (let y = 0; y < 100; y++) {
      w.step(360);
      deer.push(w.snapshot().totals.deer);
    }
    const t = w.snapshot().totals;
    for (const s of species) expect(t[s.id], s.id).toBeGreaterThan(0);
    expect(species.map((s) => s.trophic)).toEqual(expect.arrayContaining(['plant', 'herbivore', 'carnivore']));
    // M3: 捕食者・被食者の波が持続する (後半 50 年で極大値 3 以上、振幅比 0.2 以上)
    expect(countPeaks(secondHalf(deer), 0.5)).toBeGreaterThanOrEqual(3);
    expect(amplitudeRatio(secondHalf(deer))).toBeGreaterThanOrEqual(0.2);
  });
  it('default world runs 20 years with vegetation between 5% and 95%', { timeout: 60_000 }, () => {
    const w = World.create({ ...base, species }, { log: createMemorySink() });
    w.step(360 * 20);
    const s = w.snapshot();
    let land = 0;
    let veg = 0;
    for (let i = 0; i < s.layers.elevation.length; i++) {
      if (s.layers.elevation[i] >= 0.3) {
        land++;
        veg += s.layers.vegetation[i];
      }
    }
    expect(veg / land).toBeGreaterThan(0.05);
    expect(veg / land).toBeLessThan(0.95);
  });
});
