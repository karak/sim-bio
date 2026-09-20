import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import { populationAround } from './civilization';

/**
 * 文明の負荷と衰退判定 (M8-03)。純粋関数のみを置く。World は呼ぶだけ。
 * stage は civilization.ts の 0(なし)〜7(星) に合わせる。段階の配列は index = stage で参照する。
 */

/** 負荷が及ぶ半径 (セル)。段階が上がるほど広がる。stage 0 は文明なしなので 0 */
export const LOAD_RADIUS: readonly number[] = [0, 2, 3, 4, 5, 7, 9, 12];
/** 半径内の「森」種 (species id: forest) を 1 tick に削る量。削った分は枯死 (litter) に積む */
export const LOGGING: readonly number[] = [0, 0.0008, 0.0012, 0.0018, 0.0025, 0.004, 0.007, 0.011];
/** 半径内の生気を 1 tick に削る量 */
export const VITALITY_DRAIN: readonly number[] = [0, 0.0004, 0.0007, 0.001, 0.0015, 0.0025, 0.004, 0.006];
/**
 * その段階を維持するのに集落半径内で必要な種の総量。割ると stage が 1 下がる。
 * 校正 (M8-05): 元の [0,1,2,4,8,14,22,32] は「島全体で数十」規模の想定だったが、
 * 実際の populationAround (HOME_RADIUS 内の密度の和) は鹿のように島に薄く広がる種では
 * stage 6 でも 0.1〜0.3 程度にしかならない。実測に合わせて 2 桁小さいスケールに直す。
 */
export const POP_NEED: readonly number[] = [0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05];
/** 集落半径内の生気平均がこれを割ると stage が 1 下がる */
export const VITALITY_FLOOR = 0.1;

export type LoadLayers = {
  /** 森 (species id: forest) の密度 [0,1] */
  forest: Float32Array;
  /** 枯死 [0,1] */
  litter: Float32Array;
  /** 生気 [0,1] */
  vitality: Float32Array;
  elevation: Float32Array;
  /**
   * 文明の種の密度 [0,1] (省略可、校正 M8-05 で追加)。渡すと集落周りの populationAround を毎 tick 実測し、
   * POP_NEED[stage] に対する不足分だけ負荷 (伐採・生気消費) を弱める (働き手が少なければ伐り出しも消費も減る)。
   * 省略時は従来どおり常に全力 (factor 1) の負荷をかける (既存呼び出し・テストと同じ結果になる)。
   */
  civPopulation?: Float32Array;
};

/**
 * 集落 (home) 半径 LOAD_RADIUS[stage] 内の陸セルに 1 tick 分の負荷をかける。
 * 森は LOGGING[stage] だけ減り (0 未満にはならない)、減った分だけ枯死に積む (1 を超えない)。
 * 生気は VITALITY_DRAIN[stage] だけ減る (0 未満にはならない)。stage 0 または home 未設定 (< 0) は何もしない。
 * civPopulation を渡した場合、populationAround が POP_NEED[stage] を下回る分だけ logging/drain を按分で弱める
 * (疫病などで民を間引けば、その年から負荷が軽くなる。M8-05 校正で「間引いて負荷を下げる」を機能させるための変更)。
 */
export function applyLoad(stage: number, home: number, layers: LoadLayers, size: number): void {
  if (stage <= 0 || home < 0) return;
  const radius = LOAD_RADIUS[stage];
  if (!(radius > 0)) return;
  const need = POP_NEED[stage];
  const factor = !layers.civPopulation || need <= 0 ? 1 : Math.min(1, populationAround(layers.civPopulation, home, layers.elevation, size) / need);
  const logging = LOGGING[stage] * factor;
  const drain = VITALITY_DRAIN[stage] * factor;
  forEachInRadius(home, radius, size, (i) => {
    if (layers.elevation[i] < SEA_LEVEL) return;
    if (logging > 0) {
      const removed = Math.min(layers.forest[i], logging);
      layers.forest[i] -= removed;
      layers.litter[i] = Math.min(1, layers.litter[i] + removed);
    }
    if (drain > 0) layers.vitality[i] = Math.max(0, layers.vitality[i] - drain);
  });
}

/**
 * 衰退判定。stage ≥ 1 で、集落半径内の population が POP_NEED[stage] 未満、
 * または集落半径内の生気平均が VITALITY_FLOOR 未満なら decline。stage 1 → 0 は呼び出し側で崩壊として扱う。
 */
export function checkDecline(
  stage: number,
  population: number,
  vitalityMeanAroundHome: number,
): { decline: boolean; reason?: 'population' | 'vitality' } {
  if (stage < 1) return { decline: false };
  if (population < POP_NEED[stage]) return { decline: true, reason: 'population' };
  if (vitalityMeanAroundHome < VITALITY_FLOOR) return { decline: true, reason: 'vitality' };
  return { decline: false };
}
