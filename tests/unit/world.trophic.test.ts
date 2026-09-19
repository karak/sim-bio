import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig, grass, forest } from './helpers';
import type { SpeciesDef } from '../../src/simulation/types';

export const deer: SpeciesDef = {
  id: 'deer', name: '鹿', trophic: 'herbivore', growthRate: 0.06, mortality: 0.02, predation: 0.03,
  tempRange: [-5, 28], moistureRange: [0.2, 0.9], diffusion: 0.15, eats: ['grass'], assetId: 'deer', color: '#E2B45A',
  initialDensity: 0.05,
};

describe('World trophic interactions', () => {
  it('herbivores reduce grass compared to a world without them', () => {
    const a = World.create(testConfig({ species: [grass, forest] }), { log: createMemorySink() });
    const b = World.create(testConfig({ species: [grass, forest, deer] }), { log: createMemorySink() });
    a.step(360 * 5);
    b.step(360 * 5);
    expect(b.snapshot().totals.grass).toBeLessThan(a.snapshot().totals.grass);
    expect(b.snapshot().totals.deer).toBeGreaterThan(0);
  });
  it('spawn_species works for animals', () => {
    const w = World.create(testConfig({ species: [grass, forest, { ...deer, initialDensity: 0 }] }), { log: createMemorySink() });
    const s = w.snapshot();
    let c = -1;
    for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) { c = i; break; }
    expect(w.snapshot().totals.deer).toBe(0);
    w.dispatch({ type: 'spawn_species', speciesId: 'deer', cell: c, amount: 0.5 });
    w.step(1);
    expect(w.snapshot().totals.deer).toBeGreaterThan(0);
  });
});
