import { describe, it, expect } from 'vitest';
import { computeVeinLoss, veinFactor, VEIN_LOSS, VEIN_BLUR } from '../../src/simulation/vein';
import { BASE_DECOMPOSITION, DECOMPOSER_BOOST, stepVitality, type VitalityState } from '../../src/simulation/vitality';
import type { SpeciesDef } from '../../src/simulation/types';

const moss: SpeciesDef = {
  id: 'moss', name: '胞子苔', trophic: 'decomposer', growthRate: 2, mortality: 0.01, predation: 0.08, handlingTime: 5,
  tempRange: [0, 30], moistureRange: [0.55, 1], diffusion: 0.03, eats: [], assetId: 'moss', color: '#8FD3C4',
};

describe('computeVeinLoss (M9-03 霊脈)', () => {
  const size = 9;
  const n = size * size;
  const land = () => new Float32Array(n).fill(0.5);
  const center = 4 * size + 4;

  it('掘っていなければ (crystal = crystal0) 全セル 0', () => {
    const c0 = new Float32Array(n);
    c0[center] = 0.8;
    const out = new Float32Array(n).fill(0.7);
    computeVeinLoss(c0.slice(), c0, land(), size, out);
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('輝石が無かった土地 (crystal0 = 0) は、島の他所を掘り尽くしても半径 VEIN_BLUR の外なら 0 のまま', () => {
    const c0 = new Float32Array(n);
    c0[0] = 1; // 左上に鉱脈
    const crystal = new Float32Array(n); // 掘り尽くした
    const out = new Float32Array(n);
    computeVeinLoss(crystal, c0, land(), size, out);
    expect(out[0]).toBe(1);
    expect(out[n - 1]).toBe(0); // 右下は遠い
    expect(out[VEIN_BLUR]).toBe(1); // 半径内は鉱脈セルの枯渇の平均 (鉱脈が 1 セルだけなので 1)
    expect(out[VEIN_BLUR + 1]).toBe(0);
  });

  it('半分掘れば枯渇 0.5。過剰に増えた輝石 (crystal > crystal0) は 0 にクランプ', () => {
    const c0 = new Float32Array(n);
    c0[center] = 0.8;
    const crystal = new Float32Array(n);
    crystal[center] = 0.4;
    const out = new Float32Array(n);
    computeVeinLoss(crystal, c0, land(), size, out);
    expect(out[center]).toBeCloseTo(0.5, 6);
    crystal[center] = 1.0;
    computeVeinLoss(crystal, c0, land(), size, out);
    expect(out[center]).toBe(0);
  });

  it('海セルは常に 0', () => {
    const c0 = new Float32Array(n);
    c0[center] = 1;
    const elevation = land();
    elevation[center + 1] = 0; // 隣が海
    const out = new Float32Array(n);
    computeVeinLoss(new Float32Array(n), c0, elevation, size, out);
    expect(out[center + 1]).toBe(0);
    expect(out[center]).toBe(1);
  });
});

describe('veinFactor と分解率 (M9-03)', () => {
  it('veinFactor は [1 − VEIN_LOSS, 1]', () => {
    expect(veinFactor(0)).toBe(1);
    expect(veinFactor(1)).toBeCloseTo(1 - VEIN_LOSS, 9);
    expect(veinFactor(0.5)).toBeCloseTo(1 - VEIN_LOSS / 2, 9);
  });

  it('レバー感度: 霊脈が枯れた土地では苔がいても分解者の効きが (1 − VEIN_LOSS) 倍に落ち、基礎分解は落ちない', () => {
    const mk = (): VitalityState => ({
      elevation: new Float32Array(1).fill(0.5), vitality: new Float32Array(1), litter: new Float32Array(1).fill(1),
      populations: { moss: new Float32Array(1).fill(0.5) },
    });
    const healthy = mk();
    const dead = mk();
    dead.veinLoss = new Float32Array(1).fill(1);
    stepVitality(healthy, [moss], new Float32Array(1), 1);
    stepVitality(dead, [moss], new Float32Array(1), 1);
    const kHealthy = BASE_DECOMPOSITION + DECOMPOSER_BOOST * 0.5;
    const kDead = BASE_DECOMPOSITION + DECOMPOSER_BOOST * 0.5 * (1 - VEIN_LOSS);
    expect(1 - healthy.litter[0]).toBeCloseTo(kHealthy, 6);
    expect(1 - dead.litter[0]).toBeCloseTo(kDead, 6);
    expect(dead.vitality[0]).toBeLessThan(healthy.vitality[0]);
  });

  it('veinLoss を省略すれば今までどおり (既存の平衡を変えない)', () => {
    const a: VitalityState = { elevation: new Float32Array(1).fill(0.5), vitality: new Float32Array(1), litter: new Float32Array(1).fill(1), populations: { moss: new Float32Array(1).fill(0.5) } };
    const b: VitalityState = { ...a, vitality: new Float32Array(1), litter: new Float32Array(1).fill(1), veinLoss: new Float32Array(1) };
    stepVitality(a, [moss], new Float32Array(1), 1);
    stepVitality(b, [moss], new Float32Array(1), 1);
    expect(b.vitality[0]).toBe(a.vitality[0]);
  });
});
