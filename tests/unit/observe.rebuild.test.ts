import { describe, it, expect } from 'vitest';
import { observeIslandOf, observeNeedsRebuild } from '../../src/observe/rebuild';
import type { WorldSnapshot } from '../../src/simulation/types';

const snapshot = (elevation: Float32Array, tick = 0) => ({ tick, layers: { elevation } }) as unknown as WorldSnapshot;

describe('observeNeedsRebuild (M26-07: 観察画面は島が替われば組み直す。tick では組み直さない)', () => {
  const elevation = new Float32Array(4);

  it('まだ何も組んでいなければ組む', () => {
    expect(observeNeedsRebuild(null, observeIslandOf(snapshot(elevation)))).toBe(true);
  });

  it('同じ島なら、tick が進んでも組み直さない (tick の更新は view.setSnapshot の仕事)', () => {
    const built = observeIslandOf(snapshot(elevation, 0));
    expect(observeNeedsRebuild(built, observeIslandOf(snapshot(elevation, 360)))).toBe(false);
  });

  it('別の島なら、tick が同じでも組み直す (年 0 の新しい島・同じ tick の枠や file を読む)', () => {
    const built = observeIslandOf(snapshot(elevation, 0));
    expect(observeNeedsRebuild(built, observeIslandOf(snapshot(new Float32Array(4), 0)))).toBe(true);
  });

  it('島の同一性は描き直しの判定 (render/rebuild.ts) と同じ layers.elevation の参照', () => {
    expect(observeIslandOf(snapshot(elevation))).toBe(elevation);
  });
});
