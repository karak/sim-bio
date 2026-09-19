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
    for (const l of ['terrain', 'temperature', 'moisture', 'vegetation', 'vitality', 'species:grass'] as const) {
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
});
