import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { forEachInRadius } from '../../src/simulation/disaster';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

/**
 * M8-09: 炎蜥蜴 (熱でしか増えない肉食)。
 *
 * パラメータの根拠 (scratch スクリプトによる実測、2026-09-20):
 * - 既定の島 (assets/data/world.default.json, size 128・64 とも) で、噴火なしの自然な陸セルの最高気温は
 *   5 年 (size 128) / 3 年 (size 64) を通じて 25.48℃ が上限 (季節・緯度・標高のみで決まり、年をまたいでも変わらない)。
 * - 陸セルの中で最も自然気温が高いセル (size 128, seed 42) はセル index 13108、tick 90 (年内 90 日目) に 25.48℃ に達する。
 *   このセル・タイミングで火山を 1 回噴くと、直後に半径 3 以内の最高気温が 31.48℃ まで跳ね上がり (tempRange 下限 30 を超える)、
 *   噴火から 90 日後には 22.64℃ まで落ちて (下限 30 − TEMP_EDGE 5 = 25 を下回り) 住みやすさは 0 に戻る。
 * - tempRange を [30, 80] にすると、自然の最高気温 25.48℃ では住みやすさ ≈ 0.096 (わずかに残るが、年の 1 日だけの瞬間値で
 *   残り 359 日はほぼ 0 なので、死亡率 (mortality) が上回り実質絶滅する)。噴火直後は住みやすさ 1 になり爆発的に増える。
 * - growthRate 6 / predation 1 / handlingTime 3 / mortality 0.005 で実測したところ (半径 3 平均密度):
 *   噴火前 (tick 90) 0.00084 → 噴火後 tick 60 で 0.0087 (ピーク、約 10 倍) → tick 360 で 0.00006 → tick 540 で 0 (絶滅)。
 *   同じ半径の鹿は噴火前 0.0174 → tick 360 で 0.0020 (約 88% 減、基準の 5 割を大きく割る)。
 *
 * M8-05 v2 (2026-09-21) の再測定 (minHeat 1.0 / growthRate 4 / mortality 0.0015 / diffusion 0.3、VOLCANO_HEAT 6、半減期 1 年):
 * - 熱の門は heat/minHeat で成長にだけ掛かるので、熱が 1 を割っても (噴火 2.6 年後) 門が 0.3 程度ある間は増減が拮抗し、
 *   半径 3 の平均密度は y1 0.014 → y2 0.010 → y3 0.024 → y4 0.026 → y5 0.008 → y6 0.005 → y7 0.0006 → y8 0 (総量も 0)。
 * - ピーク (半径 3 平均) は 0.036 (2 年以内) / 0.053 (4 年以内)。鹿は半径 5 の平均で噴火前 0.027 → 最小 0.0014 (95% 減)。
 * - つまり「熱が冷めれば消える」は 3 年ではなく 7〜8 年の尺度で成り立つ。テストは噴火 8 年後にピークの 1 割未満を確認する。
 */
describe('firelizard (M8-09)', () => {
  const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
  const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
  const lizard = species.find((s) => s.id === 'firelizard');

  it('is defined as a non-spawnable carnivore that eats deer, gated by heat', () => {
    expect(lizard).toBeDefined();
    expect(lizard?.trophic).toBe('carnivore');
    expect(lizard?.eats).toEqual(['deer']);
    expect(lizard?.spawnable).toBe(false);
    // M8-05 v2: 気温ではなく熱 (minHeat) で門を掛ける。気温帯は広く取り、熱の無い場所では増えない
    expect(lizard?.minHeat).toBeGreaterThan(0);
    expect(lizard?.initialDensity).toBe(0);
  });

  it('heat 0 の島では数年で絶滅する (総量が 0 に近づく)', { timeout: 60_000 }, () => {
    const w = World.create({ ...base, size: 64, species }, { log: createMemorySink() });
    for (let y = 0; y < 6; y++) w.step(360);
    const t = w.snapshot().totals;
    // MIN_DENSITY 未満のセルは 0 に丸められるので、熱が無ければ厳密に 0 まで落ちる
    expect(t.firelizard).toBe(0);
  });

  it('火山の噴火後、半径 3 で炎蜥蜴が湧き鹿が減る (副作用テスト)', { timeout: 60_000 }, () => {
    const w = World.create({ ...base, species }, { log: createMemorySink() });
    const size = base.size;
    // scratch 測定で見つけた、陸セルの中で自然気温が最も高いセル (size 128, seed 42)
    const cell = 13108;
    const radius = 3;
    const s0 = w.snapshot();
    expect(s0.layers.elevation[cell]).toBeGreaterThanOrEqual(SEA_LEVEL);
    const cellsInRadius: number[] = [];
    forEachInRadius(cell, radius, size, (i) => {
      if (s0.layers.elevation[i] >= SEA_LEVEL) cellsInRadius.push(i);
    });
    const avg = (pop: Float32Array): number => cellsInRadius.reduce((sum, i) => sum + pop[i], 0) / cellsInRadius.length;

    // 自然気温がその年で最も高くなる tick 90 まで熱無しで進めてから噴火させる (火の効果が最大化されるタイミング)
    for (let t = 0; t < 90; t++) w.step(1);
    const before = w.snapshot();
    const deerBefore = avg(before.layers.populations.deer);

    w.dispatch({ type: 'disaster', kind: 'volcano', cell, radius });
    // 2 年、日次で炎蜥蜴のピーク密度と鹿の最小密度を追う (実測ではピークは噴火から約 60 日後)
    let lizardPeak = 0;
    let deerMin = deerBefore;
    for (let t = 0; t < 360 * 2; t++) {
      w.step(1);
      const s = w.snapshot();
      lizardPeak = Math.max(lizardPeak, avg(s.layers.populations.firelizard));
      deerMin = Math.min(deerMin, avg(s.layers.populations.deer));
    }
    // 湧く: 噴火前の密度 (seed が自然減衰した約 0.00084) の 5 倍以上に増える
    expect(lizardPeak).toBeGreaterThan(0.005);
    // 鹿が減る: 噴火前の半分を割る
    expect(deerMin).toBeLessThan(deerBefore * 0.5);

    // 熱が冷めた後 (3 年目) には炎蜥蜴がほぼ消える
    // M8-05 v2: 熱の門は徐々に閉じるので、消えるのは 7〜8 年の尺度 (上の再測定を参照)。噴火 8 年後にピークの 1 割未満を確認する
    for (let t = 0; t < 360 * 6; t++) w.step(1);
    const after8y = w.snapshot();
    const lizardAfter8y = avg(after8y.layers.populations.firelizard);
    expect(lizardAfter8y).toBeLessThan(lizardPeak * 0.1);
  });
});
