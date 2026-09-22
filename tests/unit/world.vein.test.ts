import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { forEachInRadius } from '../../src/simulation/disaster';
import { SUPPORT_RADIUS, meanAround } from '../../src/simulation/civilization';
import { veinDepletion } from '../../src/simulation/vein';

/**
 * 霊脈の World 配線 (M9-03)。レベルデザイン docs/design/2026-09-21-level-design-faith.md §5 の感度・定着。
 * seed 42 / size 64 / 全種。集落 1770 は輝石の脈 (71 セル、29.7) の上 (LD §4.3)。石 (4) で始め、薪の蓄えで燃料を切り離す。
 * 信仰は 1.0 から始めて (減衰で 0.3 を割るのは 40 年後)、内乱が先に来ないようにする。
 */
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const SIZE = 64;
const HOME = 1770;
const mk = () => World.create({ ...base, size: SIZE, species, civilization: { speciesId: 'deer', start: { stage: 4, home: HOME, fuelStock: 600, faith: 1.0 } } }, { log: createMemorySink() });
const homeVein = (w: World): number => {
  let v = -1;
  forEachInRadius(HOME, 3, SIZE, (i) => { if (v < 0 && w.veins[i] >= 0) v = w.veins[i]; });
  return v;
};
const veinRatio = (w: World) => 1 - veinDepletion(w.snapshot().layers.crystal, w.crystal0, w.veins)[homeVein(w)];
const civVitality = (w: World) => { const s = w.snapshot(); return meanAround(s.layers.vitality, HOME, SUPPORT_RADIUS, s.layers.elevation, SIZE); };

describe('霊脈の感度と定着 (M9-03、size 64)', () => {
  it('レバー感度: 石の文明を脈の上に置いて放置すると、民は脈を辿って掘り、50 年で脈が 6 割未満・集落の生気が 0.65 未満に落ちる (実測 0.52 / 0.60)', { timeout: 300_000 }, () => {
    const w = mk();
    expect(veinRatio(w)).toBeCloseTo(1, 6);
    expect(civVitality(w)).toBeGreaterThan(0.5);
    w.step(360 * 50);
    expect(veinRatio(w)).toBeLessThan(0.6);
    expect(civVitality(w)).toBeLessThan(0.65);
    expect(civVitality(w)).toBeGreaterThan(0.4);
    // 定着: 脈が半分残っているうちに「止めよ」(信仰 0.7) → 10 年後も脈と生気が保たれる。掘り続ければ (苔を放っても) さらに落ちる
    const save0 = w.serialize();
    const save = structuredClone(save0);
    save.civ!.faith = 0.7;
    const stopped = World.restore(structuredClone(save), { log: createMemorySink() });
    stopped.dispatch({ type: 'civ_edict', edict: 'stop_mining' });
    // 苔だけの世界は放置の信仰 (減衰済み) のまま復元する。0.7 から始めると同じ苔の放流が儀式になって 2 年で 0.8 に達し、
    // 星の門 (M10-02: 半径 12 の民 4.0 + 信仰 0.8) を越えて星に上がり、星は掘らない (MINE_RATE[7] = 0) ので脈が減らなくなる
    const mossOnly = World.restore(structuredClone(save0), { log: createMemorySink() });
    const snap = mossOnly.snapshot();
    forEachInRadius(HOME, 6, SIZE, (i) => { if (snap.layers.elevation[i] >= 0.3 && i % 3 === 0) mossOnly.dispatch({ type: 'spawn_species', speciesId: 'moss', cell: i, amount: 0.5, radius: 1 }); });
    const ratioAtStop = veinRatio(stopped);
    const vitAtStop = civVitality(stopped);
    stopped.step(360 * 10);
    mossOnly.step(360 * 10);
    expect(veinRatio(stopped)).toBeCloseTo(ratioAtStop, 6);
    expect(civVitality(stopped)).toBeGreaterThan(vitAtStop - 0.05);
    expect(veinRatio(mossOnly)).toBeLessThan(ratioAtStop - 0.05);
    expect(civVitality(mossOnly)).toBeLessThan(vitAtStop - 0.05);
  });
});
