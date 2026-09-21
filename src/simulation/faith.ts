/**
 * 文明の信仰の値 (M9-01)。World には依存しない純粋関数群。
 * 同じ種類の介入(予測可能)を繰り返すと上がり、種類がばらつく介入や災害で下がり、
 * 何もしなければゆっくり減衰する。係数はすべてこのファイルの定数にまとめる。
 */
import type { Command } from './types';

/** 文明が stage ≥ 1 になった最初の年に生まれる初期値 */
export const FAITH_INITIAL = 0.5;
/** 同じ種類のコマンドが続いた (a) ときに足す量 */
export const FAITH_UP = 0.05;
/** 種類がばらついた (b) ときに引く量 */
export const FAITH_DOWN = 0.05;
/** 災害 1 回につき引く量 (c) */
export const FAITH_DISASTER = 0.1;
/** 介入が無くても毎年これだけ減衰する (d) */
export const FAITH_DECAY = 0.03;
/** recent の最後のキーがこれ以上あれば (a) が成り立つ */
export const FAITH_STREAK_THRESHOLD = 3;
/** recent に異なるキーがこれ以上あれば (b) が成り立つ */
export const FAITH_VARIETY_THRESHOLD = 3;
/** recent / 履歴として保持する年数 (今年を含む、直近) */
export const FAITH_HISTORY_YEARS = 10;

/**
 * コマンドの「種類」のキー。信仰の更新で「同じ種類」「ばらつき」を数えるのに使う。
 * sink は滅びの進行(予定どおりの沈降)なので数えない (null)。
 */
export function commandKey(cmd: Command): string | null {
  switch (cmd.type) {
    case 'spawn_species':
      return `spawn:${cmd.speciesId}`;
    case 'set_climate':
      return 'climate';
    case 'disaster':
      return `disaster:${cmd.kind}`;
    case 'sink':
      return null;
  }
}

/**
 * 信仰の値を 1 年分更新する。
 * - recent: 直近 FAITH_HISTORY_YEARS 年 (今年を含む) に dispatch されたコマンドのキー、古い順
 * - disasters: 今年の災害コマンドの回数 (プレイヤーも予定コマンドも含む)
 * 規則:
 * (a) recent の最後のキーと同じキーが recent に FAITH_STREAK_THRESHOLD 回以上あれば +FAITH_UP
 * (b) recent の異なるキーが FAITH_VARIETY_THRESHOLD 種類以上なら −FAITH_DOWN
 * (c) 今年の災害 1 回につき −FAITH_DISASTER
 * (d) 最後に × (1 − FAITH_DECAY) で減衰
 * (e) [0,1] にクランプ
 * (a)(b) は両方成り立てば両方掛かる。
 */
export function updateFaith(prev: number, input: { recent: string[]; disasters: number }): number {
  const { recent, disasters } = input;
  let faith = prev;
  if (recent.length > 0) {
    const last = recent[recent.length - 1];
    const streak = recent.filter((k) => k === last).length;
    if (streak >= FAITH_STREAK_THRESHOLD) faith += FAITH_UP;
    const distinct = new Set(recent).size;
    if (distinct >= FAITH_VARIETY_THRESHOLD) faith -= FAITH_DOWN;
  }
  faith -= disasters * FAITH_DISASTER;
  faith *= 1 - FAITH_DECAY;
  return Math.min(1, Math.max(0, faith));
}
