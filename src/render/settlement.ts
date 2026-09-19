import type { CivState } from '../simulation/civilization';

/** 集落の箱の数と位置。count 0 は非表示 (文明なし・stage 0) を意味する */
export type SettlementInstances = { cell: number; count: number };

/**
 * 集落 InstancedMesh 用の純粋関数。stage の数だけ箱を積む。
 * civ が null・stage 0・home が不正 (盤外) なら count 0 (非表示)。
 */
export function settlementInstances(civ: CivState | null, size: number): SettlementInstances {
  if (!civ || civ.stage <= 0 || civ.home < 0 || civ.home >= size * size) return { cell: 0, count: 0 };
  return { cell: civ.home, count: civ.stage };
}
