import type { Command } from '../simulation/types';

/**
 * 判定条件。すべて snapshot と介入回数から評価できる純粋なデータ。
 * `min`/`max` は閾値、`ratio` は「開始時に対する倍率」。
 */
export type Condition =
  | { type: 'species_alive'; ids: string[] }
  | { type: 'species_extinct'; ids: string[] }
  | { type: 'land_ratio'; min?: number; max?: number }
  | { type: 'vegetation_ratio'; min?: number; max?: number }
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
  start?: { seed?: number; size?: number; tempOffset?: number; rainScale?: number };
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
};

export type ScenarioStatus = 'running' | 'alive' | 'dead';
export type Verdict = { status: ScenarioStatus; reason: string };

/** 開始時に固定する基準値 */
export type StartStats = { landRatio: number; totals: Record<string, number> };
