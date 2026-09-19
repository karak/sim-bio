import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
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
