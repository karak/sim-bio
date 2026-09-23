import type { WorldSnapshot } from '../../src/simulation/types';
import type { CivState } from '../../src/simulation/civilization';
import type { ShipState } from '../../src/simulation/ship';

/** 観察画面の単体テスト用の偽の snapshot。size × size、標高は既定で陸 (0.4)、種は鹿・狼・兎・鐘樹 */
export const OBS_SIZE = 32;
export const OBS_HOME = 16 * OBS_SIZE + 16;

export type FakeSnapOpts = {
  elevation?: (col: number, row: number) => number;
  density?: Partial<Record<'deer' | 'wolf' | 'rabbit' | 'belltree', (col: number, row: number) => number>>;
  civ?: Partial<CivState> | null;
  ship?: ShipState | null;
  year?: number;
};

export function fakeSnapshot(opts: FakeSnapOpts = {}): WorldSnapshot {
  const size = OBS_SIZE;
  const n = size * size;
  const elevation = new Float32Array(n);
  const vitality = new Float32Array(n);
  const pops: Record<string, Float32Array> = {};
  for (const id of ['deer', 'wolf', 'rabbit', 'belltree'] as const) pops[id] = new Float32Array(n);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const i = row * size + col;
      elevation[i] = opts.elevation ? opts.elevation(col, row) : 0.4;
      vitality[i] = 0.5;
      for (const id of ['deer', 'wolf', 'rabbit', 'belltree'] as const) {
        const f = opts.density?.[id];
        pops[id][i] = f ? f(col, row) : 0;
      }
    }
  }
  const empty = new Float32Array(n);
  const civ: CivState | null =
    opts.civ === null ? null : { speciesId: 'deer', stage: 5, progress: 0, home: OBS_HOME, population: 1, faith: 1, ...(opts.civ ?? {}) };
  return {
    tick: 0,
    year: opts.year ?? 0,
    dayOfYear: 0,
    size,
    layers: { elevation, temperature: empty, moisture: empty, vegetation: empty, vitality, litter: empty, crystal: empty, populations: pops },
    totals: {},
    meanTemperature: 15,
    co2: 0,
    species: [],
    climate: { tempOffset: 0, rainScale: 1 },
    civ,
    volcanoCell: 0,
    towers: [],
    ship: opts.ship ?? null,
    dreamEater: null,
  };
}
