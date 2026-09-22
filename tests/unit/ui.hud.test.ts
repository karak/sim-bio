import { describe, it, expect } from 'vitest';
import { formatCiv, formatShipHint } from '../../src/ui/Hud';
import type { CivState } from '../../src/simulation/civilization';
import { SHIP_CREW, SHIP_FAITH, SHIP_FOREST_MIN, SHIP_NEED } from '../../src/simulation/ship';

describe('formatCiv (HUD の文明の 1 行)', () => {
  it('civ が null なら null (行を出さない)', () => {
    expect(formatCiv(null)).toBeNull();
  });
  it('stage 0 でも null', () => {
    const civ: CivState = { speciesId: 'deer', stage: 0, progress: 0.5, home: 10, population: 3 };
    expect(formatCiv(civ)).toBeNull();
  });
  it('段階名・進みの %・民の数を整形する', () => {
    // 進みは NEED[6]=3.2 に対する割合 (0.4/3.2=12.5% → 13%)。民は密度の和を 100 倍して見せる (M8-06)
    const civ: CivState = { speciesId: 'deer', stage: 6, progress: 0.4, home: 10, population: 12 };
    expect(formatCiv(civ)).toBe('文明 塔(6) · 進み 13% · 民 1200');
  });
  it('progress・population は四捨五入する', () => {
    // NEED[4]=1.8 に対する割合 (0.126/1.8=7%)。population*100 = 360
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360');
  });
  it('faith があれば小数 2 桁で「· 信仰 0.62」を足す (M9-01)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6, faith: 0.62 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360 · 信仰 0.62');
  });
  it('faith が undefined なら信仰の表示は出ない (M9-01)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 6, progress: 0.4, home: 10, population: 12 };
    expect(formatCiv(civ)).toBe('文明 塔(6) · 進み 13% · 民 1200');
  });
  it('faithCap があれば「信仰 0.50 / 上限 0.90」を出す (M10R-02)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6, faith: 0.5, faithCap: 0.9 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360 · 信仰 0.50 / 上限 0.90');
    expect(formatCiv(civ)).toContain('信仰 0.50 / 上限 0.90');
  });
  it('faithCap が undefined なら上限の表示は出ない (古いセーブ等、M10R-02)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6, faith: 0.62 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360 · 信仰 0.62');
  });
});

describe('formatCiv: 夢喰い (M10R-03)', () => {
  it('dreamEater 引数が true なら信仰の直後に「· 夢喰い」を足す。省略時・false では出さない', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0, home: 10, population: 3.6, faith: 0.2, faithCap: 0.25 };
    expect(formatCiv(civ, true)).toBe('文明 石(4) · 進み 0% · 民 360 · 信仰 0.20 / 上限 0.25 · 夢喰い');
    expect(formatCiv(civ, false)).toBe('文明 石(4) · 進み 0% · 民 360 · 信仰 0.20 / 上限 0.25');
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 0% · 民 360 · 信仰 0.20 / 上限 0.25');
  });
  it('信仰の後・生気/採掘の前に入る (M9-05 の vitality と併用)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0, home: 10, population: 1, faith: 0.2, vitality: 0.5, miningStopped: true };
    expect(formatCiv(civ, true)).toBe('文明 石(4) · 進み 0% · 民 100 · 信仰 0.20 · 夢喰い · 生気 50% · 採掘 止');
  });
});

describe('formatCiv の採掘の停止 (M9-03)', () => {
  it('miningStopped なら末尾に「· 採掘 止」を足し、そうでなければ出さない', () => {
    const civ: CivState = { speciesId: 'deer', stage: 3, progress: 0, home: 10, population: 1, faith: 0.7, miningStopped: true };
    expect(formatCiv(civ)).toBe('文明 歌(3) · 進み 0% · 民 100 · 信仰 0.70 · 採掘 止');
    expect(formatCiv({ ...civ, miningStopped: false })).toBe('文明 歌(3) · 進み 0% · 民 100 · 信仰 0.70');
  });
});

describe('formatCiv の集落の生気 (M9-05)', () => {
  it('vitality があれば「· 生気 NN%」を信仰の後・採掘の前に足す。無ければ出さない', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0, home: 10, population: 1, faith: 0.5, vitality: 0.574, miningStopped: true };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 0% · 民 100 · 信仰 0.50 · 生気 57% · 採掘 止');
    const noVit: CivState = { ...civ };
    delete noVit.vitality;
    expect(formatCiv(noVit)).toBe('文明 石(4) · 進み 0% · 民 100 · 信仰 0.50 · 採掘 止');
  });
});

describe('formatCiv: 星の工事 (M10-02)', () => {
  it('works があれば末尾に「· 工事 備蓄 / 必要」を足し、止まっていれば「止」を添える。無ければ出さない', () => {
    const civ = { speciesId: 'deer', stage: 7, progress: 0, home: 0, population: 1, faith: 0.9, works: { stock: 1.25, stopped: false } };
    expect(formatCiv(civ)).toBe('文明 星(7) · 進み 100% · 民 100 · 信仰 0.90 · 工事 1.3 / 3');
    expect(formatCiv({ ...civ, works: { stock: 1.25, stopped: true } })).toBe('文明 星(7) · 進み 100% · 民 100 · 信仰 0.90 · 工事 1.3 / 3 止');
    expect(formatCiv({ ...civ, works: undefined })).toBe('文明 星(7) · 進み 100% · 民 100 · 信仰 0.90');
  });
});

describe('formatShipHint: #hud-ship の説明文 (M10-03)', () => {
  it('未着工なら門の説明 (帆・信仰・材・SHIP_NEED を含む)', () => {
    expect(formatShipHint(null, null)).toBe(`帆・信仰 ${SHIP_FAITH}・材 ${SHIP_FOREST_MIN} で着工。材を伐って ${SHIP_NEED} まで進む`);
  });
  it('建造中は「舟 進み X.X / SHIP_NEED」を出す (完成していなければ「民は乗らない」は付かない)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1, faith: 0.9 };
    expect(formatShipHint(civ, { startedYear: 0, progress: 4.25 })).toBe(`舟 進み 4.3 / ${SHIP_NEED}`);
  });
  it('完成しても信仰が SHIP_FAITH 未満なら「· 民は乗らない(信仰 0.XX)」を添える。毎年再判定なので進みも出す', () => {
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1, faith: 0.3 };
    expect(formatShipHint(civ, { startedYear: 0, progress: SHIP_NEED })).toBe(`舟 進み ${SHIP_NEED.toFixed(1)} / ${SHIP_NEED} · 民は乗らない(信仰 0.30)`);
  });
  it('完成し信仰・民も足りていれば「民は乗らない」は付かない (M10R-04: populationShip も SHIP_CREW 以上)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1, faith: SHIP_FAITH, populationShip: SHIP_CREW };
    expect(formatShipHint(civ, { startedYear: 0, progress: SHIP_NEED })).toBe(`舟 進み ${SHIP_NEED.toFixed(1)} / ${SHIP_NEED}`);
  });
  it('完成し信仰は足りているが民 (populationShip) が SHIP_CREW 未満なら「· 民が乗るには足りない(民 0.42 / 0.6)」を添える (M10R-04)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1, faith: SHIP_FAITH, populationShip: 0.42 };
    expect(formatShipHint(civ, { startedYear: 0, progress: SHIP_NEED })).toBe(`舟 進み ${SHIP_NEED.toFixed(1)} / ${SHIP_NEED} · 民が乗るには足りない(民 0.42 / ${SHIP_CREW})`);
  });
  it('飛び立っていれば「舟は飛び立った」', () => {
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1, faith: 0.9 };
    expect(formatShipHint(civ, { startedYear: 0, progress: SHIP_NEED, launchedYear: 12 })).toBe('舟は飛び立った');
  });
});

describe('formatCiv: 星の民 (M10 レビュー)', () => {
  it('塔以上で populationStar があれば「民」の直後に「· 星の民 N」を足す。帆以下や無いときは出さない', () => {
    const civ = { speciesId: 'deer', stage: 6, progress: 3.2, home: 0, population: 3.2, populationStar: 3.7 };
    expect(formatCiv(civ)).toBe('文明 塔(6) · 進み 100% · 民 320 · 星の民 370');
    expect(formatCiv({ ...civ, stage: 5 })).toBe('文明 帆(5) · 進み 100% · 民 320');
    expect(formatCiv({ ...civ, populationStar: undefined })).toBe('文明 塔(6) · 進み 100% · 民 320');
  });
});
