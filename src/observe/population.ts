/**
 * 観察画面の個体層: 密度 → 目標頭数と、個体の出入りの計画 (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §3)。
 * 純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 契約:
 * - targetCounts: 種ごとの区域の頭数 = round(Σ 密度 × K[種]) (陸セルだけ)。セルへの割り振りは最大剰余法
 *   (各セルに floor(密度 × K) を配り、残りを端数の大きいセルから 1 頭ずつ。同じ端数は index の小さい方)。
 *   区域の密度は 1 セル 0.02 前後と薄く、セルごとに round すると全部 0 になるため (設計 §1 の実測: 鹿の合計 3.7 / 185 セル)。
 * - reconcile: 数える個体 (isPresent) の種ごとの合計を目標に合わせる出入りの計画を返す。
 *   1 秒あたり budgetPerSecond 件まで (credit を持ち越す。貯められるのは max(1, budgetPerSecond × dt) 件まで)。
 *   よって任意の実時間 T 秒の出入りは budgetPerSecond × T + 1 件を超えない。暦の速さは入力に無い (10x でも早送りしない)。
 *   増やす: 目標との差が最も大きいセルへ。同じ種が同じか隣のセルにいれば、その近くに生まれる (born)。いなければ区域の縁から入る (enter)。
 *   減らす: 目標を最も超えたセルの個体から。鹿で、同じか隣のセルにふだんの状態の狼がいれば、その狼に狩らせる (hunt)。
 *   それ以外は FALL_SHARE の割合で倒れて還り (fall)、残りは最寄りの縁へ出ていく (leave)。
 */
import type { Area, AreaCell, Point } from './area';
import { cellAt, cellDistance, isLandAt, nearestLand, rimCells } from './area';
import type { Agent, AgentRole, AgentSpecies } from './agents';
import { isFree, isPresent, isRemovable } from './agents';
import { SUPPORT_RADIUS } from '../simulation/civilization';
import type { CivState } from '../simulation/civilization';

export const AGENT_SPECIES: readonly AgentSpecies[] = ['deer', 'wolf', 'rabbit'];
/** 密度 1 あたりの頭数 (設計 §3: 鹿 10、兎 10、狼 8) */
export const K_DEFAULT: Readonly<Record<AgentSpecies, number>> = { deer: 10, wolf: 8, rabbit: 10 };
/** 1 秒あたりの出入りの上限の既定値 */
export const BUDGET_PER_SECOND = 2;
/** 狩り以外の減少のうち、倒れて還る (区域の中で死ぬ) 割合。残りは縁から出ていく */
export const FALL_SHARE = 0.3;

/** 民の決め方: この種で、区域の中心 (集落) からセルの距離 radius 以内に生まれた個体は folk */
export type FolkRule = { species: AgentSpecies; radius: number };

export type Targets = {
  area: Area;
  /** 種 → (セル index → 頭数)。陸セルだけ、0 頭のセルも入る */
  perCell: Readonly<Record<AgentSpecies, ReadonlyMap<number, number>>>;
  totals: Readonly<Record<AgentSpecies, number>>;
  folk: FolkRule | null;
};

export type Spawn = {
  species: AgentSpecies;
  role: AgentRole;
  kind: 'enter' | 'born';
  /** 目標の足りないセル */
  cell: number;
  /** 現れる位置 (born は親の近く、enter は区域の縁) */
  x: number;
  z: number;
  /** enter で歩いて向かう先 (セルの中心)。born は現れる位置と同じ */
  target: Point;
};

export type Removal =
  | { kind: 'leave'; agent: number; target: Point }
  | { kind: 'fall'; agent: number }
  | { kind: 'hunt'; agent: number; hunter: number };

export type Plan = { spawns: Spawn[]; removals: Removal[]; credit: number };

/** 文明から民の決め方を作る。文明が無い・段階 0・民が個体層の種でなければ null。半径は支え半径 (設計 §3) */
export function folkRuleFor(civ: CivState | null, radius: number = SUPPORT_RADIUS): FolkRule | null {
  if (!civ || civ.stage < 1) return null;
  const sp = AGENT_SPECIES.find((s) => s === civ.speciesId);
  return sp ? { species: sp, radius } : null;
}

export function targetCounts(area: Area, K: Readonly<Record<AgentSpecies, number>> = K_DEFAULT, folk: FolkRule | null = null): Targets {
  const land = area.cells.filter((c) => c.isLand);
  const perCell = {} as Record<AgentSpecies, Map<number, number>>;
  const totals = {} as Record<AgentSpecies, number>;
  for (const sp of AGENT_SPECIES) {
    const exact = land.map((c) => Math.max(0, c.density[sp] ?? 0) * K[sp]);
    const total = Math.round(exact.reduce((s, v) => s + v, 0));
    const counts = exact.map(Math.floor);
    let rest = total - counts.reduce((s, v) => s + v, 0);
    const order = land.map((_, i) => i).sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]) || land[a].index - land[b].index);
    for (let k = 0; rest > 0 && k < order.length; k++, rest--) counts[order[k]]++;
    perCell[sp] = new Map(land.map((c, i) => [c.index, counts[i]]));
    totals[sp] = total;
  }
  return { area, perCell, totals, folk };
}

/** 個体を数えるセル。入ってくる個体は向かう先のセルで数える (縁と行き先で二重に出入りを起こさないため) */
function countCell(area: Area, a: Agent): AreaCell | undefined {
  const p = a.state === 'enter' && a.target && 'x' in a.target ? a.target : a;
  return cellAt(area, p.x, p.z) ?? nearestLand(area, p.x, p.z);
}

export function reconcile(
  agents: readonly Agent[],
  targets: Targets,
  budgetPerSecond: number,
  dt: number,
  rng: () => number,
  credit = 0,
): Plan {
  const { area } = targets;
  let c = Math.min(credit + budgetPerSecond * Math.max(dt, 0), Math.max(1, budgetPerSecond * Math.max(dt, 0)));
  const spawns: Spawn[] = [];
  const removals: Removal[] = [];
  const count = {} as Record<AgentSpecies, Map<number, number>>;
  const present = {} as Record<AgentSpecies, number>;
  const cellOf = new Map<number, AreaCell | undefined>();
  for (const sp of AGENT_SPECIES) {
    count[sp] = new Map();
    present[sp] = 0;
  }
  for (const a of agents) {
    const cell = countCell(area, a);
    cellOf.set(a.id, cell);
    if (!isPresent(a)) continue;
    present[a.species]++;
    if (cell) count[a.species].set(cell.index, (count[a.species].get(cell.index) ?? 0) + 1);
  }
  const taken = new Set<number>();
  const exhausted = new Set<AgentSpecies>();
  const rim = rimCells(area);
  const diffAt = (sp: AgentSpecies, idx: number) => (targets.perCell[sp].get(idx) ?? 0) - (count[sp].get(idx) ?? 0);

  while (c >= 1) {
    let sp: AgentSpecies | undefined;
    let gap = 0;
    for (const s of AGENT_SPECIES) {
      if (exhausted.has(s)) continue;
      const g = targets.totals[s] - present[s];
      if (Math.abs(g) > Math.abs(gap)) {
        gap = g;
        sp = s;
      }
    }
    if (!sp) break;
    if (gap > 0) {
      let best: AreaCell | undefined;
      let bestDiff = -Infinity;
      for (const [idx] of targets.perCell[sp]) {
        const d = diffAt(sp, idx);
        if (d > bestDiff) {
          bestDiff = d;
          best = area.byIndex.get(idx);
        }
      }
      if (!best) {
        exhausted.add(sp);
        continue;
      }
      spawns.push(planSpawn(sp, best, agents, cellOf, targets, rim, rng));
      count[sp].set(best.index, (count[sp].get(best.index) ?? 0) + 1);
      present[sp]++;
    } else {
      const s = sp;
      const candidates = agents.filter((a) => a.species === s && isRemovable(a) && !taken.has(a.id));
      if (candidates.length === 0) {
        exhausted.add(s);
        continue;
      }
      const hunterFor = (a: Agent): Agent | undefined => {
        if (s !== 'deer') return undefined;
        const ac = cellOf.get(a.id);
        let best: Agent | undefined;
        for (const w of agents) {
          if (w.species !== 'wolf' || !isFree(w) || taken.has(w.id)) continue;
          const wc = cellOf.get(w.id);
          if (!ac || !wc || cellDistance(ac, wc) > 1) continue;
          if (!best || Math.hypot(w.x - a.x, w.z - a.z) < Math.hypot(best.x - a.x, best.z - a.z)) best = w;
        }
        return best;
      };
      // 目標を最も超えたセルの個体 → 狼が近い → ふだんの状態 → id の小さい順
      const score = (a: Agent) => {
        const cell = cellOf.get(a.id);
        return [cell ? -diffAt(s, cell.index) : 0, hunterFor(a) ? 1 : 0, isFree(a) ? 1 : 0, -a.id];
      };
      let pick = candidates[0];
      let pickScore = score(pick);
      for (const a of candidates.slice(1)) {
        const sc = score(a);
        for (let k = 0; k < sc.length; k++) {
          if (sc[k] === pickScore[k]) continue;
          if (sc[k] > pickScore[k]) {
            pick = a;
            pickScore = sc;
          }
          break;
        }
      }
      const hunter = hunterFor(pick);
      taken.add(pick.id);
      if (hunter) {
        taken.add(hunter.id);
        removals.push({ kind: 'hunt', agent: pick.id, hunter: hunter.id });
      } else if (rng() < FALL_SHARE) {
        removals.push({ kind: 'fall', agent: pick.id });
      } else {
        const exit = nearestLand(area, pick.x, pick.z, rim);
        removals.push({ kind: 'leave', agent: pick.id, target: exit ? { x: exit.x, z: exit.z } : { x: pick.x, z: pick.z } });
      }
      const cell = cellOf.get(pick.id);
      if (cell) count[s].set(cell.index, (count[s].get(cell.index) ?? 0) - 1);
      present[s]--;
    }
    c -= 1;
  }
  return { spawns, removals, credit: c };
}

function planSpawn(
  sp: AgentSpecies,
  cell: AreaCell,
  agents: readonly Agent[],
  cellOf: ReadonlyMap<number, AreaCell | undefined>,
  targets: Targets,
  rim: readonly AreaCell[],
  rng: () => number,
): Spawn {
  const { area, folk } = targets;
  const home = area.byIndex.get(area.home);
  const role: AgentRole = folk && folk.species === sp && home && Math.hypot(cell.col - home.col, cell.row - home.row) <= folk.radius ? 'folk' : 'wild';
  let kin: Agent | undefined;
  for (const a of agents) {
    if (a.species !== sp || !isPresent(a) || a.state === 'board') continue;
    const ac = cellOf.get(a.id);
    if (!ac || cellDistance(ac, cell) > 1) continue;
    if (!kin || Math.hypot(a.x - cell.x, a.z - cell.z) < Math.hypot(kin.x - cell.x, kin.z - cell.z)) kin = a;
  }
  if (kin) {
    const p = { x: kin.x + (rng() - 0.5) * 4, z: kin.z + (rng() - 0.5) * 4 };
    const at = isLandAt(area, p.x, p.z) ? p : { x: kin.x, z: kin.z };
    return { species: sp, role, kind: 'born', cell: cell.index, x: at.x, z: at.z, target: at };
  }
  const edge = nearestLand(area, cell.x, cell.z, rim) ?? cell;
  return { species: sp, role, kind: 'enter', cell: cell.index, x: edge.x, z: edge.z, target: { x: cell.x, z: cell.z } };
}
