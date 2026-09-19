import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import type { SpeciesDef } from './types';

/** 適温帯の端から外へ、この幅で適合度が 1 → 0 に落ちる */
const TEMP_EDGE = 5;
const MOIST_EDGE = 0.15;
/** これ未満の密度は 0 とみなす (絶滅判定のため) */
export const MIN_DENSITY = 1e-4;

const ramp = (v: number, lo: number, hi: number, w: number): number =>
  v < lo ? Math.max(0, 1 - (lo - v) / w) : v > hi ? Math.max(0, 1 - (v - hi) / w) : 1;

/** 環境適合度 [0,1]。範囲内 1、範囲外は線形に 0 へ。 */
export function suitability(def: SpeciesDef, temp: number, moisture: number): number {
  return (
    ramp(temp, def.tempRange[0], def.tempRange[1], TEMP_EDGE) *
    ramp(moisture, def.moistureRange[0], def.moistureRange[1], MOIST_EDGE)
  );
}

/** 全植物種の密度合計を out に書く。 */
export function sumVegetation(pops: Record<string, Float32Array>, plants: SpeciesDef[], out: Float32Array): void {
  out.fill(0);
  for (const d of plants) {
    const p = pops[d.id];
    for (let i = 0; i < out.length; i++) out[i] += p[i];
  }
}

export type VegetationEnv = { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array };

/**
 * 1 tick 分の植生更新。
 * p' = p + r·f·p·(1 − total) − m·(2 − f)·p (基礎死亡 m に不適合分 m·(1−f) を加算)、
 * その後 4 近傍への拡散。海は常に 0。全種の合計が 1 を超えたら比例で縮める。
 * 適合 f=1 での平衡密度は 1 − m/r。
 */
export function stepVegetation(
  pops: Record<string, Float32Array>,
  scratch: Float32Array,
  env: VegetationEnv,
  plants: SpeciesDef[],
  size: number,
): void {
  const n = size * size;
  const total = new Float32Array(n);
  sumVegetation(pops, plants, total);
  for (const d of plants) {
    const p = pops[d.id];
    for (let i = 0; i < n; i++) {
      if (env.elevation[i] < SEA_LEVEL) {
        scratch[i] = 0;
        continue;
      }
      const f = suitability(d, env.temperature[i], env.moisture[i]);
      const v = p[i];
      scratch[i] = v + d.growthRate * f * v * (1 - total[i]) - d.mortality * (2 - f) * v;
    }
    for (let i = 0; i < n; i++) {
      if (env.elevation[i] < SEA_LEVEL) {
        p[i] = 0;
        continue;
      }
      let sum = 0;
      let c = 0;
      forEachNeighbor4(i, size, (j) => {
        if (env.elevation[j] >= SEA_LEVEL) {
          sum += scratch[j];
          c++;
        }
      });
      const mean = c ? sum / c : scratch[i];
      const v = scratch[i] + d.diffusion * (mean - scratch[i]);
      p[i] = v < MIN_DENSITY ? 0 : v > 1 ? 1 : v;
    }
  }
  // 容量 1 を全種で共有する。超えた分は比例で縮める
  sumVegetation(pops, plants, total);
  for (let i = 0; i < n; i++) {
    if (total[i] <= 1) continue;
    const k = 1 / total[i];
    for (const d of plants) pops[d.id][i] *= k;
  }
}
