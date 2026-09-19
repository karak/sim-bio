import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { forEachInRadius } from '../../src/simulation/disaster';
import { LOAD_RADIUS } from '../../src/simulation/civilizationLoad';
import { testConfig, grass, moss } from './helpers';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

/** testConfig() の地形 (seed 42, size 32) の中心セル。既定のシナリオ開始地点と同じ規約 (resolveCivilizationStart) */
function centerHome(size: number): number {
  return Math.floor(size / 2) * size + Math.floor(size / 2);
}

/** home 半径内の陸セルで arr の値を合計する */
function sumInRadius(arr: Float32Array, home: number, radius: number, elevation: Float32Array, size: number): number {
  let sum = 0;
  forEachInRadius(home, radius, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) sum += arr[i];
  });
  return sum;
}

/** home 半径内の陸セルで arr の平均を取る */
function meanInRadius(arr: Float32Array, home: number, radius: number, elevation: Float32Array, size: number): number {
  let sum = 0;
  let count = 0;
  forEachInRadius(home, radius, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) {
      sum += arr[i];
      count++;
    }
  });
  return count ? sum / count : 0;
}

/** 個体が一切放たれず、常に個体数 0 のままの種。衰退・崩壊のテスト専用 */
const ghostDeer: SpeciesDef = {
  id: 'ghostDeer', name: '幻の鹿', trophic: 'herbivore', growthRate: 0.5, mortality: 0.05,
  tempRange: [0, 30], moistureRange: [0.2, 0.9], diffusion: 0.1, eats: ['grass'], predation: 0.05,
  assetId: 'deer', color: '#E2B45A',
};

describe('World civilization load & decline (M8-03)', () => {
  it('stage 6 の文明は集落周りの森を control (文明なし) より減らす', () => {
    const size = 32;
    const home = centerHome(size);
    const base: Partial<WorldConfig> = { size };
    const civ = World.create(testConfig({ ...base, civilization: { speciesId: 'grass', start: { stage: 6, home } } }), { log: createMemorySink() });
    const control = World.create(testConfig(base), { log: createMemorySink() });
    // 1 年未満 (ticksPerYear=360) にとどめ、衰退・段階変化を挟まずに負荷だけを見る
    const ticks = 300;
    civ.step(ticks);
    control.step(ticks);
    const civSnap = civ.snapshot();
    const controlSnap = control.snapshot();
    const radius = LOAD_RADIUS[6];
    const civForest = sumInRadius(civSnap.layers.populations.forest, home, radius, civSnap.layers.elevation, size);
    const controlForest = sumInRadius(controlSnap.layers.populations.forest, home, radius, controlSnap.layers.elevation, size);
    expect(civForest).toBeLessThan(controlForest);
  });

  it('stage 6 の文明は集落周りの生気を control より下げる', () => {
    const size = 32;
    const home = centerHome(size);
    const base: Partial<WorldConfig> = { size };
    const civ = World.create(testConfig({ ...base, civilization: { speciesId: 'grass', start: { stage: 6, home } } }), { log: createMemorySink() });
    const control = World.create(testConfig(base), { log: createMemorySink() });
    const ticks = 300;
    civ.step(ticks);
    control.step(ticks);
    const civSnap = civ.snapshot();
    const controlSnap = control.snapshot();
    const radius = LOAD_RADIUS[6];
    const civVitality = meanInRadius(civSnap.layers.vitality, home, radius, civSnap.layers.elevation, size);
    const controlVitality = meanInRadius(controlSnap.layers.vitality, home, radius, controlSnap.layers.elevation, size);
    expect(civVitality).toBeLessThan(controlVitality);
  });

  it('人口がほぼ 0 の種の文明は population 理由で衰退を重ね、stage 0 で崩壊する', () => {
    const size = 32;
    const home = centerHome(size);
    const log = createMemorySink();
    const w = World.create(
      testConfig({ size, species: [ghostDeer], civilization: { speciesId: 'ghostDeer', start: { stage: 3, home } } }),
      { log },
    );
    expect(w.snapshot().civ?.population).toBe(0);
    // 個体数 0 なので毎年 population 理由で衰退圧がかかる。輝石の採掘 (M8-02) は home 周りの残量が
    // 尽きるまで一時的に段階を押し上げうるが、輝石は再生しないのでいずれ衰退が追いつき崩壊する
    w.step(360 * 8);
    // sim.civ.stage は採掘による上昇 (M8-02、reason 無し) にも出るので、衰退 (reason 付き) だけを見る
    const declineEvents = log.find('sim.civ.stage').filter((r) => (r as { reason?: string }).reason !== undefined);
    expect(declineEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of declineEvents) {
      expect((e as { reason?: string }).reason).toBe('population');
    }
    const collapsed = log.find('sim.civ.collapsed');
    expect(collapsed).toHaveLength(1);
    expect((collapsed[0] as { reason?: string }).reason).toBe('population');
    const snap = w.snapshot();
    expect(snap.civ?.stage).toBe(0);
    expect(snap.civ?.home).toBe(-1);
  });

  it('forest 種の無い世界でも生気の負荷はかかる (guard)', () => {
    const size = 32;
    const home = centerHome(size);
    const civ = World.create(
      testConfig({ size, species: [grass, moss], civilization: { speciesId: 'grass', start: { stage: 6, home } } }),
      { log: createMemorySink() },
    );
    const control = World.create(testConfig({ size, species: [grass, moss] }), { log: createMemorySink() });
    expect(() => civ.step(50)).not.toThrow();
    const radius = LOAD_RADIUS[6];
    const civVitality = meanInRadius(civ.snapshot().layers.vitality, home, radius, civ.snapshot().layers.elevation, size);
    control.step(50);
    const controlVitality = meanInRadius(control.snapshot().layers.vitality, home, radius, control.snapshot().layers.elevation, size);
    expect(civVitality).toBeLessThan(controlVitality);
  });
});
