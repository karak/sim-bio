import type { CivState } from '../simulation/civilization';
import { SUPPORT_RADIUS } from '../simulation/civilization';
import type { DreamEaterState } from '../simulation/dreamEater';

/** 夢喰いの影 (M10R-03)。visible false は非表示を意味する */
export type DreamEaterShade = { cell: number; radius: number; visible: boolean };

/**
 * 夢喰いの影 InstancedMesh/Mesh 用の純粋関数 (settlementInstances と同じ流儀)。
 * 現れていて (dreamEater !== null)、civ の home が有効な陸セルなら、集落の支え半径 (SUPPORT_RADIUS) を覆う円を出す。
 * 現れていない・civ が無い・home が盤外なら非表示。
 */
export function dreamEaterShade(dreamEater: DreamEaterState | null, civ: CivState | null, size: number): DreamEaterShade {
  if (!dreamEater || !civ || civ.home < 0 || civ.home >= size * size) return { cell: 0, radius: 0, visible: false };
  return { cell: civ.home, radius: SUPPORT_RADIUS, visible: true };
}
