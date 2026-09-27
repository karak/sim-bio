/**
 * 動的な解像度 (M23-07、docs/design/2026-09-24-observe-perf.md)。コマの時間が予算を続けて超えたときだけ、
 * 合成の描画先の倍率 (画面の画素に対する) を下げる。画面 (canvas) の大きさは変えず、最後のパスで引き伸ばす (grade.ts の setPixelRatio)。
 *
 * - 判定は window コマごとに、そのあいだのコマの時間の中央値で行う (1 コマの引っかかりでは下げない)。
 *   250 ms を超えるコマ (タブの切り替え・素材の読み込み) は数えず、そのときは数え直す。
 * - 中央値が budget × dropAt を超えたら step だけ下げる (min まで)。
 * - 60 Hz の画面では垂直同期でコマの時間が 16.7 ms に張り付き、余裕が見えない。そこで下げたあと upAfterS 秒、
 *   中央値が budget × raiseAt 以下のままなら 1 段戻してみる。戻して 3 秒以内にまた下げたら、次に戻すまでの待ちを倍にする (上限 8 倍)。
 * 速い GPU (予算の中で描ける) では何もしない。
 */

export type DynamicResolutionOptions = {
  /** 1 コマの予算 (ms)。既定 1000 / 60 */
  budgetMs?: number;
  /** 倍率の下限 (既定 0.6) と刻み (既定 0.1) */
  min?: number;
  step?: number;
  /** 何コマごとに判定するか (既定 30) */
  window?: number;
  /** 中央値がこの倍を超えたら下げる (既定 1.15 = 60 fps の予算で 19.2 ms、52 fps) */
  dropAt?: number;
  /** 中央値がこの倍以下なら、待ちのあとで戻してみる (既定 1.05) */
  raiseAt?: number;
  /** 下げてから戻してみるまでの秒 (既定 8) */
  upAfterS?: number;
};

export type DynamicResolution = {
  /** 1 コマの時間 (ms) を渡す。今の倍率を返す */
  update(frameMs: number): number;
  readonly scale: number;
};

/** 数える最長のコマ (ms)。これより長いコマは引っかかりとして捨てる */
const HITCH_MS = 250;
/** 戻してからこの秒のうちに下がったら、戻すのが早すぎたとみる */
const RETRY_S = 3;

export function createDynamicResolution(opts: DynamicResolutionOptions = {}): DynamicResolution {
  const budget = opts.budgetMs ?? 1000 / 60;
  const min = opts.min ?? 0.6;
  const step = opts.step ?? 0.1;
  const win = opts.window ?? 30;
  const dropAt = opts.dropAt ?? 1.15;
  const raiseAt = opts.raiseAt ?? 1.05;
  const upAfter = opts.upAfterS ?? 8;
  let scale = 1;
  let samples: number[] = [];
  /** 最後に倍率を変えてからの秒 */
  let since = 0;
  let lastWasRaise = false;
  let backoff = 1;
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    get scale() {
      return scale;
    },
    update(frameMs) {
      if (!(frameMs > 0) || frameMs > HITCH_MS) {
        samples = [];
        return scale;
      }
      since += frameMs / 1000;
      samples.push(frameMs);
      if (samples.length < win) return scale;
      const sorted = [...samples].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      samples = [];
      if (med > budget * dropAt && scale > min) {
        if (lastWasRaise && since < RETRY_S) backoff = Math.min(8, backoff * 2);
        scale = round(Math.max(min, scale - step));
        since = 0;
        lastWasRaise = false;
      } else if (scale < 1 && med <= budget * raiseAt && since >= upAfter * backoff) {
        scale = round(Math.min(1, scale + step));
        since = 0;
        lastWasRaise = true;
      }
      return scale;
    },
  };
}
