import { describe, it, expect } from 'vitest';
import { barkDetailPixels, crackMask, patchTone, ringWobble, strokeHeight } from '../../src/observe/render/barkDetail';

const FIELDS = { stroke: strokeHeight, patch: patchTone, ring: ringWobble, crack: crackMask };

/** 升の 0〜1 の座標を n × n の画素の真ん中で読む */
function grid(f: (u: number, v: number) => number, n = 96): number[][] {
  return Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => f((i + 0.5) / n, (j + 0.5) / n)));
}
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('観察画面 (M22-11): 樹皮の筆致の升', () => {
  it('決定論: 同じ大きさで 2 回作ると同じ画素になる', () => {
    const a = barkDetailPixels(32);
    expect(a.length).toBe(32 * 32 * 4);
    expect(Array.from(a)).toEqual(Array.from(barkDetailPixels(32)));
  });

  it('継ぎ目が無い: どの組も升の端 (u = 0 と 1、v = 0 と 1) で同じ値になる (幹の周りと軸の繰り返しで筋が切れない)', () => {
    for (const [name, f] of Object.entries(FIELDS)) {
      for (let t = 0.03; t < 1; t += 0.11) {
        expect(f(0, t), `${name} u`).toBeCloseTo(f(1, t), 6);
        expect(f(t, 0), `${name} v`).toBeCloseTo(f(t, 1), 6);
      }
    }
  });

  it('値は 0〜1 で、筋の高さは幅を持つ (平らな升でない)', () => {
    for (const f of Object.values(FIELDS)) {
      const xs = grid(f).flat();
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(1);
    }
    const s = grid(strokeHeight).flat();
    expect(Math.max(...s) - Math.min(...s)).toBeGreaterThan(0.6);
  });

  it('筆の筋は軸の向き (v) に長い: 隣の画素との差は周りの向き (u) の方が軸の向きより 3 倍以上大きい', () => {
    const g = grid(strokeHeight);
    const du: number[] = [];
    const dv: number[] = [];
    for (let j = 0; j < g.length - 1; j++) {
      for (let i = 0; i < g.length - 1; i++) {
        du.push(Math.abs(g[j][i + 1] - g[j][i]));
        dv.push(Math.abs(g[j + 1][i] - g[j][i]));
      }
    }
    expect(mean(du)).toBeGreaterThan(mean(dv) * 3);
  });

  it('裂け目は細い: 升の 3〜15% の画素だけが裂け目 (0.5 より上)', () => {
    const xs = grid(crackMask).flat();
    const frac = xs.filter((x) => x > 0.5).length / xs.length;
    expect(frac).toBeGreaterThan(0.03);
    expect(frac).toBeLessThan(0.15);
  });
});
