/**
 * 夢喰い (M17-02 の前倒し、M10R-03)。信仰の上限 (民の記憶) が低いと集落に現れる「影」。
 * 知性を持つ民だけを食う。M17 の本体 (密度を持つ種) ではなく、内乱・工事と同じ舞台装置の状態機械として入れる。
 * レベルデザイン docs/design/2026-09-22-level-design-faith-economy.md §3.3。World には依存しない純粋関数群。
 * 係数はすべてこのファイルの定数にまとめ、校正はここだけを触れば済むようにする (unrest.ts / works.ts と同じ流儀)。
 */
import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import { SUPPORT_RADIUS } from './civilization';

/** 出現: 信仰の上限 (faithCap) がこれ未満 */
export const DREAM_CAP = 0.3;
/** 出現に要る最低段階 (歌、3) */
export const DREAM_STAGE = 3;
/** 出現中、毎年支え半径内の民に掛ける減り (20%) */
export const DREAM_EAT = 0.2;
/** 去る: 信仰の上限がこれ以上 */
export const DREAM_LEAVE = 0.5;

/** 夢喰いの状態。現れていなければ null。since は現れた年 */
export type DreamEaterState = { since: number };

/**
 * 年に一度呼ぶ。
 * - 現れていなければ (state === null): 段階 ≥ DREAM_STAGE かつ faithCap < DREAM_CAP で出現する
 * - 現れていれば: faithCap ≥ DREAM_LEAVE で去る。それ以外はそのまま留まる
 * faithCap が無ければ (発生直後でまだ年をまたいでいない) 1 とみなす (満ちているので出現しない)
 */
export function stepDreamEater(
  state: DreamEaterState | null,
  civ: { stage: number; faithCap?: number },
  year: number,
): { state: DreamEaterState | null; appeared: boolean; left: boolean } {
  const cap = civ.faithCap ?? 1;
  if (state) {
    if (cap >= DREAM_LEAVE) return { state: null, appeared: false, left: true };
    return { state, appeared: false, left: false };
  }
  if (civ.stage >= DREAM_STAGE && cap < DREAM_CAP) return { state: { since: year }, appeared: true, left: false };
  return { state: null, appeared: false, left: false };
}

/** 出現中: home の支え半径内の陸セルにいるその種の密度を (1 − DREAM_EAT) 倍にする (配列をその場で書き換える。applyUnrest と同じ流儀) */
export function applyDreamEater(pops: Float32Array, home: number, elevation: Float32Array, size: number): void {
  if (home < 0) return;
  forEachInRadius(home, SUPPORT_RADIUS, size, (i) => {
    if (elevation[i] >= SEA_LEVEL) pops[i] *= 1 - DREAM_EAT;
  });
}
