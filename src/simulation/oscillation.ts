/**
 * 時系列の振動を機械的に判定するための純粋関数。
 * 性質テストと将来の UI(「波が出ている」表示)で使う。
 */

/** 局所極大値の数。両隣より大きい点を数える (端は数えない)。 */
export function countPeaks(series: ArrayLike<number>, minProminence = 0): number {
  let peaks = 0;
  for (let i = 1; i < series.length - 1; i++) {
    const v = series[i];
    if (v > series[i - 1] && v >= series[i + 1] && v - Math.min(series[i - 1], series[i + 1]) > minProminence) peaks++;
  }
  return peaks;
}

/** 振幅比 (max − min) / max。max が 0 なら 0。 */
export function amplitudeRatio(series: ArrayLike<number>): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < series.length; i++) {
    lo = Math.min(lo, series[i]);
    hi = Math.max(hi, series[i]);
  }
  if (!Number.isFinite(hi) || hi <= 0) return 0;
  return (hi - lo) / hi;
}

/** 系列の後半だけを取り出す。 */
export function secondHalf(series: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = Math.floor(series.length / 2); i < series.length; i++) out.push(series[i]);
  return out;
}
