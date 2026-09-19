import { describe, it, expect } from 'vitest';
import { BASE_DECOMPOSITION, DECOMPOSER_BOOST, VITALITY_LEACH, stepVitality, vitalityFactor, type VitalityState } from '../../src/simulation/vitality';
import type { SpeciesDef } from '../../src/simulation/types';

const moss: SpeciesDef = {
  id: 'moss', name: '胞子苔', trophic: 'decomposer', growthRate: 2, mortality: 0.01, predation: 0.08, handlingTime: 5,
  tempRange: [0, 30], moistureRange: [0.55, 1], diffusion: 0.03, eats: [], assetId: 'moss', color: '#8FD3C4',
};
const mk = (size = 3): VitalityState => {
  const n = size * size;
  return { elevation: new Float32Array(n).fill(0.5), vitality: new Float32Array(n), litter: new Float32Array(n), populations: { moss: new Float32Array(n) } };
};

describe('stepVitality', () => {
  it('decomposes litter into vitality at the base rate without decomposers', () => {
    const s = mk(1);
    s.litter[0] = 1;
    stepVitality(s, [moss], new Float32Array(1), 1);
    expect(s.litter[0]).toBeCloseTo(1 - BASE_DECOMPOSITION, 6);
    expect(s.vitality[0]).toBeCloseTo(BASE_DECOMPOSITION * (1 - VITALITY_LEACH), 6);
  });
  it('decomposers speed up decomposition', () => {
    const a = mk(1);
    const b = mk(1);
    a.litter[0] = 1;
    b.litter[0] = 1;
    b.populations.moss[0] = 0.5;
    stepVitality(a, [moss], new Float32Array(1), 1);
    stepVitality(b, [moss], new Float32Array(1), 1);
    expect(b.vitality[0]).toBeGreaterThan(a.vitality[0]);
    expect(b.vitality[0] / a.vitality[0]).toBeCloseTo((BASE_DECOMPOSITION + DECOMPOSER_BOOST * 0.5) / BASE_DECOMPOSITION, 3);
  });
  it('diffuses to neighbours, leaches slowly, and sea stays 0', () => {
    const s = mk(3);
    s.elevation[0] = 0.1;
    s.vitality[4] = 1;
    stepVitality(s, [], new Float32Array(9), 3);
    expect(s.vitality[1]).toBeGreaterThan(0);
    expect(s.vitality[4]).toBeLessThan(1);
    expect(s.vitality[0]).toBe(0);
    const t = mk(1);
    t.vitality[0] = 1;
    for (let k = 0; k < 1000; k++) stepVitality(t, [], new Float32Array(1), 1);
    expect(t.vitality[0]).toBeCloseTo(Math.pow(1 - VITALITY_LEACH, 1000), 4);
  });
  it('vitalityFactor saturates', () => {
    expect(vitalityFactor(0)).toBe(0);
    expect(vitalityFactor(1)).toBeGreaterThan(0.85);
    expect(vitalityFactor(0.05)).toBeCloseTo(0.5, 6);
  });
});
