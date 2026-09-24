import { describe, it, expect } from 'vitest';
import { Color, Matrix4, Vector3, type InstancedBufferAttribute } from 'three';
import { carpetTuft, createGrass, farTuft, grassIsFar, tuftSilhouette } from '../../src/observe/render/grass';
import { createTerrainField, groundColorAt, groundPatch, wearAt, type GroundLayers } from '../../src/observe/render/terrain';
import type { WorldSnapshot } from '../../src/simulation/types';

/** 12×12 の陸 (標高 0.45)。草の密度は 0.4 (本体の草地のふつうの値)、東の半分に苔 */
function snap(): WorldSnapshot {
  const size = 12;
  const elevation = new Float32Array(size * size).fill(0.45);
  const grass = new Float32Array(size * size).fill(0.4);
  const moss = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 6; x < size; x++) moss[y * size + x] = 0.5;
  return { size, layers: { elevation, populations: { grass, moss } } } as unknown as WorldSnapshot;
}
const home = 6 * 12 + 6;

describe('観察画面 (草の磨き上げ): 房の形', () => {
  it('12 枚の葉で 36 三角形 (M22-03 の 1 房 40 三角形の予算の内)、高さは約 0.5 m', () => {
    const g = carpetTuft();
    expect(g.getAttribute('position').count / 3).toBe(36);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(0.42);
    expect(g.boundingBox!.max.y).toBeLessThan(0.53);
    // 根元に寄せた房: 葉の根元 (葉の幅を含む) は房の中心から 13 cm 以内
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) === 0) expect(Math.hypot(pos.getX(i), pos.getZ(i))).toBeLessThan(0.13);
  });
});

describe('観察画面 (草の磨き上げ): 地面の斑と踏み固めた所', () => {
  it('斑の値は 0〜1 で決定論。草の密度が低いほど土がのぞく', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 3.7 - 300;
      const z = i * -2.3 + 150;
      const a = groundPatch(x, z, 0.4);
      expect(groundPatch(x, z, 0.4)).toEqual(a);
      for (const v of [a.dry, a.bare, a.clump]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(groundPatch(x, z, 0).bare).toBeGreaterThanOrEqual(a.bare);
    }
  });
  it('踏み固めた所は線分の上で 1、半径の外で 0', () => {
    const worn = [{ ax: 0, az: 0, bx: 20, bz: 0, r: 3 }];
    expect(wearAt(worn, 10, 0)).toBe(1);
    expect(wearAt(worn, 10, 5)).toBe(0);
    expect(wearAt(worn, 30, 0)).toBe(0);
    expect(wearAt([], 10, 0)).toBe(0);
  });
});

describe('観察画面 (草の磨き上げ): 草の房', () => {
  const s = snap();
  const field = createTerrainField(s, home, 5);
  const layers: GroundLayers = { grass: s.layers.populations.grass, moss: s.layers.populations.moss };
  const tuft = carpetTuft();
  tuft.computeBoundingBox();
  const top = tuft.boundingBox!.max.y;
  const heights = (g: ReturnType<typeof createGrass>) => {
    const m = new Matrix4();
    const p = new Vector3();
    const out: { x: number; z: number; h: number }[] = [];
    for (let i = 0; i < g.mesh.count; i++) {
      g.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      out.push({ x: p.x, z: p.z, h: new Vector3().setFromMatrixColumn(m, 1).length() * top });
    }
    return out;
  };

  it('根元の色 (aRoot) は地面の色と同じ式で、遠くの房はこの色に溶ける', () => {
    const g = createGrass(field, layers, 800, 7, undefined, 40);
    expect(g.mesh.count).toBeGreaterThan(100);
    const root = g.mesh.geometry.getAttribute('aRoot') as InstancedBufferAttribute;
    const m = new Matrix4();
    const p = new Vector3();
    const want = new Color();
    for (const i of [0, 5, 50]) {
      g.mesh.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      groundColorAt(field, layers, p.x, p.z, want);
      expect(root.getX(i)).toBeCloseTo(want.r, 5);
      expect(root.getY(i)).toBeCloseTo(want.g, 5);
      expect(root.getZ(i)).toBeCloseTo(want.b, 5);
    }
  });

  it('兎 (座高 0.35 m) が見えるように、丈は平均 0.5 m 未満、最も高い房でも 0.85 m 未満', () => {
    const hs = heights(createGrass(field, layers, 800, 7, undefined, 40)).map((t) => t.h);
    expect(hs.reduce((a, b) => a + b, 0) / hs.length).toBeLessThan(0.5);
    expect(Math.max(...hs)).toBeLessThan(0.85);
  });

  it('踏み固めた所の房は消え、縁に残る房は短くなる', () => {
    const g = createGrass(field, layers, 1500, 7, undefined, 40);
    const before = heights(g);
    const worn = [{ ax: 0, az: 0, bx: 0, bz: 0, r: 10 }];
    g.trample(worn);
    g.update(0, { x: 0, z: 0 });
    const after = heights(g);
    expect(after.length).toBeLessThan(before.length);
    for (const t of after) {
      expect(Math.hypot(t.x, t.z)).toBeGreaterThan(10 * 0.75 * 0.55 - 0.01);
      // 踏まれた所 (wear > 0) の房は、踏む前より短い
      const w = wearAt(worn, t.x, t.z);
      const b = before.find((u) => u.x === t.x && u.z === t.z)!;
      if (w > 0) expect(t.h).toBeLessThan(b.h);
      else expect(t.h).toBeCloseTo(b.h, 5);
    }
  });
});

describe('観察画面 (M23-05): 草の遠距離版', () => {
  it('遠距離版に替える距離は房ごとの乱数で 22〜36 m に散らす。近いほうは必ず近い房、遠いほうは必ず遠距離版、帯の中は乱数の割合', () => {
    const hs = Array.from({ length: 1000 }, (_, i) => (i + 0.5) / 1000);
    const share = (d: number) => hs.filter((h) => grassIsFar(d, h)).length / hs.length;
    expect(share(0)).toBe(0);
    expect(share(22)).toBe(0);
    expect(share(29)).toBeCloseTo(0.5, 2);
    expect(share(36.01)).toBe(1);
    expect(share(120)).toBe(1);
    // 距離が延びるほど遠距離版の割合が増え、1 つの房は一度遠距離版になれば、より遠くでも遠距離版 (カメラが離れるとき戻らない)
    for (let d = 20; d < 40; d += 0.5) expect(share(d + 0.5)).toBeGreaterThanOrEqual(share(d));
    for (const h of [0.1, 0.5, 0.9]) for (let d = 20; d < 40; d += 0.5) if (grassIsFar(d, h)) expect(grassIsFar(d + 0.5, h)).toBe(true);
  });

  it('遠距離版の房は 2 三角形の板で、近い房と同じ高さ・同じ横の幅。法線は真上', () => {
    const tuft = carpetTuft();
    const far = farTuft(tuft);
    const pos = far.getAttribute('position');
    expect(pos.count / 3).toBe(2);
    expect(far.getAttribute('uv').count).toBe(pos.count);
    tuft.computeBoundingBox();
    far.computeBoundingBox();
    expect(far.boundingBox!.max.y).toBeCloseTo(tuft.boundingBox!.max.y, 6);
    expect(far.boundingBox!.min.y).toBe(0);
    const r = Math.max(-tuft.boundingBox!.min.x, tuft.boundingBox!.max.x);
    expect(far.boundingBox!.max.x).toBeCloseTo(r, 6);
    expect(far.boundingBox!.min.x).toBeCloseTo(-r, 6);
    const n = far.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect([n.getX(i), n.getY(i), n.getZ(i)]).toEqual([0, 1, 0]);
  });

  it('板の覆いは房を横から見た輪郭: 根元は密、先は疎ら、上の角は空く。覆いの割合は 4 つの色の組で同じ', () => {
    const tex = tuftSilhouette(carpetTuft(), 64);
    const data = tex.image.data as Uint8Array;
    expect(tex.image.width).toBe(64);
    const row = (y: number) => {
      let a = 0;
      for (let x = 0; x < 64; x++) a += data[(y * 64 + x) * 4];
      return a / 64 / 255;
    };
    const band = (y0: number, y1: number) => {
      let a = 0;
      for (let y = y0; y < y1; y++) a += row(y);
      return a / (y1 - y0);
    };
    // 下の半分は 2.5 割以上を覆い、上の 4 分の 1 (外の葉より高い内の 4 枚の先だけ) は下の半分の 4 分の 1 未満、全体は 1〜6 割 (葉の間から地面がのぞく)
    expect(band(0, 32)).toBeGreaterThan(0.25);
    expect(band(48, 64)).toBeLessThan(band(0, 32) * 0.25);
    expect(band(0, 64)).toBeGreaterThan(0.1);
    expect(band(0, 64)).toBeLessThan(0.6);
    expect(data[(63 * 64 + 0) * 4]).toBe(0);
    expect(data[(63 * 64 + 63) * 4]).toBe(0);
    for (let i = 0; i < 64 * 64; i++) {
      expect(data[i * 4 + 1]).toBe(data[i * 4]);
      expect(data[i * 4 + 3]).toBe(data[i * 4]);
    }
  });
});
