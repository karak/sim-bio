import type { LayerKind } from './layerToColors';

/**
 * 地形・インスタンスを描き直す判定 (M26-05)。島の同一性・tick・層の 3 つで決める。
 * tick だけで決めると、年 0 の新しい島や同じ tick の枠を読んだ島で、前の島の地形が残る。
 * island は島を表す参照 (World が持つ標高のバッファ)。World は島ごとに 1 つ作り、島の中では差し替えないので、島が変われば参照が変わる
 */
export type Drawn = { island: object; tick: number; layer: LayerKind };

export function needsRebuild(last: Drawn | null, now: Drawn): boolean {
  return last === null || last.island !== now.island || last.tick !== now.tick || last.layer !== now.layer;
}
