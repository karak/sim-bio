import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import { MIN_DENSITY, suitability } from './vegetation';
import type { SpeciesDef } from './types';

export type PopulationEnv = {
  elevation: Float32Array;
  temperature: Float32Array;
  moisture: Float32Array;
  /** 草食獣が植物を食べた量を積む。植物の回復遅れに使う。省略可 */
  grazed?: Float32Array;
  /** 枯死。動物の死亡分を積み、分解者の餌になる。省略可 */
  litter?: Float32Array;
  /** 局所加熱 (火山の熱)。minHeat を持つ種の適合度に掛かる。省略可 */
  heat?: Float32Array;
};

/** 植物を 1 単位食べたとき grazed に積む量。大きいほど回復が遅い */
export const GRAZE_IMPACT = 3;
/** 熱でしか生きられない種 (minHeat) が、熱のあるセルに自然に湧くときの密度 (M8-05 v2)。絶滅していても熱があれば戻る */
export const HEAT_SEED = 0.01;
/**
 * 熱の外での繁殖力の下限 (M8-05 v2)。0 だと熱が冷めた瞬間に消える種になり、火の代償が残らない。
 * 下限を持たせると、一度湧いた種は弱い捕食者として居着き、噴火のたびに増える。校正 (M8-05 v2) では 0.25 で
 * 島中に広がってしまったので 0 にし、代わりに死亡率を低くして「熱が冷めても 2 年ほど歩き回る」形で代償を残す
 */
export const HEAT_FLOOR = 0;

const TROPHIC_ORDER = { plant: 0, herbivore: 1, carnivore: 2, decomposer: 3 } as const;

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
  const grazed = env.grazed;
  const litter = env.litter;
  for (const d of ordered) {
    const p = pops[d.id];
    const prey = (d.eats ?? []).map((id) => pops[id]).filter((arr): arr is Float32Array => arr !== undefined);
    const eatsPlants = d.trophic === 'herbivore';
    // 分解者の餌は枯死。枯死そのものは stepVitality で分解されるのでここでは減らさない
    const eatsLitter = d.trophic === 'decomposer';
    const predation = d.predation ?? 0;
    const handling = d.handlingTime ?? 0;
    for (let i = 0; i < n; i++) {
      if (env.elevation[i] < SEA_LEVEL) {
        scratch[i] = 0;
        continue;
      }
      let food = 0;
      if (eatsLitter) food = litter ? litter[i] : 0;
      else for (const q of prey) food += q[i];
      // 熱でしか生きられない種 (minHeat): 熱が無ければ適合度 0、minHeat 以上で満点 (M8-05 v2)
      const heatGate = d.minHeat && d.minHeat > 0 ? Math.max(HEAT_FLOOR, Math.min(1, (env.heat ? env.heat[i] : 0) / d.minHeat)) : 1;
      const f = suitability(d, env.temperature[i], env.moisture[i]);
      // 熱のあるセルには、いなくても湧く (熱でしか生きられない種の特性)。熱が冷めれば増えなくなり、
      // 死亡率 (2 − f·熱) で消えていくが、それまでは拡散で歩き回って周りの餌を食う
      const heatSpecies = !!d.minHeat && d.minHeat > 0;
      const v = heatSpecies && heatGate >= 1 && p[i] < HEAT_SEED ? HEAT_SEED : p[i];
      const g = functionalResponse(predation, handling, food);
      const fg = f * heatGate;
      const death = d.mortality * (2 - fg) * v;
      scratch[i] = v + d.growthRate * fg * g * v - death;
      if (litter && !eatsLitter) litter[i] = Math.min(1, litter[i] + death);
      if (!eatsLitter && g > 0 && v > 0 && food > 0) {
        // 取り除く総量 g·v を餌種ごとに比例配分する。1 を超えないよう clamp
        const k = Math.max(0, 1 - (g * v) / food);
        for (const q of prey) {
          const nv = q[i] * k;
          q[i] = nv < MIN_DENSITY ? 0 : nv;
        }
        if (grazed && eatsPlants) {
          const ng = grazed[i] + GRAZE_IMPACT * Math.min(g * v, food);
          grazed[i] = ng > 1 ? 1 : ng;
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
