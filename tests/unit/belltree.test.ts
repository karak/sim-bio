import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { forEachInRadius } from '../../src/simulation/disaster';
import { suitability } from '../../src/simulation/vegetation';
import { testConfig } from './helpers';
import type { SpeciesDef } from '../../src/simulation/types';

/** 実データの species.json をそのまま使う (他の種との容量競合・被食まで込みで確かめるため) */
const allSpecies = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const belltree = allSpecies.find((s) => s.id === 'belltree')!;

const landCells = (w: World): number[] => {
  const s = w.snapshot();
  const out: number[] = [];
  for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) out.push(i);
  return out;
};

/** 互いに距離 > 2 (半径 1 の放流が重ならない) で、鐘樹に適した (適合度 > 0.95) 陸セルを n 個選ぶ */
const pickSpreadOutGoodCells = (w: World, n: number): number[] => {
  const s = w.snapshot();
  const size = s.size;
  const good = landCells(w).filter((i) => suitability(belltree, s.layers.temperature[i], s.layers.moisture[i]) > 0.95);
  const centers: number[] = [];
  for (const i of good) {
    const x = i % size;
    const y = (i - x) / size;
    const farEnough = centers.every((c) => {
      const cx = c % size;
      const cy = (c - cx) / size;
      return Math.hypot(x - cx, y - cy) > 2;
    });
    if (farEnough) centers.push(i);
    if (centers.length === n) break;
  }
  return centers;
};

describe('鐘樹 (belltree, M8-10)', () => {
  it('定着: 5 か所に amount 0.5 radius 1 で放った鐘樹が、10 年後も放流量の 5 割以上残る', { timeout: 30_000 }, () => {
    const w = World.create(testConfig({ species: allSpecies, size: 48 }), { log: createMemorySink() });
    const centers = pickSpreadOutGoodCells(w, 5);
    expect(centers.length).toBe(5);
    const size = w.snapshot().size;
    const elevation = w.snapshot().layers.elevation;
    // 放流量 = 各中心の半径 1 (プラス形、最大 5 セル) の陸セルに乗る amount の合計。初期密度 0 なので上限 1 には当たらない
    let spawned = 0;
    for (const c of centers) {
      forEachInRadius(c, 1, size, (i) => {
        if (elevation[i] >= 0.3) spawned += 0.5;
      });
      w.dispatch({ type: 'spawn_species', speciesId: 'belltree', cell: c, amount: 0.5, radius: 1 });
    }
    w.step(360 * 10);
    const after = w.snapshot().totals.belltree;
    // 実測 (size 48, seed 42): spawned 9, after ≈ 6.99 (残存率 ≈ 78%)。作業ログに記録
    expect(after).toBeGreaterThanOrEqual(spawned * 0.5);
  });

  it('副作用: 陸の 3 割に鐘樹を植えると、20 年後の鹿の総量が対照世界の 7 割を割る', { timeout: 180_000 }, () => {
    const cfg = testConfig({ species: allSpecies, size: 48 });
    const w = World.create(cfg, { log: createMemorySink() });
    const ctl = World.create(cfg, { log: createMemorySink() });
    const land = landCells(w);
    const targetCount = Math.round(land.length * 0.3);
    const step = land.length / targetCount;
    for (let k = 0; k < targetCount; k++) {
      const c = land[Math.floor(k * step)];
      w.dispatch({ type: 'spawn_species', speciesId: 'belltree', cell: c, amount: 0.5 });
    }
    w.step(360 * 20);
    ctl.step(360 * 20);
    const deerTreat = w.snapshot().totals.deer;
    const deerCtl = ctl.snapshot().totals.deer;
    // 実測 (size 48, seed 42, 陸 576 セル中 173 セル [30%] に植樹): deerTreat ≈ 0.11, deerCtl ≈ 15.67 (比 ≈ 0.7%)。作業ログに記録
    expect(deerTreat).toBeLessThanOrEqual(deerCtl * 0.7);
  });
});
