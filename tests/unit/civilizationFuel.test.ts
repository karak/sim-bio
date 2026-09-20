import { describe, it, expect } from 'vitest';
import { collectFuel, FUEL_NEED, HEAT_FUEL, TIMBER_RATE, FUEL_YEARS, type FuelLayers } from '../../src/simulation/civilizationFuel';
import { LOAD_RADIUS } from '../../src/simulation/civilizationLoad';
import { SEA_LEVEL } from '../../src/simulation/terrain';

const SIZE = 21;
const N = SIZE * SIZE;
const CENTER = 10 * SIZE + 10; // (10, 10)

const mkLand = (): Float32Array => new Float32Array(N).fill(0.5); // SEA_LEVEL より高い一様な陸

const mkLayers = (over: Partial<FuelLayers> = {}): FuelLayers => ({
  heat: new Float32Array(N),
  elevation: mkLand(),
  ...over,
});

describe('collectFuel', () => {
  it('stage 0〜3 (FUEL_NEED 0) では熱があっても何も取らない', () => {
    for (const stage of [0, 1, 2, 3]) {
      const layers = mkLayers({ heat: new Float32Array(N).fill(10) });
      const before = Array.from(layers.heat);
      const r = collectFuel(stage, CENTER, layers, SIZE);
      expect(r.fuel).toBe(0);
      expect(r.heatUsed).toBe(0);
      expect(layers.heat[CENTER]).toBeCloseTo(before[CENTER], 6);
    }
  });

  it('home が -1 (未発生) なら何もしない', () => {
    const layers = mkLayers({ heat: new Float32Array(N).fill(10) });
    const r = collectFuel(6, -1, layers, SIZE);
    expect(r.fuel).toBe(0);
  });

  it('熱が need を大きく上回るとき、fuel は need で頭打ちになり、熱は比例して減る', () => {
    const stage = 6;
    const heatValue = 5;
    const layers = mkLayers({ heat: new Float32Array(N).fill(heatValue) });
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(r.fuel).toBeCloseTo(FUEL_NEED[stage], 6);
    expect(r.heatUsed).toBeCloseTo(FUEL_NEED[stage] / HEAT_FUEL, 6);
    expect(r.timberUsed).toBe(0);
    // 中心セルの熱は全セル同率で減っているはず (総量に対する使用量の比だけ減る)
    const radius = LOAD_RADIUS[stage];
    let count = 0;
    const cx = CENTER % SIZE;
    const cy = (CENTER - cx) / SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) count++;
      }
    }
    const k = r.heatUsed / (count * heatValue);
    expect(layers.heat[CENTER]).toBeCloseTo(heatValue * (1 - k), 6);
    expect(layers.heat[CENTER]).toBeGreaterThan(0);
  });

  it('熱だけで need に足りないとき、不足分だけ鐘樹の材で補う (timber は熱が足りない時だけ使う)', () => {
    const stage = 6;
    // LOAD_RADIUS[6] 内は 253 セルあるので、heatTotal (253 × heatValue) が heatNeeded (18) を
    // 下回るよう heatValue を小さくして、意図的に熱を不足させる
    const heatValue = 0.02;
    const belltreeValue = 1;
    const layers = mkLayers({ heat: new Float32Array(N).fill(heatValue), belltree: new Float32Array(N).fill(belltreeValue) });
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(r.fuel).toBeCloseTo(FUEL_NEED[stage], 6);
    expect(r.timberUsed).toBeGreaterThan(0);
    // 熱は使い切って (残量少ないので) ほぼ 0 になる
    expect(layers.heat[CENTER]).toBeCloseTo(0, 6);
    // 鐘樹は一部だけ減る (0 未満にはならない、TIMBER_RATE 全量よりは控えめ)
    expect(layers.belltree![CENTER]).toBeLessThan(belltreeValue);
    expect(layers.belltree![CENTER]).toBeGreaterThan(belltreeValue * (1 - TIMBER_RATE));
  });

  it('belltree レイヤーが無ければ熱だけで賄える分だけ (timber は 0)', () => {
    const stage = 6;
    const layers = mkLayers({ heat: new Float32Array(N).fill(0.02) }); // belltree 省略 (熱も不足させる)
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(r.timberUsed).toBe(0);
    expect(r.fuel).toBeLessThan(FUEL_NEED[stage]);
  });

  it('熱が need 以内で足りているときは鐘樹に触らない', () => {
    const stage = 6;
    const layers = mkLayers({ heat: new Float32Array(N).fill(5), belltree: new Float32Array(N).fill(1) });
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(r.timberUsed).toBe(0);
    expect(layers.belltree![CENTER]).toBe(1);
  });

  it('半径外の熱は使わない (LOAD_RADIUS[stage] を尊重する)', () => {
    const stage = 4; // LOAD_RADIUS[4] = 5
    const layers = mkLayers();
    // 半径のすぐ外側のセルにだけ熱を置く
    const outside = CENTER + (LOAD_RADIUS[stage] + 3) * SIZE;
    layers.heat[outside] = 100;
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(r.fuel).toBe(0);
    expect(layers.heat[outside]).toBe(100); // 変化しない
  });

  it('海セルの熱は数えず、減らさない', () => {
    const stage = 6;
    const layers = mkLayers({ heat: new Float32Array(N).fill(5) });
    layers.elevation[CENTER] = SEA_LEVEL - 0.1; // 集落セル自体を海にする (極端だが判定だけを見る)
    const before = layers.heat[CENTER];
    const r = collectFuel(stage, CENTER, layers, SIZE);
    expect(layers.heat[CENTER]).toBeCloseTo(before, 6); // 海セルは対象外なので変化しない
    expect(r.fuel).toBeGreaterThan(0); // 他の陸セルの熱は使われる
  });
});

describe('sanity', () => {
  it('FUEL_NEED は 8 段階分あり、stage 1〜3 は 0、4 以降は単調増加する', () => {
    expect(FUEL_NEED.length).toBe(8);
    expect(FUEL_NEED[0]).toBe(0);
    expect(FUEL_NEED[1]).toBe(0);
    expect(FUEL_NEED[2]).toBe(0);
    expect(FUEL_NEED[3]).toBe(0);
    for (let stage = 4; stage < FUEL_NEED.length - 1; stage++) {
      expect(FUEL_NEED[stage + 1]).toBeGreaterThan(FUEL_NEED[stage]);
    }
    expect(FUEL_YEARS).toBeGreaterThan(0);
  });
});
