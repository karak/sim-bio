import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig, WorldSnapshot } from '../../src/simulation/types';
import { resolveCivilizationStart } from '../../src/simulation/civilization';
import { forEachInRadius } from '../../src/simulation/disaster';
import { suitability } from '../../src/simulation/vegetation';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { LOAD_RADIUS } from '../../src/simulation/civilizationLoad';
import { timberAround, SHIP_FOREST_MIN } from '../../src/simulation/ship';
import { disasterClick, spawnClick } from '../../src/ui/clicks';
import { extractArea } from '../../src/observe/area';
import { detectScenes, sceneFrame, type SceneEvent, type SceneFrame } from '../../src/observe/scenes';

/**
 * 観察画面の 4 場面 (M22-09 の受入「4 場面が実プレイで出た記録」) が、空の舟の実プレイで引かれることを確かめる。
 * 本体と石板を 1 年ずつ回し、観察画面と同じく区域 (集落の周り半径 8) の snapshot と年表の新しい出来事を detectScenes に渡す。
 * 台本は tests/slow/scenarios.playthrough.test.ts の空の舟の想定解 1 (毎年 1 本鐘樹を植えて 20 年目に着工) と放置 (沈む) を写したもの。
 */
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const def = (JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[]).find((d) => d.id === 'sky-ship')!;
const SIZE = 64;
type Script = (r: ScenarioRunner, s: WorldSnapshot, year: number) => void;

function belltreeSitesAround(s: WorldSnapshot, home: number, radius: number): number[] {
  const bt = species.find((d) => d.id === 'belltree')!;
  const out: number[] = [];
  forEachInRadius(home, radius, SIZE, (i) => {
    if (s.layers.elevation[i] < SEA_LEVEL) return;
    if (suitability(bt, s.layers.temperature[i], s.layers.moisture[i]) <= 0.6) return;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    if (out.every((c) => Math.hypot(x - (c % SIZE), y - Math.floor(c / SIZE)) >= 2)) out.push(i);
  });
  return out;
}

/** 毎年 1 本の鐘樹を植え、20 年目以降に門を越えたら着工。10 年目に一度、集落の狼に疫病を落とす (霧の場面を見るため) */
const solution: Script = (() => {
  let sites: number[] = [];
  let next = 0;
  return (r, s, y) => {
    if (y >= 1) {
      if (sites.length === 0) sites = belltreeSitesAround(s, s.civ!.home, 6);
      const bt = s.layers.populations.belltree;
      const cell = next < sites.length ? sites[next++] : sites.reduce((a, b) => ((bt?.[a] ?? 0) <= (bt?.[b] ?? 0) ? a : b));
      r.intervene(spawnClick('belltree', cell));
    }
    if (y === 10) r.intervene(disasterClick('plague', s.civ!.home + 2));
    const timber = timberAround({ forest: s.layers.populations.forest, belltree: s.layers.populations.belltree }, s.civ!.home, LOAD_RADIUS[Math.max(1, s.civ!.stage)], s.layers.elevation, SIZE);
    if (y >= 20 && !s.ship && timber >= SHIP_FOREST_MIN && (s.civ?.faith ?? 0) >= 0.5) r.intervene({ type: 'launch_ship' });
  };
})();

function watch(script: Script | null): { scenes: SceneEvent[]; status: string } {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
    civilization: resolveCivilizationStart(def.start?.civilization, SIZE),
    volcanoCell: def.start?.volcanoCell,
    crystalScale: def.start?.crystalScale,
  };
  const w = World.create(cfg, { log: createMemorySink() });
  const r = createScenarioRunner(def, w, { ticksPerYear: cfg.ticksPerYear });
  const home = w.snapshot().civ!.home;
  const scenes: SceneEvent[] = [];
  let prev: SceneFrame | null = null;
  let seen = 0;
  const look = () => {
    const s = w.snapshot();
    const area = extractArea(s, home, 8);
    const frame = sceneFrame(s, area);
    const tl = r.timeline();
    scenes.push(...detectScenes(prev, frame, tl.slice(seen), area));
    seen = tl.length;
    prev = frame;
  };
  for (let y = 0; y <= def.years; y++) {
    const s = w.snapshot();
    script?.(r, s, y);
    const v = r.update(s);
    look();
    if (v.status !== 'running') return { scenes, status: v.status };
    w.step(cfg.ticksPerYear);
  }
  return { scenes, status: r.verdict().status };
}

describe('観察画面の 4 場面が空の舟の実プレイで引かれる (M22-09)', { timeout: 900_000 }, () => {
  it('想定解 1 (植えて 20 年目に着工): 舟が育つ・飛び立ち・種を放ったあと (芽吹き・霧)・結末 escaped', () => {
    const { scenes, status } = watch(solution);
    expect(status).toBe('escaped');
    const stages = scenes.filter((e) => e.kind === 'shipStage').map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(['keel', 'ribs', 'planks', 'mast', 'sails', 'done']);
    expect(scenes.some((e) => e.kind === 'departure')).toBe(true);
    expect(scenes.filter((e) => e.kind === 'sprout').length).toBeGreaterThan(5);
    expect(scenes.some((e) => e.kind === 'mist')).toBe(true);
    expect(scenes.at(-1)).toMatchObject({ kind: 'ending', status: 'escaped' });
  });

  it('放置: 滅び (区域が沈んで陸が減り、結末 dead)', () => {
    const { scenes, status } = watch(null);
    expect(status).toBe('dead');
    expect(scenes.some((e) => e.kind === 'sinking')).toBe(true);
    expect(scenes.at(-1)).toMatchObject({ kind: 'ending', status: 'dead' });
  });
});
