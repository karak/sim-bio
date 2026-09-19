import { describe, it, expect } from 'vitest';
import { stepVegetation, suitability, sumVegetation } from '../../src/simulation/vegetation';
import type { SpeciesDef } from '../../src/simulation/types';

const grass: SpeciesDef = {
  id: 'grass', name: '草', trophic: 'plant', growthRate: 0.05, mortality: 0.02,
  tempRange: [0, 30], moistureRange: [0.2, 0.9], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C',
};
const env = (n: number, t = 15, m = 0.5) => ({
  elevation: new Float32Array(n).fill(0.5),
  temperature: new Float32Array(n).fill(t),
  moisture: new Float32Array(n).fill(m),
});

describe('suitability', () => {
  it('is 1 inside range, 0 far outside, between at edge', () => {
    expect(suitability(grass, 15, 0.5)).toBe(1);
    expect(suitability(grass, -20, 0.5)).toBe(0);
    const e = suitability(grass, -2.5, 0.5);
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(1);
  });
});

describe('stepVegetation', () => {
  it('grows toward capacity in good conditions', () => {
    const n = 9;
    const p = { grass: new Float32Array(n).fill(0.1) };
    const s = new Float32Array(n);
    for (let k = 0; k < 500; k++) stepVegetation(p, s, env(n), [grass], 3);
    expect(p.grass[4]).toBeGreaterThan(0.5);
    expect(p.grass[4]).toBeLessThanOrEqual(1);
  });
  it('declines in bad conditions', () => {
    const n = 9;
    const p = { grass: new Float32Array(n).fill(0.5) };
    const s = new Float32Array(n);
    for (let k = 0; k < 200; k++) stepVegetation(p, s, env(n, -20), [grass], 3);
    expect(p.grass[4]).toBeLessThan(0.05);
  });
  it('sea stays 0, diffusion spreads to empty land', () => {
    const n = 9;
    const e = env(n);
    e.elevation[0] = 0.1;
    const p = { grass: new Float32Array(n) };
    p.grass[4] = 0.8;
    p.grass[0] = 0.8;
    const s = new Float32Array(n);
    stepVegetation(p, s, e, [grass], 3);
    expect(p.grass[0]).toBe(0);
    expect(p.grass[1]).toBeGreaterThan(0);
  });
  it('two species share capacity', () => {
    const forest = { ...grass, id: 'forest' };
    const p = { grass: new Float32Array([0.6]), forest: new Float32Array([0.6]) };
    const s = new Float32Array(1);
    stepVegetation(p, s, env(1), [grass, forest], 1);
    expect(p.grass[0] + p.forest[0]).toBeLessThan(1.2);
    const out = new Float32Array(1);
    sumVegetation(p, [grass, forest], out);
    expect(out[0]).toBeCloseTo(p.grass[0] + p.forest[0], 6);
  });
});
