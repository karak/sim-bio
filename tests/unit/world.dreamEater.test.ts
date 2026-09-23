import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { DREAM_CAP, DREAM_EAT, DREAM_LEAVE, DREAM_STAGE } from '../../src/simulation/dreamEater';
import { testConfig } from './helpers';

/** testConfig() (seed 42, size 32) の陸のセルを 1 つ返す。文明の home に使う (M10R-02 の祈りテストと同じ流儀) */
function someLandCell(): number {
  const probe = World.create(testConfig(), { log: createMemorySink() });
  const elevation = probe.snapshot().layers.elevation;
  const i = elevation.findIndex((e) => e >= SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/**
 * faithCap は CivilizationConfig.start に直接指定できない (faith しか無い) ので、M10R-02 のテストと同じく
 * 1 年進めて faithCap を生ませてから serialize → save.civ!.faithCap を書き換えて restore する。
 * base で 1 年 (tick 360、年 1) 進めてから serialize するので、restore した世界は年 1 から始まり、
 * 次に年をまたぐのは年 2 になる (以下のテストの year/since の値はこれに合わせてある)
 */
function withFaithCap(faithCap: number, stage = DREAM_STAGE, log = createMemorySink()): { w: World; home: number } {
  const home = someLandCell();
  const base = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage, home, faith: 0.5 } } }), { log: createMemorySink() });
  base.step(360); // faithCap が生まれるまで 1 年進める
  const save = base.serialize();
  save.civ!.faithCap = faithCap;
  const w = World.restore(save, { log });
  return { w, home };
}

describe('World の夢喰い (M10R-03)', () => {
  it('faithCap < DREAM_CAP かつ段階 ≥ 歌で現れ、sim.civ.dream_eater { phase: appeared } が出る。snapshot.dreamEater に反映される', () => {
    const log = createMemorySink();
    const { w } = withFaithCap(DREAM_CAP - 0.1, DREAM_STAGE, log);
    expect(w.snapshot().dreamEater).toBeNull();
    w.step(360); // 年 1 → 2 の境界で現れる (withFaithCap のコメント参照)
    const s = w.snapshot();
    expect(s.dreamEater).not.toBeNull();
    expect(s.dreamEater?.since).toBe(2);
    const appeared = log.find('sim.civ.dream_eater').filter((r) => r.phase === 'appeared');
    expect(appeared).toHaveLength(1);
    expect(appeared[0]).toMatchObject({ year: 2, faithCap: s.civ?.faithCap });
  });

  it('段階 < 歌なら faithCap が低くても現れない', () => {
    const { w } = withFaithCap(0.01, DREAM_STAGE - 1);
    w.step(360 * 3);
    expect(w.snapshot().dreamEater).toBeNull();
  });

  it('出現中は毎年、支え半径内の民が (1 − DREAM_EAT) 倍に減る (内乱の一度きりの半減と違い、出現し続ける限り毎年)', () => {
    const { w, home } = withFaithCap(DREAM_CAP - 0.1);
    w.step(360); // 現れる年
    expect(w.snapshot().dreamEater).not.toBeNull();
    // 年境界の一撃を、その前後 (成長がほとんど無い 1 tick 差) で確かめる。360 tick かけて比べると
    // 草の自然な成長 (growthRate) が 20% の減りを上回ってしまい、観測できない
    w.step(359);
    const before = w.snapshot().layers.populations['grass'][home];
    w.step(1); // 次の年境界をまたぎ、DREAM_EAT の一撃が掛かる
    const after = w.snapshot().layers.populations['grass'][home];
    expect(after).toBeLessThan(before);
    expect(after / before).toBeCloseTo(1 - DREAM_EAT, 1);
  });

  it('出現中は文明の進みが増えない (輝石は掘られて減る。採掘そのものは止めない)', () => {
    const { w, home } = withFaithCap(DREAM_CAP - 0.1);
    w.step(360); // 現れる年 (この年はまだ null だったので、この年の分の進みは既に足されている)
    expect(w.snapshot().dreamEater).not.toBeNull();
    const progressAfterAppear = w.snapshot().civ?.progress ?? 0;
    const crystalBefore = w.snapshot().layers.crystal[home];
    w.step(360); // 出現し続けている年: 進みは増えない
    const progressAfterOneMoreYear = w.snapshot().civ?.progress ?? 0;
    const crystalAfter = w.snapshot().layers.crystal[home];
    expect(progressAfterOneMoreYear).toBeCloseTo(progressAfterAppear, 6);
    // 採掘そのものは止めないので、輝石はそれでも減る (掘る対象の半径内に輝石があれば)
    expect(crystalAfter).toBeLessThanOrEqual(crystalBefore);
  });

  it('faithCap ≥ DREAM_LEAVE で去り、sim.civ.dream_eater { phase: left } が出て snapshot.dreamEater が null に戻る', () => {
    const { w } = withFaithCap(DREAM_CAP - 0.1);
    w.step(360);
    expect(w.snapshot().dreamEater).not.toBeNull();
    const save = w.serialize();
    save.civ!.faithCap = DREAM_LEAVE;
    const log = createMemorySink();
    const r = World.restore(save, { log });
    r.step(360);
    expect(r.snapshot().dreamEater).toBeNull();
    const left = log.find('sim.civ.dream_eater').filter((e) => e.phase === 'left');
    expect(left).toHaveLength(1);
  });

  it('serialize → restore で dreamEater が往復する', () => {
    const { w } = withFaithCap(DREAM_CAP - 0.1);
    w.step(360);
    const before = w.snapshot().dreamEater;
    expect(before).not.toBeNull();
    const save = w.serialize();
    expect(save.dreamEater).toEqual(before);
    const r = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(r.snapshot().dreamEater).toEqual(before);
  });

  it('古いセーブ (dreamEater 無し) は null として復元できる', () => {
    const { w } = withFaithCap(DREAM_CAP - 0.1);
    w.step(360);
    expect(w.snapshot().dreamEater).not.toBeNull();
    const save = w.serialize();
    delete save.dreamEater;
    const r = World.restore(save, { log: createMemorySink() });
    expect(r.snapshot().dreamEater).toBeNull();
  });
});
