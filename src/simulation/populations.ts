import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import { MIN_DENSITY, suitability } from './vegetation';
import type { SpeciesDef } from './types';

export type PopulationEnv = { elevation: Float32Array; temperature: Float32Array; moisture: Float32Array };

const TROPHIC_ORDER = { plant: 0, herbivore: 1, carnivore: 2 } as const;

/**
 * 1 tick 分の動物の更新 (Lotka-Volterra 型、摂食応答は線形)。草食獣 → 肉食獣の順に処理する。
 * 各セルで
 *   food = Σ 餌種の密度
 *   摂取量 = predation·p·food
 *   p' = p + growthRate·f·摂取量 − mortality·(2 − f)·p
 *   餌種の密度 −= predation·p·(餌種の密度)
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
    for (let i = 0; i < n; i++) {
      if (env.elevation[i] < SEA_LEVEL) {
        scratch[i] = 0;
        continue;
      }
      let food = 0;
      for (const q of prey) food += q[i];
      const f = suitability(d, env.temperature[i], env.moisture[i]);
      const v = p[i];
      scratch[i] = v + d.growthRate * f * predation * food * v - d.mortality * (2 - f) * v;
      if (predation > 0 && v > 0) {
        const k = 1 - predation * v;
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
