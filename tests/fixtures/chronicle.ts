import type { Chronicle } from '../../src/harbor/contract';
import type { ReplayIsland } from '../../src/chronicle/replay';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

/**
 * 年代記の再生の golden (M19-06)。単体 (Node) と E2E (Chromium の Web Worker) が同じ年代記を回し、同じ hash になることを確かめる。
 * 本体の係数を変えて hash が変わったら SIM_VERSION を上げる (tests/unit/scenario.determinism.test.ts の GOLDEN と同じ扱い)
 */
export const FIXTURE_SIZE = 32;
export const FIXTURE_YEARS = 3;

export const FIXTURE_CHRONICLE: Chronicle = {
  simVersion: '1',
  scenarioId: 'sinking',
  seed: 42,
  commands: [
    { tick: 0, command: { type: 'set_climate', rainScale: 1.25 } },
    { tick: 400, command: { type: 'spawn_species', speciesId: 'deer', cell: 16 * FIXTURE_SIZE + 16, amount: 0.5, radius: 1 } },
    { tick: 720, command: { type: 'spawn_species', speciesId: 'deer', cell: 14 * FIXTURE_SIZE + 17, amount: 0.5, radius: 1 } },
    { tick: 800, command: { type: 'disaster', kind: 'plague', cell: 16 * FIXTURE_SIZE + 16, radius: 4 } },
  ],
  yearly: [],
};

export const FIXTURE_HASH = 'c8c2ea44b47e522b37bc4fefc4d7e81798cb5f033dbe6b18fe387d75db51aaa2';

/** 石板の年数と島の大きさだけを縮めた島 (速く回すため)。種の上書きと seed は石板のまま */
export function fixtureIsland(catalog: { base: Omit<WorldConfig, 'species'>; species: readonly SpeciesDef[]; scenarios: readonly ScenarioDef[] }, scenarioId = FIXTURE_CHRONICLE.scenarioId): ReplayIsland {
  const found = catalog.scenarios.find((d) => d.id === scenarioId);
  if (!found) throw new Error(`scenario ${scenarioId} missing`);
  const def: ScenarioDef = { ...found, years: FIXTURE_YEARS };
  const config: WorldConfig = {
    ...structuredClone(catalog.base),
    size: FIXTURE_SIZE,
    species: catalog.species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? catalog.base.seed,
  };
  return { def, config };
}
