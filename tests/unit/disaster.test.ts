import { describe, it, expect } from 'vitest';
import { applyDisaster, stepFire, type DisasterState } from '../../src/simulation/disaster';
import type { SpeciesDef } from '../../src/simulation/types';

const grass: SpeciesDef = {
  id: 'grass', name: '草', trophic: 'plant', growthRate: 0.05, mortality: 0.02,
  tempRange: [0, 30], moistureRange: [0.2, 0.9], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C',
};
const deer: SpeciesDef = { ...grass, id: 'deer', trophic: 'herbivore', eats: ['grass'] };
const mk = (size = 5): DisasterState => {
  const n = size * size;
  return {
    elevation: new Float32Array(n).fill(0.5),
    heat: new Float32Array(n),
    fire: new Uint8Array(n),
    burnt: new Uint16Array(n),
    populations: { grass: new Float32Array(n).fill(0.8), deer: new Float32Array(n).fill(0.5) },
  };
};

describe('applyDisaster', () => {
  it('meteor clears everything in radius and lowers center', () => {
    const s = mk();
    applyDisaster(s, { type: 'disaster', kind: 'meteor', cell: 12, radius: 1 }, [grass, deer], 5);
    expect(s.populations.grass[12]).toBe(0);
    expect(s.populations.deer[7]).toBe(0);
    expect(s.populations.grass[0]).toBeCloseTo(0.8, 6);
    expect(s.elevation[12]).toBeCloseTo(0.45, 6);
  });
  it('volcano clears plants and adds heat', () => {
    const s = mk();
    applyDisaster(s, { type: 'disaster', kind: 'volcano', cell: 12, radius: 1 }, [grass, deer], 5);
    expect(s.populations.grass[12]).toBe(0);
    expect(s.populations.deer[12]).toBeCloseTo(0.5, 6);
    expect(s.heat[12]).toBe(6);
  });
  it('plague hits animals only', () => {
    const s = mk();
    applyDisaster(s, { type: 'disaster', kind: 'plague', cell: 12, radius: 1 }, [grass, deer], 5);
    expect(s.populations.deer[12]).toBeCloseTo(0.05, 6);
    expect(s.populations.grass[12]).toBeCloseTo(0.8, 6);
  });
  it('wildfire ignites center and spreads through dense vegetation', () => {
    const s = mk();
    applyDisaster(s, { type: 'disaster', kind: 'wildfire', cell: 12, radius: 0 }, [grass], 5);
    expect(s.fire[12]).toBe(1);
    const veg = s.populations.grass;
    const b1 = stepFire(s, veg, [grass], 5);
    expect(b1).toBe(1);
    expect(veg[12]).toBe(0);
    expect(s.fire[7]).toBe(1);
    const b2 = stepFire(s, veg, [grass], 5);
    expect(b2).toBe(4);
    expect(s.fire[12]).toBe(0);
  });
  it('wildfire does not spread into sparse vegetation', () => {
    const s = mk();
    s.populations.grass.fill(0.1);
    s.populations.grass[12] = 0.8;
    applyDisaster(s, { type: 'disaster', kind: 'wildfire', cell: 12, radius: 0 }, [grass], 5);
    stepFire(s, s.populations.grass, [grass], 5);
    expect(s.fire[7]).toBe(0);
  });
  it('wildfire burns decomposers too and leaves ash in litter', () => {
    const moss: SpeciesDef = { ...grass, id: 'moss', trophic: 'decomposer', assetId: 'moss' };
    const s = mk();
    s.populations.moss = new Float32Array(25).fill(0.4);
    s.litter = new Float32Array(25);
    applyDisaster(s, { type: 'disaster', kind: 'wildfire', cell: 12, radius: 0 }, [grass], 5);
    stepFire(s, s.populations.grass, [grass, moss], 5);
    expect(s.populations.moss[12]).toBe(0);
    expect(s.litter[12]).toBeCloseTo(0.4, 6);
  });
});
