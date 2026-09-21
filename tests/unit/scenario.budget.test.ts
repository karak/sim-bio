import { describe, it, expect } from 'vitest';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

/**
 * 星の力 (介入の予算) の性質。
 * 陸地率と生気を固定した偽の world で、値段・収入・維持費・枯渇を確かめる。
 */
const fakeWorld = (opts: { landRatio?: number; vitality?: number; rainScale?: number; tempOffset?: number; civStage?: number; civFaith?: number } = {}) => {
  let tick = 0;
  const cmds: Command[] = [];
  const size = 4;
  const n = size * size;
  const landCells = Math.round((opts.landRatio ?? 1) * n);
  const elevation = new Float32Array(n).fill(0.1);
  for (let i = 0; i < landCells; i++) elevation[i] = 0.5;
  const climate = { rainScale: opts.rainScale ?? 1, tempOffset: opts.tempOffset ?? 0 };
  // 文明の段階 (M8-04)。テストから setCivStage で年をまたいで変えて timeline を確かめる
  let civStage = opts.civStage ?? 0;
  // 信仰 (M9-01)。テストから setCivFaith で年をまたいで変えて civ_faith の timeline を確かめる。省略時は undefined (未設定)
  let civFaith = opts.civFaith;
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { ...climate }, totals: { grass: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n).fill(opts.vitality ?? 1), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
    civ: civStage > 0 ? { speciesId: 'deer', stage: civStage, progress: 0, home: 0, population: 0, ...(civFaith !== undefined ? { faith: civFaith } : {}) } : null,
    volcanoCell: 0,
  });
  const dispatch = (c: Command) => {
    cmds.push(c);
    if (c.type === 'set_climate') {
      if (c.rainScale !== undefined) climate.rainScale = c.rainScale;
      if (c.tempOffset !== undefined) climate.tempOffset = c.tempOffset;
    }
  };
  return {
    dispatch, snapshot, step: (t: number) => { tick += t; }, cmds,
    setCivStage: (s: number) => { civStage = s; },
    setCivFaith: (f: number) => { civFaith = f; },
  };
};

const base: ScenarioDef = {
  id: 'b', title: 'b', prophecy: 'p', kind: 'endure', years: 50, referenceSize: 4, schedule: [],
  alive: { type: 'species_alive', ids: ['grass'] },
};
const withBudget = (over: Partial<NonNullable<ScenarioDef['budget']>> = {}): ScenarioDef => ({
  ...base,
  budget: { start: 10, incomePerYear: 4, costs: { spawn: 3, disaster: 5, climate: 1 }, upkeepPerYear: { rainScale: 10, tempOffset: 2 }, ...over },
});
const spawn: Command = { type: 'spawn_species', speciesId: 'grass', cell: 0, amount: 0.1 };
const disaster: Command = { type: 'disaster', kind: 'plague', cell: 0, radius: 1 };
const climate: Command = { type: 'set_climate', rainScale: 1.5 };

describe('星の力 (budget)', () => {
  it('budget のないシナリオは無料で、power は 0、budget() は null', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    expect(r.intervene(spawn)).toEqual({ ok: true });
    expect(r.intervene(disaster)).toEqual({ ok: true });
    expect(r.power()).toBe(0);
    expect(r.budget()).toBeNull();
    expect(w.cmds).toHaveLength(2);
  });

  it('コマンドの種類ごとに値段を引く。sink は無料', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(withBudget(), w);
    r.update(w.snapshot());
    expect(r.power()).toBe(10);
    r.intervene(spawn);
    expect(r.power()).toBe(7);
    r.intervene(climate);
    expect(r.power()).toBe(6);
    r.intervene(disaster);
    expect(r.power()).toBe(1);
    r.intervene({ type: 'sink', amount: 0.01 });
    expect(r.power()).toBe(1);
    expect(r.interventions()).toBe(4);
  });

  it('足りないと ok:false, reason budget で弾き、world に流さない', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(withBudget({ start: 2 }), w);
    r.update(w.snapshot());
    expect(r.intervene(spawn)).toEqual({ ok: false, reason: 'budget' });
    expect(w.cmds).toHaveLength(0);
    expect(r.interventions()).toBe(0);
    expect(r.power()).toBe(2);
    // 安いコマンドは通る
    expect(r.intervene(climate)).toEqual({ ok: true });
    expect(r.power()).toBe(1);
  });

  it('年が変わると incomePerYear × 陸地率 × 生気平均 が入る (最初の年は入らない)', () => {
    const w = fakeWorld({ landRatio: 0.5, vitality: 0.5 });
    const r = createScenarioRunner(withBudget({ start: 4, incomePerYear: 8 }), w);
    r.update(w.snapshot());
    expect(r.power()).toBe(4);
    w.step(360);
    r.update(w.snapshot());
    // 8 × 0.5 × 0.5 = 2
    expect(r.power()).toBeCloseTo(6, 6);
    expect(r.budget()).toMatchObject({ incomeLastYear: 2, upkeepLastYear: 0 });
    w.step(360);
    r.update(w.snapshot());
    expect(r.power()).toBeCloseTo(8, 6);
  });

  it('気候を変えている分は維持費として毎年引かれる', () => {
    const w = fakeWorld({ rainScale: 1.5, tempOffset: -2 });
    const r = createScenarioRunner(withBudget({ start: 20, incomePerYear: 4 }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    // 維持費 = 0.5×10 + 2×2 = 9。収入 4。20 + 4 − 9 = 15
    expect(r.power()).toBeCloseTo(15, 6);
    expect(r.budget()).toMatchObject({ upkeepLastYear: 9 });
  });

  it('上限 (省略時 start × 3) で止まる', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(withBudget({ start: 10, incomePerYear: 100 }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(r.power()).toBe(30);
    expect(r.budget()?.max).toBe(30);
    const r2 = createScenarioRunner(withBudget({ start: 10, incomePerYear: 100, max: 12 }), fakeWorld());
    expect(r2.budget()?.max).toBe(12);
  });

  it('力が尽きたら 0 になり、気候が既定に戻り、onPowerExhausted が呼ばれる', () => {
    const w = fakeWorld({ rainScale: 1.8 });
    let exhausted = 0;
    const r = createScenarioRunner(withBudget({ start: 3, incomePerYear: 1 }), w, { onPowerExhausted: () => exhausted++ });
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    // 3 + 1 − 8 < 0
    expect(r.power()).toBe(0);
    expect(exhausted).toBe(1);
    expect(w.cmds).toContainEqual({ type: 'set_climate', rainScale: 1, tempOffset: 0 });
    // 気候が戻ったので翌年は維持費 0、収入だけ入る
    w.step(360);
    r.update(w.snapshot());
    expect(r.power()).toBeCloseTo(1, 6);
    expect(exhausted).toBe(1);
  });

  it('判定確定後は reason finished で弾く', () => {
    const w = fakeWorld();
    const r = createScenarioRunner({ ...withBudget(), years: 1 }, w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(r.verdict().status).toBe('alive');
    expect(r.intervene(spawn)).toEqual({ ok: false, reason: 'finished' });
  });
});

describe('警告と結果の内訳 (runner)', () => {
  it('年次評価で warnings() が更新され、同じ警告の onWarning は初回だけ', () => {
    const w = fakeWorld({ rainScale: 1.5 });
    const seen: string[] = [];
    const r = createScenarioRunner(withBudget({ start: 1, incomePerYear: 1 }), w, { onWarning: (x) => seen.push(x.key) });
    r.update(w.snapshot());
    expect(r.warnings()).toEqual([]);
    w.step(360);
    r.update(w.snapshot());
    // 1 + 1 − 5 < 0 → 力 0、気候は戻る。維持費 5 > 収入 1
    expect(r.warnings().map((x) => x.kind)).toEqual(['power_low', 'upkeep_over_income']);
    expect(seen).toEqual(['power_low', 'upkeep_over_income']);
    w.step(360);
    r.update(w.snapshot());
    // 翌年: 力 1 で climate (1) が買えるので power_low は消える。維持費 0 なので upkeep も消える
    expect(r.warnings()).toEqual([]);
    w.step(360);
    r.update(w.snapshot());
    expect(seen).toEqual(['power_low', 'upkeep_over_income']);
  });
  it('判定が確定すると Verdict.stats に介入回数・使った力・陸地率・総量が入る', () => {
    const w = fakeWorld({ landRatio: 0.5 });
    let got: ReturnType<typeof r.verdict> | null = null;
    const r = createScenarioRunner({ ...withBudget(), years: 1 }, w, { onVerdict: (v) => (got = v) });
    r.update(w.snapshot());
    r.intervene(spawn);
    r.intervene(climate);
    w.step(360);
    r.update(w.snapshot());
    expect(got).not.toBeNull();
    expect(got!.stats).toEqual({ interventions: 2, powerSpent: 4, landRatio: 0.5, totals: { grass: 1 } });
    expect(r.verdict().stats).toEqual(got!.stats);
  });
});

describe('年表 (runner.timeline)', () => {
  it('介入・単発の予定イベント・力切れ・警告の初回・勝敗を年付きで積む。毎年の沈降は積まない', () => {
    const w = fakeWorld({ rainScale: 1.8 });
    const d: ScenarioDef = {
      ...withBudget({ start: 3, incomePerYear: 1 }),
      years: 2,
      schedule: [
        { atYear: 1, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 } },
        { atYear: 0, everyYears: 1, untilYear: 2, command: { type: 'sink', amount: 0.01 } },
      ],
    };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot());
    r.intervene(climate);
    w.step(360);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    const kinds = r.timeline().map((e) => `${e.year}:${e.kind}`);
    // 1 年目: 力 0 で power_low と upkeep_over_income の 2 つが初回
    expect(kinds).toEqual(['0:intervene', '1:scheduled', '1:power_exhausted', '1:warning', '1:warning', '2:verdict']);
    expect(r.timeline()[0]).toMatchObject({ kind: 'intervene', command: climate });
    expect(r.timeline()[3]).toMatchObject({ kind: 'warning', warning: { kind: 'power_low' } });
    expect(r.timeline()[4]).toMatchObject({ kind: 'warning', warning: { kind: 'upkeep_over_income' } });
    expect(r.timeline()[5]).toMatchObject({ kind: 'verdict', verdict: { status: 'alive' } });
  });
});

describe('文明の年表 (civ_stage, M8-04)', () => {
  it('snapshot.civ.stage が年をまたいで変わったら timeline に civ_stage を積む', () => {
    const w = fakeWorld();
    w.setCivStage(2);
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivStage(3);
    r.update(w.snapshot());
    w.step(360);
    w.setCivStage(0);
    r.update(w.snapshot());
    const civEvents = r.timeline().filter((e) => e.kind === 'civ_stage');
    expect(civEvents).toEqual([
      { year: 1, kind: 'civ_stage', from: 2, to: 3 },
      { year: 2, kind: 'civ_stage', from: 3, to: 0 },
    ]);
  });
  it('段階が変わらなければ積まない', () => {
    const w = fakeWorld();
    w.setCivStage(4);
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'civ_stage')).toEqual([]);
  });
});

describe('文明の年表 (civ_faith, M9-01)', () => {
  it('snapshot.civ.faith が前年から |Δ| >= 0.1 動いたら timeline に civ_faith を積む', () => {
    const w = fakeWorld({ civStage: 4, civFaith: 0.5 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivFaith(0.62); // +0.12 (閾値超え)
    r.update(w.snapshot());
    w.step(360);
    w.setCivFaith(0.48); // -0.14 (閾値超え)
    r.update(w.snapshot());
    const faithEvents = r.timeline().filter((e) => e.kind === 'civ_faith');
    expect(faithEvents).toEqual([
      { year: 1, kind: 'civ_faith', from: 0.5, to: 0.62 },
      { year: 2, kind: 'civ_faith', from: 0.62, to: 0.48 },
    ]);
  });

  it('|Δ| < 0.1 なら積まない', () => {
    const w = fakeWorld({ civStage: 4, civFaith: 0.5 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivFaith(0.55); // +0.05 (閾値未満)
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'civ_faith')).toEqual([]);
  });

  it('発生前 (faith が undefined → 値が付く年) は積まない', () => {
    const w = fakeWorld({ civStage: 4 }); // civFaith 省略 = undefined
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivFaith(0.5); // 誕生年相当。前年の値が無いので積まない
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'civ_faith')).toEqual([]);
  });
});
