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
  // M3-02: Holling II 型応答 (狼 handlingTime=20) で持続する波が出る。
  // M3-01 時点 (線形応答) では後半 30 年の振幅比 < 0.1、極大値 < 3 だった。
  it('sustained oscillation: >= 3 peaks and amplitude ratio >= 0.2 in the last 30 years', () => {
    expect(countPeaks(secondHalf(deer), 0.5)).toBeGreaterThanOrEqual(3);
    expect(amplitudeRatio(secondHalf(deer))).toBeGreaterThanOrEqual(0.2);
  });
});
