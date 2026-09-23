/**
 * 観察画面の場面の引き金 (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §6)。
 * 本体を変えずに snapshot と年表から読む。純粋関数のみ (Three.js・DOM に依存しない)。
 *
 * 契約:
 * - detectScenes(prev, cur, events, area) は、前のフレーム prev (初回は null) から cur への変化と、
 *   その間に積まれた年表の出来事 events から、場面の引き金を順に返す (舟 → 帆を失う → 介入 → 沈む → 終わり)。
 *   同じ変化を二度返さない (状態ではなく変化で引く)。初回 (prev = null) は、今の舟の段階・飛び立ち・帆を失った状態を一度だけ返す。
 * - 舟の段階: 進み 0〜24 竜骨、24〜48 肋、48〜72 板、72〜96 帆柱、96〜120 帆、120 以上 done (下限を含む)。
 * - 飛び立ち: ship.launchedYear が付いた。帆を失う: 舟があって飛び立っておらず、文明の段階が帆 (SHIP_STAGE) を下回った (文明が消えたときも)。
 * - 介入: 年表の intervene のうち、中心セルが区域の中のものだけ。spawn_species → 芽吹き (sprout)、
 *   disaster plague → 霧 (mist)、set_climate で rainScale > 1 → 雨 (rain、区域全体)。
 * - 沈む: 区域の陸セルの数が減った。終わり: 年表の verdict が dead / escaped。
 */
import type { Area, Point } from './area';
import type { WorldSnapshot } from '../simulation/types';
import type { ShipState } from '../simulation/ship';
import { SHIP_STAGE } from '../simulation/ship';
import type { TimelineEvent } from '../scenario/ScenarioRunner';

export type ShipStage = 'keel' | 'ribs' | 'planks' | 'mast' | 'sails' | 'done';

/** 段階の下限 (進み)。done は SHIP_NEED (120) */
export const SHIP_STAGE_AT: Readonly<Record<ShipStage, number>> = { keel: 0, ribs: 24, planks: 48, mast: 72, sails: 96, done: 120 };
const STAGES: readonly ShipStage[] = ['done', 'sails', 'mast', 'planks', 'ribs', 'keel'];

export function shipStage(progress: number): ShipStage {
  for (const s of STAGES) if (progress >= SHIP_STAGE_AT[s]) return s;
  return 'keel';
}

/** 場面の引き金を読むのに要る、フレームごとの値 */
export type SceneFrame = { ship: ShipState | null; civStage: number | null; landCount: number };

export function sceneFrame(s: WorldSnapshot, area: Area): SceneFrame {
  return { ship: s.ship, civStage: s.civ ? s.civ.stage : null, landCount: area.landCount };
}

export type SceneEvent =
  | { kind: 'shipStage'; stage: ShipStage; from: ShipStage | null }
  | { kind: 'departure'; year: number }
  | { kind: 'sailLost' }
  | { kind: 'sprout'; year: number; cell: number; at: Point; speciesId: string; radius: number }
  | { kind: 'mist'; year: number; cell: number; at: Point; radius: number }
  | { kind: 'rain'; year: number }
  | { kind: 'sinking'; from: number; to: number }
  | { kind: 'ending'; year: number; status: 'dead' | 'escaped' };

const sailLost = (f: SceneFrame | null): boolean =>
  !!f && !!f.ship && f.ship.launchedYear === undefined && (f.civStage === null || f.civStage < SHIP_STAGE);

export function detectScenes(prev: SceneFrame | null, cur: SceneFrame, events: readonly TimelineEvent[], area: Area): SceneEvent[] {
  const out: SceneEvent[] = [];
  if (cur.ship) {
    const now = shipStage(cur.ship.progress);
    const before = prev?.ship ? shipStage(prev.ship.progress) : null;
    if (now !== before) out.push({ kind: 'shipStage', stage: now, from: before });
    if (cur.ship.launchedYear !== undefined && prev?.ship?.launchedYear === undefined) {
      out.push({ kind: 'departure', year: cur.ship.launchedYear });
    }
  }
  if (sailLost(cur) && !sailLost(prev)) out.push({ kind: 'sailLost' });
  for (const e of events) {
    if (e.kind !== 'intervene') continue;
    const c = e.command;
    if (c.type === 'spawn_species' || (c.type === 'disaster' && c.kind === 'plague')) {
      const cell = area.byIndex.get(c.cell);
      if (!cell) continue;
      const at = { x: cell.x, z: cell.z };
      if (c.type === 'spawn_species') out.push({ kind: 'sprout', year: e.year, cell: c.cell, at, speciesId: c.speciesId, radius: c.radius ?? 0 });
      else out.push({ kind: 'mist', year: e.year, cell: c.cell, at, radius: c.radius });
    } else if (c.type === 'set_climate' && c.rainScale !== undefined && c.rainScale > 1) {
      out.push({ kind: 'rain', year: e.year });
    }
  }
  if (prev && cur.landCount < prev.landCount) out.push({ kind: 'sinking', from: prev.landCount, to: cur.landCount });
  for (const e of events) {
    if (e.kind === 'verdict' && (e.verdict.status === 'dead' || e.verdict.status === 'escaped')) {
      out.push({ kind: 'ending', year: e.year, status: e.verdict.status });
    }
  }
  return out;
}
