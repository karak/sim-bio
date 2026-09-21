/**
 * 霊脈 (M9-03)。輝石は地下で土地の生気を支える。掘り尽くした土地では分解の効きが落ち、苔がいても生気が戻らない。
 * レベルデザイン docs/design/2026-09-21-level-design-faith.md §3.2。
 * 輝石が無かった土地 (crystal0 = 0) の枯渇は常に 0 なので、既存シナリオの生気の平衡は変わらない。
 * World には依存しない純粋関数群。係数はここにまとめる。
 */
import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';

/** 枯渇 1.0 (輝石を掘り尽くした) の土地で分解率をどれだけ落とすか [0,1]。0.9 なら分解者の効きが 1 割に */
export const VEIN_LOSS = 0.9;
/** 枯渇をぼかす半径 (セル)。鉱脈の周りの土地にも霊脈の細りが及ぶ */
export const VEIN_BLUR = 3;

/**
 * セルごとの霊脈の細り veinLoss [0,1] を out に書く。
 * depletion_i = 1 − crystal_i / crystal0_i (開始時に輝石があった陸セルだけ、他は 0)。
 * veinLoss_i = 半径 VEIN_BLUR 内の「開始時に輝石があったセル」の depletion の平均 (そういうセルが無ければ 0)。
 * 掘っていなければ全セル 0。年に 1 回で十分な精度 (採掘は年 0.1〜0.4 程度)。
 */
export function computeVeinLoss(crystal: Float32Array, crystal0: Float32Array, elevation: Float32Array, size: number, out: Float32Array): void {
  const n = size * size;
  const depletion = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (elevation[i] < SEA_LEVEL || crystal0[i] <= 0) continue;
    const d = 1 - crystal[i] / crystal0[i];
    depletion[i] = d < 0 ? 0 : d > 1 ? 1 : d;
    if (depletion[i] > 0) any = true;
  }
  if (!any) {
    out.fill(0);
    return;
  }
  for (let i = 0; i < n; i++) {
    if (elevation[i] < SEA_LEVEL) {
      out[i] = 0;
      continue;
    }
    let sum = 0;
    let count = 0;
    forEachInRadius(i, VEIN_BLUR, size, (j) => {
      if (elevation[j] >= SEA_LEVEL && crystal0[j] > 0) {
        sum += depletion[j];
        count++;
      }
    });
    out[i] = count ? sum / count : 0;
  }
}

/** 分解率に掛ける霊脈の係数 [1 − VEIN_LOSS, 1]。veinLoss が無ければ 1 */
export function veinFactor(veinLoss: number): number {
  return 1 - VEIN_LOSS * veinLoss;
}
