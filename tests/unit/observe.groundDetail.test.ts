import { describe, it, expect } from 'vitest';
import {
  RELIEF,
  cavityShade,
  clodHeight,
  groundDetailPixels,
  pebbleHeight,
  pebbleStone,
  PEBBLE_GRID,
  rippleHeight,
  rockHeight,
} from '../../src/observe/render/groundDetail';

const FIELDS = { clod: clodHeight, pebble: pebbleHeight, ripple: rippleHeight, rock: rockHeight };

/** 升の 0〜1 の座標を n × n の画素の真ん中で読む */
function sample(f: (u: number, v: number) => number, n = 128): number[] {
  const out: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(f((i + 0.5) / n, (j + 0.5) / n));
  return out;
}
const quantile = (xs: readonly number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))];

/** 小石の格子の全部のマスの石 (無いマスは除く) */
function stones() {
  const out: { ox: number; oy: number; r: number }[] = [];
  for (let gy = 0; gy < PEBBLE_GRID; gy++) for (let gx = 0; gx < PEBBLE_GRID; gx++) {
    const s = pebbleStone(gx, gy);
    if (s) out.push(s);
  }
  return out;
}

describe('観察画面 (地面の質感): 質感の升', () => {
  it('決定論: 同じ大きさで 2 回作ると同じ画素になる (起動ごとに升が変わらない)', () => {
    const a = groundDetailPixels(32);
    const b = groundDetailPixels(32);
    expect(a.length).toBe(32 * 32 * 4);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('どの組も高さは 0〜1 に収まり、平らな一色ではない', () => {
    for (const [name, f] of Object.entries(FIELDS)) {
      const xs = sample(f, 64);
      expect(Math.min(...xs), name).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs), name).toBeLessThanOrEqual(1);
      // (小石はまばらなので 5〜95% では平らに見える。いちばん低い所と高い所の差で見る)
      expect(Math.max(...xs) - Math.min(...xs), name).toBeGreaterThan(0.3);
    }
  });

  it('継ぎ目が無い: 升の左端と右端、上端と下端で高さが揃う (世界座標に繰り返し敷く)', () => {
    for (const [name, f] of Object.entries(FIELDS)) {
      for (let k = 0; k <= 32; k++) {
        const t = k / 32;
        expect(Math.abs(f(0, t) - f(1, t)), `${name} u の端 ${t}`).toBeLessThan(1e-9);
        expect(Math.abs(f(t, 0) - f(t, 1)), `${name} v の端 ${t}`).toBeLessThan(1e-9);
      }
    }
  });
});

describe('観察画面 (地面の質感): 小石を減らし、大きさを散らす', () => {
  it('石のあるマスは格子の 1〜2 割 (前は 4 割)', () => {
    const n = stones().length / (PEBBLE_GRID * PEBBLE_GRID);
    expect(n).toBeGreaterThan(0.1);
    expect(n).toBeLessThanOrEqual(0.2);
  });

  it('石の大きさが散る: いちばん大きい石は小さい石の 3 倍以上、ばらつき (標準偏差 ÷ 平均) 0.35 以上、小さい石が多い', () => {
    const r = stones().map((s) => s.r);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
    expect(Math.max(...r) / Math.min(...r)).toBeGreaterThanOrEqual(3);
    expect(sd / mean).toBeGreaterThanOrEqual(0.35);
    expect(quantile(r, 0.5)).toBeLessThan(mean);
    // 大きい石も隣のマスの石の探し (3 × 3) からはみ出さない
    for (const s of r) expect(s * 1.35).toBeLessThan(1);
  });

  it('石が盛り上がる面積は升の 6% 以下 (前は 8.6%)、石の真ん中は盛り上がる', () => {
    const xs = sample(pebbleHeight, 192);
    const raised = xs.filter((h) => h > 0.5).length / xs.length;
    expect(raised).toBeLessThanOrEqual(0.06);
    expect(raised).toBeGreaterThan(0.01);
    for (let gy = 0; gy < PEBBLE_GRID; gy++) for (let gx = 0; gx < PEBBLE_GRID; gx++) {
      const s = pebbleStone(gx, gy);
      if (!s) continue;
      expect(pebbleHeight((gx + s.ox) / PEBBLE_GRID, (gy + s.oy) / PEBBLE_GRID), `石 ${gx},${gy}`).toBeGreaterThan(0.7);
    }
  });
});

describe('観察画面 (地面の質感): 起伏の明暗を強める', () => {
  it('窪みの陰の掛け方は上限と下限で止まる (真っ黒・白飛びにしない)', () => {
    expect(cavityShade(-10, 1)).toBe(RELIEF.shadeMin);
    expect(cavityShade(10, 1)).toBe(RELIEF.shadeMax);
    expect(cavityShade(0, 0.5)).toBe(1);
    expect(RELIEF.shadeMin).toBeGreaterThan(0.3);
    expect(RELIEF.shadeMax).toBeLessThan(1.5);
  });

  it('土の塊と岩の升の 5〜95% の高さの差が、明るさで土 3 割・岩 6 割以上の差になる (前は土 2 割・岩 5.5 割)', () => {
    const [grassCavity, , , rockCavity] = RELIEF.cavity;
    const spread = (f: (u: number, v: number) => number, cavity: number) => {
      const xs = sample(f, 96);
      return cavityShade(quantile(xs, 0.95) - 0.5, cavity) - cavityShade(quantile(xs, 0.05) - 0.5, cavity);
    };
    expect(spread(clodHeight, grassCavity)).toBeGreaterThanOrEqual(0.3);
    expect(spread(rockHeight, rockCavity)).toBeGreaterThanOrEqual(0.6);
  });

  it('法線を揺らす起伏の高さは前より大きい (近い升の土の塊 0.11 m・岩 0.2 m より)', () => {
    // mat4 は列ごと: 列 0 草地の土・列 1 むき出しの土・列 2 砂・列 3 岩、行は升の組 (R 土の塊・G 小石・B 風紋・A 岩)
    expect(RELIEF.ampNear[0]).toBeGreaterThan(0.11);
    expect(RELIEF.ampNear[15]).toBeGreaterThan(0.2);
    expect(RELIEF.ampNear).toHaveLength(16);
    expect(RELIEF.ampFar).toHaveLength(16);
  });
});
