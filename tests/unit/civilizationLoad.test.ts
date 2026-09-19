import { describe, it, expect } from 'vitest';
import {
  applyLoad,
  checkDecline,
  LOAD_RADIUS,
  LOGGING,
  VITALITY_DRAIN,
  POP_NEED,
  VITALITY_FLOOR,
  type LoadLayers,
} from '../../src/simulation/civilizationLoad';
import { SEA_LEVEL } from '../../src/simulation/terrain';

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
    expect(layers.forest[CENTER]).toBeCloseTo(0.6 - LOGGING[stage], 6);
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
    expect(removed).toBeCloseTo(LOGGING[stage], 6);
  });

  it('森は 0 未満にならない', () => {
    const layers = mkLayers();
    layers.forest.fill(0.0002);
    const stage = 7; // LOGGING[7] は 0.0002 よりずっと大きい
    applyLoad(stage, CENTER, layers, SIZE);
    expect(layers.forest[CENTER]).toBe(0);
    expect(layers.litter[CENTER]).toBeCloseTo(0.0002, 6);
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
