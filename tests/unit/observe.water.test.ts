import { describe, it, expect } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { bakeHeightGrid, buildWaterGeometry, createWater, paintShoreDistance, sampleHeightGrid, WAVE_SURGE_AMP } from '../../src/observe/render/water';
import { createTerrainField, createTerrainMesh, terrainGrid, type TerrainField } from '../../src/observe/render/terrain';
import { fakeSnapshot, OBS_HOME, OBS_SIZE } from './observeFixtures';

/** 観察画面と同じ窓 (12 セル = 半辺 125 m) の地面。x = 20 m が水際で、東へ 10 m ごとに 1 m 高くなる (西は海) */
function slope(): TerrainField {
  return { home: OBS_HOME, window: 12, size: OBS_SIZE, heightAt: (x) => (x - 20) * 0.1, layerAt: () => 0 };
}

describe('観察画面の海 (M23-03 のやり直し): 地面の高さの表', () => {
  it('表の格子は地面の頂点の格子を含み、窓の中の画素は地面の頂点とちょうど同じ位置・同じ高さ', () => {
    const f: TerrainField = { ...slope(), heightAt: (x, z) => Math.sin(x * 0.07) * 3 + Math.cos(z * 0.05) * 2 };
    const g = bakeHeightGrid(f);
    const { half, step, n } = terrainGrid(f);
    expect(g.step).toBe(step);
    expect(g.half).toBe(half);
    // 表の原点は地面の頂点の番号で整数 (−half からちょうど step の倍数)
    const i0 = (g.x0 + half) / step;
    const j0 = (g.z0 + half) / step;
    expect(Math.abs(i0 - Math.round(i0))).toBeLessThan(1e-9);
    expect(Math.abs(j0 - Math.round(j0))).toBeLessThan(1e-9);
    // 窓 (地面の頂点 0〜n−1) が表に収まる
    expect(-Math.round(i0)).toBeGreaterThanOrEqual(0);
    expect(-Math.round(i0) + n - 1).toBeLessThanOrEqual(g.nx - 1);
    for (const [vi, vj] of [[0, 0], [n - 1, n - 1], [37, 101], [150, 3]]) {
      const x = -half + vi * step;
      const z = -half + vj * step;
      expect(sampleHeightGrid(g, x, z)).toBeCloseTo(f.heightAt(x, z), 5);
    }
  });

  it('表は本体の世界 (size 四方のセル) の端の 2 セル外まで広がる', () => {
    const g = bakeHeightGrid(slope());
    // 家のセル (16, 16)、世界は 32 セル。世界のセル c の中心は (c − 16) × 10 m
    expect(g.x0).toBeLessThanOrEqual((-2 - 16) * 10);
    expect(g.x0 + (g.nx - 1) * g.step).toBeGreaterThanOrEqual((32 + 1 - 16) * 10);
    // 窓 (半辺 125 m) の方が広い向きは窓まで
    expect(g.z0).toBeLessThanOrEqual(-125);
  });

  it('画素の間の高さは、描いた地面 (createTerrainMesh) の三角形の面と同じ (真上から落とした光線の当たる高さ)', () => {
    // 起伏のある世界 (セルごとに標高を変える)
    const s = fakeSnapshot({ elevation: (c, r) => 0.3 + 0.08 * Math.sin(c * 0.9) + 0.06 * Math.cos(r * 1.3) });
    const field = createTerrainField(s, OBS_HOME, 4);
    const terrain = createTerrainMesh(s, field);
    terrain.updateMatrixWorld();
    const g = bakeHeightGrid(field);
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0);
    let n = 0;
    for (let k = 0; k < 60; k++) {
      // 窓 (半辺 45 m) の中を散らして、目の中の半端な位置を選ぶ
      const x = -40 + ((k * 37.13) % 80);
      const z = -40 + ((k * 53.71) % 80);
      ray.set(new Vector3(x, 500, z), down);
      const hit = ray.intersectObject(terrain)[0];
      if (!hit) continue;
      expect(sampleHeightGrid(g, x, z)).toBeCloseTo(hit.point.y, 3);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });

  it('表の外は端の値を引き伸ばす (世界の外の heightAt と同じく一定)', () => {
    const g = bakeHeightGrid(slope());
    const edgeX = g.x0 + (g.nx - 1) * g.step;
    expect(sampleHeightGrid(g, edgeX + 500, 0)).toBeCloseTo(sampleHeightGrid(g, edgeX, 0), 3);
    expect(sampleHeightGrid(g, g.x0 - 900, 3)).toBeCloseTo(sampleHeightGrid(g, g.x0, 3), 3);
  });
});

describe('観察画面の海 (M23-03 のやり直し): 陸の縁からの距離 (泡の帯を岸に沿わせる)', () => {
  it('まっすぐな岸: 距離は高さ level の線 (x = 20 + level × 10) からの横の距離で、reach で頭打ち', () => {
    const g = bakeHeightGrid(slope());
    paintShoreDistance(g, 0.16, 6);
    // 高さ 0.16 m の線は x = 21.6 m。画素 (1.67 m おき) の値を補うので、線の上は 0 でなく半目ほどまで持ち上がる
    for (const x of [19.1, 18.6, 17]) expect(sampleHeightGrid(g, x, 5.3, 1)).toBeCloseTo(Math.abs(x - 21.6), 1);
    expect(sampleHeightGrid(g, 21.6, 5.3, 1)).toBeLessThan(g.step / 2);
    expect(sampleHeightGrid(g, 10, 5.3, 1)).toBeCloseTo(6, 5);
    expect(sampleHeightGrid(g, -60, 5.3, 1)).toBeCloseTo(6, 5);
  });

  it('波をかぶる高さまでしか出ていない砂州 (頂が level より低い) からは距離を引かない。頂が level を越える島からは引く', () => {
    // x = 0 を頂にした砂州。頂の高さ top、両側へ 1 m ごとに 5 cm 下がる
    const bar = (top: number): TerrainField => ({ ...slope(), heightAt: (x) => top - Math.abs(x) * 0.05 });
    const low = bakeHeightGrid(bar(0.1));
    paintShoreDistance(low, 0.16, 6);
    for (const x of [-3, 0, 2.5]) expect(sampleHeightGrid(low, x, 7, 1)).toBeCloseTo(6, 5);
    const high = bakeHeightGrid(bar(0.4));
    paintShoreDistance(high, 0.16, 6);
    // 頂から 4.8 m の所が高さ 0.16 m
    expect(sampleHeightGrid(high, 6.8, 7, 1)).toBeCloseTo(2, 1);
  });

  it('within を渡すと、その外 (地面の窓の外) の岸からは距離を引かない', () => {
    // x = 141.6 m (窓の外、表の中) だけに岸がある
    const f: TerrainField = { ...slope(), heightAt: (x) => (x - 140) * 0.1 };
    const g = bakeHeightGrid(f);
    paintShoreDistance(g, 0.16, 6, g.half);
    expect(sampleHeightGrid(g, 138, 0, 1)).toBeCloseTo(6, 5);
    paintShoreDistance(g, 0.16, 6);
    expect(sampleHeightGrid(g, 138, 0, 1)).toBeCloseTo(3.6, 1);
  });
});

describe('観察画面の海 (M23-03 のやり直し): 近くは細かく遠くは粗い分割', () => {
  const water = createWater(slope(), 3000);
  const geo = water.mesh.geometry;
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex()!;

  it('三角形は 15 千以下 (以前の一様な 240 × 240 は 115,200)', () => {
    expect(idx.count / 3).toBeLessThanOrEqual(15_000);
    expect(idx.count / 3).toBe(10_020);
  });

  it('海の果ては以前と同じ 3 km 四方、地面の窓 (半辺 125 m) の中は 4.2 m 前後の目', () => {
    geo.computeBoundingBox();
    expect(geo.boundingBox!.min.x).toBeCloseTo(-1500, 5);
    expect(geo.boundingBox!.max.z).toBeCloseTo(1500, 5);
    const xs = new Set<number>();
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i)) <= 125 && Math.abs(pos.getZ(i)) <= 125) xs.add(+pos.getX(i).toFixed(3));
    const sorted = [...xs].sort((a, b) => a - b);
    expect(sorted[0]).toBeCloseTo(-125, 3);
    expect(sorted[sorted.length - 1]).toBeCloseTo(125, 3);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeLessThan(4.5);
  });

  it('隙間が無い: 内側の辺はどれもちょうど 2 枚の三角形が共有し、1 枚だけの辺は海の果ての縁にしか無い', () => {
    const edges = new Map<string, number>();
    for (let t = 0; t < idx.count; t += 3) {
      const v = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (let e = 0; e < 3; e++) {
        const a = Math.min(v[e], v[(e + 1) % 3]);
        const b = Math.max(v[e], v[(e + 1) % 3]);
        edges.set(`${a}-${b}`, (edges.get(`${a}-${b}`) ?? 0) + 1);
      }
    }
    let rim = 0;
    for (const [key, n] of edges) {
      expect(n === 1 || n === 2).toBe(true);
      if (n === 2) continue;
      rim++;
      for (const i of key.split('-').map(Number)) expect(Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeCloseTo(1500, 3);
    }
    // 外の縁は 1 辺 60 / 4 = 15 分割 × 4
    expect(rim).toBe(60);
    const seen = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('三角形はどれも上を向き (裏返りが無い)、合計の面積は 3 km 四方', () => {
    let area = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      const ny = (pos.getZ(b) - pos.getZ(a)) * (pos.getX(c) - pos.getX(a)) - (pos.getX(b) - pos.getX(a)) * (pos.getZ(c) - pos.getZ(a));
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
    expect([...edges.values()].filter((n) => n === 1).length).toBe(8);
    expect([...edges.values()].every((n) => n === 1 || n === 2)).toBe(true);
  });
});

describe('観察画面の海 (M23-03 のやり直し): 沈降で海面を上げる', () => {
  it('setLevel(3) で海面が 3 m 上がり、泡を切る陸の縁が x = 21.8 m から 51.8 m (高さ 3.18 m) へ移る。5 cm 未満の変化は書き直さない', () => {
    const w = createWater(slope(), 3000);
    // 最初の陸の縁は波の無い海面 0.02 m + 0.16 m = 高さ 0.18 m、x = 21.8 m
    expect(sampleHeightGrid(w.heights, 18.8, 0, 1)).toBeCloseTo(3, 1);
    expect(sampleHeightGrid(w.heights, 48.8, 0, 1)).toBeCloseTo(6, 5);
    w.setLevel(3);
    expect(w.mesh.position.y).toBeCloseTo(3.02, 5);
    expect(sampleHeightGrid(w.heights, 48.8, 0, 1)).toBeCloseTo(3, 1);
    expect(sampleHeightGrid(w.heights, 18.8, 0, 1)).toBeCloseTo(6, 5);
    // 高さの値はそのまま
    expect(sampleHeightGrid(w.heights, 40, 0)).toBeCloseTo(2, 4);
    // (M22-07 の手直しで変更: 沈む海は毎コマ少しずつ上がるので、海面 (面の高さ) は 5 cm 未満でもそのまま動かし、陸の縁からの距離の表だけ書き直さない)
    const before = sampleHeightGrid(w.heights, 48.8, 0, 1);
    w.setLevel(3.03);
    expect(w.mesh.position.y).toBeCloseTo(3.05, 5);
    expect(sampleHeightGrid(w.heights, 48.8, 0, 1)).toBe(before);
    // 書き直した海面 (3) から 5 cm 動くと表を書き直す: 陸の縁は高さ 3.24 m、x = 52.4 m へ
    w.setLevel(3.06);
    expect(sampleHeightGrid(w.heights, 49.4, 0, 1)).toBeCloseTo(3, 1);
  });

  it('(M22-07 の手直し) setSurge は波の高さの倍率を 1 → WAVE_SURGE_AMP にし、setRain は雨の波紋の強さを渡す。0 に戻すと前の海と同じ', () => {
    const w = createWater(slope(), 3000);
    expect(w.fxState()).toEqual({ surge: 0, waveAmp: 1, rain: 0 });
    w.setSurge(1);
    expect(w.fxState().waveAmp).toBeCloseTo(WAVE_SURGE_AMP, 6);
    expect(w.fxState().surge).toBe(1);
    w.setSurge(0.5);
    expect(w.fxState().waveAmp).toBeCloseTo(1 + (WAVE_SURGE_AMP - 1) * 0.5, 6);
    w.setSurge(0);
    w.setRain(0.7);
    expect(w.fxState()).toEqual({ surge: 0, waveAmp: 1, rain: 0.7 });
  });
});
