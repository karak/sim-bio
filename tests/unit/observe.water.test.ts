import { describe, it, expect } from 'vitest';
import type { BufferAttribute } from 'three';
import { buildWaterGeometry, createWater } from '../../src/observe/render/water';
import type { TerrainField } from '../../src/observe/render/terrain';

/** 観察画面と同じ窓 (12 セル = 半辺 125 m) の地面。x = 20 m が水際で、東へ 10 m ごとに 1 m 高くなる (西は海) */
function field(): TerrainField {
  return { home: 0, window: 12, size: 32, heightAt: (x) => (x - 20) * 0.1, layerAt: () => 0 };
}

describe('観察画面の海 (M23-03): 近くは細かく遠くは粗い分割', () => {
  const water = createWater(field(), 3000);
  const geo = water.mesh.geometry;
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()!;

  it('三角形は 15 千以下 (以前の一様な 240 × 240 は 115,200)', () => {
    expect(idx.count / 3).toBeLessThanOrEqual(15_000);
    expect(idx.count / 3).toBeGreaterThan(10_000);
  });

  it('海の果ては以前と同じ 3 km 四方、地面の窓 (半辺 125 m) の中は 3.5 m 前後の目', () => {
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.x).toBeCloseTo(-1500, 5);
    expect(geo.boundingBox!.max.z).toBeCloseTo(1500, 5);
    // 窓の中の頂点の x を並べ、隣との間隔を見る
    const xs = new Set<number>();
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) <= 125 && Math.abs(pos.getZ(i)) <= 125) xs.add(+pos.getX(i).toFixed(3));
    const sorted = [...xs].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(-125, 3);
    expect(sorted[sorted.length - 1]).toBeCloseTo(125, 3);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThan(4);
  });

  it('隙間が無い: 内側の辺はどれもちょうど 2 枚の三角形が共有し、1 枚だけの辺は海の果ての縁にしか無い', () => {
    const edges = new Map<string, number>();
    for (let t = 0; t < idx.count; t += 3) {
      const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const a = v[e];
        const b = v[(e + 1) % 3];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    let rim = 0;
    for (const [key, n] of edges) {
      expect(n === 1 || n === 2).toBe(true);
      if (n === 2) continue;
      rim++;
      for (const i of key.split('-').map(Number)) expect(Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeCloseTo(1500, 3);
    }
    // 外の縁は 1 辺 18 分割 × 4
    expect(rim).toBe(72);
    // 同じ位置に別の頂点が重なっていない (継ぎ目で頂点を共有している)
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('三角形はどれも上を向き (裏返りが無い)、面積は正で、合計は 3 km 四方', () => {
    let area = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const ux = pos.getX(b) - pos.getX(a);
      const uz = pos.getZ(b) - pos.getZ(a);
      const vx = pos.getX(c) - pos.getX(a);
      const vz = pos.getZ(c) - pos.getZ(a);
      // 法線の y = uz * vx - ux * vz
      const ny = uz * vx - ux * vz;
      expect(ny).toBeGreaterThan(0);
      area += ny / 2;
    }
    expect(area).toBeCloseTo(3000 * 3000, -2);
  });

  it('分割の数を変えても隙間の無い形になる (細かい格子 1 辺 8 分割)', () => {
    const g = buildWaterGeometry(1000, 50, 8);
    const index = g.getIndex()!;
    const edges = new Map<string, number>();
    for (let t = 0; t < index.count; t += 3) {
      const v = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const a = Math.min(v[e], v[(e + 1) % 3]);
        const b = Math.max(v[e], v[(e + 1) % 3]);
        edges.set(`${a}-${b}`, (edges.get(`${a}-${b}`) ?? 0) + 1);
      }
    }
    // 外の縁 (1 辺 8 / 4 = 2 分割 × 4 = 8 辺) だけが 1 枚
    expect([...edges.values()].filter((n) => n === 1).length).toBe(8);
    expect([...edges.values()].every((n) => n === 1 || n === 2)).toBe(true);
  });
});

describe('観察画面の海 (M23-03): 沈降で海面を上げると水深と泡を塗り直す', () => {
  /**
   * z = 0 の列で x0〜x1 m にある頂点の、泡の帯 (水深 −0.2〜0.5 m) に入る数・赤の平均・青の平均。
   * 泡は画素ごとに頂点の水深 aDepth から塗り、頂点の色は水深の色だけ (線形: 浅瀬の赤 0.16、深い青の赤 0.03・青 0.27)
   */
  const band = (w: ReturnType<typeof createWater>, x0: number, x1: number) => {
    const geo = w.mesh.geometry;
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color') as BufferAttribute;
    const dep = geo.getAttribute('aDepth') as BufferAttribute;
    let foam = 0;
    let r = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) !== 0 || pos.getX(i) < x0 || pos.getX(i) > x1) continue;
      if (dep.getX(i) > -0.2 && dep.getX(i) < 0.5) foam++;
      r += col.getX(i);
      b += col.getZ(i);
      n++;
    }
    return { foam, r: r / n, b: b / n, n };
  };

  it('海面 0 m: 頂点の水深は海面 − 地面の高さ。水際 (x ≈ 18 m) に泡の帯の頂点があり、沖 (x = −60 m、水深 8 m) は深い青', () => {
    const w = createWater(field(), 3000);
    const geo = w.mesh.geometry;
    const pos = geo.getAttribute('position');
    const dep = geo.getAttribute('aDepth') as BufferAttribute;
    for (let i = 0; i < pos.count; i += 97) expect(dep.getX(i)).toBeCloseTo(-(pos.getX(i) - 20) * 0.1, 4);
    const shore = band(w, 15, 22);
    // 3.5 m 目なので、水際の 7 m の幅に頂点が 2 つある
    expect(shore.n).toBe(2);
    expect(shore.foam).toBeGreaterThanOrEqual(1);
    const off = band(w, -62, -58);
    expect(off.foam).toBe(0);
    expect(off.r).toBeLessThan(0.05);
    expect(off.b).toBeGreaterThan(0.25);
  });

  it('setLevel(3) で水際が x ≈ 48 m へ上がり、泡の帯がそこへ移って元の水際は水深 3 m の色に沈む。海面の高さも 3 m 上がる', () => {
    const w = createWater(field(), 3000);
    const geo = w.mesh.geometry;
    const colAttr = geo.getAttribute('color') as BufferAttribute;
    const depAttr = geo.getAttribute('aDepth') as BufferAttribute;
    const oldShore = band(w, 15, 22);
    expect(band(w, 45, 52).foam).toBe(0);
    const cv = colAttr.version;
    const dv = depAttr.version;
    w.setLevel(3);
    expect(w.mesh.position.y).toBeCloseTo(3.02, 5);
    expect(colAttr.version).toBeGreaterThan(cv);
    expect(depAttr.version).toBeGreaterThan(dv);
    // 新しい水際に泡の帯の頂点が来て、元の水際からは消える
    expect(band(w, 45, 52).foam).toBeGreaterThanOrEqual(1);
    const after = band(w, 15, 22);
    expect(after.foam).toBe(0);
    // 元の水際は浅瀬の色から水深 3 m (浅瀬と深い青の中ほど) の色へ
    expect(after.r).toBeLessThan(oldShore.r - 0.05);
    // 5 cm 未満の変化は塗り直さない (以前と同じ)
    const v = colAttr.version;
    w.setLevel(3.03);
    expect(colAttr.version).toBe(v);
  });
});
