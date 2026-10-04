import { describe, it, expect } from 'vitest';
import { needsRebuild, type Drawn } from '../../src/render/rebuild';
import { terrainDigest } from '../../src/render/inspect';

const island = () => new Float32Array(4);

describe('needsRebuild (M26-05: 描き直しの判定は、島の同一性と tick と層の 3 つで決める)', () => {
  const a = island();
  const drawn: Drawn = { island: a, tick: 0, layer: 'terrain' };

  it('まだ何も描いていなければ描く', () => {
    expect(needsRebuild(null, drawn)).toBe(true);
  });

  it('島も tick も層も同じなら描き直さない (M21-10: 止めた島を描き直さない)', () => {
    expect(needsRebuild(drawn, { ...drawn })).toBe(false);
  });

  it('同じ島で tick が進めば描き直す', () => {
    expect(needsRebuild(drawn, { ...drawn, tick: 1 })).toBe(true);
  });

  it('同じ島で層が替われば描き直す', () => {
    expect(needsRebuild(drawn, { ...drawn, layer: 'temperature' })).toBe(true);
  });

  it('別の島なら、tick が同じでも描き直す (新しい島を年 0 で・同じ tick の枠を読む)', () => {
    expect(needsRebuild(drawn, { ...drawn, island: island() })).toBe(true);
  });
});

describe('terrainDigest (地形の頂点の高さを 1 つの数にする)', () => {
  /** 頂点 2 つ分の座標。x, z は固定で、高さだけ変える */
  const verts = (y0: number, y1: number) => Float32Array.from([0, y0, 0, 1, y1, 0]);
  it('同じ高さなら同じ数、1 つでも違えば違う数、並びが違っても違う数', () => {
    expect(terrainDigest(verts(1, 2))).toBe(terrainDigest(verts(1, 2)));
    expect(terrainDigest(verts(1, 2))).not.toBe(terrainDigest(verts(1, 2.5)));
    expect(terrainDigest(verts(1, 2))).not.toBe(terrainDigest(verts(2, 1)));
  });
});
