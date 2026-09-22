import type { Command, SpeciesDef } from '../simulation/types';
import type { WarningKind } from './warnings';
import type { PrayerKind } from '../simulation/prayer';

type SpeciesDefLike = SpeciesDef;

/**
 * 判定条件。すべて snapshot と介入回数から評価できる純粋なデータ。
 * `min`/`max` は閾値、`ratio` は「開始時に対する倍率」。
 */
export type Condition =
  | { type: 'species_alive'; ids: string[] }
  /** 直近 years 年の総量の平均が min 以上 (群れとして残っているか)。年ごとの振動と最後の瞬間の放流に左右されない */
  | { type: 'species_mean'; ids: string[]; years: number; min: number }
  | { type: 'species_extinct'; ids: string[] }
  | { type: 'land_ratio'; min?: number; max?: number }
  | { type: 'vegetation_ratio'; min?: number; max?: number }
  | { type: 'vitality_ratio'; min?: number; max?: number }
  | { type: 'total_ratio_vs_start'; id: string; min?: number; max?: number }
  /** 文明の段階 (0..7)。years があれば直近 years 年の最小段階で判定する (瞬間的な回復で勝てないように) */
  | { type: 'civ_stage'; min?: number; max?: number; years?: number }
  /** 文明の信仰 [0,1] (M9-03)。文明が無い・未発生なら 0 扱い */
  | { type: 'faith'; min?: number; max?: number }
  /** 応えた祈りの数 (M9-03)。「祈りに応えるな」は max: 0 を dead に使う。文明が無ければ 0 */
  | { type: 'prayers_answered'; min?: number; max?: number }
  /** 集落の支え半径内の生気の平均 (M9-03)。years があれば直近 years 年の平均で判定する。文明が無ければ 0 扱い */
  | { type: 'civ_vitality'; min?: number; max?: number; years?: number }
  /** 迎撃した回数 (M10-02)。「迎撃の塔」は min: 1 を alive に使う。文明が無ければ 0 */
  | { type: 'intercepted'; min?: number; max?: number }
  | { type: 'year_reached'; year: number }
  | { type: 'no_intervention' }
  | { type: 'all'; of: Condition[] }
  | { type: 'any'; of: Condition[] };

/** 予定コマンド。at は開始からの年 (整数)。every があれば every 年ごとに繰り返す */
export type ScheduledCommand = { atYear: number; everyYears?: number; untilYear?: number; command: Command };

export type ScenarioDef = {
  id: string;
  title: string;
  /** true なら選択 UI に出さない (テスト・デバッグ用) */
  hidden?: boolean;
  /** 石板の予言 (プレイヤーに最初から見せる) */
  prophecy: string;
  /** 回避の型 */
  kind: 'prevent' | 'endure' | 'escape';
  /** 開始状態の上書き (seed, size, climate など)。省略時は world.default.json */
  start?: {
    seed?: number;
    size?: number;
    tempOffset?: number;
    rainScale?: number;
    /** 種ごとの上書き (initialDensity など) */
    species?: Record<string, Partial<Pick<SpeciesDefLike, 'initialDensity' | 'growthRate' | 'mortality' | 'diffusion'>>>;
    /**
     * 文明の初期状態の上書き (M8-02)。stage/home 省略時は stage 0 / home -1 (未発生)。
     * prayer 指定 (M9-02) があれば開始時にその祈りを有効にする (E2E の決定論のため)
     */
    civilization?: { speciesId: string; stage?: number; home?: number; fuelStock?: number; prayer?: PrayerKind; faith?: number };
    /**
     * 火山セルの上書き (M8-08)。省略時は World が標高最大の陸セルを既定にする。
     * -1 は他のセル指定と同じ規約で島の中心。M8-09 の校正で標高最大セルは寒すぎ
     * (噴火 3 回でも半径 3 で 22.6℃ ほどにしかならず、炎蜥蜴の適温 [30,80] に届かない) と分かり、
     * シナリオ側で暖かい低地セルを指定できるようにした
     */
    volcanoCell?: number;
  };
  /** 滅びの進行と予定イベント */
  schedule: ScheduledCommand[];
  /** 判定する年数。この年に alive を満たしていれば勝ち */
  years: number;
  /** total_ratio_vs_start の基準を取る年 (省略時 0)。初期投入直後は不安定なので数年後を基準にできる */
  baselineYear?: number;
  /** schedule 内の radius はこのグリッドサイズを基準に書く (省略時 128)。実行時に size に比例して縮尺する */
  referenceSize?: number;
  /** 満たしたら勝ち (years 到達時に評価) */
  alive: Condition;
  /** 毎年評価し、満たした瞬間に負け。省略時は years 到達時の alive 判定だけで決まる */
  dead?: Condition;
  /** 出さない警告の種類。予言どおりの進行 (沈む欠片の陸の減少など) を警告にしないため */
  ignoreWarnings?: WarningKind[];
  /** 予言の節目。未到達のものを石板に先に見せ、到達したら消す */
  milestones?: { atYear: number; text: string }[];
  /** 星の力 (介入の予算)。省略時は今までどおり介入は無料 */
  budget?: {
    /** 開始時の力 */
    start: number;
    /** 年収の上限。実際は × 陸地率 × 生気の平均 (島が痩せると減る) */
    incomePerYear: number;
    /** コマンド 1 回の値段 */
    costs: { spawn: number; disaster: number; climate: number };
    /** |rainScale−1|·rainScale + |tempOffset|·tempOffset を毎年引く (気候を変え続けている分の維持費) */
    upkeepPerYear: { rainScale: number; tempOffset: number };
    /** 貯められる上限 (省略時 start × 3) */
    max?: number;
  };
};

export type ScenarioStatus = 'running' | 'alive' | 'dead';
/** 勝敗が確定したときの内訳。オーバーレイに出す */
export type VerdictStats = { interventions: number; powerSpent: number; landRatio: number; totals: Record<string, number> };
export type Verdict = { status: ScenarioStatus; reason: string; stats?: VerdictStats };

/** 開始時に固定する基準値 */
export type StartStats = { landRatio: number; totals: Record<string, number> };
