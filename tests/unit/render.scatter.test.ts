import { describe, it, expect } from 'vitest';
import { scatterInstances } from '../../src/render/scatter';

describe('scatterInstances', () => {
  it('writes round(density*max) per cell, deterministic, inside cell', () => {
    const d = new Float32Array([0, 0.5, 1, 0.25]);
    const e = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    const out = new Float32Array(100 * 3);
    const n = scatterInstances(d, e, 2, 4, 1, out);
    expect(n).toBe(0 + 2 + 4 + 1);
    const out2 = new Float32Array(100 * 3);
    scatterInstances(d, e, 2, 4, 1, out2);
    expect(Array.from(out2.subarray(0, n * 3))).toEqual(Array.from(out.subarray(0, n * 3)));
    for (let k = 0; k < n; k++) {
      expect(out[k * 3 + 1]).toBe(0.5);
      expect(Math.abs(out[k * 3])).toBeLessThanOrEqual(1);
    }
  });
  it('stops at buffer capacity', () => {
    const d = new Float32Array(4).fill(1);
    const e = new Float32Array(4).fill(0.5);
    const out = new Float32Array(5 * 3);
    expect(scatterInstances(d, e, 2, 4, 1, out)).toBe(5);
  });
});
