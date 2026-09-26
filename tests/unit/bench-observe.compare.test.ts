import { describe, it, expect } from 'vitest';
import { compareBench, summarizeBench, type BenchResult, type BenchShot } from '../../tools/bench-observe-compare.ts';

const row = (drawn: number, inView: number, shadow: number) => ({ drawn, inView, shadow, beyond30: 0, beyond60: 0, instances: 1 });
const shot = (name: string, triangles: number, calls: number, fps: number, breakdown: BenchShot['breakdown']): BenchShot => ({
  name,
  triangles,
  calls,
  fps,
  samples: { calls: [calls], triangles: [triangles], fps: [fps] },
  camera: 'free',
  at: [0, 0, 0],
  breakdown,
});
const result = (commit: string, shots: BenchShot[]): BenchResult => ({
  meta: { date: '2026-09-24T00:00:00.000Z', commit, url: '/observe.html', viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, settleMs: 2500, browser: 'chromium', gpu: 'test', note: '' },
  shots,
});

describe('計測の台の前後の表 (M23-01)', () => {
  const before = result('aaa1111', [shot('集落', 1_397_152, 102, 56.5, { grass: row(512_000, 105_000, 0), water: row(115_200, 115_200, 0) })]);
  const after = result('bbb2222', [shot('集落', 657_152, 98, 71.25, { grass: row(105_000, 105_000, 0), water: row(115_200, 115_200, 0) })]);

  it('画ごとに三角形 (千)・draw call・fps の前 → 後と差を出す', () => {
    const lines = compareBench(before, after).split('\n');
    expect(lines[0]).toBe('前: 2026-09-24T00:00:00.000Z aaa1111  後: 2026-09-24T00:00:00.000Z bbb2222');
    expect(lines).toContain('| 集落 | 1397.2 → 657.2 (−740.0, −53%) | 102 → 98 (−4) | 57 → 71 |');
  });

  it('区分ごとに drawn / inView / shadow を並べ、変わらない値は 1 つだけ書く', () => {
    const lines = compareBench(before, after).split('\n');
    expect(lines).toContain('| 集落 | grass | 512.0 → 105.0 (−407.0) | 105.0 | 0.0 |');
    expect(lines).toContain('| 集落 | water | 115.2 | 115.2 | 0.0 |');
    // 後の drawn の多い順 (water 115.2 千 > grass 105 千)
    expect(lines.findIndex((l) => l.includes('| water |'))).toBeLessThan(lines.findIndex((l) => l.includes('| grass |')));
  });

  it('片方にしか無い画・区分は 0 または — として並べる', () => {
    const more = result('ccc3333', [...after.shots, shot('林', 1_000_000, 100, 60, { forest: row(10_000, 5_000, 10_000) })]);
    const lines = compareBench(before, more).split('\n');
    expect(lines).toContain('| 林 | 0.0 → 1000.0 (+1000.0) | 0 → 100 (+100) | — → 60 |');
    expect(lines).toContain('| 林 | forest | 0.0 → 10.0 (+10.0) | 0.0 → 5.0 (+5.0) | 0.0 → 10.0 (+10.0) |');
  });

  it('1 つの測りの要約は画ごとの三角形・draw call・fps の表', () => {
    expect(summarizeBench(before).split('\n')).toEqual([
      '2026-09-24T00:00:00.000Z aaa1111 1280×720 @1x  GPU: test',
      '',
      '| 画 | 三角形 (千) | draw call | fps |',
      '|---|---|---|---|',
      '| 集落 | 1397.2 | 102 | 57 |',
    ]);
  });

  it('(M23-07) 画面の大きさとページに足した指定を見出しに出す', () => {
    const r: BenchResult = { ...before, meta: { ...before.meta, viewport: { width: 2560, height: 1440, deviceScaleFactor: 1 }, params: 'air=0&bloom=0' } };
    expect(summarizeBench(r).split('\n')[0]).toBe('2026-09-24T00:00:00.000Z aaa1111 2560×1440 @1x air=0&bloom=0  GPU: test');
  });
});
