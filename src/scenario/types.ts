import type { Command, SpeciesDef } from '../simulation/types';

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
