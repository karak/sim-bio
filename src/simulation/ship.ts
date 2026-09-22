/**
 * 空の舟 (M10-03)。舞台装置: 段階「帆」以上の文明が、種と民を空の舟に乗せて次の島へ逃がす。
 * 着工には信仰と徴収半径内の材 (森+鐘樹の密度和) が要る。建造中は毎年材を伐って進みに積み、
 * 完成しても信仰が足りなければ民は乗らない (毎年再判定)。
 * レベルデザイン docs/design/2026-09-22-level-design-devices.md §3.3。World には依存しない純粋関数群。
 * 係数はすべてこのファイルの定数にまとめ、校正はここだけを触れば済むようにする (works.ts / weatherTower.ts と同じ流儀)。
 */
import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import type { CivState } from './civilization';
import { formatFaith } from './faith';
import type { WorldSnapshot } from './types';

/** 舟を作れる最低段階 (帆、5) */
export const SHIP_STAGE = 5;
/** 舟に乗るのに要る信仰の下限 (着工にも要る) */
export const SHIP_FAITH = 0.5;
/** 着工に要る材 (徴収半径内の森+鐘樹の密度和) の下限 */
export const SHIP_FOREST_MIN = 6;
/** 建造 1 年で材 (森+鐘樹の立木) に掛ける伐採の割合。合計の伐採量は材 × SHIP_CUT */
export const SHIP_CUT = 0.3;
/**
 * 完成に要る進みの累計。校正 (M10-03): 10 では開始時の森 (集落の徴収半径に 22) だけで 5〜12 年で飛べてしまい、
 * 森が鹿に食われる圧も沈没も効かなかった。120 なら森を放ち続けても (鹿に食われて年 0.8 しか進まず) 200 年に間に合わず、
 * 鐘樹 (食われない) を植えれば 25〜45 年で飛べる。LD §8.3
 */
export const SHIP_NEED = 120;

/** 舟の状態。着工した年・進み・(あれば) 飛び立った年。launchedYear が無ければまだ飛んでいない */
export type ShipState = { startedYear: number; progress: number; launchedYear?: number };

/** 持ち出しデータ (JSON の形をここで固定する)。生きている種 (総量 > 0) だけを積む */
export type Cargo = {
  version: 1;
  year: number;
  size: number;
  species: { id: string; total: number; density: number[] }[];
  civ: CivState | null;
};

/** 徴収半径 radius 内 (陸セルだけ) の森+鐘樹の密度の合計。home が未設定 (-1) なら 0 */
export function timberAround(
  pops: { forest?: Float32Array; belltree?: Float32Array },
  home: number,
  radius: number,
  elevation: Float32Array,
  size: number,
): number {
  if (home < 0) return 0;
  let sum = 0;
  forEachInRadius(home, radius, size, (i) => {
    if (elevation[i] < SEA_LEVEL) return;
    if (pops.forest) sum += pops.forest[i];
    if (pops.belltree) sum += pops.belltree[i];
  });
  return sum;
}

/**
 * launch_ship の門。段階 → 信仰 → 二重着工/既発進 → 材の順に確かめる
 * (canBuildTower と同じ流儀: 門 → 状態の重複チェック → 資源の順)。
 */
export function canLaunchShip(civ: CivState | null, timber: number, ship: ShipState | null): { ok: true } | { ok: false; reason: string } {
  if (!civ || civ.stage < 1) return { ok: false, reason: '文明がない' };
  if (civ.stage < SHIP_STAGE) return { ok: false, reason: '段階が帆に満たない' };
  const faith = civ.faith ?? 0;
  if (faith < SHIP_FAITH) return { ok: false, reason: `信仰が足りない(信仰 ${formatFaith(faith)} < ${SHIP_FAITH})` };
  if (ship) return { ok: false, reason: ship.launchedYear !== undefined ? '舟は既に飛び立った' : '舟は既に建造中' };
  if (timber < SHIP_FOREST_MIN) return { ok: false, reason: `材が足りない(材 ${timber.toFixed(1)} / ${SHIP_FOREST_MIN})` };
  return { ok: true };
}

/**
 * 年に一度呼ぶ。既に飛び立っていれば何もしない (unchanged)。
 * 徴収半径内の陸セルから、森・鐘樹の立木に SHIP_CUT の割合を掛けて伐り、進みに積む。
 * 合計の伐採量 (材 × SHIP_CUT) が残りの必要量 (SHIP_NEED − progress) を超えるなら、割合を落として超えないようにする。
 * 材が 0 の年は何も変わらない (progress は頭打ちのまま)。pops は呼び出し元の配列をその場で書き換える。
 */
export function stepShip(
  ship: ShipState,
  pops: { forest?: Float32Array; belltree?: Float32Array },
  home: number,
  radius: number,
  elevation: Float32Array,
  size: number,
): { ship: ShipState; cut: number } {
  if (ship.launchedYear !== undefined) return { ship, cut: 0 };
  const remaining = SHIP_NEED - ship.progress;
  if (remaining <= 0) return { ship, cut: 0 };
  const timber = timberAround(pops, home, radius, elevation, size);
  if (timber <= 0) return { ship, cut: 0 };
  const potentialCut = timber * SHIP_CUT;
  const cut = Math.min(potentialCut, remaining);
  const rate = SHIP_CUT * (cut / potentialCut);
  forEachInRadius(home, radius, size, (i) => {
    if (elevation[i] < SEA_LEVEL) return;
    if (pops.forest && pops.forest[i] > 0) pops.forest[i] -= pops.forest[i] * rate;
    if (pops.belltree && pops.belltree[i] > 0) pops.belltree[i] -= pops.belltree[i] * rate;
  });
  return { ship: { ...ship, progress: ship.progress + cut }, cut };
}

/** 進みが SHIP_NEED に達した (完成した) か */
export function shipDone(ship: ShipState): boolean {
  return ship.progress >= SHIP_NEED;
}

/** 生きている (総量 > 0 の) 種の数 */
export function aliveSpeciesCount(s: WorldSnapshot): number {
  return s.species.filter((d) => (s.totals[d.id] ?? 0) > 0).length;
}

/** 持ち出しデータを書き出す。生きている種だけを積み、密度は素の配列にする (セーブ・ダウンロードに使うので JSON 化できる形) */
export function exportCargo(s: WorldSnapshot): Cargo {
  const species = s.species
    .filter((d) => (s.totals[d.id] ?? 0) > 0)
    .map((d) => ({ id: d.id, total: s.totals[d.id] ?? 0, density: Array.from(s.layers.populations[d.id] ?? []) }));
  return { version: 1, year: s.year, size: s.size, species, civ: s.civ ? { ...s.civ } : null };
}
