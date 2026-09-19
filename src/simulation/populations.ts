import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import { MIN_DENSITY, suitability } from './vegetation';
import type { SpeciesDef } from './types';

export type PopulationEnv = { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array };

const TROPHIC_ORDER = { plant: 0, herbivore: 1, carnivore: 2 } as const;

/**
 * 餌密度 food に対する 1 個体あたりの摂食率 (Holling II 型)。
 * handlingTime = 0 なら線形 (predation·food)、大きいほど 1/handlingTime で飽和する。
 */
export function functionalResponse(predation: number, handlingTime: number, food: number): number {
  return (predation * food) / (1 + predation * handlingTime * food);
}

/**
 * 1 tick 分の動物の更新 (Rosenzweig-MacArthur 型)。草食獣 → 肉食獣の順に処理する。
 * 各セルで
 *   food = Σ 餌種の密度
 *   摂食率 g = predation·food / (1 + predation·handlingTime·food)
 *   p' = p + growthRate·f·g·p − mortality·(2 − f)·p
 *   餌種の密度 −= (g·p / food)·(餌種の密度)   (= 各餌種から比例配分で g·p を取り除く)
 * 捕食者の密度は餌の量で自然に頭打ちになる。その後 4 近傍へ拡散。海は常に 0。
 */
export function stepPopulations(
  pops: Record<string, Float32Array>,
  scratch: Float32Array,
  env: PopulationEnv,
  animals: SpeciesDef[],
  size: number,
): void {
  const n = size * size;
  const ordered = [...animals].sort((a, b) => TROPHIC_ORDER[a.trophic] - TROPHIC_ORDER[b.trophic]);
  for (const d of ordered) {
    const p = pops[d.id];
    const prey = (d.eats ?? []).map((id) => pops[id]).filter((arr): arr is Float32Array => arr !== undefined);
    const predation = d.predation ?? 0;
    const handling = d.handlingTime ?? 0;
    for (let i = 0; i < n; i++) {
      if (env.elevation[i] < SEA_LEVEL) {
        scratch[i] = 0;
        continue;
      }
      let food = 0;
      for (const q of prey) food += q[i];
      const f = suitability(d, env.temperature[i], env.moisture[i]);
      const v = p[i];
      const g = functionalResponse(predation, handling, food);
      scratch[i] = v + d.growthRate * f * g * v - d.mortality * (2 - f) * v;
      if (g > 0 && v > 0 && food > 0) {
        // 取り除く総量 g·v を餌種ごとに比例配分する。1 を超えないよう clamp
        const k = Math.max(0, 1 - (g * v) / food);
        for (const q of prey) {
          const nv = q[i] * k;
          q[i] = nv < MIN_DENSITY ? 0 : nv;
        }
      }
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
}
