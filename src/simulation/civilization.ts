/**
 * 文明の発生と段階 (M8-02)。1 島 1 文明。World には依存しない純粋関数群。
 * 係数はすべてこのファイルの定数にまとめ、校正はここだけを触れば済むようにする。
 */
import { forEachInRadius } from './disaster';
import { amplitudeRatio } from './oscillation';
import { SEA_LEVEL } from './terrain';
import type { PrayerKind, PrayerState } from './prayer';

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
  fuel?: { last: number; need: number; shortYears: number; stock: number; debt: number };
  /**
   * 信仰の値 [0,1] (M9-01)。文明が stage ≥ 1 になった最初の年に faith.ts の FAITH_INITIAL で生まれる。
   * stage 0 や civ が無いあいだは undefined のまま。既存のテスト・セーブとの互換を保つため省略可にしてある。
   */
  faith?: number;
  /** 現在有効な祈り (M9-02)。無ければ undefined。既存のテスト・セーブとの互換を保つため省略可にしてある */
  prayer?: PrayerState;
  /** 応えた祈りの累計 (M9-02, M9-03 の判定条件が読む)。省略時は 0 相当 */
  prayersAnswered?: number;
  /** 無視した (期限切れの) 祈りの累計 (M9-02)。省略時は 0 相当 */
  prayersIgnored?: number;
  /**
   * 採掘半径 MINE_RADIUS[MAX_STAGE] 内の輝石の総量 (M9-02)。stage ≥ 1 になった最初の年 (発生時か開始時) に
   * 記録し、以後は変えない。「星の砂を」の判定 (crystalRatio) の分母。既存のテスト・セーブとの互換を保つため省略可
   */
  crystalStart?: number;
  /** 勅令で採掘が止まっているか (M9-03)。省略時 false。止まっている間は stepMining を呼ばない */
  miningStopped?: boolean;
  /** 最後の勅令とその結果 (M9-03)。石板が「民は聞かなかった」を出すために残す */
  edict?: { kind: 'stop_mining' | 'resume_mining'; year: number; obeyed: boolean; faith: number };
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
// M9-00: 絶対値ではなく「島の陸の植生平均に対する倍率」として読む (候補の支え半径 8 の平均 > EMERGE_VEGETATION × 島の平均)。
// 実測 (seed 42, size 64, 全種, 150 年放置) で候補の半径 3 の植生は 0.25、半径 8 は 0.18 で頭打ちになり、
// 密度最大点 = 採食圧最大点という構造上、絶対値 0.4 には届かなかった (LD 2026-09-21 §1, §8)
/** 発生条件: 直近 10 年の振幅比 (amplitudeRatio) がこれ未満 (振動していない) */
export const EMERGE_AMPLITUDE = 0.15;
// M9-00: 振幅比は島全体の総量ではなく、候補セルの支え半径 (SUPPORT_RADIUS) 内の総量で測る。
// 島全体の鹿は 9 年周期で振動し続ける (振幅比 0.42〜0.53) が、地域の群れは 0.08〜0.11 で安定していた
/** 発生に必要な年次履歴の年数 */
export const EMERGE_HISTORY_YEARS = 10;
/**
 * 集落候補が前年の候補からこの距離 (セル) 以内なら、地域の履歴を引き継ぐ (M9-00)。
 * 候補は密度最大セルなので年ごとに数セル揺れる。支え半径と同じ広さまでは「同じ群れ」とみなす
 */
export const EMERGE_CANDIDATE_MOVE = SUPPORT_RADIUS;
/**
 * 群れへの留まり (M9-00)。前年の候補の周り (EMERGE_CANDIDATE_MOVE) で追い直した候補の地域人口が、
 * 島で最大の候補の地域人口のこの倍率以上なら、最大の方へ飛ばずに同じ群れを見続ける。
 * size 128 の既定島では密度最大セルが複数の群れの間を数年ごとに飛び (80 年で 32 回)、履歴が 10 年たまらなかった
 */
export const EMERGE_STICKY = 0.5;

/**
 * 今年の集落候補を決める (M9-00)。島で密度最大の候補を取り、前年の候補があればその群れの中で追い直した候補が
 * 最大の EMERGE_STICKY 倍以上の人口なら群れに留まる。返り値が前年から EMERGE_CANDIDATE_MOVE より遠ければ別の群れ
 */
export function trackHomeCandidate(pops: Float32Array, crystal: Float32Array, elevation: Float32Array, size: number, prev: number): number {
  const best = pickHomeCandidate(pops, crystal, elevation, size);
  if (prev < 0 || best < 0) return best;
  const local = pickHomeCandidate(pops, crystal, elevation, size, { center: prev, radius: EMERGE_CANDIDATE_MOVE });
  if (local < 0) return best;
  const localPop = populationAround(pops, local, elevation, size);
  const bestPop = populationAround(pops, best, elevation, size);
  return localPop >= EMERGE_STICKY * bestPop ? local : best;
}

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

/** 発生判定の入力 (M9-00)。すべて候補セルの周りで測った値 */
export type EmergenceInput = {
  /** 候補の支え半径内の植生 (森+草) 平均 */
  candidateVegetation: number;
  /** 島の陸セル全体の植生平均。候補の植生はこれに対する倍率で判定する */
  islandVegetation: number;
  /** 候補の採掘半径 MINE_RADIUS[1] 以内に輝石があるか (掘るものが無ければ知性は生まれない。世界観 §1.5) */
  hasCrystal: boolean;
};

/**
 * 発生判定。stage 0 のとき年に 1 回呼ぶ。
 * history はその種の年次総量 (直近 10 年、古い順)。振動していない (振幅比が小さい) かつ
 * 集落候補地の植生が十分あれば true。
 * M9-00: history は島全体ではなく候補の支え半径内の総量、植生は島の平均に対する倍率、
 * さらに候補の近くに輝石があることを条件に足した (LD 2026-09-21 §8)。
 */
export function checkEmergence(history: number[], input: EmergenceInput): boolean {
  if (history.length < EMERGE_HISTORY_YEARS) return false;
  if (!input.hasCrystal) return false;
  if (amplitudeRatio(history) >= EMERGE_AMPLITUDE) return false;
  return input.candidateVegetation > EMERGE_VEGETATION * input.islandVegetation;
}

/** 2 セル間の距離 (セル単位のユークリッド距離) */
export function cellDistance(a: number, b: number, size: number): number {
  const ax = a % size;
  const ay = (a - ax) / size;
  const bx = b % size;
  const by = (b - bx) / size;
  return Math.hypot(ax - bx, ay - by);
}

/**
 * 集落候補 (M9-00): その種の密度が最大の陸セルのうち、採掘半径 MINE_RADIUS[1] 以内に輝石があるもの。
 * 民は遺産のそばに集まる (世界観 §1.5)。該当が無ければ -1
 */
export function pickHomeCandidate(
  pops: Float32Array,
  crystal: Float32Array,
  elevation: Float32Array,
  size: number,
  /** 指定があれば center の半径 radius 以内だけから選ぶ (前年の群れの中で候補を追い直す) */
  within?: { center: number; radius: number },
): number {
  let candidate = -1;
  let best = 0;
  const radius = MINE_RADIUS[1];
  for (let i = 0; i < pops.length; i++) {
    if (elevation[i] < SEA_LEVEL || pops[i] <= best) continue;
    if (within && cellDistance(i, within.center, size) > within.radius) continue;
    let has = false;
    forEachInRadius(i, radius, size, (j) => {
      if (!has && elevation[j] >= SEA_LEVEL && crystal[j] > 0) has = true;
    });
    if (!has) continue;
    best = pops[i];
    candidate = i;
  }
  return candidate;
}

/** cell の半径 radius 以内の陸セルの arr の平均 (陸が無ければ 0) */
export function meanAround(arr: Float32Array, cell: number, radius: number, elevation: Float32Array, size: number): number {
  let sum = 0;
  let count = 0;
  forEachInRadius(cell, radius, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) {
      sum += arr[i];
      count++;
    }
  });
  return count ? sum / count : 0;
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
  /**
   * 霊脈の番号 (M9-03、vein.ts の labelVeins)。渡せば民は脈を辿って掘る: 採掘半径に掛かる脈のセル全体から残量に比例して
   * 取り除く。渡さなければ今までどおり採掘半径の中だけ (既存テスト・脈の無い世界)
   */
  veins?: Int32Array,
): { state: CivState; mined: number } {
  if (state.home < 0 || state.stage < 1 || state.stage > MAX_STAGE) return { state, mined: 0 };
  const radius = MINE_RADIUS[state.stage];
  const rate = MINE_RATE[state.stage];
  // 掘る対象のセル: 採掘半径内の陸セル。脈があれば、半径に掛かる脈を辿ってその脈のセル全体
  const pool: number[] = [];
  const touched = new Set<number>();
  forEachInRadius(state.home, radius, size, (i) => {
    if (elevation[i] < SEA_LEVEL) return;
    if (veins && veins[i] >= 0) touched.add(veins[i]);
    else pool.push(i);
  });
  if (veins && touched.size > 0) {
    for (let i = 0; i < veins.length; i++) if (touched.has(veins[i]) && elevation[i] >= SEA_LEVEL) pool.push(i);
  }
  let total = 0;
  for (const i of pool) total += crystal[i];
  if (total <= 0 || rate <= 0) return { state, mined: 0 };
  const mined = Math.min(rate, total);
  // 残量に比例して各セルから取り除く (多いセルほど多く掘る、輝石が無いセルは変化なし)
  const k = mined / total;
  for (const i of pool) if (crystal[i] > 0) crystal[i] -= crystal[i] * k;
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
export type CivilizationConfig = { speciesId: string; start?: { stage: number; home: number; fuelStock?: number; prayer?: PrayerKind; faith?: number } };

/**
 * シナリオの start.civilization を WorldConfig.civilization へ解決する。
 * home は他のコマンドと同じ規約で、省略または -1 なら島の中心セルにする。stage 省略時は 0 (まだ発生していない)。
 * prayer 指定 (M9-02) があれば開始時にその祈りを有効にする (E2E の決定論のため。期限は World 側で開始年 + PRAYER_YEARS にする)。
 */
export function resolveCivilizationStart(
  start: { speciesId: string; stage?: number; home?: number; fuelStock?: number; prayer?: PrayerKind; faith?: number } | undefined,
  size: number,
): CivilizationConfig | undefined {
  if (!start) return undefined;
  const home = start.home === undefined || start.home === -1 ? Math.floor(size / 2) * size + Math.floor(size / 2) : start.home;
  return { speciesId: start.speciesId, start: { stage: start.stage ?? 0, home, fuelStock: start.fuelStock, prayer: start.prayer, faith: start.faith } };
}
