import { describe, it, expect } from 'vitest';
import { CIV_VITALITY_LOW, FAITH_LOW, scenarioWarnings, speciesInCondition } from '../../src/scenario/warnings';
import type { ScenarioDef, StartStats } from '../../src/scenario/types';
import type { WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

const deer = { ...grass, id: 'deer', name: '鹿' };
const snap = (over: { totals?: Record<string, number>; land?: number[]; civ?: { stage: number; fuel?: { stock: number; need: number; debt: number } } | null } = {}): WorldSnapshot => {
  const elevation = Float32Array.from(over.land ?? [0.5, 0.5, 0.5, 0.1]);
  const n = elevation.length;
  // civ_declining のテスト用に、段階だけ指定できる簡易な CivState を組み立てる (他のフィールドは評価に使わないので既定値)
  const civ = over.civ
    ? { speciesId: 'deer', stage: over.civ.stage, progress: 0, home: -1, population: 0, ...(over.civ.fuel ? { fuel: { last: 0, shortYears: 0, ...over.civ.fuel } } : {}) }
    : null;
  return {
    tick: 0, year: 0, dayOfYear: 0, size: 2, species: [grass, deer], meanTemperature: 10, co2: 280, climate: { tempOffset: 0, rainScale: 1 }, civ, volcanoCell: 0,
    totals: over.totals ?? { grass: 10, deer: 4, wolf: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n), deer: new Float32Array(n) } },
  };
};
const start: StartStats = { landRatio: 0.75, totals: { grass: 10, deer: 4, wolf: 1 } };
const def: ScenarioDef = {
  id: 'w', title: 'w', prophecy: 'p', kind: 'endure', years: 10, schedule: [],
  alive: { type: 'all', of: [{ type: 'species_alive', ids: ['deer'] }, { type: 'total_ratio_vs_start', id: 'grass', min: 1 }] },
  budget: { start: 10, incomePerYear: 4, costs: { spawn: 3, disaster: 5, climate: 1 }, upkeepPerYear: { rainScale: 10, tempOffset: 2 } },
};

describe('scenarioWarnings', () => {
  it('speciesInCondition は alive 条件が参照する種だけを集める', () => {
    expect(speciesInCondition(def.alive)).toEqual(['deer', 'grass']);
    expect(speciesInCondition({ type: 'land_ratio', min: 0.1 })).toEqual([]);
  });
  it('species_low: 基準の 25% 未満の種に、名前と割合を入れて出す。関係ない種 (wolf) は出さない', () => {
    const ws = scenarioWarnings(def, snap({ totals: { grass: 10, deer: 0.8, wolf: 0 } }), start, null);
    expect(ws.map((w) => w.kind)).toEqual(['species_low']);
    expect(ws[0]).toMatchObject({ id: 'deer', key: 'species_low:deer' });
    expect(ws[0].text).toBe('鹿が減っている(基準の 20%)');
    expect(scenarioWarnings(def, snap({ totals: { grass: 10, deer: 1.2, wolf: 0 } }), start, null)).toEqual([]);
  });
  it('land_low: 陸地率が基準の半分未満で出す', () => {
    const ws = scenarioWarnings(def, snap({ land: [0.5, 0.1, 0.1, 0.1] }), start, null);
    expect(ws.map((w) => w.kind)).toEqual(['land_low']);
    expect(ws[0].text).toBe('陸が減っている(基準の 33%)');
    expect(scenarioWarnings(def, snap({ land: [0.5, 0.5, 0.1, 0.1] }), start, null)).toEqual([]);
  });
  it('power_low: どのコマンドも買えないときだけ出す', () => {
    expect(scenarioWarnings(def, snap(), start, { power: 0.5, max: 30, incomeLastYear: 2, upkeepLastYear: 0 }).map((w) => w.text)).toEqual(['力が足りない(残り 0)']);
    expect(scenarioWarnings(def, snap(), start, { power: 1, max: 30, incomeLastYear: 2, upkeepLastYear: 0 })).toEqual([]);
    // budget のないシナリオでは力の警告は出ない
    expect(scenarioWarnings({ ...def, budget: undefined }, snap(), start, { power: 0, max: 30, incomeLastYear: 0, upkeepLastYear: 0 })).toEqual([]);
  });
  it('upkeep_over_income: 直前の年の維持費が収入を超えているときに出す', () => {
    const ws = scenarioWarnings(def, snap(), start, { power: 5, max: 30, incomeLastYear: 3.2, upkeepLastYear: 5 });
    expect(ws.map((w) => w.kind)).toEqual(['upkeep_over_income']);
    expect(ws[0].text).toBe('維持費が収入を超えている(−5.0/年 > +3.2/年)');
    expect(scenarioWarnings(def, snap(), start, { power: 5, max: 30, incomeLastYear: 5, upkeepLastYear: 5 })).toEqual([]);
  });
  it('power_capped: 上限に達していて収入があるときに出す。収入 0 (最初の年) では出さない', () => {
    expect(scenarioWarnings(def, snap(), start, { power: 30, max: 30, incomeLastYear: 2, upkeepLastYear: 0 }).map((w) => w.text)).toEqual(['力が上限(30)に達している。使わなければ収入は捨てられる']);
    expect(scenarioWarnings(def, snap(), start, { power: 29, max: 30, incomeLastYear: 2, upkeepLastYear: 0 })).toEqual([]);
    expect(scenarioWarnings(def, snap(), start, { power: 30, max: 30, incomeLastYear: 0, upkeepLastYear: 0 })).toEqual([]);
  });
  it('ignoreWarnings にある種類は出さない (沈む欠片の陸の減少)', () => {
    const s = snap({ totals: { grass: 1, deer: 0, wolf: 0 }, land: [0.5, 0.1, 0.1, 0.1] });
    expect(scenarioWarnings(def, s, start, null).map((w) => w.kind)).toEqual(['species_low', 'species_low', 'land_low']);
    expect(scenarioWarnings({ ...def, ignoreWarnings: ['land_low'] }, s, start, null).map((w) => w.kind)).toEqual(['species_low', 'species_low']);
  });
  it('複数同時に出るときは 種 → 陸 → 力 の順', () => {
    const ws = scenarioWarnings(def, snap({ totals: { grass: 1, deer: 0, wolf: 0 }, land: [0.5, 0.1, 0.1, 0.1] }), start, { power: 0, max: 30, incomeLastYear: 1, upkeepLastYear: 2 });
    expect(ws.map((w) => w.kind)).toEqual(['species_low', 'species_low', 'land_low', 'power_low', 'upkeep_over_income']);
  });
  it('civ_declining: civ 引数を渡し、段階が前年より下がっていれば出す', () => {
    const s = snap({ civ: { stage: 5 } });
    expect(scenarioWarnings(def, s, start, null, { prevStage: 6 }).map((w) => w.kind)).toEqual(['civ_declining']);
    expect(scenarioWarnings(def, s, start, null, { prevStage: 6 })[0].text).toBe('文明が衰えている(段階 6 → 5)');
  });
  it('civ_declining: 段階が下がっていない、または civ を渡さないときは出さない', () => {
    const s = snap({ civ: { stage: 6 } });
    expect(scenarioWarnings(def, s, start, null, { prevStage: 6 })).toEqual([]);
    expect(scenarioWarnings(def, s, start, null)).toEqual([]);
    // civ が無い (null) スナップショットは段階 0 扱いなので、前年 1 なら下がったことになる
    const s0 = snap({ civ: null });
    expect(scenarioWarnings(def, s0, start, null, { prevStage: 1 }).map((w) => w.kind)).toEqual(['civ_declining']);
  });
  it('fuel_low: 蓄えが 1 年分を割れば「心細い」、負債があれば「足りない(不足 N 年分)」。蓄えが足りていれば出さない (M8-06)', () => {
    const ok = snap({ civ: { stage: 6, fuel: { stock: 12, need: 6, debt: 0 } } });
    expect(scenarioWarnings(def, ok, start, null)).toEqual([]);
    const low = snap({ civ: { stage: 6, fuel: { stock: 4, need: 6, debt: 0 } } });
    expect(scenarioWarnings(def, low, start, null).map((w) => [w.kind, w.text])).toEqual([['fuel_low', '塔の燃料が心細い(蓄え 4 / 年に 6)']]);
    const debt = snap({ civ: { stage: 6, fuel: { stock: 0, need: 6, debt: 9 } } });
    expect(scenarioWarnings(def, debt, start, null).map((w) => w.text)).toEqual(['塔の燃料が足りない(不足 1.5 年分。3 年分で一段崩れる)']);
    // 燃料の要らない段階 (need 0) では出さない
    const none = snap({ civ: { stage: 2, fuel: { stock: 0, need: 0, debt: 0 } } });
    expect(scenarioWarnings(def, none, start, null)).toEqual([]);
  });
});

describe('faith_low (M9-03)', () => {
  it('信仰が FAITH_LOW 未満なら出す。ちょうど FAITH_LOW、信仰が無い (未発生)、文明が無いときは出さない', () => {
    const low = snap({ civ: { stage: 3 } });
    low.civ!.faith = FAITH_LOW - 0.01;
    expect(scenarioWarnings(def, low, start, null).map((w) => [w.kind, w.text])).toEqual([['faith_low', `民の信仰が揺らいでいる(${(FAITH_LOW - 0.01).toFixed(2)}。0.3 を 3 年割れば内乱)`]]);
    const edge = snap({ civ: { stage: 3 } });
    edge.civ!.faith = FAITH_LOW;
    expect(scenarioWarnings(def, edge, start, null)).toEqual([]);
    expect(scenarioWarnings(def, snap({ civ: { stage: 3 } }), start, null)).toEqual([]);
    expect(scenarioWarnings(def, snap({ civ: null }), start, null)).toEqual([]);
  });
});

describe('civ_vitality_low (M9-05)', () => {
  it('集落の生気が CIV_VITALITY_LOW 未満なら出す。ちょうど、未設定、stage 0 では出さない', () => {
    const low = snap({ civ: { stage: 4 } });
    low.civ!.vitality = 0.29;
    expect(scenarioWarnings(def, low, start, null).map((w) => [w.kind, w.text])).toEqual([['civ_vitality_low', '集落の生気が痩せている(29%。霊脈が細ると苔を放っても戻らない)']]);
    const edge = snap({ civ: { stage: 4 } });
    edge.civ!.vitality = CIV_VITALITY_LOW;
    expect(scenarioWarnings(def, edge, start, null)).toEqual([]);
    expect(scenarioWarnings(def, snap({ civ: { stage: 4 } }), start, null)).toEqual([]);
  });
});
