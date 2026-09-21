import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import type { SpeciesDef } from './types';
import { veinCap, veinFactor } from './vein';

/** 分解者がいなくても進む基礎分解率 (1 tick に枯死のこの割合が生気になる) */
export const BASE_DECOMPOSITION = 0.00005;
/** 分解者密度 1 あたりの分解率の上乗せ */
export const DECOMPOSER_BOOST = 0.02;
/** 生気の拡散率 */
export const VITALITY_DIFFUSION = 0.02;
/** 生気の漏出 (1 tick に失われる割合)。分解がなければ生気は減り続ける */
export const VITALITY_LEACH = 0.00015;
/** 植物の成長 1 単位が消費する生気 */
export const VITALITY_COST = 0.02;
/** 生気がこの値で成長率が最大の半分になる */
export const VITALITY_HALF = 0.05;
/** create 時の生気 */
export const INITIAL_VITALITY = 0.6;

export type VitalityState = {
  elevation: Float32Array;
  vitality: Float32Array;
  litter: Float32Array;
  populations: Record<string, Float32Array>;
  /** 霊脈の細り [0,1] (M9-03、vein.ts の computeVeinLoss)。省略時は 0 (今までどおり) */
  veinLoss?: Float32Array;
};

/** 生気による植物の成長係数 [0,1] */
export function vitalityFactor(v: number): number {
  return v / (v + VITALITY_HALF);
}

/**
 * 1 tick 分の分解と生気の移動。
 *   分解率 k = BASE + BOOST·(分解者密度)。枯死の k 倍が生気に移る
 *   生気は 4 近傍へ拡散し、LEACH だけ漏出する。海は常に 0
 */
export function stepVitality(s: VitalityState, decomposers: SpeciesDef[], scratch: Float32Array, size: number): void {
  const n = size * size;
  for (let i = 0; i < n; i++) {
    if (s.elevation[i] < SEA_LEVEL) {
      s.vitality[i] = 0;
      s.litter[i] = 0;
      scratch[i] = 0;
      continue;
    }
    let boost = 0;
    for (const d of decomposers) boost += s.populations[d.id][i];
    // 霊脈が細った土地では分解者の効きが落ちる (M9-03)。基礎分解は土地の性質なので落とさない
    const vein = s.veinLoss ? veinFactor(s.veinLoss[i]) : 1;
    const k = Math.min(1, BASE_DECOMPOSITION + DECOMPOSER_BOOST * boost * vein);
    const moved = s.litter[i] * k;
    s.litter[i] -= moved;
    scratch[i] = s.vitality[i] + moved;
  }
  for (let i = 0; i < n; i++) {
    if (s.elevation[i] < SEA_LEVEL) continue;
    let sum = 0;
    let c = 0;
    forEachNeighbor4(i, size, (j) => {
      if (s.elevation[j] >= SEA_LEVEL) {
        sum += scratch[j];
        c++;
      }
    });
    const mean = c ? sum / c : scratch[i];
    let v = scratch[i] + VITALITY_DIFFUSION * (mean - scratch[i]);
    v *= 1 - VITALITY_LEACH;
    // 霊脈は生気の器 (M9-03): 脈が細った土地は 1 − VEIN_LOSS × veinLoss までしか生気を保てない。脈が尽きれば 0
    const cap = s.veinLoss ? veinCap(s.veinLoss[i]) : 1;
    s.vitality[i] = v < 0 ? 0 : v > cap ? cap : v;
  }
}
