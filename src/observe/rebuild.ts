import type { WorldSnapshot } from '../simulation/types';

/**
 * 観察画面を組み直す判定 (M26-07)。操作画面の描き直しの判定 (render/rebuild.ts の needsRebuild) と同じく、島の同一性で決める。
 * 観察画面は島ごとに 1 度組み、同じ島の中の更新は view.setSnapshot が受け持つので、tick・層では組み直さない。
 * 島は World が持つ標高のバッファ (layers.elevation) の参照で表す。島が替われば参照が変わる
 */
export function observeIslandOf(s: WorldSnapshot): object {
  return s.layers.elevation;
}

export function observeNeedsRebuild(built: object | null, now: object): boolean {
  return built === null || built !== now;
}
