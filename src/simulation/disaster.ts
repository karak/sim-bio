import { SEA_LEVEL } from './terrain';
import { forEachNeighbor4 } from './grid';
import type { Command, SpeciesDef } from './types';

export type DisasterState = {
  elevation: Float32Array;
  heat: Float32Array;
  /** 1 = この tick に燃えるセル */
  fire: Uint8Array;
  /** 焼失後の再着火不可カウンタ */
  burnt: Uint16Array;
  populations: Record<string, Float32Array>;
};

export const VOLCANO_HEAT = 6;
export const METEOR_CRATER = 0.05;
/** この植生密度を超える隣接セルへ延焼する */
export const FIRE_THRESHOLD = 0.3;
export const BURNT_TICKS = 30;
export const PLAGUE_SURVIVAL = 0.1;

export type DisasterCommand = Extract<Command, { type: 'disaster' }>;

function forEachInRadius(cell: number, radius: number, size: number, fn: (i: number) => void): void {
  const cx = cell % size;
  const cy = (cell - cx) / size;
  const r = Math.ceil(radius);
  for (let y = Math.max(0, cy - r); y <= Math.min(size - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(size - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) fn(y * size + x);
    }
  }
}

/** 一点 + 半径に効果を落とす。wildfire は中心に着火するだけで、延焼は stepFire が担う。 */
export function applyDisaster(
  s: DisasterState,
  cmd: DisasterCommand,
  species: SpeciesDef[],
  size: number,
): { affectedCells: number } {
  let affected = 0;
  const plants = species.filter((d) => d.trophic === 'plant');
  const animals = species.filter((d) => d.trophic !== 'plant');
  switch (cmd.kind) {
    case 'meteor':
      forEachInRadius(cmd.cell, cmd.radius, size, (i) => {
        affected++;
        for (const d of species) s.populations[d.id][i] = 0;
      });
      s.elevation[cmd.cell] = Math.max(0, s.elevation[cmd.cell] - METEOR_CRATER);
      break;
    case 'volcano':
      forEachInRadius(cmd.cell, cmd.radius, size, (i) => {
        affected++;
        for (const d of plants) s.populations[d.id][i] = 0;
        s.heat[i] += VOLCANO_HEAT;
      });
      break;
    case 'plague':
      forEachInRadius(cmd.cell, cmd.radius, size, (i) => {
        affected++;
        for (const d of animals) s.populations[d.id][i] *= PLAGUE_SURVIVAL;
      });
      break;
    case 'wildfire':
      if (s.elevation[cmd.cell] >= SEA_LEVEL) {
        s.fire[cmd.cell] = 1;
        affected = 1;
      }
      break;
  }
  return { affectedCells: affected };
}

/**
 * 燃えているセルの植物を 0 にし、植生の濃い隣接セルへ延焼を予約する。
 * 返り値はこの tick に燃えたセル数。
 */
export function stepFire(s: DisasterState, vegetation: Float32Array, plants: SpeciesDef[], size: number): number {
  const n = size * size;
  const next: number[] = [];
  let burned = 0;
  for (let i = 0; i < n; i++) {
    if (s.burnt[i] > 0) s.burnt[i]--;
    if (s.fire[i] !== 1) continue;
    burned++;
    for (const d of plants) s.populations[d.id][i] = 0;
    s.burnt[i] = BURNT_TICKS;
    s.fire[i] = 0;
    forEachNeighbor4(i, size, (j) => {
      if (s.fire[j] === 0 && s.burnt[j] === 0 && s.elevation[j] >= SEA_LEVEL && vegetation[j] > FIRE_THRESHOLD) next.push(j);
    });
  }
  for (const j of next) s.fire[j] = 1;
  return burned;
}
