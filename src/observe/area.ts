/**
 * 観察画面の区域 (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §1〜§3)。
 * 集落 (home) を中心に半径 radius セルを snapshot から切り出す。純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 契約:
 * - 区域のセルは forEachInRadius と同じ円判定で選び、index の昇順に並べる。
 * - 位置は m 単位。1 セル = CELL_M (10 m)、集落のセルの中心が原点。x は列 (東) の向き、z は行 (南) の向き。
 * - isLand は elevation ≥ SEA_LEVEL。landCount は区域の陸セルの数。
 * - density は snapshot の populations をセルごとに写したもの (全種)。snapshot の配列は参照しない (コピー)。
 */
import { forEachInRadius } from '../simulation/disaster';
import { SEA_LEVEL } from '../simulation/terrain';
import type { WorldSnapshot } from '../simulation/types';

/** 1 セルの一辺 (m) */
export const CELL_M = 10;

export type Point = { x: number; z: number };

export type AreaCell = {
  /** 本体のセル index */
  index: number;
  col: number;
  row: number;
  /** 区域の中心 (集落のセルの中心) からの位置 (m) */
  x: number;
  z: number;
  elevation: number;
  isLand: boolean;
  vitality: number;
  /** 種 id → 密度 */
  density: Readonly<Record<string, number>>;
};

export type Area = {
  size: number;
  home: number;
  radius: number;
  cells: readonly AreaCell[];
  landCount: number;
  byIndex: ReadonlyMap<number, AreaCell>;
};

export function extractArea(s: WorldSnapshot, home: number, radius: number): Area {
  const size = s.size;
  const hc = home % size;
  const hr = (home - hc) / size;
  const indices: number[] = [];
  forEachInRadius(home, radius, size, (i) => indices.push(i));
  indices.sort((a, b) => a - b);
  const ids = Object.keys(s.layers.populations);
  const cells: AreaCell[] = indices.map((index) => {
    const col = index % size;
    const row = (index - col) / size;
    const elevation = s.layers.elevation[index];
    const density: Record<string, number> = {};
    for (const id of ids) density[id] = s.layers.populations[id][index];
    return {
      index,
      col,
      row,
      x: (col - hc) * CELL_M,
      z: (row - hr) * CELL_M,
      elevation,
      isLand: elevation >= SEA_LEVEL,
      vitality: s.layers.vitality[index],
      density,
    };
  });
  const byIndex = new Map(cells.map((c) => [c.index, c]));
  return { size, home, radius, cells, landCount: cells.filter((c) => c.isLand).length, byIndex };
}

/** 位置 (m) を含むセル。区域の外なら undefined */
export function cellAt(area: Area, x: number, z: number): AreaCell | undefined {
  const hc = area.home % area.size;
  const hr = (area.home - hc) / area.size;
  const col = hc + Math.round(x / CELL_M);
  const row = hr + Math.round(z / CELL_M);
  if (col < 0 || row < 0 || col >= area.size || row >= area.size) return undefined;
  return area.byIndex.get(row * area.size + col);
}

/** 位置が区域の中の陸か */
export function isLandAt(area: Area, x: number, z: number): boolean {
  return cellAt(area, x, z)?.isLand ?? false;
}

/** 2 つのセルの列・行の差の大きい方 (同じセルなら 0、隣なら 1) */
export function cellDistance(a: AreaCell, b: AreaCell): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/** 区域の縁 (円の外周から 1 セル以内) の陸セル。出入りの演出はここから入り、ここへ出る */
export function rimCells(area: Area): AreaCell[] {
  const hc = area.home % area.size;
  const hr = (area.home - hc) / area.size;
  return area.cells.filter((c) => c.isLand && Math.hypot(c.col - hc, c.row - hr) > area.radius - 1);
}

/** 位置に最も近い陸セル (同距離は index の小さい方)。陸が無ければ undefined */
export function nearestLand(area: Area, x: number, z: number, among: readonly AreaCell[] = area.cells): AreaCell | undefined {
  let best: AreaCell | undefined;
  let bestD = Infinity;
  for (const c of among) {
    if (!c.isLand) continue;
    const d = (c.x - x) ** 2 + (c.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export type Landmarks = {
  /** 集落 (区域の中心) */
  center: Point;
  /** 民の林 = 鐘樹の密度が最大の陸セル。鐘樹が無ければ null */
  grove: Point | null;
  /** 船台 = 集落に最も近い海辺の陸セル。海辺が無ければ集落 */
  slipway: Point;
  /** 灯り = 集落のセルと、その 8 近傍の陸セル */
  lanterns: Point[];
  /** 海岸の引きの画の狙い = 海に接する辺が最も多い陸セル。海辺が無ければ集落 */
  coast: Point;
};

/**
 * 区域の目印。本体に船台・灯りの位置は無いので、区域の地形と鐘樹の密度から決定論で置く
 * (描画側の集落・舟の配置と、民の行動・カメラの狙いが同じ点を使うため、ここで一度だけ決める)。
 */
export function landmarks(area: Area): Landmarks {
  const center = { x: 0, z: 0 };
  const pt = (c: AreaCell): Point => ({ x: c.x, z: c.z });
  let grove: AreaCell | undefined;
  for (const c of area.cells) {
    const b = c.density.belltree ?? 0;
    if (c.isLand && b > 0 && (!grove || b > (grove.density.belltree ?? 0))) grove = c;
  }
  const seaSides = (c: AreaCell): number => {
    let n = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = cellAt(area, c.x + dc * CELL_M, c.z + dr * CELL_M);
      if (nb && !nb.isLand) n++;
    }
    return n;
  };
  const coastal = area.cells.filter((c) => c.isLand && seaSides(c) > 0);
  const slip = nearestLand(area, 0, 0, coastal);
  let coast: AreaCell | undefined;
  for (const c of coastal) if (!coast || seaSides(c) > seaSides(coast)) coast = c;
  const home = area.byIndex.get(area.home);
  const lanterns = home ? area.cells.filter((c) => c.isLand && cellDistance(c, home) <= 1).map(pt) : [];
  return {
    center,
    grove: grove ? pt(grove) : null,
    slipway: slip ? pt(slip) : center,
    lanterns,
    coast: coast ? pt(coast) : center,
  };
}
