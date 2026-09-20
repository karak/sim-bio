import { describe, it, expect } from 'vitest';
import { GRAZED_RECOVERY_PER_TICK, stepVegetation, suitability, sumVegetation } from '../../src/simulation/vegetation';
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
  it('grazed cell regrows slower and recovers after the delay', () => {
    // 2×2 グリッド。セル 0 だけ grazed=1、拡散は 0
    const n = 4;
    const e = { ...env(n), grazed: new Float32Array([1, 0, 0, 0]) };
    const p = { grass: new Float32Array(n).fill(0.2) };
    const s = new Float32Array(n);
    const sp = [{ ...grass, diffusion: 0 }];
    stepVegetation(p, s, e, sp, 2);
    expect(p.grass[0]).toBeLessThan(p.grass[1]);
    expect(e.grazed[0]).toBeCloseTo(1 - GRAZED_RECOVERY_PER_TICK, 6);
    for (let k = 0; k < 40; k++) stepVegetation(p, s, e, sp, 2);
    expect(e.grazed[0]).toBe(0);
    // 遅れが消えた後は、同じ密度から同じだけ成長する
    p.grass.fill(0.3);
    stepVegetation(p, s, e, sp, 2);
    expect(p.grass[0]).toBeCloseTo(p.grass[1], 9);
  });
  it('low vitality slows growth, growth consumes vitality, death feeds litter', () => {
    const n = 4;
    const e = { ...env(n), vitality: new Float32Array([0.02, 1, 1, 1]), litter: new Float32Array(n) };
    const p = { grass: new Float32Array(n).fill(0.2) };
    const s = new Float32Array(n);
    const sp = [{ ...grass, diffusion: 0 }];
    stepVegetation(p, s, e, sp, 2);
    expect(p.grass[0]).toBeLessThan(p.grass[1]);
    expect(e.vitality[1]).toBeLessThan(1);
    expect(e.litter[1]).toBeGreaterThan(0);
  });

  // M8-10 鐘樹: shade (他種の成長を弱める) と litterBoost (自分の死亡分の枯死への積み増し) の単体テスト
  describe('shade / litterBoost (M8-10)', () => {
    it('shade reduces another plant growth in the same cell in proportion to the shading species density', () => {
      const n = 1;
      // 1 セル、拡散なし。shader は growthRate=mortality=0 で密度が固定されたまま (計測をぶれさせない)
      const shaderWith = { ...grass, id: 'shader', growthRate: 0, mortality: 0, diffusion: 0, shade: 0.8 };
      const shaderWithout = { ...shaderWith, shade: 0 };
      const g = { ...grass, diffusion: 0 };
      const run = (shader: SpeciesDef) => {
        const p = { grass: new Float32Array([0.1]), shader: new Float32Array([0.5]) };
        const s = new Float32Array(n);
        stepVegetation(p, s, env(n), [g, shader], 1);
        return p.grass[0];
      };
      const withShade = run(shaderWith);
      const withoutShade = run(shaderWithout);
      // 陰があるほうが成長が抑えられ、密度が低い (死亡分は shade の影響を受けないので差は growth の分だけ)
      expect(withShade).toBeLessThan(withoutShade);
      // shade=0.8, v_shader=0.5 → 成長倍率 (1 − 0.8·0.5) = 0.6。理論値と一致することを確認
      const f = 1;
      const total = 0.1 + 0.5;
      const growthNoShade = g.growthRate * f * 1 * 1 * 0.1 * (1 - total);
      const death = g.mortality * (2 - f) * 0.1;
      const expectedWithShade = 0.1 + growthNoShade * 0.6 - death;
      const expectedWithoutShade = 0.1 + growthNoShade - death;
      expect(withShade).toBeCloseTo(expectedWithShade, 5);
      expect(withoutShade).toBeCloseTo(expectedWithoutShade, 5);
    });
    it('litterBoost multiplies the litter added by that species death', () => {
      const n = 1;
      const boosted = { ...grass, diffusion: 0, litterBoost: 2 };
      const plain = { ...grass, diffusion: 0 };
      const run = (d: SpeciesDef) => {
        const litter = new Float32Array(1);
        const p = { grass: new Float32Array([0.5]) };
        const s = new Float32Array(n);
        stepVegetation(p, s, { ...env(n), litter }, [d], 1);
        return litter[0];
      };
      const litterBoosted = run(boosted);
      const litterPlain = run(plain);
      expect(litterBoosted).toBeCloseTo(litterPlain * 2, 6);
    });
    it('absent shade/litterBoost fields give identical results to a run without any M8-10 species present', () => {
      const n = 4;
      const litterA = new Float32Array(n);
      const litterB = new Float32Array(n);
      const pA = { grass: new Float32Array(n).fill(0.2) };
      // belltree 相当の種を同じ環境に足すが、密度は 0 のまま (放流していない状態を模す)。
      // shade/litterBoost を持つ種が存在しても、密度 0 なら他種の結果に一切影響しないはず
      const belltreeLike: SpeciesDef = {
        id: 'belltree', name: '鐘樹', trophic: 'plant', growthRate: 0.005, mortality: 0.0026,
        tempRange: [2, 26], moistureRange: [0.4, 1], diffusion: 0.005, shade: 0.8, litterBoost: 2,
        assetId: 'belltree', color: '#3E8E6A',
      };
      const pB = { grass: new Float32Array(n).fill(0.2), belltree: new Float32Array(n) };
      const sA = new Float32Array(n);
      const sB = new Float32Array(n);
      for (let k = 0; k < 100; k++) {
        stepVegetation(pA, sA, { ...env(n), litter: litterA }, [grass], 2);
        stepVegetation(pB, sB, { ...env(n), litter: litterB }, [grass, belltreeLike], 2);
      }
      for (let i = 0; i < n; i++) {
        expect(pB.grass[i]).toBeCloseTo(pA.grass[i], 9);
        expect(litterB[i]).toBeCloseTo(litterA[i], 9);
        expect(pB.belltree[i]).toBe(0);
      }
    });
  });
});
