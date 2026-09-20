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
  /**
   * 塔の燃料の直近の年次実績 (M8-08)。stepCivYearly が年に一度更新するので、発生直後・年をまたぐ前は
   * まだ無い (undefined)。既存のテスト・セーブとの互換を保つため省略可にしてある。
   */
  fuel?: { last: number; need: number; shortYears: number };
};

/** 段階の名前。stage をそのまま index に使う。 */
export const STAGE_NAMES = ['なし', '巣', '火', '歌', '石', '帆', '塔', '星'] as const;

/** 最大段階 (星)。これを超えては上がらない */
export const MAX_STAGE = STAGE_NAMES.length - 1;

/** 集落候補地の発生判定 (植生チェック) に使う半径 (セル)。集落 1 つ分の局所的な広さでよい */
export const HOME_RADIUS = 3;
/**
 * 文明を支える人口・生気を数える半径 (セル)。
 * 校正 (M8-05): HOME_RADIUS (3、集落そのものの広さ) だと局所密度しか拾えず、
 * 鹿のように島に薄く広がる種では人口がほぼ 0 になって POP_NEED と比較にならない
 * (実測 stage 6 で HOME_RADIUS=3 なら ~0.0〜0.02、SUPPORT_RADIUS=8 で ~0.1〜0.3)。
 * 段階の負荷が及ぶ範囲 (LOAD_RADIUS) に近い広さまで広げ、地域の豊かさを拾えるようにする。
 * populationAround (population/vitality 判定) にだけ使い、発生判定の植生チェックには使わない。
 */
export const SUPPORT_RADIUS = 8;
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
export const MINE_RATE: readonly number[] = [0, 0.0004, 0.0005, 0.0006, 0.0007, 0.0008, 0.001, 0];
// 校正 (M8-06): 元の 10 倍の値では stage 6 → 7 が 1 年で終わり、塔の重さで放置の塔がすぐ星になった。
// 1 段階に約 9 年 (NEED / (rate × 360)) かかる速さに落とした

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
  /** false なら掘っても段階は上がらず、progress は NEED で頭打ち (民が次の段階の必要量に足りないとき。M8-06) */
  canAdvance = true,
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
    if (canAdvance) {
      stage += 1;
      progress = 0;
    } else {
      progress = NEED[stage];
    }
  }
  return { state: { ...state, stage, progress }, mined };
}

/** home 半径 SUPPORT_RADIUS 以内の陸セルにいるその種の総量 (人口)。home が無ければ 0。 */
export function populationAround(pops: Float32Array, home: number, elevation: Float32Array, size: number): number {
  if (home < 0) return 0;
  let sum = 0;
  forEachInRadius(home, SUPPORT_RADIUS, size, (i) => {
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
