import { describe, it, expect } from 'vitest';
import { Color, Matrix4, Vector3, type InstancedBufferAttribute } from 'three';
import { carpetTuft, createGrass } from '../../src/observe/render/grass';
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
