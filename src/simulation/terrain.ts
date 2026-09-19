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
      const m = (fbm(noise2, nx * 2 + 10, ny * 2 + 10) + 1) / 2;
      const lowland = 1 - Math.max(0, e - SEA_LEVEL) / (1 - SEA_LEVEL);
      moistureBase[y * size + x] = Math.min(1, Math.max(0, 0.35 * m + 0.45 * lowland + 0.1));
    }
  }
  return { elevation, moistureBase };
}
