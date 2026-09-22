import { describe, it, expect } from 'vitest';
import {
  applyLoad,
  checkDecline,
  LOAD_RADIUS,
  LOGGING,
  VITALITY_DRAIN,
  POP_NEED,
  VITALITY_FLOOR,
  STAR_RADIUS,
  STAR_FAITH,
  populationFor,
  canAscend,
  type LoadLayers,
} from '../../src/simulation/civilizationLoad';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { populationAround } from '../../src/simulation/civilization';

const SIZE = 9;
const N = SIZE * SIZE;
const CENTER = 4 * SIZE + 4; // (4,4)

const mkLayers = (): LoadLayers => ({
  forest: new Float32Array(N).fill(0.6),
  litter: new Float32Array(N),
  vitality: new Float32Array(N).fill(0.5),
  elevation: new Float32Array(N).fill(0.5), // 全セル陸 (SEA_LEVEL = 0.3)
});

describe('applyLoad', () => {
  it('stage 0 は何もしない', () => {
    const layers = mkLayers();
    applyLoad(0, CENTER, layers, SIZE);
    expect(layers.forest[CENTER]).toBeCloseTo(0.6, 6);
    expect(layers.vitality[CENTER]).toBeCloseTo(0.5, 6);
    expect(layers.litter[CENTER]).toBe(0);
  });

  it('home が未設定 (-1) なら何もしない', () => {
    const layers = mkLayers();
    applyLoad(6, -1, layers, SIZE);
    expect(layers.forest[CENTER]).toBeCloseTo(0.6, 6);
  });

  it('半径内だけ森を減らし生気を吸う (単体)', () => {
    const layers = mkLayers();
    const stage = 4;
    applyLoad(stage, CENTER, layers, SIZE);
    // 森は立木 (0.6) に比例して減る (M8-06: 定量ではなく定率)
    expect(layers.forest[CENTER]).toBeCloseTo(0.6 - 0.6 * LOGGING[stage], 6);
    expect(layers.vitality[CENTER]).toBeCloseTo(0.5 - VITALITY_DRAIN[stage], 6);
    // 半径の外 (LOAD_RADIUS[4] = 5 なので (0,0) は届かない)
    const outside = 0;
    expect(layers.forest[outside]).toBeCloseTo(0.6, 6);
    expect(layers.vitality[outside]).toBeCloseTo(0.5, 6);
  });

  it('海セルは減らさない', () => {
    const layers = mkLayers();
    layers.elevation[CENTER] = SEA_LEVEL - 0.1;
    applyLoad(5, CENTER, layers, SIZE);
    expect(layers.forest[CENTER]).toBeCloseTo(0.6, 6);
    expect(layers.vitality[CENTER]).toBeCloseTo(0.5, 6);
  });

  it('森が減った分だけ枯死に積む', () => {
    const layers = mkLayers();
    const stage = 3;
    const before = layers.forest[CENTER];
    applyLoad(stage, CENTER, layers, SIZE);
    const removed = before - layers.forest[CENTER];
    expect(layers.litter[CENTER]).toBeCloseTo(removed, 6);
    // 森は立木に比例して減る (M8-06) ので、減った量は before × LOGGING[stage]
    expect(removed).toBeCloseTo(before * LOGGING[stage], 6);
  });

  it('森は 0 未満にならない (比例なので 0 に近づくだけで負にはならない)', () => {
    const layers = mkLayers();
    layers.forest.fill(0.0002);
    const stage = 7;
    // M8-06 で定量 (min(forest, logging)) から定率 (forest * logging) に変えたため、
    // 一度で 0 に落ちることはなく、繰り返し適用しても 0 未満にはならず単調に減っていく
    let prev = layers.forest[CENTER];
    for (let i = 0; i < 50; i++) {
      applyLoad(stage, CENTER, layers, SIZE);
      expect(layers.forest[CENTER]).toBeGreaterThanOrEqual(0);
      expect(layers.forest[CENTER]).toBeLessThan(prev);
      prev = layers.forest[CENTER];
    }
    expect(layers.litter[CENTER]).toBeGreaterThan(0);
  });

  it('生気は 0 未満にならない', () => {
    const layers = mkLayers();
    layers.vitality.fill(0.0001);
    const stage = 7;
    applyLoad(stage, CENTER, layers, SIZE);
    expect(layers.vitality[CENTER]).toBe(0);
  });

  it('枯死は 1 を超えない', () => {
    const layers = mkLayers();
    layers.litter.fill(0.9999);
    const stage = 6;
    applyLoad(stage, CENTER, layers, SIZE);
    expect(layers.litter[CENTER]).toBeLessThanOrEqual(1);
  });

  it('半径・量は段階が上がるほど広く強くなる', () => {
    for (let stage = 1; stage < LOAD_RADIUS.length - 1; stage++) {
      expect(LOAD_RADIUS[stage + 1]).toBeGreaterThan(LOAD_RADIUS[stage]);
      expect(LOGGING[stage + 1]).toBeGreaterThan(LOGGING[stage]);
      expect(VITALITY_DRAIN[stage + 1]).toBeGreaterThan(VITALITY_DRAIN[stage]);
      expect(POP_NEED[stage + 1]).toBeGreaterThan(POP_NEED[stage]);
    }
  });

  it('段階が高いほど半径内で失われる森の総量が多い (単体)', () => {
    const low = mkLayers();
    const high = mkLayers();
    applyLoad(2, CENTER, low, SIZE);
    applyLoad(6, CENTER, high, SIZE);
    const sum = (arr: Float32Array) => Array.from(arr).reduce((a, b) => a + b, 0);
    const lostLow = N * 0.6 - sum(low.forest);
    const lostHigh = N * 0.6 - sum(high.forest);
    expect(lostHigh).toBeGreaterThan(lostLow);
  });
});

describe('checkDecline', () => {
  it('stage 0 は衰退しない', () => {
    expect(checkDecline(0, 0, 0).decline).toBe(false);
  });

  it('population が POP_NEED 未満なら reason: population', () => {
    const stage = 3;
    const r = checkDecline(stage, POP_NEED[stage] - 0.001, 1);
    expect(r.decline).toBe(true);
    expect(r.reason).toBe('population');
  });

  it('population が POP_NEED ちょうどなら衰退しない (境界)', () => {
    const stage = 3;
    const r = checkDecline(stage, POP_NEED[stage], 1);
    expect(r.decline).toBe(false);
  });

  it('生気平均が VITALITY_FLOOR 未満なら reason: vitality', () => {
    const stage = 2;
    const r = checkDecline(stage, POP_NEED[stage] + 10, VITALITY_FLOOR - 0.001);
    expect(r.decline).toBe(true);
    expect(r.reason).toBe('vitality');
  });

  it('生気平均が VITALITY_FLOOR ちょうどなら衰退しない (境界)', () => {
    const stage = 2;
    const r = checkDecline(stage, POP_NEED[stage] + 10, VITALITY_FLOOR);
    expect(r.decline).toBe(false);
  });

  it('population・生気ともに十分なら衰退しない', () => {
    const stage = 4;
    const r = checkDecline(stage, POP_NEED[stage] + 10, 0.9);
    expect(r.decline).toBe(false);
    expect(r.reason).toBeUndefined();
  });
});

describe('星の門 (M10-02): populationFor / canAscend', () => {
  // 半径 8 と 12 の差が出るように、このブロックだけ 32×32 の格子 (中心 (16,16)) を使う
  const S2 = 32;
  const N2 = S2 * S2;
  const C2 = 16 * S2 + 16;
  const mkPops = () => {
    const pops = new Float32Array(N2).fill(0);
    // 中心から距離 8 以内は 0.01、それより外 (9〜12) は 1.0: 半径 8 と 12 で数が大きく変わるようにする
    for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) {
      const d = Math.max(Math.abs(x - 16), Math.abs(y - 16));
      pops[y * S2 + x] = d <= 8 ? 0.01 : 1.0;
    }
    return pops;
  };
  it('populationFor は星 (7) だけ STAR_RADIUS (= LOAD_RADIUS[7] = 12) で数え、塔以下は SUPPORT_RADIUS で数える', () => {
    expect(STAR_RADIUS).toBe(LOAD_RADIUS[7]);
    const elev = new Float32Array(N2).fill(0.5);
    const pops = mkPops();
    const tower = populationFor(6, pops, C2, elev, S2);
    const star = populationFor(7, pops, C2, elev, S2);
    expect(tower).toBeCloseTo(populationAround(pops, C2, elev, S2), 6);
    expect(tower).toBeLessThan(5);
    expect(star).toBeGreaterThan(50);
    expect(populationFor(7, pops, -1, elev, S2)).toBe(0);
  });
  it('populationFor は海のセルを数えない', () => {
    const elev = new Float32Array(N2).fill(SEA_LEVEL - 0.01);
    expect(populationFor(7, mkPops(), C2, elev, S2)).toBe(0);
  });
  it('canAscend: 塔以下は支え半径の民だけを見る (信仰は要らない)', () => {
    expect(canAscend({ stage: 5, population: POP_NEED[6], faith: 0 })).toBe(true);
    expect(canAscend({ stage: 5, population: POP_NEED[6] - 0.01, faith: 1, populationStar: 100 })).toBe(false);
  });
  it('canAscend: 塔 → 星は半径 12 の民 ≥ POP_NEED[7] かつ信仰 ≥ STAR_FAITH (0.8)。支え半径の民が足りなくてもよい', () => {
    expect(STAR_FAITH).toBe(0.8);
    expect(canAscend({ stage: 6, population: 0, populationStar: POP_NEED[7], faith: STAR_FAITH })).toBe(true);
    expect(canAscend({ stage: 6, population: 100, populationStar: POP_NEED[7], faith: STAR_FAITH - 0.01 })).toBe(false);
    expect(canAscend({ stage: 6, population: 100, populationStar: POP_NEED[7] - 0.01, faith: 1 })).toBe(false);
    // populationStar / faith が無い (古いセーブ) なら 0 扱いで上がらない
    expect(canAscend({ stage: 6, population: 100 })).toBe(false);
  });
  it('canAscend: 最大段階ならこれ以上は無いので true', () => {
    expect(canAscend({ stage: 7, population: 0 })).toBe(true);
  });
});
