import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluate, judgeScenario, landRatio, startStats, type JudgeInput } from '../../src/scenario/judge';
import type { ScenarioDef } from '../../src/scenario/types';
import type { WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

const snap = (over: Partial<{ totals: Record<string, number>; elevation: number[]; vegetation: number[] }> = {}): WorldSnapshot => {
  const elevation = Float32Array.from(over.elevation ?? [0.1, 0.5, 0.5, 0.5]);
  const vegetation = Float32Array.from(over.vegetation ?? [0, 0.5, 0.5, 1]);
  const n = elevation.length;
  return {
    tick: 0, year: 0, dayOfYear: 0, size: 2, species: [grass], meanTemperature: 10, co2: 280,
    totals: over.totals ?? { grass: 10, deer: 5, wolf: 1 },
    layers: { elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation, populations: { grass: vegetation } },
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
    expect(defs.map((d) => d.id)).toEqual(['sinking', 'falling-star', 'volcano', 'enrichment']);
    for (const d of defs) {
      expect(d.prophecy.length).toBeGreaterThan(10);
      expect(d.years).toBeGreaterThan(0);
      expect(['prevent', 'endure', 'escape']).toContain(d.kind);
      expect(judgeScenario(d, input(snap({ totals: { grass: 1, forest: 1, deer: 1, rabbit: 1, wolf: 1 } }), 0)).status).toBe('running');
    }
  });
});
