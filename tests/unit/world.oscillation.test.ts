import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { amplitudeRatio, countPeaks, secondHalf } from '../../src/simulation/oscillation';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;

/** 年次の総量系列 (年境界でサンプル) */
export function yearlyTotals(w: World, years: number, id: string): number[] {
  const out: number[] = [];
  for (let y = 0; y < years; y++) {
    w.step(360);
    out.push(w.snapshot().totals[id]);
  }
  return out;
}

describe('World oscillation (seed 42, size 64, 60 years)', { timeout: 120_000 }, () => {
  const w = World.create({ ...base, size: 64, species }, { log: createMemorySink() });
  const deer = yearlyTotals(w, 60, 'deer');

  it('herbivore totals stay positive', () => {
    expect(Math.min(...deer)).toBeGreaterThan(0);
  });
  // M3-01 時点の現状固定: 線形応答では減衰して平坦になる。M3-02 でこの期待を反転する。
  it('current linear-response model damps out (amplitude ratio of last 30 years < 0.1)', () => {
    expect(amplitudeRatio(secondHalf(deer))).toBeLessThan(0.1);
    expect(countPeaks(secondHalf(deer), 0.5)).toBeLessThan(3);
  });
});
