import { describe, it, expect } from 'vitest';
import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_KERNELS, blurTaps, bloomSizes, bloomWeights } from '../../src/observe/render/bloom';

/** UnrealBloomPass の内側 (JS では見える所) */
type UnrealInside = {
  separableBlurMaterials: { uniforms: { centerWeight: { value: number }; gaussianOffsets: { value: number[] }; gaussianWeights: { value: number[] } } }[];
  renderTargetsVertical: { width: number; height: number }[];
  compositeMaterial: { uniforms: { bloomFactors: { value: number[] } } };
};

describe('光の滲み (M23-07、UnrealBloomPass と同じ計算)', () => {
  const unreal = new UnrealBloomPass(new Vector2(1, 1), 0.4, 0.5, 0.92) as unknown as UnrealInside & UnrealBloomPass;

  it('段ごとのぼかしの係数 (中心・線形補間の読みの位置と重み) が UnrealBloomPass と一致する', () => {
    BLOOM_KERNELS.forEach((k, i) => {
      const u = unreal.separableBlurMaterials[i].uniforms;
      const t = blurTaps(k);
      expect(t.center).toBeCloseTo(u.centerWeight.value, 12);
      expect(t.offsets).toHaveLength(u.gaussianOffsets.value.length);
      t.offsets.forEach((o, j) => expect(o).toBeCloseTo(u.gaussianOffsets.value[j], 12));
      t.weights.forEach((w, j) => expect(w).toBeCloseTo(u.gaussianWeights.value[j], 12));
    });
  });

  it('5 段を足す重みは 3 × strength × mix(factor, 1.2 − factor, radius) (radius 0.5 ではどの段も 0.72)', () => {
    const f = unreal.compositeMaterial.uniforms.bloomFactors.value;
    const w = bloomWeights(0.4, 0.5);
    w.forEach((x, i) => expect(x).toBeCloseTo(3 * 0.4 * (f[i] + (1.2 - 2 * f[i]) * 0.5), 12));
    w.forEach((x) => expect(x).toBeCloseTo(0.72, 12));
    // radius 0 では bloomFactors [1, 0.8, 0.6, 0.4, 0.2] のまま
    bloomWeights(1, 0).forEach((x, i) => expect(x).toBeCloseTo([3, 2.4, 1.8, 1.2, 0.6][i], 12));
  });

  it('段の大きさは UnrealBloomPass.setSize と同じ (半分から半分ずつ)', () => {
    for (const [w, h] of [
      [2560, 1440],
      [1280, 720],
      [1366, 768],
      [37, 11],
    ]) {
      unreal.setSize(w, h);
      expect(bloomSizes(w, h)).toEqual(unreal.renderTargetsVertical.map((t) => ({ w: Math.max(1, t.width), h: Math.max(1, t.height) })));
    }
    expect(bloomSizes(2560, 1440).map((s) => `${s.w}x${s.h}`)).toEqual(['1280x720', '640x360', '320x180', '160x90', '80x45']);
  });
});
