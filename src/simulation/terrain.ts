import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';

/** この標高未満は海。 */
export const SEA_LEVEL = 0.3;

export type Terrain = { elevation: Float32Array; moistureBase: Float32Array };

type Noise2D = (x: number, y: number) => number;

function fbm(n: Noise2D, x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < 5; o++) {
    v += amp * n(x * f, y * f);
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

/** 輝石が陸セルに占める目標割合。閾値はこの割合から逆算するので地形が変わっても陸地比はほぼ一定 (M8-01) */
const CRYSTAL_COVERAGE = 0.08;
/** 輝石ノイズの空間スケール。小さいほど大きな塊になる (moistureBase の 6 より低周波にして塊状にする) */
const CRYSTAL_SCALE = 2.5;
/** seed とは別系統の乱数にするための XOR 定数 (moistureBase の 0x9e3779b9 とは別の値) */
const CRYSTAL_SEED_OFFSET = 0x5bd1e995;

/**
 * シードから島の標高と基礎水分を生成する。
 * 標高は [0,1]、外周 2 セルは必ず海。基礎水分は [0,1] で低地ほど湿る。
 */
export function generateTerrain(seed: number, size: number): Terrain {
  const noise = createNoise2D(mulberry32(seed));
  const noise2 = createNoise2D(mulberry32((seed ^ 0x9e3779b9) >>> 0));
  const elevation = new Float32Array(size * size);
  const moistureBase = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const d = Math.sqrt(nx * nx + ny * ny) * 2; // 中心 0 .. 角 ~1.41
      const mask = Math.max(0, 1 - d * d); // 放射状の減衰で島にする
      let e = (fbm(noise, nx * 3, ny * 3) + 1) / 2;
      e = e * 0.75 * mask + 0.05;
      const border = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (border < 2) e = Math.min(e, SEA_LEVEL - 0.05);
      elevation[y * size + x] = Math.min(1, Math.max(0, e));
      // 水分は高めの周波数のノイズを主にして、森・草原・乾燥地がパッチ状に混ざるようにする (生息地のモザイク)
      // fbm は中央に値が集まるのでコントラストを 2.4 倍に伸ばす
      const m = Math.min(1, Math.max(0, 0.5 + fbm(noise2, nx * 6 + 10, ny * 6 + 10) * 1.2));
      const lowland = 1 - Math.max(0, e - SEA_LEVEL) / (1 - SEA_LEVEL);
      moistureBase[y * size + x] = Math.min(1, Math.max(0, 0.6 * m + 0.3 * lowland + 0.05));
    }
  }
  return { elevation, moistureBase };
}

/**
 * 輝石の鉱脈を陸だけに決定論で置く (M8-01)。標高とは別系統のノイズを取り、
 * 陸セルのノイズ値の上位 CRYSTAL_COVERAGE 割を輝石の塊とする。
 * 閾値をノイズ値の分布から逆算するので、島の形が変わっても陸地に対する輝石の割合はほぼ一定になる。
 * 海セル (elevation < SEA_LEVEL) は必ず 0。純粋関数で、掘削 (M8-02) はここでは行わない。
 */
export function generateCrystal(seed: number, elevation: Float32Array, size: number): Float32Array {
  const noise = createNoise2D(mulberry32((seed ^ CRYSTAL_SEED_OFFSET) >>> 0));
  const n = size * size;
  const field = new Float32Array(n);
  const landValues: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (elevation[i] < SEA_LEVEL) continue;
      const nx = x / size - 0.5;
      const ny = y / size - 0.5;
      const v = (fbm(noise, nx * CRYSTAL_SCALE, ny * CRYSTAL_SCALE) + 1) / 2;
      field[i] = v;
      landValues.push(v);
    }
  }
  const crystal = new Float32Array(n);
  if (landValues.length === 0) return crystal;
  landValues.sort((a, b) => a - b);
  const cutIndex = Math.max(0, Math.min(landValues.length - 1, Math.floor(landValues.length * (1 - CRYSTAL_COVERAGE))));
  const threshold = landValues[cutIndex];
  const range = Math.max(1e-6, landValues[landValues.length - 1] - threshold);
  for (let i = 0; i < n; i++) {
    if (elevation[i] < SEA_LEVEL) continue;
    if (field[i] > threshold) crystal[i] = Math.min(1, (field[i] - threshold) / range);
  }
  return crystal;
}
