import { describe, it, expect } from 'vitest';
import { extractArea, cellAt, isLandAt, landmarks, CELL_M } from '../../src/observe/area';
import { fakeSnapshot, OBS_HOME, OBS_SIZE } from './observeFixtures';

describe('観察画面 (M22-04): extractArea', () => {
  it('半径 8 の円 (forEachInRadius と同じ判定) を切り出し、1 セル = 10 m で集落を原点に置く', () => {
    const area = extractArea(fakeSnapshot(), OBS_HOME, 8);
    // 半径 8 の円内のセル数は 197 (設計書 §1 の区域と同じ)
    expect(area.cells.length).toBe(197);
    expect(area.landCount).toBe(197);
    expect(CELL_M).toBe(10);
    const center = area.cells.find((c) => c.index === OBS_HOME)!;
    expect(center).toMatchObject({ x: 0, z: 0, col: 16, row: 16 });
    // 東へ 3、南へ 2 のセルは (30 m, 20 m)
    const east = area.cells.find((c) => c.index === 18 * OBS_SIZE + 19)!;
    expect(east).toMatchObject({ x: 30, z: 20 });
  });

  it('標高 < SEA_LEVEL (0.3) のセルは海、陸の数だけ landCount に数え、密度と生気を写す', () => {
    const snap = fakeSnapshot({
      elevation: (col) => (col >= 20 ? 0.25 : 0.4),
      density: { deer: (col, row) => (col === 16 && row === 16 ? 0.7 : 0) },
    });
    const area = extractArea(snap, OBS_HOME, 8);
    const sea = area.cells.filter((c) => !c.isLand);
    expect(sea.every((c) => c.col >= 20)).toBe(true);
    expect(area.landCount).toBe(197 - sea.length);
    const center = area.cells.find((c) => c.index === OBS_HOME)!;
    expect(center.density.deer).toBeCloseTo(0.7);
    expect(center.vitality).toBeCloseTo(0.5);
    expect(center.elevation).toBeCloseTo(0.4);
  });

  it('cellAt は位置 (m) を最寄りのセルに丸め、区域の外は undefined。isLandAt は海と区域外で false', () => {
    const area = extractArea(fakeSnapshot({ elevation: (col) => (col >= 20 ? 0.25 : 0.4) }), OBS_HOME, 8);
    expect(cellAt(area, 4.9, -4.9)?.index).toBe(OBS_HOME);
    expect(cellAt(area, 5.1, 0)?.index).toBe(OBS_HOME + 1);
    expect(cellAt(area, 90, 0)).toBeUndefined();
    expect(isLandAt(area, 0, 0)).toBe(true);
    expect(isLandAt(area, 40, 0)).toBe(false);
    expect(isLandAt(area, 0, 90)).toBe(false);
  });
});

describe('観察画面 (M22-04): landmarks', () => {
  it('林 = 鐘樹の密度が最大の陸セル、船台 = 集落に最も近い海辺の陸セル、灯り = 集落と隣の陸セル', () => {
    const snap = fakeSnapshot({
      elevation: (col) => (col >= 20 ? 0.25 : 0.4),
      density: { belltree: (col, row) => (col === 13 && row === 15 ? 0.9 : col === 12 ? 0.3 : 0) },
    });
    const m = landmarks(extractArea(snap, OBS_HOME, 8));
    expect(m.center).toEqual({ x: 0, z: 0 });
    expect(m.grove).toEqual({ x: -30, z: -10 });
    // 海 (col 20〜) に接する陸は col 19。集落 (16,16) から最も近いのは (19,16)
    expect(m.slipway).toEqual({ x: 30, z: 0 });
    expect(m.lanterns.length).toBe(9);
    expect(m.lanterns[0]).toEqual({ x: -10, z: -10 });
  });

  it('鐘樹が無ければ林は null、海が無ければ船台は集落そのもの', () => {
    const m = landmarks(extractArea(fakeSnapshot(), OBS_HOME, 8));
    expect(m.grove).toBeNull();
    expect(m.slipway).toEqual({ x: 0, z: 0 });
    expect(m.coast).toEqual({ x: 0, z: 0 });
  });
});
