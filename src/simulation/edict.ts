/**
 * 勅令 (M9-03)。石板の「採掘を止めよ / 再開せよ」。信仰が EDICT_FAITH 以上のときだけ民が従う。
 * レベルデザイン docs/design/2026-09-21-level-design-faith.md §3.3。World には依存しない純粋関数。
 * 言葉であって行為ではないので、星の力は消費せず、信仰の「同じ種類の介入」にも数えない (faith.ts の commandKey が null)。
 */
import type { CivState } from './civilization';

export type EdictKind = 'stop_mining' | 'resume_mining';

/** 民が勅令に従う信仰の下限 */
export const EDICT_FAITH = 0.6;

/**
 * 勅令を文明に掛ける。従えば miningStopped を切り替え、従わなければ状態は変えない。
 * どちらの場合も edict (最後の勅令と結果) を記録する (石板が「民は聞かなかった」を出すため)。
 * 文明が無い (stage 0) なら何も起きない (obeyed false、edict も残さない)。
 */
export function applyEdict(civ: CivState, kind: EdictKind, year: number, n = 1): { civ: CivState; obeyed: boolean } {
  if (civ.stage < 1) return { civ, obeyed: false };
  const faith = civ.faith ?? 0;
  const obeyed = faith >= EDICT_FAITH;
  const next: CivState = { ...civ, edict: { kind, year, obeyed, faith, n } };
  if (obeyed) next.miningStopped = kind === 'stop_mining';
  return { civ: next, obeyed };
}
