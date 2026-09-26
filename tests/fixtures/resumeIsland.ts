import { readFileSync } from 'node:fs';
import { resolveCivilizationStart } from '../../src/simulation/civilization';
import type { ReplayIsland } from '../../src/chronicle/replay';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';

/**
 * 途中で閉じて開き直す確かめ (M19-14) の島。石板の年数と島の大きさを縮め、文明の集落は島の中心に置き、予定の命令のセルは縮めた島の同じ位置へ写す
 * (石板のセルの番号は石板の島の大きさ、多くは size 64 の番号なので)。
 * 種の上書き・seed・気候・輝石の倍率・文明の初期状態は main.ts の ?scenario の組み立てと同じにする
 */
export const RESUME_SIZE = 32;

const catalog = {
  base: JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>,
  species: JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[],
  scenarios: JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[],
};

/** 石板の島の大きさで書かれたセルの番号を、縮めた島の同じ位置へ写す (-1 は島の中心のまま) */
const shrinkCell = (cell: number, from: number): number => (cell < 0 ? cell : Math.floor(Math.floor(cell / from) * (RESUME_SIZE / from)) * RESUME_SIZE + Math.floor((cell % from) * (RESUME_SIZE / from)));

export function resumeIsland(scenarioId: string, years: number): ReplayIsland {
  const found = catalog.scenarios.find((d) => d.id === scenarioId);
  if (!found) throw new Error(`scenario ${scenarioId} missing`);
  const from = found.start?.size ?? catalog.base.size;
  const schedule = found.schedule.map((sc) => ('cell' in sc.command ? { ...sc, command: { ...sc.command, cell: shrinkCell(sc.command.cell, from) } } : sc));
  const def: ScenarioDef = { ...found, years, schedule };
  const start = def.start;
  const config: WorldConfig = {
    ...structuredClone(catalog.base),
    size: RESUME_SIZE,
    species: catalog.species.map((d) => ({ ...d, ...(start?.species?.[d.id] ?? {}) })),
    seed: start?.seed ?? catalog.base.seed,
  };
  if (start?.tempOffset !== undefined) config.climate.tempOffset = start.tempOffset;
  if (start?.rainScale !== undefined) config.climate.rainScale = start.rainScale;
  if (start?.crystalScale !== undefined) config.crystalScale = start.crystalScale;
  const civilization = resolveCivilizationStart(start?.civilization && { ...start.civilization, home: -1 }, RESUME_SIZE);
  if (civilization) config.civilization = civilization;
  return { def, config };
}
