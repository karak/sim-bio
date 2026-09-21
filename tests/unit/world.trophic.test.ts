import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig, grass, forest, moss } from './helpers';
import type { SpeciesDef } from '../../src/simulation/types';
import { readFileSync } from 'node:fs';

// 実データと同じ値で検証する (バランスは species.json が正)
const data = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const byId = (id: string): SpeciesDef => {
  const d = data.find((x) => x.id === id);
  if (!d) throw new Error(`species ${id} not in species.json`);
  return { ...d, initialDensity: 0.05 };
};
export const deer = byId('deer');
export const rabbit = byId('rabbit');
export const wolf = byId('wolf');

const firstLand = (w: World) => {
  const s = w.snapshot();
  for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) return i;
  throw new Error('no land');
};

describe('World trophic interactions', () => {
  it('herbivores reduce grass compared to a world without them', () => {
    const a = World.create(testConfig({ species: [grass, forest, moss] }), { log: createMemorySink() });
    const b = World.create(testConfig({ species: [grass, forest, moss, deer] }), { log: createMemorySink() });
    a.step(360 * 5);
    b.step(360 * 5);
    expect(b.snapshot().totals.grass).toBeLessThan(a.snapshot().totals.grass);
    expect(b.snapshot().totals.deer).toBeGreaterThan(0);
  });
  it('spawn_species works for animals', () => {
    const w = World.create(testConfig({ species: [grass, forest, moss, { ...deer, initialDensity: 0 }] }), { log: createMemorySink() });
    const c = firstLand(w);
    expect(w.snapshot().totals.deer).toBe(0);
    w.dispatch({ type: 'spawn_species', speciesId: 'deer', cell: c, amount: 0.5 });
    w.step(1);
    expect(w.snapshot().totals.deer).toBeGreaterThan(0);
  });
  it('carnivores reduce herbivores compared to a world without them', () => {
    const a = World.create(testConfig({ species: [grass, forest, moss, deer] }), { log: createMemorySink() });
    const b = World.create(testConfig({ species: [grass, forest, moss, deer, wolf] }), { log: createMemorySink() });
    a.step(360 * 5);
    b.step(360 * 5);
    expect(b.snapshot().totals.deer).toBeLessThan(a.snapshot().totals.deer);
    expect(b.snapshot().totals.wolf).toBeGreaterThan(0);
  });
  it('emits sim.species.extinct once when an animal dies out', () => {
    const log = createMemorySink();
    const starving = { ...wolf, eats: [] as string[] };
    const w = World.create(testConfig({ species: [grass, forest, moss, starving] }), { log });
    w.step(360 * 5);
    expect(w.snapshot().totals.wolf).toBe(0);
    expect(log.find('sim.species.extinct').map((r) => r.speciesId)).toEqual(['wolf']);
  });
  it('drier climate shifts the herbivore mix toward rabbits', { timeout: 30_000 }, () => {
    const wet = World.create(testConfig({ species: [grass, forest, moss, deer, rabbit] }), { log: createMemorySink() });
    const dry = World.create(testConfig({ species: [grass, forest, moss, deer, rabbit] }), { log: createMemorySink() });
    dry.dispatch({ type: 'set_climate', rainScale: 0.5 });
    wet.step(360 * 10);
    dry.step(360 * 10);
    const share = (w: World) => {
      const t = w.snapshot().totals;
      return t.rabbit / (t.rabbit + t.deer);
    };
    expect(dry.snapshot().totals.rabbit).toBeGreaterThan(0);
    expect(share(dry)).toBeGreaterThan(share(wet));
  });
});
