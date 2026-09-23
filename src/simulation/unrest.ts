/**
 * 内乱 (M9-03)。信仰が低い年が続くと集落の民が半減し、文明の段階が 1 つ下がる。
 * レベルデザイン docs/design/2026-09-21-level-design-faith.md §3.4。World には依存しない純粋関数群。
 */
import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import { SUPPORT_RADIUS } from './civilization';

/** 信仰がこれ未満の年を「低い」と数える */
export const UNREST_FAITH = 0.3;
/** 低い年がこれだけ続くと内乱 */
export const UNREST_YEARS = 3;
/** 内乱で集落 (支え半径) の民に掛ける倍率 */
export const UNREST_SURVIVORS = 0.5;
/** 内乱の後の信仰。3 年ごとに連鎖しないように、閾値より少し上へ戻す */
// M10R-02: 戻り先は min(UNREST_FAITH_AFTER, 信仰の上限)。上限が 0.3 を切っていれば連鎖する (夢喰いが出る局面で、意図した滅びの螺旋)
export const UNREST_FAITH_AFTER = 0.4;

/**
 * 今年の信仰から低い年の連続数を更新し、内乱が起きるかを返す。
 * 起きた年は streak を 0 に戻す (次の内乱までまた UNREST_YEARS 年かかる)。
 */
export function stepUnrest(faith: number, streak: number): { streak: number; unrest: boolean } {
  const next = faith < UNREST_FAITH ? streak + 1 : 0;
  if (next >= UNREST_YEARS) return { streak: 0, unrest: true };
  return { streak: next, unrest: false };
}

/** home の支え半径内の陸セルにいるその種の密度を factor 倍にする (配列をその場で書き換える)。内乱と夢喰い (M10R-03) が共用する */
export function scalePopulationAround(pops: Float32Array, home: number, factor: number, elevation: Float32Array, size: number): void {
  if (home < 0) return;
  forEachInRadius(home, SUPPORT_RADIUS, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) pops[i] *= factor;
  });
}

/** 内乱: home の支え半径内の陸セルにいるその種の密度を UNREST_SURVIVORS 倍にする (配列をその場で書き換える) */
export function applyUnrest(pops: Float32Array, home: number, elevation: Float32Array, size: number): void {
  scalePopulationAround(pops, home, UNREST_SURVIVORS, elevation, size);
}
