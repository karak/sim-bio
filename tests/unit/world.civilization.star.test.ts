import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { MINE_RATE, NEED } from '../../src/simulation/civilization';
import { STAR_FAITH } from '../../src/simulation/civilizationLoad';
import { testConfig } from './helpers';

/**
 * 星の門 (M10-02): 塔 (6) → 星 (7) は半径 12 の民 ≥ POP_NEED[7] かつ信仰 ≥ STAR_FAITH のときだけ。
 * 草の文明 (草は島中にあるので民の条件は満たす) で、信仰だけを変えて上がる・上がらないを見る。
 * 薪の蓄えを持たせて燃料切れの段階下げ (M8-08) と競合しないようにする。
 */
function bestCrystalCell(): number {
  const w = World.create(testConfig(), { log: createMemorySink() });
  const s = w.snapshot();
  let best = -1;
  let bv = -1;
  for (let i = 0; i < s.layers.crystal.length; i++) if (s.layers.crystal[i] > bv) { bv = s.layers.crystal[i]; best = i; }
  return best;
}
/** NEED[6] を MINE_RATE[6] で掘り切るのに要る tick 数 + 1 年 (年次更新の populationStar を確実に通す) */
const ticksToFill = Math.ceil(NEED[6] / MINE_RATE[6]) + 360;

describe('星の門 (M10-02)', () => {
  it('信仰が STAR_FAITH 未満なら、進みが満ちても塔のまま (進みは NEED で頭打ち)', () => {
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 6, home: bestCrystalCell(), fuelStock: 500, faith: 0.5 } } }), { log });
    w.step(ticksToFill);
    const civ = w.snapshot().civ!;
    expect(civ.stage).toBe(6);
    expect(civ.progress).toBeCloseTo(NEED[6], 6);
    expect((civ.populationStar ?? 0) >= 4).toBe(true);
    expect(log.find('sim.civ.stage').filter((e) => e.to === 7)).toHaveLength(0);
  });
  it('信仰が STAR_FAITH 以上で半径 12 の民が足りれば星に上がり、sim.civ.stage (6 → 7) が出る', () => {
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 6, home: bestCrystalCell(), fuelStock: 500, faith: 1 } } }), { log });
    w.step(ticksToFill);
    const civ = w.snapshot().civ!;
    expect(civ.stage).toBe(7);
    expect(civ.faith).toBeGreaterThanOrEqual(STAR_FAITH);
    const ev = log.find('sim.civ.stage').find((e) => e.to === 7);
    expect(ev).toBeDefined();
    expect(ev!.from).toBe(6);
  });
  it('populationStar は支え半径の民以上で、save/restore で往復する', () => {
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 6, home: bestCrystalCell(), fuelStock: 500 } } }), { log: createMemorySink() });
    w.step(360);
    const civ = w.snapshot().civ!;
    expect(civ.populationStar).toBeGreaterThanOrEqual(civ.population);
    const r = World.restore(w.serialize(), { log: createMemorySink() });
    expect(r.snapshot().civ!.populationStar).toBeCloseTo(civ.populationStar!, 6);
  });
});
