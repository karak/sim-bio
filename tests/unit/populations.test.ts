import { describe, it, expect } from 'vitest';
import { functionalResponse, stepPopulations } from '../../src/simulation/populations';
import type { SpeciesDef } from '../../src/simulation/types';

const deer: SpeciesDef = {
  id: 'deer', name: '鹿', trophic: 'herbivore', growthRate: 2.5, mortality: 0.02, predation: 0.03,
  tempRange: [-5, 28], moistureRange: [0.2, 0.9], diffusion: 0.15, eats: ['grass'], assetId: 'deer', color: '#E2B45A',
};
const env = (n: number) => ({
  elevation: new Float32Array(n).fill(0.5),
  temperature: new Float32Array(n).fill(15),
  moisture: new Float32Array(n).fill(0.5),
});

describe('functionalResponse', () => {
  it('is linear with handlingTime 0 and saturates otherwise', () => {
    expect(functionalResponse(0.1, 0, 0.5)).toBeCloseTo(0.05, 9);
    expect(functionalResponse(0.1, 20, 0.5)).toBeLessThan(0.05);
    // 飽和: 餌が 10 倍でも摂食率は 10 倍にならない
    const lo = functionalResponse(0.1, 20, 0.1);
    const hi = functionalResponse(0.1, 20, 1.0);
    expect(hi / lo).toBeLessThan(5);
    expect(hi).toBeLessThan(1 / 20);
  });
});

describe('stepPopulations', () => {
  it('grows with food and eats the prey', () => {
    const n = 9;
    const pops = { grass: new Float32Array(n).fill(0.8), deer: new Float32Array(n).fill(0.1) };
    const s = new Float32Array(n);
    for (let k = 0; k < 50; k++) stepPopulations(pops, s, env(n), [deer], 3);
    expect(pops.deer[4]).toBeGreaterThan(0.1);
    expect(pops.grass[4]).toBeLessThan(0.8);
  });
  it('declines without food', () => {
    const n = 9;
    const pops = { grass: new Float32Array(n), deer: new Float32Array(n).fill(0.5) };
    const s = new Float32Array(n);
    for (let k = 0; k < 100; k++) stepPopulations(pops, s, env(n), [deer], 3);
    expect(pops.deer[4]).toBeLessThan(0.1);
  });
  it('diffuses to neighbours and stays 0 on sea', () => {
    const n = 9;
    const e = env(n);
    e.elevation[0] = 0.1;
    const pops = { grass: new Float32Array(n).fill(0.8), deer: new Float32Array(n) };
    pops.deer[4] = 0.5;
    const s = new Float32Array(n);
    stepPopulations(pops, s, e, [deer], 3);
    expect(pops.deer[1]).toBeGreaterThan(0);
    expect(pops.deer[0]).toBe(0);
  });
  it('carnivore is processed after herbivore and eats it', () => {
    const wolf: SpeciesDef = { ...deer, id: 'wolf', trophic: 'carnivore', eats: ['deer'], predation: 0.08, growthRate: 3, assetId: 'wolf' };
    const n = 1;
    const pops = { grass: new Float32Array([0.8]), deer: new Float32Array([0.5]), wolf: new Float32Array([0.3]) };
    const s = new Float32Array(n);
    stepPopulations(pops, s, env(n), [wolf, deer], 1);
    expect(pops.deer[0]).toBeLessThan(0.5 + 0.06);
    expect(pops.wolf[0]).toBeGreaterThan(0.3);
  });
});
