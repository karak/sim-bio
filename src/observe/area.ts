/**
 * 観察画面の区域 (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §1〜§3)。
 * 集落 (home) を中心に半径 radius セルを snapshot から切り出す。純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 契約:
 * - 区域のセルは forEachInRadius と同じ円判定で選び、index の昇順に並べる。
 * - 位置は m 単位。1 セル = CELL_M (10 m)、集落のセルの中心が原点。x は列 (東) の向き、z は行 (南) の向き。
 * - isLand は elevation ≥ SEA_LEVEL。landCount は区域の陸セルの数。
 * - openSea は地図の縁から 4 近傍でつながる海 (外海)。陸に囲まれた池・湖は false。
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
  /** 地図の縁から海だけを通ってたどれる海セル (外海)。陸・池は false */
  openSea: boolean;
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
  const open = openSeaMask(s.layers.elevation, size);
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
      openSea: open[index] === 1,
      vitality: s.layers.vitality[index],
      density,
    };
  });
  const byIndex = new Map(cells.map((c) => [c.index, c]));
  return { size, home, radius, cells, landCount: cells.filter((c) => c.isLand).length, byIndex };
}

/** 地図の縁の海セルから 4 近傍で塗り広げた外海の印 (1 = 外海) */
function openSeaMask(elevation: ArrayLike<number>, size: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const stack: number[] = [];
  const push = (i: number) => {
    if (mask[i] || elevation[i] >= SEA_LEVEL) return;
    mask[i] = 1;
    stack.push(i);
  };
  for (let k = 0; k < size; k++) {
    push(k);
    push((size - 1) * size + k);
    push(k * size);
    push(k * size + size - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const col = i % size;
    if (col > 0) push(i - 1);
    if (col < size - 1) push(i + 1);
    if (i >= size) push(i - size);
    if (i < size * (size - 1)) push(i + size);
  }
  return mask;
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
  /**
   * (M22-06 で上の規則を変更) 船台 = 集落に最も近い、外海に接する陸セル (M22-06 の判断: 水際のまま、船出の画に外海と水平線が入る)。
   * 外海に接する陸が無ければ池の岸、それも無ければ集落。着工の年に決めて動かさないのは呼び出し側の責任
   */
  slipway: Point;
  /** 舳先の向き (単位ベクトル、x = 東・z = 南)。船台から 8 方位のうち外海が区域の中で最も長く続く方位 */
  slipwayBow: Point;
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
  const openSides = (c: AreaCell): number => {
    let n = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (cellAt(area, c.x + dc * CELL_M, c.z + dr * CELL_M)?.openSea) n++;
    return n;
  };
  // (試作 1 までは海辺なら池の岸でも選んでいた。M22-06 で外海に接する陸を優先に変更)
  const slip = nearestLand(area, 0, 0, coastal.filter((c) => openSides(c) > 0)) ?? nearestLand(area, 0, 0, coastal);
  const slipwayBow = slip ? bowToward(area, slip) : { x: 1, z: 0 };
  let coast: AreaCell | undefined;
  for (const c of coastal) if (!coast || seaSides(c) > seaSides(coast)) coast = c;
  const home = area.byIndex.get(area.home);
  const lanterns = home ? area.cells.filter((c) => c.isLand && cellDistance(c, home) <= 1).map(pt) : [];
  return {
    center,
    grove: grove ? pt(grove) : null,
    slipway: slip ? pt(slip) : center,
    slipwayBow,
    lanterns,
    coast: coast ? pt(coast) : center,
  };
}

/** from から 8 方位へ区域の端まで進み、外海 (無ければ海) が途切れずに続くセル数が最も多い方位。同数は東から時計回りで先の方位 */
function bowToward(area: Area, from: AreaCell): Point {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const run = (dc: number, dr: number, open: boolean): number => {
    let n = 0;
    for (let k = 1; k <= area.radius * 2; k++) {
      const c = cellAt(area, from.x + dc * k * CELL_M, from.z + dr * k * CELL_M);
      if (!c || c.isLand || (open && !c.openSea)) break;
      n++;
    }
    return n;
  };
  for (const open of [true, false]) {
    let best = -1;
    let bestN = 0;
    dirs.forEach(([dc, dr], i) => {
      const n = run(dc, dr, open);
      if (n > bestN) {
        bestN = n;
        best = i;
      }
    });
    if (best >= 0) {
      const [dc, dr] = dirs[best];
      const l = Math.hypot(dc, dr);
      return { x: dc / l, z: dr / l };
    }
  }
  return { x: 1, z: 0 };
}
