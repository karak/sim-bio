import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluate, judgeScenario, landRatio, startStats, type JudgeInput } from '../../src/scenario/judge';
import type { Condition, ScenarioDef } from '../../src/scenario/types';
import type { WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

const snap = (over: Partial<{ totals: Record<string, number>; elevation: number[]; vegetation: number[] }> = {}): WorldSnapshot => {
  const elevation = Float32Array.from(over.elevation ?? [0.1, 0.5, 0.5, 0.5]);
  const vegetation = Float32Array.from(over.vegetation ?? [0, 0.5, 0.5, 1]);
  const n = elevation.length;
  return {
    tick: 0, year: 0, dayOfYear: 0, size: 2, species: [grass], meanTemperature: 10, co2: 280, climate: { tempOffset: 0, rainScale: 1 },
    totals: over.totals ?? { grass: 10, deer: 5, wolf: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation, vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: vegetation } },
    civ: null,
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
  it('contains the four first scenarios with prophecy and conditions', () => {
    expect(defs.filter((d) => !d.hidden).map((d) => d.id)).toEqual(['sinking', 'falling-star', 'volcano', 'enrichment', 'vitality-famine']);
    for (const d of defs.filter((x) => !x.hidden)) {
      expect(d.prophecy.length).toBeGreaterThan(10);
      expect(d.years).toBeGreaterThan(0);
      expect(['prevent', 'endure', 'escape']).toContain(d.kind);
      expect(judgeScenario(d, input(snap({ totals: { grass: 1, forest: 1, deer: 1, rabbit: 1, wolf: 1 } }), 0)).status).toBe('running');
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
