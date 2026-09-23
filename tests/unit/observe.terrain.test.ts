import { describe, it, expect } from 'vitest';
import { createTerrainField, CELL_M, ELEV_M } from '../../src/observe/render/terrain';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import type { WorldSnapshot } from '../../src/simulation/types';

/** 8×8 の島: x < 4 は陸 (標高 0.45)、x ≥ 4 は海 (0.2)。集落はセル (2, 4) */
function snap(): WorldSnapshot {
  const size = 8;
  const elevation = new Float32Array(size * size);
  const grass = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    elevation[y * size + x] = x < 4 ? 0.45 : 0.2;
    grass[y * size + x] = x;
  }
  return { size, layers: { elevation, populations: { grass } } } as unknown as WorldSnapshot;
}

describe('観察画面の地面 (M22-02)', () => {
  const home = 4 * 8 + 2;
  it('セルの中心では本体の標高をそのまま通り、陸は海面より上・海は下になる', () => {
    const f = createTerrainField(snap(), home, 3);
    // 集落のセル (陸の平ら) の中心。起伏ノイズは ±0.8 m まで
    expect(Math.abs(f.heightAt(0, 0) - (0.45 - SEA_LEVEL) * ELEV_M)).toBeLessThanOrEqual(0.801);
    expect(f.heightAt(0, 0)).toBeGreaterThan(10);
    // 3 セル東 (x = 5、海) の中心は海面より下で、ノイズを足さない
    expect(f.heightAt(3 * CELL_M, 0)).toBeCloseTo((0.2 - SEA_LEVEL) * ELEV_M, 5);
  });
  it('層の値はセルの間を線形に補う (ワールド座標 → セル)', () => {
    const f = createTerrainField(snap(), home, 3);
    const grass = snap().layers.populations.grass;
    expect(f.layerAt(grass, 0, 0)).toBeCloseTo(2, 5);
    expect(f.layerAt(grass, CELL_M / 2, 0)).toBeCloseTo(2.5, 5);
  });
});
