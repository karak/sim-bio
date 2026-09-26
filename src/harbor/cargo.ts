import { SEA_LEVEL } from '../simulation/terrain';
import type { Cargo as Hold } from '../simulation/ship';
import { MAX_AMOUNT } from './chronicle';
import { HARBOR_LIMITS, type Cargo, type CargoId } from './contract';

/**
 * 空の舟の積荷 (M19-10、設計書 B5・§6.3)。持ち出し (simulation/ship.ts の exportCargo) から港へ流す積荷を作り、
 * 漂着を受け取る島で、積荷の着く浜のセルを決める。どちらも純粋な関数。
 * 受け取った積荷は放流の命令 (ui/clicks.ts の receiveCargoClick) として本体の dispatch の門を通り、年代記に載る
 */

/** 島が積荷を受け取れたか。budget は石板の星の力が足りない、refused は判定の後・訪問など介入を受けない島 */
export type LandResult = 'ok' | 'no_shore' | 'budget' | 'refused';

/** 舟は島の種の総数のこの割合を積む。量は放流の amount (セルの密度に足す量) として受け取り側に届く */
export const CARGO_SHARE = 0.01;
/** これより少ない種は積まない (ほぼ絶えた種の塵を、外来種として他人の島へ流さない) */
export const MIN_CARGO_AMOUNT = 0.001;

/** 持ち出しの種を総数の多い順 (同じなら id の順) に 5 件まで。量は 3 桁に丸め [MIN_CARGO_AMOUNT, MAX_AMOUNT] に収める。積むものが無ければ null */
export function cargoOfHold(hold: Pick<Hold, 'species'>): Cargo | null {
  const items = [...hold.species]
    .sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s) => ({ speciesId: s.id, amount: Number(Math.min(MAX_AMOUNT, s.total * CARGO_SHARE).toPrecision(3)) }))
    .filter((item) => item.amount >= MIN_CARGO_AMOUNT)
    .slice(0, HARBOR_LIMITS.cargoItems);
  return items.length === 0 ? null : { items };
}

/** 積荷の id の FNV-1a (32 bit)。同じ積荷は、どのブラウザでも同じ浜に着く */
function hashOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** 積荷の着く浜 (上下左右に海のある陸のセル)。浜が無ければ陸のどこか、陸が無ければ null */
export function landingCell(id: CargoId, island: { elevation: ArrayLike<number>; size: number }): number | null {
  const { elevation, size } = island;
  const isLand = (i: number) => elevation[i] >= SEA_LEVEL;
  const land: number[] = [];
  const shore: number[] = [];
  for (let i = 0; i < size * size; i++) {
    if (!isLand(i)) continue;
    land.push(i);
    const x = i % size;
    const y = Math.floor(i / size);
    const neighbours = [x > 0 ? i - 1 : -1, x < size - 1 ? i + 1 : -1, y > 0 ? i - size : -1, y < size - 1 ? i + size : -1];
    if (neighbours.some((j) => j >= 0 && !isLand(j))) shore.push(i);
  }
  const cells = shore.length > 0 ? shore : land;
  return cells.length === 0 ? null : cells[hashOf(id) % cells.length];
}
