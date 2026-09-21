import { describe, it, expect } from 'vitest';
import { computeVeinLoss, labelVeins, veinCap, veinDepletion, veinFactor, VEIN_LOSS, VEIN_REACH } from '../../src/simulation/vein';
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

  it('輝石が無かった土地は、最寄りの脈から VEIN_REACH 歩以内ならその脈の枯渇を受け、届かなければ 0 のまま', () => {
    const c0 = new Float32Array(n);
    c0[0] = 1; // 左上に鉱脈
    const crystal = new Float32Array(n); // 掘り尽くした
    const out = new Float32Array(n);
    computeVeinLoss(crystal, c0, land(), size, out);
    expect(out[0]).toBe(1);
    expect(out[VEIN_REACH]).toBe(1); // 右へ 8 歩
    expect(out[VEIN_REACH * size]).toBe(1); // 下へ 8 歩
    expect(out[VEIN_REACH * size + 1]).toBe(0); // 9 歩
    expect(out[n - 1]).toBe(0); // 右下は 16 歩
  });

  it('脈 (labelVeins) を渡せば、掘ったセルだけでなく脈全体が同じ枯渇を受ける', () => {
    const elevation = land();
    const c0 = new Float32Array(n);
    // 左上から右へ 5 セル続く脈 A と、右下に離れた脈 B
    for (let x = 0; x < 5; x++) c0[x] = 1;
    c0[n - 1] = 1;
    const veins = labelVeins(c0, elevation, size);
    expect(veins[0]).toBe(veins[4]);
    expect(veins[n - 1]).not.toBe(veins[0]);
    expect(veins[10]).toBe(-1);
    const crystal = c0.slice();
    crystal[0] = 0; // 脈 A の左端だけ掘り尽くした (脈 A 全体の 2 割)
    const dep = veinDepletion(crystal, c0, veins);
    expect(dep[0]).toBeCloseTo(0.2, 6);
    expect(dep[1]).toBe(0);
    const out = new Float32Array(n);
    computeVeinLoss(crystal, c0, elevation, size, out, veins);
    expect(out[0]).toBeCloseTo(0.2, 6);
    expect(out[4]).toBeCloseTo(0.2, 6); // 掘っていないセルも脈全体の枯渇
    expect(out[n - 1]).toBe(0); // 脈 B は無傷
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

describe('霊脈は生気の器 (M9-03)', () => {
  it('veinCap は 1 − VEIN_LOSS × veinLoss (0 未満にならない)。stepVitality は生気をその上限で抑える', () => {
    expect(veinCap(0)).toBe(1);
    expect(veinCap(1)).toBeCloseTo(1 - VEIN_LOSS, 9);
    expect(veinCap(0.4)).toBeCloseTo(1 - VEIN_LOSS * 0.4, 9);
    const mk = (loss: number | undefined): VitalityState => ({
      elevation: new Float32Array(1).fill(0.5), vitality: new Float32Array(1).fill(1), litter: new Float32Array(1).fill(1),
      populations: { moss: new Float32Array(1).fill(1) }, ...(loss === undefined ? {} : { veinLoss: new Float32Array(1).fill(loss) }),
    });
    const free = mk(undefined);
    const half = mk(0.5);
    const gone = mk(1);
    stepVitality(free, [moss], new Float32Array(1), 1);
    stepVitality(half, [moss], new Float32Array(1), 1);
    stepVitality(gone, [moss], new Float32Array(1), 1);
    expect(free.vitality[0]).toBe(1);
    expect(half.vitality[0]).toBeCloseTo(veinCap(0.5), 6);
    expect(gone.vitality[0]).toBeCloseTo(veinCap(1), 6);
  });
});
