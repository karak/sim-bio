/**
 * 文明の発生と段階 (M8-02)。1 島 1 文明。World には依存しない純粋関数群。
 * 係数はすべてこのファイルの定数にまとめ、校正はここだけを触れば済むようにする。
 */
import { forEachInRadius } from './disaster';
import { amplitudeRatio } from './oscillation';
import { SEA_LEVEL } from './terrain';

/** 文明の状態。stage 0 = まだ発生していない。 */
export type CivState = {
  speciesId: string;
  /** 0..7 (なし・巣・火・歌・石・帆・塔・星) */
  stage: number;
  /** 現在の段階の進み [0,1) 相当 (NEED[stage] に対する掘削量の累計) */
  progress: number;
  /** 集落セル。まだ無ければ -1 */
  home: number;
  /** 集落半径内のその種の総量 */
  population: number;
};

/** 段階の名前。stage をそのまま index に使う。 */
export const STAGE_NAMES = ['なし', '巣', '火', '歌', '石', '帆', '塔', '星'] as const;

/** 最大段階 (星)。これを超えては上がらない */
export const MAX_STAGE = STAGE_NAMES.length - 1;

/** 集落の人口を数える半径 (セル) */
export const HOME_RADIUS = 3;
/** 発生条件: 集落候補セル周辺の植生 (森+草の合計) 平均がこれを超える */
export const EMERGE_VEGETATION = 0.4;
/** 発生条件: 直近 10 年の振幅比 (amplitudeRatio) がこれ未満 (振動していない) */
export const EMERGE_AMPLITUDE = 0.15;
/** 発生に必要な年次履歴の年数 */
export const EMERGE_HISTORY_YEARS = 10;

/**
 * 段階ごとの採掘半径 (セル)。index = stage。index 0 (なし) は未使用 (0 を入れておく)。
 * 段階が上がるほど遠くまで掘りに行けるようにする。
 */
export const MINE_RADIUS: readonly number[] = [0, 2, 2, 3, 3, 4, 4, 5];

/**
 * 段階ごとの採掘量 (1 tick あたり、半径内の輝石から合計で取り除く上限)。index = stage。
 * stage 7 (星) は最大段階なのでこれ以上掘っても進まない → 0 にして輝石を無駄に消費しない。
 */
export const MINE_RATE: readonly number[] = [0, 0.004, 0.005, 0.006, 0.007, 0.008, 0.01, 0];

/**
 * 段階ごとに次の段階へ上がるのに必要な progress の累計。index = stage (現在の段階)。
 * stage 0 は checkEmergence で発生するので未使用、stage 7 は最大段階なので未使用 (Infinity)。
 */
export const NEED: readonly number[] = [Infinity, 0.6, 1.0, 1.4, 1.8, 2.4, 3.2, Infinity];

/**
 * 発生判定。stage 0 のとき年に 1 回呼ぶ。
 * history はその種の年次総量 (直近 10 年、古い順)。振動していない (振幅比が小さい) かつ
 * 集落候補地の植生が十分あれば true。
 */
export function checkEmergence(history: number[], candidateVegetation: number): boolean {
  if (history.length < EMERGE_HISTORY_YEARS) return false;
  return amplitudeRatio(history) < EMERGE_AMPLITUDE && candidateVegetation > EMERGE_VEGETATION;
}

/**
 * 1 tick 分の採掘。home の周り MINE_RADIUS[stage] 以内の陸セルから、輝石の残量に比例して
 * (多いセルほど多く) 合計 MINE_RATE[stage] まで取り除き、取れた分だけ progress に足す。
 * 半径内に輝石が無ければ何も変わらない (mined = 0、stage も進まない)。
 * progress が NEED[stage] 以上になり、かつ最大段階でなければ stage を 1 つ上げ、progress は 0 に戻す。
 * crystal は呼び出し元の配列をその場で書き換える (他の step 関数と同じ流儀)。
 */
export function stepMining(
  state: CivState,
  crystal: Float32Array,
  elevation: Float32Array,
  size: number,
): { state: CivState; mined: number } {
  if (state.home < 0 || state.stage < 1 || state.stage > MAX_STAGE) return { state, mined: 0 };
  const radius = MINE_RADIUS[state.stage];
  const rate = MINE_RATE[state.stage];
  let total = 0;
  forEachInRadius(state.home, radius, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) total += crystal[i];
  });
  if (total <= 0 || rate <= 0) return { state, mined: 0 };
  const mined = Math.min(rate, total);
  // 残量に比例して各セルから取り除く (多いセルほど多く掘る、輝石が無いセルは変化なし)
  const k = mined / total;
  forEachInRadius(state.home, radius, size, (i) => {
    if (elevation[i] >= SEA_LEVEL && crystal[i] > 0) crystal[i] -= crystal[i] * k;
  });
  let stage = state.stage;
  let progress = state.progress + mined;
  if (stage < MAX_STAGE && progress >= NEED[stage]) {
    stage += 1;
    progress = 0;
  }
  return { state: { ...state, stage, progress }, mined };
}

/** home 半径 HOME_RADIUS 以内の陸セルにいるその種の総量 (人口)。home が無ければ 0。 */
export function populationAround(pops: Float32Array, home: number, elevation: Float32Array, size: number): number {
  if (home < 0) return 0;
  let sum = 0;
  forEachInRadius(home, HOME_RADIUS, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) sum += pops[i];
  });
  return sum;
}

/** WorldConfig.civilization の形 (main.ts がシナリオの start.civilization をこの形へ解決する) */
export type CivilizationConfig = { speciesId: string; start?: { stage: number; home: number } };

/**
 * シナリオの start.civilization を WorldConfig.civilization へ解決する。
 * home は他のコマンドと同じ規約で、省略または -1 なら島の中心セルにする。stage 省略時は 0 (まだ発生していない)。
 */
export function resolveCivilizationStart(
  start: { speciesId: string; stage?: number; home?: number } | undefined,
  size: number,
): CivilizationConfig | undefined {
  if (!start) return undefined;
  const home = start.home === undefined || start.home === -1 ? Math.floor(size / 2) * size + Math.floor(size / 2) : start.home;
  return { speciesId: start.speciesId, start: { stage: start.stage ?? 0, home } };
}
