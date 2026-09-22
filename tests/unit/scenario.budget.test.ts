import { describe, it, expect } from 'vitest';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import type { PrayerKind } from '../../src/simulation/prayer';
import type { WeatherTower } from '../../src/simulation/weatherTower';
import { TOWER_COST, TOWER_UPKEEP } from '../../src/simulation/weatherTower';
import { grass } from './helpers';

/**
 * 星の力 (介入の予算) の性質。
 * 陸地率と生気を固定した偽の world で、値段・収入・維持費・枯渇を確かめる。
 */
const fakeWorld = (
  opts: {
    landRatio?: number;
    vitality?: number;
    rainScale?: number;
    tempOffset?: number;
    civStage?: number;
    civFaith?: number;
    civPrayer?: { kind: PrayerKind; issuedYear: number; deadlineYear: number };
    civPrayersAnswered?: number;
    civPrayersIgnored?: number;
    towers?: WeatherTower[];
  } = {},
) => {
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
  // 祈り (M9-02)。テストから setCivPrayer/setCivPrayersAnswered/setCivPrayersIgnored で年をまたいで変えて prayer の timeline を確かめる
  let civPrayer = opts.civPrayer;
  let civPrayersAnswered = opts.civPrayersAnswered;
  let civPrayersIgnored = opts.civPrayersIgnored;
  // 勅令 (M9-03)。テストから setCivEdict で変えて civ_edict の timeline を確かめる
  let civEdict: { kind: 'stop_mining' | 'resume_mining'; year: number; obeyed: boolean; faith: number; n: number } | undefined;
  // 気象塔 (M10-01)。テストから setTowers/dispatch(tower_power) で active を変えて維持費の timeline を確かめる
  let towers: WeatherTower[] = opts.towers ?? [];
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { ...climate }, totals: { grass: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n).fill(opts.vitality ?? 1), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
    civ: civStage > 0
      ? {
          speciesId: 'deer', stage: civStage, progress: 0, home: 0, population: 0,
          ...(civFaith !== undefined ? { faith: civFaith } : {}),
          ...(civPrayer !== undefined ? { prayer: civPrayer } : {}),
          ...(civPrayersAnswered !== undefined ? { prayersAnswered: civPrayersAnswered } : {}),
          ...(civPrayersIgnored !== undefined ? { prayersIgnored: civPrayersIgnored } : {}),
          ...(civEdict !== undefined ? { edict: civEdict } : {}),
        }
      : null,
    volcanoCell: 0,
    towers: towers.map((t) => ({ ...t })),
    ship: null,
  });
  const dispatch = (c: Command) => {
    cmds.push(c);
    if (c.type === 'set_climate') {
      if (c.rainScale !== undefined) climate.rainScale = c.rainScale;
      if (c.tempOffset !== undefined) climate.tempOffset = c.tempOffset;
    }
    // 維持費の自動切り替え (M10-01): ScenarioRunner が dispatch する tower_power を、実際の World と同じく
    // 全ての塔の active に反映する (でなければ翌年また同じ dispatch が繰り返されてしまう)
    if (c.type === 'tower_power') towers = towers.map((t) => ({ ...t, active: c.active }));
  };
  return {
    dispatch, snapshot, step: (t: number) => { tick += t; }, cmds,
    setCivStage: (s: number) => { civStage = s; },
    setCivFaith: (f: number) => { civFaith = f; },
    setCivPrayer: (p: { kind: PrayerKind; issuedYear: number; deadlineYear: number } | undefined) => { civPrayer = p; },
    setCivPrayersAnswered: (n: number) => { civPrayersAnswered = n; },
    setCivPrayersIgnored: (n: number) => { civPrayersIgnored = n; },
    setCivEdict: (e: { kind: 'stop_mining' | 'resume_mining'; year: number; obeyed: boolean; faith: number; n: number } | undefined) => { civEdict = e; },
    setTowers: (t: WeatherTower[]) => { towers = t; },
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

describe('文明の年表と石板表示 (prayer, M9-02)', () => {
  it('祈りが出たら issued、応えたら answered、期限切れで無視されたら ignored を timeline に積み、onPrayer を呼ぶ', () => {
    const events: unknown[] = [];
    const w = fakeWorld({ civStage: 4 });
    const r = createScenarioRunner(base, w, { onPrayer: (e) => events.push(e) });
    r.update(w.snapshot());
    w.step(360);
    w.setCivPrayer({ kind: 'rain', issuedYear: 1, deadlineYear: 6 });
    r.update(w.snapshot());
    w.step(360 * 5);
    w.setCivPrayer(undefined);
    w.setCivPrayersIgnored(1);
    r.update(w.snapshot());
    const prayerEvents = r.timeline().filter((e) => e.kind === 'prayer');
    expect(prayerEvents).toEqual([
      { year: 1, kind: 'prayer', phase: 'issued', prayer: 'rain' },
      { year: 6, kind: 'prayer', phase: 'ignored', prayer: 'rain' },
    ]);
    expect(events).toEqual(prayerEvents);
  });

  it('応えた (prayersAnswered が増えた) 年は answered を積む', () => {
    const w = fakeWorld({ civStage: 4 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivPrayer({ kind: 'wolves', issuedYear: 1, deadlineYear: 6 });
    r.update(w.snapshot());
    w.step(360);
    w.setCivPrayer(undefined);
    w.setCivPrayersAnswered(1);
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'prayer')).toEqual([
      { year: 1, kind: 'prayer', phase: 'issued', prayer: 'wolves' },
      { year: 2, kind: 'prayer', phase: 'answered', prayer: 'wolves' },
    ]);
  });

  it('同じ祈り (issuedYear が同じ) が続くあいだは issued を二重に積まない', () => {
    const w = fakeWorld({ civStage: 4 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivPrayer({ kind: 'rain', issuedYear: 1, deadlineYear: 6 });
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot()); // まだ同じ祈り (issuedYear 1)
    expect(r.timeline().filter((e) => e.kind === 'prayer')).toEqual([{ year: 1, kind: 'prayer', phase: 'issued', prayer: 'rain' }]);
  });

  it('文明のない世界・祈りの無い年は積まない', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'prayer')).toEqual([]);
  });

  it('runner.prayer() は現在有効な祈りと残り年数を返す。無ければ null', () => {
    const w = fakeWorld({ civStage: 4 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    expect(r.prayer()).toBeNull();
    w.step(360);
    w.setCivPrayer({ kind: 'rain', issuedYear: 1, deadlineYear: 6 });
    r.update(w.snapshot());
    expect(r.prayer()).toEqual({ kind: 'rain', yearsLeft: 5 });
    w.step(360 * 3); // year 4、期限 (6) まで残り 2 年
    r.update(w.snapshot());
    expect(r.prayer()).toEqual({ kind: 'rain', yearsLeft: 2 });
  });
});

describe('勅令の年表と力 (civ_edict, M9-03)', () => {
  it('新しい勅令が記録された年に civ_edict を積む (従った / 聞かなかった)。同じ勅令 (同じ通し番号) は 1 度だけ、同じ年の 2 つ目 (番号が進む) も積む', () => {
    const w = fakeWorld({ civStage: 4, civFaith: 0.5 });
    const r = createScenarioRunner(base, w);
    r.update(w.snapshot());
    w.step(360);
    w.setCivEdict({ kind: 'stop_mining', year: 1, obeyed: false, faith: 0.5, n: 1 });
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    w.setCivEdict({ kind: 'stop_mining', year: 2, obeyed: true, faith: 0.7, n: 2 });
    w.step(360);
    r.update(w.snapshot());
    // 同じ年 (3) に再開の勅令 (番号 3) → 次の年次評価で積む (年で重複を弾くと落ちていた)
    w.setCivEdict({ kind: 'resume_mining', year: 3, obeyed: true, faith: 0.7, n: 3 });
    w.step(360);
    r.update(w.snapshot());
    expect(r.timeline().filter((e) => e.kind === 'civ_edict')).toEqual([
      { year: 1, kind: 'civ_edict', edict: 'stop_mining', obeyed: false, faith: 0.5 },
      { year: 3, kind: 'civ_edict', edict: 'stop_mining', obeyed: true, faith: 0.7 },
      { year: 4, kind: 'civ_edict', edict: 'resume_mining', obeyed: true, faith: 0.7 },
    ]);
  });
  it('勅令は力を消費しない (budget があっても 0)', () => {
    const w = fakeWorld({ civStage: 4 });
    const r = createScenarioRunner(withBudget({ start: 5 }), w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'civ_edict', edict: 'stop_mining' })).toEqual({ ok: true });
    expect(r.power()).toBe(5);
    expect(r.interventions()).toBe(0); // 言葉なので介入回数にも数えない
    expect(w.cmds).toEqual([{ type: 'civ_edict', edict: 'stop_mining' }]);
  });
});

describe('気象塔 (M10-01)', () => {
  const buildTower: Command = { type: 'build_tower', cell: 0 };

  it('costOf(build_tower) は budget.costs.tower。省略時は TOWER_COST', () => {
    const w = fakeWorld();
    const withCost = createScenarioRunner(withBudget({ start: 20, costs: { spawn: 3, disaster: 5, climate: 1, tower: 15 } }), w);
    withCost.update(w.snapshot());
    withCost.intervene(buildTower);
    expect(withCost.power()).toBe(5);
    const w2 = fakeWorld();
    const withDefault = createScenarioRunner(withBudget({ start: 20 }), w2);
    withDefault.update(w2.snapshot());
    withDefault.intervene(buildTower);
    expect(withDefault.power()).toBe(20 - TOWER_COST);
  });

  it('build_tower は介入回数に数え、年表に専用の tower kind を積む (既定値を補って)', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(withBudget({ start: 40 }), w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'build_tower', cell: 3 })).toEqual({ ok: true });
    expect(r.interventions()).toBe(1);
    expect(r.timeline()).toContainEqual({ year: 0, kind: 'tower', cell: 3, rainScale: 1.5, tempOffset: 0 });
    // 汎用の 'intervene' kind は積まない (二重に出さない)
    expect(r.timeline().some((e) => e.kind === 'intervene')).toBe(false);
    // 指定した値も反映する
    r.intervene({ type: 'build_tower', cell: 1, rainScale: 2, tempOffset: -1 });
    expect(r.timeline()).toContainEqual({ year: 0, kind: 'tower', cell: 1, rainScale: 2, tempOffset: -1 });
  });

  it('tower_power は値段が無く (0)、介入回数にも数えない', () => {
    const w = fakeWorld();
    const r = createScenarioRunner(withBudget({ start: 20 }), w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'tower_power', active: false })).toEqual({ ok: true });
    expect(r.power()).toBe(20);
    expect(r.interventions()).toBe(0);
  });

  it('塔が無ければ維持費は引かれない (既存の挙動のまま)', () => {
    const w = fakeWorld({ towers: [] });
    const r = createScenarioRunner(withBudget({ start: 20, incomePerYear: 0 }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(r.power()).toBe(20);
    expect(r.budget()).toMatchObject({ upkeepLastYear: 0 });
  });

  it('毎年 TOWER_UPKEEP × 塔の数を、既存の気候の維持費と合わせて引く。省略時 TOWER_UPKEEP', () => {
    const towers: WeatherTower[] = [
      { cell: 0, radius: 6, rainScale: 1.5, tempOffset: 0, active: true, year: 0 },
      { cell: 1, radius: 6, rainScale: 1.5, tempOffset: 0, active: true, year: 0 },
    ];
    const w = fakeWorld({ towers });
    const r = createScenarioRunner(withBudget({ start: 100, incomePerYear: 0 }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    // 気候の維持費は無い (rainScale 1・tempOffset 0)。塔 2 つ × TOWER_UPKEEP を引くだけ
    expect(r.power()).toBe(100 - 2 * TOWER_UPKEEP);
  });

  it('力が塔の維持費を下回ると tower_power {active:false} を dispatch し、年表に tower_stopped を積む', () => {
    const towers: WeatherTower[] = [{ cell: 0, radius: 6, rainScale: 1.5, tempOffset: 0, active: true, year: 0 }];
    const w = fakeWorld({ towers });
    const r = createScenarioRunner(withBudget({ start: 3, incomePerYear: 0, upkeepPerYear: { rainScale: 10, tempOffset: 2, tower: 4 } }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(w.cmds).toContainEqual({ type: 'tower_power', active: false });
    expect(r.timeline()).toContainEqual({ year: 1, kind: 'tower_stopped' });
    // 払えないので力は引かれない (0 のまま、既存の power_exhausted と違い塔の維持費はマイナスにしない)
    expect(r.power()).toBe(3);
  });

  it('翌年に力が維持費以上へ戻れば tower_power {active:true} を dispatch し、年表に tower_resumed を積む', () => {
    const towers: WeatherTower[] = [{ cell: 0, radius: 6, rainScale: 1.5, tempOffset: 0, active: false, year: 0 }];
    const w = fakeWorld({ towers });
    // max を広く取り、力の上限クランプが計算に混ざらないようにする
    const r = createScenarioRunner(withBudget({ start: 3, incomePerYear: 10, max: 50, upkeepPerYear: { rainScale: 10, tempOffset: 2, tower: 4 } }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(w.cmds).toContainEqual({ type: 'tower_power', active: true });
    expect(r.timeline()).toContainEqual({ year: 1, kind: 'tower_resumed' });
    expect(r.power()).toBe(3 + 10 - TOWER_UPKEEP);
  });

  it('既に動いている塔は毎年 tower_power を dispatch し直さない (無駄な dispatch を出さない)', () => {
    const towers: WeatherTower[] = [{ cell: 0, radius: 6, rainScale: 1.5, tempOffset: 0, active: true, year: 0 }];
    const w = fakeWorld({ towers });
    const r = createScenarioRunner(withBudget({ start: 100, incomePerYear: 100 }), w);
    r.update(w.snapshot());
    w.step(360);
    r.update(w.snapshot());
    expect(w.cmds.filter((c) => c.type === 'tower_power')).toEqual([]);
    expect(r.timeline().filter((e) => e.kind === 'tower_resumed' || e.kind === 'tower_stopped')).toEqual([]);
  });
});
