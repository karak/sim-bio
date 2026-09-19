import { mulberry32 } from '../simulation/rng';

/**
 * 密度に応じてセル内に個体を決定論的にばらまく。
 * out に [x, y(標高), z] を書き、書いた個数を返す。座標はグリッド中心が原点。
 */
export function scatterInstances(
  density: Float32Array,
  elevation: Float32Array,
  size: number,
  maxPerCell: number,
  seed: number,
  out: Float32Array,
): number {
  const cap = Math.floor(out.length / 3);
  let k = 0;
  const half = size / 2;
  for (let i = 0; i < density.length && k < cap; i++) {
    const count = Math.round(density[i] * maxPerCell);
    if (count <= 0) continue;
    const rng = mulberry32((seed * 7919 + i) >>> 0);
    const cx = i % size;
    const cy = (i - cx) / size;
    for (let c = 0; c < count && k < cap; c++, k++) {
      out[k * 3] = cx - half + rng();
      out[k * 3 + 1] = elevation[i];
      out[k * 3 + 2] = cy - half + rng();
    }
  }
  return k;
}
