import { describe, it, expect } from 'vitest';
import { DOOR_M, HEARTH_M, HUT_OFFSETS, MAX_LIFT_M, SINK_M, hutPlacements } from '../../src/observe/settlementLayout';

describe('hutPlacements (小屋の置き方)', () => {
  const center = { x: 5, z: -3 };
  const plaza = { x: 5, z: -9 };
  const flat = () => 2;
  const huts = hutPlacements(center, plaza, flat);

  it('HUT_OFFSETS の数だけ、集落の中心からずらした位置に置く', () => {
    expect(huts.map((h) => [h.x, h.z])).toEqual(HUT_OFFSETS.map(([dx, dz]) => [center.x + dx, center.z + dz]));
  });

  it('戸口 (+Z を ry で回した向き) が広場を向く', () => {
    for (const h of huts) {
      const door = { x: Math.sin(h.ry), z: Math.cos(h.ry) };
      const toPlaza = { x: plaza.x - h.x, z: plaza.z - h.z };
      const len = Math.hypot(toPlaza.x, toPlaza.z);
      expect(door.x * (toPlaza.x / len) + door.z * (toPlaza.z / len)).toBeCloseTo(1, 6);
    }
  });

  it('西の小屋 (−14, −8) は東の広場へ向く (ry ≈ atan2(14, 2))', () => {
    const west = hutPlacements({ x: 0, z: 0 }, { x: 0, z: -6 }, flat)[0];
    expect(west.ry).toBeCloseTo(Math.atan2(14, 2), 6);
  });

  it('炉は小屋の中心から戸口の側へ HEARTH_M の所', () => {
    for (const h of huts) {
      expect(Math.hypot(h.hearth.x - h.x, h.hearth.z - h.z)).toBeCloseTo(HEARTH_M, 6);
      expect(Math.hypot(h.hearth.x - plaza.x, h.hearth.z - plaza.z)).toBeLessThan(Math.hypot(h.x - plaza.x, h.z - plaza.z));
    }
  });

  it('平らな地面では地面から SINK_M 沈める', () => {
    for (const h of huts) expect(h.y).toBeCloseTo(2 - SINK_M, 6);
  });

  it('戸口の外が上り坂なら戸口の外の高さに合わせ、下り坂なら中心の高さのまま', () => {
    const west = { x: 0, z: 0 };
    const east = { x: 10, z: 0 };
    // x が増えると 0.2 m/m 上がる坂。小屋 (−14, −8) の戸口は広場 (東) を向く
    const slope = (x: number) => 0.2 * x;
    const up = hutPlacements(west, { x: 0, z: -8 }, slope)[0];
    const doorX = up.x + Math.sin(up.ry) * DOOR_M;
    expect(up.y).toBeCloseTo(slope(doorX) - SINK_M, 6);
    expect(up.y).toBeGreaterThan(slope(up.x) - SINK_M);
    // 広場が西にあると戸口は下り坂を向く → 中心の高さ
    const down = hutPlacements(east, { x: -30, z: -8 }, slope)[0];
    expect(down.y).toBeCloseTo(slope(down.x) - SINK_M, 6);
  });

  it('上げる高さは中心から MAX_LIFT_M まで', () => {
    const steep = (x: number) => 3 * x;
    const h = hutPlacements({ x: 0, z: 0 }, { x: 0, z: -8 }, steep)[0];
    expect(h.y).toBeCloseTo(steep(h.x) + MAX_LIFT_M - SINK_M, 6);
  });

  it('敷石は戸口の外に 3 枚、広場へ向かって順に遠くなる', () => {
    for (const h of huts) {
      expect(h.steps).toHaveLength(3);
      const d = h.steps.map((s) => Math.hypot(s.x - h.x, s.z - h.z));
      expect(d[0]).toBeGreaterThan(2);
      expect(d[1]).toBeGreaterThan(d[0]);
      expect(d[2]).toBeGreaterThan(d[1]);
      const toPlaza = h.steps.map((s) => Math.hypot(s.x - plaza.x, s.z - plaza.z));
      expect(toPlaza[2]).toBeLessThan(toPlaza[0]);
    }
  });
});
