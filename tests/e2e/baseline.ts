/**
 * 要素ごとの基準画 (M25-03、ADR 0001 段 3)。閾値は ADR「基準画の閾値」の値。
 * 基準画は手元の Mac だけで持つ (ADR 決定 1)。CI (ubuntu) と Mac 以外では比べを回さず、lens の検査だけ回す。
 * 置き場は playwright.config.ts の snapshotPathTemplate (tests/e2e/baselines/)。受入の画面の shots/ とは別で、check_shots には見えない
 */

import type { Locator } from '@playwright/test';

export const BASELINE_OPTIONS = { threshold: 0.2, maxDiffPixelRatio: 0.02, animations: 'disabled', caret: 'hide' } as const;

/**
 * 字が画の大半を占める細い板 (1 行の帯と、字だけのセルの詳細) の閾値。
 * 要素が小さいので、字の描き方の更新 (text-rendering: geometricPrecision) だけで 3〜8% が閾値 0.2 を越え、0.02 ではフォントの更新のたびに赤になる。
 * 文は撮る前に toHaveText で確かめているので、この画が見るのは置き場のずれ (字を横に 2px ずらすと訪問のリンク 0.13・受け取りの文 0.21 で落ちる。M25-03 の作業ログ)。要素名で引く
 */
export const TEXT_STRIP_RATIO = 0.12;
export const TEXT_STRIPS: ReadonlySet<string> = new Set(['訪問のリンク', '積荷の知らせ', '受け取りの文', 'セルの詳細', '年表の結末']);

/**
 * 画ごとに変わる字 (年代記の hash から決まる島の名前) は、mask に渡した要素の箱を塗りつぶして比べる (M25-14)。
 * 箱の大きさは字の長さに依らない要素 (横いっぱいの見出し) を渡す。字の長さで箱が変わると、覆っても差が出る
 */
export const optionsFor = (name: string, mask?: readonly Locator[]): { threshold: number; maxDiffPixelRatio: number; animations: 'disabled'; caret: 'hide'; mask?: Locator[] } => {
  const base = TEXT_STRIPS.has(name) ? { ...BASELINE_OPTIONS, maxDiffPixelRatio: TEXT_STRIP_RATIO } : BASELINE_OPTIONS;
  return mask && mask.length > 0 ? { ...base, mask: [...mask] } : base;
};

export const shouldCompareBaselines = (env: { CI?: string }, platform: string) => !env.CI && platform === 'darwin';

/** 画 n の要素 name の基準画の名前 */
export const baselineName = (id: string, n: number, name: string) => `${id}-${n}-${name}.png`;

/** 3D の canvas の範囲の画の要素名。DOM の板の画とは別の画にする */
export const CANVAS_TARGET = '3D の面';
