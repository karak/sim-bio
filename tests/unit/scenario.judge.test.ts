import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { civVitality, evaluate, judgeScenario, landRatio, startStats, type JudgeInput } from '../../src/scenario/judge';
import type { Condition, ScenarioDef } from '../../src/scenario/types';
import type { WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

const snap = (over: Partial<{ totals: Record<string, number>; elevation: number[]; vegetation: number[]; civ: { stage: number } | null }> = {}): WorldSnapshot => {
  const elevation = Float32Array.from(over.elevation ?? [0.1, 0.5, 0.5, 0.5]);
  const vegetation = Float32Array.from(over.vegetation ?? [0, 0.5, 0.5, 1]);
  const n = elevation.length;
  // civ_stage のテスト用に、段階だけ指定できる簡易な CivState を組み立てる (他のフィールドは評価に使わないので既定値)
  const civ = over.civ ? { speciesId: 'deer', stage: over.civ.stage, progress: 0, home: -1, population: 0 } : null;
  return {
    tick: 0, year: 0, dayOfYear: 0, size: 2, species: [grass], meanTemperature: 10, co2: 280, climate: { tempOffset: 0, rainScale: 1 }, civ, volcanoCell: 0,
    totals: over.totals ?? { grass: 10, deer: 5, wolf: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation, vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: vegetation } },
  };
};
const input = (s: WorldSnapshot, year = 0, interventions = 0, start = startStats(snap())): JudgeInput => ({ snapshot: s, start, year, interventions });

describe('evaluate', () => {
  it('species_alive / species_extinct', () => {
    expect(evaluate({ type: 'species_alive', ids: ['deer', 'wolf'] }, input(snap())).ok).toBe(true);
    expect(evaluate({ type: 'species_alive', ids: ['deer'] }, input(snap({ totals: { deer: 0 } }))).ok).toBe(false);
    expect(evaluate({ type: 'species_extinct', ids: ['deer'] }, input(snap({ totals: { deer: 0 } }))).ok).toBe(true);
    expect(evaluate({ type: 'species_extinct', ids: ['deer'] }, input(snap())).why).toContain('deer');
  });
  it('land_ratio / vegetation_ratio', () => {
    expect(landRatio(snap())).toBe(0.75);
    expect(evaluate({ type: 'land_ratio', min: 0.5 }, input(snap())).ok).toBe(true);
    expect(evaluate({ type: 'land_ratio', max: 0.5 }, input(snap())).ok).toBe(false);
    // 陸 3 セルの植生 (0.5+0.5+1)/3
    expect(evaluate({ type: 'vegetation_ratio', min: 0.66 }, input(snap())).ok).toBe(true);
    expect(evaluate({ type: 'vegetation_ratio', min: 0.7 }, input(snap())).ok).toBe(false);
  });
  it('vitality_ratio averages vitality over land', () => {
    const s = snap();
    s.layers.vitality.set([0, 0.2, 0.6, 1]);
    // 陸 3 セル (0.2 + 0.6 + 1) / 3 = 0.6
    expect(evaluate({ type: 'vitality_ratio', min: 0.6 }, input(s)).ok).toBe(true);
    expect(evaluate({ type: 'vitality_ratio', min: 0.61 }, input(s)).ok).toBe(false);
  });
  it('total_ratio_vs_start uses the start totals', () => {
    const start = startStats(snap({ totals: { forest: 100 } }));
    expect(evaluate({ type: 'total_ratio_vs_start', id: 'forest', min: 1.5 }, input(snap({ totals: { forest: 160 } }), 0, 0, start)).ok).toBe(true);
    expect(evaluate({ type: 'total_ratio_vs_start', id: 'forest', min: 1.5 }, input(snap({ totals: { forest: 120 } }), 0, 0, start)).ok).toBe(false);
  });
  it('year_reached / no_intervention / all / any', () => {
    expect(evaluate({ type: 'year_reached', year: 10 }, input(snap(), 9)).ok).toBe(false);
    expect(evaluate({ type: 'year_reached', year: 10 }, input(snap(), 10)).ok).toBe(true);
    expect(evaluate({ type: 'no_intervention' }, input(snap(), 0, 2)).ok).toBe(false);
    expect(evaluate({ type: 'all', of: [{ type: 'year_reached', year: 1 }, { type: 'no_intervention' }] }, input(snap(), 5, 0)).ok).toBe(true);
    expect(evaluate({ type: 'any', of: [{ type: 'year_reached', year: 99 }, { type: 'no_intervention' }] }, input(snap(), 5, 0)).ok).toBe(true);
  });
});

describe('judgeScenario', () => {
  const def: ScenarioDef = {
    id: 't', title: 't', prophecy: '', kind: 'endure', years: 10, schedule: [],
    alive: { type: 'species_alive', ids: ['deer'] },
    dead: { type: 'species_extinct', ids: ['wolf'] },
  };
  it('running before the year, alive at the year, dead when dead condition hits', () => {
    expect(judgeScenario(def, input(snap(), 5)).status).toBe('running');
    expect(judgeScenario(def, input(snap(), 10)).status).toBe('alive');
    expect(judgeScenario(def, input(snap({ totals: { deer: 5, wolf: 0 } }), 3)).status).toBe('dead');
  });
  it('reaching the year without satisfying alive is dead', () => {
    const v = judgeScenario(def, input(snap({ totals: { deer: 0, wolf: 1 } }), 10));
    expect(v.status).toBe('dead');
    expect(v.reason).toContain('予言の年');
  });
});

describe('assets/data/scenarios.json', () => {
  const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
  it('contains the eight scenarios (six first + M9 の 2 本) with prophecy and conditions', () => {
    expect(defs.filter((d) => !d.hidden).map((d) => d.id)).toEqual(['sinking', 'falling-star', 'volcano', 'enrichment', 'vitality-famine', 'tower', 'no-answer', 'vein-drain']);
    for (const d of defs.filter((x) => !x.hidden)) {
      expect(d.prophecy.length).toBeGreaterThan(10);
      expect(d.years).toBeGreaterThan(0);
      expect(['prevent', 'endure', 'escape']).toContain(d.kind);
      // civ_stage 条件を使う塔の重さも running になるよう、開始段階相当の civ を入れておく
      expect(judgeScenario(d, input(snap({ totals: { grass: 1, forest: 1, deer: 1, rabbit: 1, wolf: 1 }, civ: { stage: 6 } }), 0)).status).toBe('running');
    }
  });
});

describe('species_mean', () => {
  it('直近 years 年の平均が min 未満の種を「群れが小さい」で不合格にする。履歴が短ければある分で平均する', () => {
    const c: Condition = { type: 'species_mean', ids: ['deer', 'wolf'], years: 3, min: 5 };
    const hist = [{ deer: 20, wolf: 9 }, { deer: 2, wolf: 6 }, { deer: 8, wolf: 3 }, { deer: 5, wolf: 3 }];
    // 直近 3 年: deer (2+8+5)/3 = 5.0 ≥ 5、wolf (6+3+3)/3 = 4.0 < 5
    const r = evaluate(c, { ...input(snap({ totals: { deer: 5, wolf: 3 } })), history: hist });
    expect(r.ok).toBe(false);
    expect(r.why).toBe('群れが小さい(3 年平均): wolf 4.0 (< 5.0)');
    // 履歴 1 年分だけなら今年の値で見る
    expect(evaluate(c, { ...input(snap({ totals: { deer: 5, wolf: 5 } })), history: [{ deer: 5, wolf: 5 }] }).ok).toBe(true);
    // history 省略時は今年の totals だけ
    expect(evaluate(c, input(snap({ totals: { deer: 5, wolf: 5 } }))).why).toBe('群れが残った(3 年平均): deer 5.0, wolf 5.0');
  });
  it('areaScale で min を面積比に合わせる (referenceSize 128 で書いた min を size 64 では 1/4 に)', () => {
    const c: Condition = { type: 'species_mean', ids: ['deer'], years: 1, min: 24 };
    const base = input(snap({ totals: { deer: 7 } }));
    expect(evaluate(c, base).ok).toBe(false);
    const r = evaluate(c, { ...base, areaScale: 0.25 });
    expect(r.ok).toBe(true);
    expect(r.why).toBe('群れが残った(1 年平均): deer 7.0');
    expect(evaluate(c, { ...input(snap({ totals: { deer: 5 } })), areaScale: 0.25 }).why).toBe('群れが小さい(1 年平均): deer 5.0 (< 6.0)');
  });
  it('最後の年だけ大きくても平均が低ければ不合格 (最後の瞬間の放流で勝てない)', () => {
    const c: Condition = { type: 'species_mean', ids: ['deer'], years: 10, min: 5 };
    const hist = [...Array(9).fill({ deer: 0 }), { deer: 30 }];
    expect(evaluate(c, { ...input(snap({ totals: { deer: 30 } })), history: hist }).ok).toBe(false);
  });
});

describe('civ_stage', () => {
  it('years 省略時は今の段階だけを見る。civ が null なら段階 0 扱い', () => {
    const min6 = { type: 'civ_stage', min: 6 } as const;
    expect(evaluate(min6, input(snap({ civ: { stage: 6 } }))).ok).toBe(true);
    expect(evaluate(min6, input(snap({ civ: { stage: 6 } }))).why).toBe('文明の段階 6(塔)');
    expect(evaluate(min6, input(snap({ civ: { stage: 5 } }))).ok).toBe(false);
    expect(evaluate(min6, input(snap({ civ: { stage: 5 } }))).why).toBe('文明の段階が 5(帆) まで下がった');
    expect(evaluate(min6, input(snap({ civ: null }))).ok).toBe(false);
    expect(evaluate(min6, input(snap({ civ: null }))).why).toBe('文明の段階が 0(なし) まで下がった');
  });
  it('years ありなら直近 years 年の最小段階で判定する', () => {
    const c = { type: 'civ_stage', min: 6, years: 10 } as const;
    const okHist = [6, 6, 7, 6, 6, 6, 6, 6, 6, 6];
    expect(evaluate(c, { ...input(snap({ civ: { stage: 6 } })), civHistory: okHist }).ok).toBe(true);
    const dipHist = [6, 6, 6, 5, 6, 6, 6, 6, 6, 6];
    const r = evaluate(c, { ...input(snap({ civ: { stage: 6 } })), civHistory: dipHist });
    expect(r.ok).toBe(false);
    expect(r.why).toBe('文明の段階が 5(帆) まで下がった');
    // civHistory 省略時は今年の段階だけで見る
    expect(evaluate(c, input(snap({ civ: { stage: 6 } }))).ok).toBe(true);
  });
});

describe('faith / civ_vitality (M9-03)', () => {
  it('faith: civ の faith を min/max で判定。文明が無い・信仰が無ければ 0 扱い', () => {
    const c = { type: 'faith', min: 0.6 } as const;
    const withFaith = (faith: number | undefined) => {
      const s = snap({ civ: { stage: 3 } });
      if (faith !== undefined) s.civ!.faith = faith;
      return s;
    };
    expect(evaluate(c, input(withFaith(0.6)))).toEqual({ ok: true, why: '信仰 0.60' });
    expect(evaluate(c, input(withFaith(0.59))).ok).toBe(false);
    expect(evaluate(c, input(withFaith(undefined))).ok).toBe(false);
    expect(evaluate(c, input(snap({ civ: null }))).ok).toBe(false);
    expect(evaluate({ type: 'faith', max: 0.3 }, input(withFaith(0.3))).ok).toBe(true);
    expect(evaluate({ type: 'faith', max: 0.3 }, input(withFaith(0.31))).ok).toBe(false);
  });
  it('civ_vitality: 集落の支え半径内の生気平均。years があれば履歴の平均。集落が無ければ 0', () => {
    const s = snap({ civ: { stage: 3 } });
    s.civ!.home = 1;
    s.layers.vitality.set([0.4, 0.2, 0.0, 0.6]); // snap() の海は index 0、陸は index 1..3。size 2 なので支え半径 8 は全セルを含む
    expect(civVitality(s)).toBeCloseTo((0.2 + 0.0 + 0.6) / 3, 6);
    const c = { type: 'civ_vitality', min: 0.3 } as const;
    expect(evaluate(c, input(s)).ok).toBe(false);
    expect(evaluate(c, input(s)).why).toBe('集落の生気が 27% まで落ちた');
    const withYears = { type: 'civ_vitality', min: 0.3, years: 3 } as const;
    expect(evaluate(withYears, { ...input(s), civVitalityHistory: [0.9, 0.9, 0.5, 0.3, 0.2] }).ok).toBe(true); // 直近 3 年 (0.5, 0.3, 0.2) の平均 0.33
    expect(evaluate(withYears, { ...input(s), civVitalityHistory: [0.9, 0.2, 0.2, 0.2] }).ok).toBe(false);
    const none = snap({ civ: null });
    expect(civVitality(none)).toBe(0);
    expect(evaluate(c, input(none)).ok).toBe(false);
  });
});

describe('prayers_answered (M9-03)', () => {
  it('応えた祈りの数を min/max で判定。文明が無い・数が無ければ 0', () => {
    const c = { type: 'prayers_answered', max: 0 } as const;
    const s0 = snap({ civ: { stage: 3 } });
    expect(evaluate(c, input(s0))).toEqual({ ok: true, why: '祈りに一度も応えなかった' });
    s0.civ!.prayersAnswered = 1;
    expect(evaluate(c, input(s0))).toEqual({ ok: false, why: '祈りに 1 回応えた' });
    expect(evaluate(c, input(snap({ civ: null }))).ok).toBe(true);
    expect(evaluate({ type: 'prayers_answered', min: 1 }, input(s0)).ok).toBe(true);
  });
});
