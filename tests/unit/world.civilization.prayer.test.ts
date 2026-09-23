import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { updateFaith, FAITH_IGNORE, FAITH_ANSWER, FAITH_CAP_INITIAL, FAITH_CAP_IGNORE } from '../../src/simulation/faith';
import { PRAYER_YEARS, PRAYER_COOLDOWN, PRAYER_BASELINE_MIN } from '../../src/simulation/prayer';
import { UNREST_FAITH, UNREST_FAITH_AFTER, UNREST_YEARS } from '../../src/simulation/unrest';
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

/** 狼 (assets/data/species.json と同じ値、ただし initialDensity 0: 放流するまで捕食者はいない → 基準の捕食者比が 0 になる) */
const wolf: SpeciesDef = {
  id: 'wolf', name: '狼', trophic: 'carnivore', growthRate: 0.8, mortality: 0.015, predation: 0.6,
  tempRange: [-10, 25], moistureRange: [0.1, 1.0], diffusion: 0.2, eats: ['deer'], assetId: 'wolf', color: '#E07A55', initialDensity: 0, handlingTime: 20,
};
const prayerConfig = (over: Partial<WorldConfig> = {}): WorldConfig => testConfig({ species: [sparseGrass, forest, moss, deer, wolf], ...over });

/** prayerConfig() (seed 42, size 32) の陸のセルを 1 つ返す。文明の home に使う */
function someLandCell(): number {
  const probe = World.create(prayerConfig(), { log: createMemorySink() });
  const elevation = probe.snapshot().layers.elevation;
  const i = elevation.findIndex((e) => e >= SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

/**
 * 「狼を減らして」の困りごとを決定論で作る (M9-03: 祈りは「いつもより」で出る)。
 * 基準ができる PRAYER_BASELINE_MIN 年 (狼なし、捕食者比 0) を過ごしてから集落に狼を放ち、翌年に wolves が出る
 * (issuedYear = PRAYER_BASELINE_MIN + 1)。狼は数年で減るので、必要が続く間は毎年 keepWolves で放ち直す。
 * (草は成長が速く、噴火で焼いても年内に戻って「いつもより」にならないので、雨の必要は決定論で作りにくい)
 */
function withWolfNeed(over: Parameters<typeof prayerConfig>[0] = {}, log = createMemorySink()): { w: World; home: number } {
  const home = someLandCell();
  const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } }, ...over }), { log });
  w.step(360 * PRAYER_BASELINE_MIN);
  keepWolves(w, home);
  w.step(360);
  expect(w.snapshot().civ?.prayer?.kind).toBe('wolves');
  return { w, home };
}
const keepWolves = (w: World, home: number) => w.dispatch({ type: 'spawn_species', speciesId: 'wolf', cell: home, amount: 0.3, radius: 3 });

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

  it('基準ができる前 (PRAYER_BASELINE_MIN 年) は祈りが出ず、集落に狼が現れて捕食者比が「いつもより」上がった翌年に wolves が出る (issued)、期限は issuedYear + PRAYER_YEARS (M9-03)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home } } }), { log });
    w.step(360 * PRAYER_BASELINE_MIN);
    expect(log.find('sim.civ.prayer')).toHaveLength(0);
    keepWolves(w, home);
    w.step(360);
    const civ = w.snapshot().civ;
    const issuedYear = PRAYER_BASELINE_MIN + 1;
    expect(civ?.prayer).toEqual({ kind: 'wolves', issuedYear, deadlineYear: issuedYear + PRAYER_YEARS });
    const events = log.find('sim.civ.prayer');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ year: issuedYear, phase: 'issued', kind: 'wolves' });
  });

  it('期限が来ると無視した扱いになり、信仰が下がって prayersIgnored が増える。ログに ignored が出る', () => {
    const log = createMemorySink();
    const { w, home } = withWolfNeed({}, log);
    for (let i = 0; i < PRAYER_YEARS - 1; i++) { keepWolves(w, home); w.step(360); } // 期限の前年まで、狼を保つ
    const before = w.snapshot().civ;
    expect(before?.prayer?.kind).toBe('wolves'); // まだ無視されていない
    const faithBefore = before?.faith as number;
    keepWolves(w, home);
    w.step(360); // 期限の年
    const after = w.snapshot().civ;
    expect(after?.prayer).toBeUndefined();
    expect(after?.prayersIgnored).toBe(1);
    // 毎年の狼の放流は同じ種類の介入 (儀式) なので +FAITH_UP も掛かる (recent は spawn:wolf が 3 回以上)
    expect(after?.faith).toBeCloseTo(updateFaith(faithBefore, { recent: ['spawn:wolf', 'spawn:wolf', 'spawn:wolf'], disasters: 0, ignored: 1 }), 6);
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['issued', 'ignored']);
    expect(events[1]).toMatchObject({ phase: 'ignored', kind: 'wolves' });
  });

  it('祈りの間隔は 0 (M10R-02): 無視された年には次が出ず、翌年に困りごとが続いていれば出る', () => {
    expect(PRAYER_COOLDOWN).toBe(0);
    const log = createMemorySink();
    const { w, home } = withWolfNeed({}, log);
    for (let i = 0; i < PRAYER_YEARS - 1; i++) { keepWolves(w, home); w.step(360); } // 期限の前年まで、狼を保つ
    keepWolves(w, home);
    w.step(360); // 期限の年: 無視される
    expect(w.snapshot().civ?.prayer).toBeUndefined(); // 同じ年のうちには出ない (間隔 0 でも即再発行しない)
    expect(w.snapshot().civ?.prayersIgnored).toBe(1);
    // 翌年、困りごと (狼) がまだ続いていれば新しい祈りが出る
    keepWolves(w, home);
    w.step(360);
    expect(w.snapshot().civ?.prayer?.kind).toBe('wolves');
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['issued', 'ignored', 'issued']);
  });

  it('取り下げ (M9-03): 期限の前に困りごとが消えれば民は祈るのをやめ、信仰は動かず prayersWithdrawn が増える', () => {
    const home = someLandCell();
    const log = createMemorySink();
    // 開始時の「狼を減らして」。この世界に肉食はいないので、基準ができた年に「続いていない」と分かって取り下げられる
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home, prayer: 'wolves', faith: 0.5 } } }), { log });
    w.step(360 * (PRAYER_BASELINE_MIN + 1)); // 基準ができる年 (履歴が PRAYER_BASELINE_MIN 年たまった翌年。期限 PRAYER_YEARS より前)
    const civ = w.snapshot().civ;
    expect(civ?.prayer).toBeUndefined();
    expect(civ?.prayersWithdrawn).toBe(1);
    expect(civ?.prayersIgnored ?? 0).toBe(0);
    expect(log.find('sim.civ.prayer')[0]).toMatchObject({ phase: 'withdrawn', kind: 'wolves' });
    // 信仰は無視の −FAITH_IGNORE を受けない (減衰だけ)
    expect(civ?.faith).toBeGreaterThan(0.5 - FAITH_IGNORE);
  });

  it('若い信仰の記憶 (M10R-07): 歌 (3) の民は取り下げでも上限が FAITH_CAP_IGNORE だけ削れ、祈りの無い年に回復しない', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 3, home, prayer: 'wolves', faith: 0.5 } } }), { log });
    w.step(360 * (PRAYER_BASELINE_MIN + 1));
    const civ = w.snapshot().civ;
    expect(civ?.prayer).toBeUndefined();
    expect(civ?.prayersWithdrawn).toBe(1);
    expect(civ?.faithCap).toBeCloseTo(1 - FAITH_CAP_IGNORE, 6);
    // その後、祈りの無い年が続いても上限は戻らない
    w.step(360 * 3);
    expect(w.snapshot().civ?.faithCap).toBeCloseTo(1 - FAITH_CAP_IGNORE, 6);
  });

  it('祈りに応える介入は dispatch した瞬間に解決する (同じ年に応えた・信仰が上がる・prayersAnswered が増える)', () => {
    const log = createMemorySink();
    const home = someLandCell();
    // 開始時の「雨を」(基準ができる前なので取り下げられない)
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home, prayer: 'rain' } } }), { log });
    w.step(360);
    expect(w.snapshot().civ?.prayer?.kind).toBe('rain');
    w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.1 });
    // step せずとも dispatch した瞬間に解決する
    const resolved = w.snapshot().civ;
    expect(resolved?.prayer).toBeUndefined();
    expect(resolved?.prayersAnswered).toBe(1);
    const events = log.find('sim.civ.prayer');
    expect(events.map((e) => e.phase)).toEqual(['answered']);
    expect(events[0]).toMatchObject({ phase: 'answered', kind: 'rain' });
    // 信仰は FAITH_ANSWER の分だけ上乗せされて年が変わる (recent は今年の草の放流 1 回だけなので儀式は掛からない)
    const faithBefore = resolved?.faith as number;
    w.step(360);
    expect(w.snapshot().civ?.faith).toBeCloseTo(updateFaith(faithBefore, { recent: ['spawn:grass'], disasters: 0, answered: 1 }), 6);
    expect(FAITH_ANSWER).toBeGreaterThan(0);
  });

  it('「狼を減らして」に応える疫病は民が望んだ災害なので、信仰の災害 (−FAITH_DISASTER) には数えない (M9-03)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home, prayer: 'wolves', faith: 0.5 } } }), { log });
    w.step(360);
    const faithBefore = w.snapshot().civ?.faith as number;
    w.dispatch({ type: 'disaster', kind: 'plague', cell: home, radius: 2 });
    expect(w.snapshot().civ?.prayersAnswered).toBe(1);
    w.step(360);
    expect(w.snapshot().civ?.faith).toBeCloseTo(updateFaith(faithBefore, { recent: ['disaster:plague'], disasters: 0, answered: 1 }), 6);
    // 祈りが無いときの集落の疫病は数える
    const faith2 = w.snapshot().civ?.faith as number;
    w.dispatch({ type: 'disaster', kind: 'plague', cell: home, radius: 2 });
    w.step(360);
    expect(w.snapshot().civ?.faith).toBeCloseTo(updateFaith(faith2, { recent: ['disaster:plague', 'disaster:plague'], disasters: 1 }), 6);
  });

  it('rain の祈りは set_climate で雨を今より増やしても応えになる', () => {
    const log = createMemorySink();
    const home = someLandCell();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 4, home, prayer: 'rain' } } }), { log });
    w.step(360);
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
    const { w: a, home } = withWolfNeed();
    for (let i = 0; i < PRAYER_YEARS; i++) { keepWolves(a, home); a.step(360); } // issued → ignored まで進め、prayersIgnored が付いた状態にする
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

describe('信仰の上限 = 民の記憶 (M10R-02)', () => {
  it('無視した祈りで上限が FAITH_CAP_IGNORE だけ下がり、信仰は上限を超えない。ログ sim.civ.faith_cap が出る', () => {
    const log = createMemorySink();
    const { w, home } = withWolfNeed({}, log);
    const capBefore = w.snapshot().civ?.faithCap as number;
    expect(capBefore).toBeCloseTo(FAITH_CAP_INITIAL, 6);
    for (let i = 0; i < PRAYER_YEARS - 1; i++) { keepWolves(w, home); w.step(360); } // 期限の前年まで、狼を保つ
    keepWolves(w, home);
    w.step(360); // 期限の年: 無視される
    const civ = w.snapshot().civ;
    expect(civ?.prayersIgnored).toBe(1);
    expect(civ?.faithCap).toBeCloseTo(capBefore - FAITH_CAP_IGNORE, 6);
    expect(civ?.faith as number).toBeLessThanOrEqual((civ?.faithCap as number) + 1e-9);
    const capEvents = log.find('sim.civ.faith_cap');
    expect(capEvents).toHaveLength(1);
    expect(capEvents[0]).toMatchObject({ faithCap: civ?.faithCap });
  });

  it('儀式(同じ放流を 3 回)を続けても信仰は上限を超えない。無視の連続で上限が下がるほど 1.0 未満に張り付く', () => {
    const log = createMemorySink();
    const { w, home } = withWolfNeed({}, log);
    const years = 16; // wolves の期限 5 年をまたいで無視サイクルが複数回起きる長さ
    for (let i = 0; i < years; i++) {
      keepWolves(w, home); // 困りごとを保ち、無視サイクルで上限を下げ続ける
      // 同じ種類のコマンドを 3 回 (儀式、FAITH_UP) — 最後に dispatch するので recent の末尾がこれになる
      w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
      w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
      w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
      w.step(360);
      const civ = w.snapshot().civ;
      expect(civ?.faith as number).toBeLessThanOrEqual((civ?.faithCap as number) + 1e-9);
    }
    const civ = w.snapshot().civ;
    // 無視サイクルで上限が下がり続けたので 1.0 未満、信仰はクランプされて上限のすぐ近くに留まる
    expect(civ?.faithCap as number).toBeLessThan(FAITH_CAP_INITIAL);
    expect(civ?.faith as number).toBeGreaterThan((civ?.faithCap as number) - 0.1);
  });

  it('内乱の後の信仰は min(UNREST_FAITH_AFTER, 上限) に戻る (M10R-02): 上限が低ければ上限までしか戻らない', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(prayerConfig({ civilization: { speciesId: 'deer', start: { stage: 3, home, faith: UNREST_FAITH - 0.05 } } }), { log });
    const save = w.serialize();
    save.civ!.faithCap = 0.2; // UNREST_FAITH_AFTER (0.4) より低い上限
    const r = World.restore(save, { log });
    r.step(360 * UNREST_YEARS);
    expect(r.snapshot().civ?.stage).toBe(2);
    const civ = r.snapshot().civ;
    expect(civ?.faith as number).toBeLessThan(UNREST_FAITH_AFTER);
    expect(civ?.faith).toBeCloseTo(civ?.faithCap as number, 6);
  });

  it('faithCap が serialize → restore で一致する', () => {
    const log = createMemorySink();
    const { w: a, home } = withWolfNeed({}, log);
    for (let i = 0; i < PRAYER_YEARS; i++) { keepWolves(a, home); a.step(360); } // ignored まで進め、上限を動かした状態にする
    const civA = a.snapshot().civ;
    expect(civA?.faithCap).toBeTypeOf('number');
    expect(civA?.faithCap).toBeLessThan(FAITH_CAP_INITIAL);
    const save = a.serialize();
    expect(save.civ?.faithCap).toBe(civA?.faithCap);
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(b.snapshot().civ?.faithCap).toBe(civA?.faithCap);
  });
});
