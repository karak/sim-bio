import type { HarborRequest } from '../../src/harbor/contract';

/**
 * 港の道ごとの決まり (設計書 §6.1・§6.3)。数は 1 日 (UTC) の呼び出しの回数。
 *
 * cap はその道だけの上限。shedAt は、その日に通した呼び出しの合計 (全部の道の和) がこれに達したらその道を閉じる段。
 * 捨てる順 (ログ > 確認 > 一覧 > 積荷 > 出港 > 訪問) は shedAt の小さい順で、共有リンクの訪問を最後まで守る。
 * 閉じた道には、クライアントが UTC の 0 時まで同じ道を呼ばない返事 (503・Retry-After) を返すので、Workers の 100,000/日も後ろの道に残る。
 *
 * D1 の書きの最悪 (全部の道が上限まで) は、予算の数え 1 行 × 合計の最大 45,000 と、道の書き
 * (出港 2,000 × 4 行 [行・主鍵・部分索引 2 つ]・積荷 5,000 × 3 行・通報 1,000 × 5 行・確認 5,000・結末 5,000・取り下げ 1,000 × 5 行)
 * で 45,000 + 8,000 + 15,000 + 5,000 + 10,000 + 5,000 = 88,000 行。無料枠 100,000 行/日の内に収まる
 */
export type Bucket = HarborRequest['kind'] | 'logs';

export type Budget = { cap: number; shedAt: number };

export const BUDGETS: { readonly [B in Bucket]: Budget } = {
  logs: { cap: 10_000, shedAt: 20_000 },
  confirm: { cap: 5_000, shedAt: 25_000 },
  report_outcome: { cap: 5_000, shedAt: 25_000 },
  browse: { cap: 20_000, shedAt: 30_000 },
  avoidance: { cap: 10_000, shedAt: 30_000 },
  cast_cargo: { cap: 5_000, shedAt: 35_000 },
  draw_cargo: { cap: 10_000, shedAt: 35_000 },
  publish: { cap: 2_000, shedAt: 40_000 },
  report: { cap: 1_000, shedAt: 40_000 },
  withdraw: { cap: 1_000, shedAt: 45_000 },
  visit: { cap: 40_000, shedAt: 45_000 },
};

/**
 * rate: 送り手ごとの回数制限の binding (RATE_WRITE は 1 分 10 回、RATE_READ は 1 分 120 回。wrangler.jsonc)。
 * overBudget: 予算を越えたとき。drop は 204 で黙って捨てる (善意の付加物。呼び手の手応えを変えない)、close は 503 の閉港。
 * 人間確認 (Turnstile) は、要求に札のある道 (出港・通報) だけにかける。札の有無は契約 (src/harbor/contract.ts) が決める
 */
export type Policy = { rate: 'RATE_WRITE' | 'RATE_READ'; overBudget: 'drop' | 'close' };

export const POLICIES: { readonly [K in HarborRequest['kind']]: Policy } = {
  publish: { rate: 'RATE_WRITE', overBudget: 'close' },
  browse: { rate: 'RATE_READ', overBudget: 'close' },
  visit: { rate: 'RATE_READ', overBudget: 'close' },
  confirm: { rate: 'RATE_WRITE', overBudget: 'drop' },
  report: { rate: 'RATE_WRITE', overBudget: 'close' },
  withdraw: { rate: 'RATE_WRITE', overBudget: 'close' },
  cast_cargo: { rate: 'RATE_WRITE', overBudget: 'close' },
  draw_cargo: { rate: 'RATE_READ', overBudget: 'close' },
  report_outcome: { rate: 'RATE_WRITE', overBudget: 'drop' },
  avoidance: { rate: 'RATE_READ', overBudget: 'close' },
};

export type HarborConfig = {
  budgets: { readonly [B in Bucket]: Budget };
  /** 保存の内部の栓。1 データベース 500 MB の内側 (設計書 §6.1) */
  storageCapBytes: number;
  /** この数の別の送り手に通報されたら、自動で隠す */
  reportsToHide: number;
  /** 一覧の 1 頁 (HARBOR_LIMITS.cardsPerPage の内) */
  pageSize: number;
  /** 積荷はこの日数で流れ去る (Cron が消す) */
  cargoDays: number;
  /** 予算の行はこの日数だけ残す (運営が scripts/mod.py で読む) */
  budgetDays: number;
  /** 隠した年代記は、この日数のあいだ運営が戻せる。過ぎたら Cron が消す */
  hiddenDays: number;
};

export const HARBOR_CONFIG: HarborConfig = {
  budgets: BUDGETS,
  storageCapBytes: 400_000_000,
  reportsToHide: 3,
  pageSize: 24,
  cargoDays: 7,
  budgetDays: 7,
  hiddenDays: 30,
};
