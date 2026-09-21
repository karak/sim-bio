import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { updateFaith, FAITH_IGNORE, FAITH_ANSWER } from '../../src/simulation/faith';
import { PRAYER_YEARS, PRAYER_COOLDOWN } from '../../src/simulation/prayer';
import type { WorldConfig, SpeciesDef } from '../../src/simulation/types';
import { testConfig, grass as helperGrass, forest, moss } from './helpers';

/**
 * 祈りの World 配線 (M9-02) 専用の種構成。
 * 既定の testConfig() の草 (growthRate 0.04 / mortality 0.02) は捕食が無いと支え半径 8 の平均が
 * 0.19 前後で落ち着き PRAYER_GRASS_LOW (0.15) を割らない。ここでは成長をわずかに弱め (0.03/0.022)、
 * 鹿に食わせることで支え半径の草の平均が 0.15 を長く下回るようにし、「雨を」を決定論で再現する。
 */
const sparseGrass: SpeciesDef = { ...helperGrass, growthRate: 0.03, mortality: 0.022 };
const deer: SpeciesDef = {
  id: 'deer', name: '鹿', trophic: 'herbivore', growthRate: 3.5, mortality: 0.02, predation: 0.05,
  tempRange: [0, 30], moistureRange: [0.5, 0.95], diffusion: 0.15, eats: ['grass', 'forest'],
  assetId: 'deer', color: '#E2B45A', initialDensity: 0.02, handlingTime: 8,
};

const prayerConfig = (over: Partial<WorldConfig> = {}): WorldConfig => testConfig({ species: [sparseGrass, forest, moss, deer], ...over });

/** prayerConfig() (seed 42, size 32) の陸のセルを 1 つ返す。文明の home に使う */
function someLandCell(): number {
  const probe = World.create(prayerConfig(), { log: createMemorySink() });
  const elevation = probe.snapshot().layers.elevation;
  const i = elevation.findIndex((e) => e >= SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('World civilization prayer wiring (M9-02)', () => {
  it('文明のない世界では祈りは存在しない', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    w.step(360);
    expect(w.snapshot().civ).toBeNull();
  });

  it('stage 0 のあいだ (発生前) は祈りも出ない', () => {
    const home = someLandCell();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 0, home } } }), { log: createMemorySink() });
    w.step(360 * 3);
    expect(w.snapshot().civ?.stage).toBe(0);
    expect(w.snapshot().civ?.prayer).toBeUndefined();
  });

  it('支え半径の草が閾値未満なら stage >= 1 の最初の年に rain の祈りが出る (issued)、期限は issuedYear + PRAYER_YEARS', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360);
    const civ = w.snapshot().civ;
    expect(civ?.prayer).toEqual({ kind: 'rain', issuedYear: 1, deadlineYear: 1 + PRAYER_YEARS });
    const events = log.find('sim.civ.prayer');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ year: 1, phase: 'issued', kind: 'rain' });
  });

  it('期限が来ると無視した扱いになり、信仰が下がって prayersIgnored が増える。ログに ignored が出る', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360 * PRAYER_YEARS); // 発生 (issuedYear 1) から PRAYER_YEARS 年目 (year 5)。期限は issuedYear + PRAYER_YEARS = 6 なのでまだ前
    const before = w.snapshot().civ;
    expect(before?.prayer?.kind).toBe('rain'); // まだ無視されていない
    const faithBefore = before?.faith as number;
    w.step(360); // 期限 (issuedYear + PRAYER_YEARS = 6) の年
    const after = w.snapshot().civ;
    expect(after?.prayer).toBeUndefined();
    expect(after?.prayersIgnored).toBe(1);
    expect(after?.faith).toBeCloseTo(updateFaith(faithBefore, { recent: [], disasters: 0, ignored: 1 }), 6);
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['issued', 'ignored']);
    expect(events[1]).toMatchObject({ phase: 'ignored', kind: 'rain' });
  });

  it('解決後 PRAYER_COOLDOWN 年は次の祈りが出ず、経過後に出る (同時に 1 つだけ)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360 * (PRAYER_YEARS + 1)); // 無視で解決する年 (issuedYear 1 + PRAYER_YEARS = 6)
    expect(w.snapshot().civ?.prayer).toBeUndefined();
    // クールダウン中 (year < 6 + PRAYER_COOLDOWN) は出ない
    for (let i = 0; i < PRAYER_COOLDOWN - 1; i++) {
      w.step(360);
      expect(w.snapshot().civ?.prayer).toBeUndefined();
    }
    // クールダウンが明けた年に新しい祈りが出る
    w.step(360);
    expect(w.snapshot().civ?.prayer?.kind).toBe('rain');
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['issued', 'ignored', 'issued']);
  });

  it('祈りに応える介入は dispatch した瞬間に解決する (同じ年に応えた・信仰が上がる・prayersAnswered が増える)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360); // 誕生年、rain の祈りが出る
    expect(w.snapshot().civ?.prayer?.kind).toBe('rain');
    w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.1 });
    // step せずとも dispatch した瞬間に解決する
    const resolved = w.snapshot().civ;
    expect(resolved?.prayer).toBeUndefined();
    expect(resolved?.prayersAnswered).toBe(1);
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['issued', 'answered']);
    expect(events[1]).toMatchObject({ phase: 'answered', kind: 'rain' });
    // 信仰は FAITH_ANSWER の分だけ上乗せされて年が変わる
    const faithBefore = resolved?.faith as number;
    w.step(360);
    expect(w.snapshot().civ?.faith).toBeCloseTo(updateFaith(faithBefore, { recent: [], disasters: 0, answered: 1 }), 6);
    expect(FAITH_ANSWER).toBeGreaterThan(0);
  });

  it('rain の祈りは set_climate で雨を今より増やしても応えになる', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360);
    expect(w.snapshot().civ?.prayer?.kind).toBe('rain');
    w.dispatch({ type: 'set_climate', rainScale: 1.2 });
    expect(w.snapshot().civ?.prayer).toBeUndefined();
    expect(w.snapshot().civ?.prayersAnswered).toBe(1);
  });

  it('config.civilization.start.prayer で開始時にその祈りが有効になる (期限は開始年 0 + PRAYER_YEARS)', () => {
    const home = someLandCell();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home, prayer: 'wolves' } } }), { log: createMemorySink() });
    expect(w.snapshot().civ?.prayer).toEqual({ kind: 'wolves', issuedYear: 0, deadlineYear: PRAYER_YEARS });
  });

  it('snapshot().civ の prayer / prayersAnswered / prayersIgnored / crystalStart が serialize → restore で一致する', () => {
    const home = someLandCell();
    const a = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log: createMemorySink() });
    a.step(360 * (PRAYER_YEARS + 1)); // issued → ignored まで進め、prayersIgnored が付いた状態にする
    const civA = a.snapshot().civ;
    expect(civA?.prayersIgnored).toBe(1);
    expect(civA?.crystalStart).toBeTypeOf('number');
    const save = a.serialize();
    expect(save.civ?.prayersIgnored).toBe(civA?.prayersIgnored);
    expect(save.civ?.crystalStart).toBe(civA?.crystalStart);
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    const civB = b.snapshot().civ;
    expect(civB?.prayer).toEqual(civA?.prayer);
    expect(civB?.prayersAnswered).toBe(civA?.prayersAnswered);
    expect(civB?.prayersIgnored).toBe(civA?.prayersIgnored);
    expect(civB?.crystalStart).toBe(civA?.crystalStart);
  });

  it('FAITH_IGNORE は正の値 (回帰防止)', () => {
    expect(FAITH_IGNORE).toBeGreaterThan(0);
  });
});
