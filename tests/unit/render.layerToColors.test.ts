import { describe, it, expect } from 'vitest';
import { layerToColors } from '../../src/render/layerToColors';
import { grass } from './helpers';

const snap = () => {
  const n = 4;
  const elevation = new Float32Array(n).fill(0.5);
  elevation[0] = 0.1;
  return {
    size: 2,
    species: [grass],
    layers: {
      elevation,
      temperature: new Float32Array([10, -5, 15, 30]),
      moisture: new Float32Array([1, 0, 0.5, 1]),
      vegetation: new Float32Array([0, 0, 0.5, 1]),
      vitality: new Float32Array([0, 0.2, 0.6, 1]),
      litter: new Float32Array(4),
      populations: { grass: new Float32Array([0, 0, 0.5, 1]) },
    },
  };
};

describe('layerToColors', () => {
  it('returns size²×3 in [0,1] for every layer', () => {
    for (const l of ['terrain', 'temperature', 'moisture', 'vegetation', 'vitality', 'species:grass', 'suit:grass'] as const) {
      const c = layerToColors(snap(), l);
      expect(c.length).toBe(12);
      for (const v of c) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('sea is bluish on terrain, vegetation makes land greener', () => {
    const c = layerToColors(snap(), 'terrain');
    expect(c[2]).toBeGreaterThan(c[0]);
    // 「緑っぽい」= G が R を上回る度合いで比較する (砂色は G 成分自体は高い)
    expect(c[3 * 3 + 1] - c[3 * 3]).toBeGreaterThan(c[1 * 3 + 1] - c[1 * 3]);
  });
  it('temperature: cold is blue, hot is red', () => {
    const c = layerToColors(snap(), 'temperature');
    expect(c[1 * 3 + 2]).toBeGreaterThan(c[1 * 3 + 0]);
    expect(c[3 * 3 + 0]).toBeGreaterThan(c[3 * 3 + 2]);
  });
  it('reuses provided buffer', () => {
    const out = new Float32Array(12);
    expect(layerToColors(snap(), 'moisture', out)).toBe(out);
  });
  it('vitality: higher vitality is brighter', () => {
    const c = layerToColors(snap(), 'vitality');
    const lum = (i: number) => c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2];
    expect(lum(3)).toBeGreaterThan(lum(1));
  });
  it('suit:<id>: suitability 1 のセルは種の色、0 のセルは暗色になる', () => {
    // snap() では index2 (温度15℃・水分0.5) が grass の適合帯の中心で suitability=1、
    // index1 (温度-5℃・水分0) は範囲外で suitability=0 になる
    const c = layerToColors(snap(), 'suit:grass');
    expect(c[2 * 3]).toBeCloseTo(0x6f / 255, 2);
    expect(c[2 * 3 + 1]).toBeCloseTo(0xbf / 255, 2);
    expect(c[2 * 3 + 2]).toBeCloseTo(0x7c / 255, 2);
    expect(c[1 * 3]).toBeCloseTo(0x2a / 255, 2);
    expect(c[1 * 3 + 1]).toBeCloseTo(0x26 / 255, 2);
    expect(c[1 * 3 + 2]).toBeCloseTo(0x22 / 255, 2);
  });
  it('suit:<id>: 海は他レイヤーと同じ地形色のまま', () => {
    const cTerrain = layerToColors(snap(), 'terrain');
    const cSuit = layerToColors(snap(), 'suit:grass');
    expect(cSuit[0]).toBeCloseTo(cTerrain[0], 5);
    expect(cSuit[1]).toBeCloseTo(cTerrain[1], 5);
    expect(cSuit[2]).toBeCloseTo(cTerrain[2], 5);
  });
  it('suit:<id>: 未知の種 id でも例外にせず、陸は暗色 (全長 size²×3) を返す', () => {
    const c = layerToColors(snap(), 'suit:unknown');
    expect(c.length).toBe(12);
    expect(c[2 * 3]).toBeCloseTo(0x2a / 255, 2);
    expect(c[2 * 3 + 1]).toBeCloseTo(0x26 / 255, 2);
    expect(c[2 * 3 + 2]).toBeCloseTo(0x22 / 255, 2);
  });
});
