import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createRunner, type Speed } from '../../src/core/runner';
import { createScenarioRunner, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { SIM_VERSION } from '../../src/simulation/version';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { disasterClick, spawnClick } from '../../src/ui/clicks';

/**
 * 決定論の刻み (M19-04、設計書 2026-09-26-cloudflare-architecture.md §1.3 C6)。
 * 同じ seed・同じ介入なら、速度とフレームの刻みに依らず同じ結末になる。golden replay は本体の結末を版ごとに固定する。
 */
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
const SIZE = 32;

const scenario = (id: string, years: number): ScenarioDef => {
  const def = defs.find((d) => d.id === id);
  if (!def) throw new Error(`scenario ${id} missing`);
  return { ...def, years };
};

const setup = (def: ScenarioDef) => {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
  };
  const world = World.create(cfg, { log: createMemorySink() });
  const runner = createScenarioRunner(def, world, { ticksPerYear: cfg.ticksPerYear });
  return { world, runner, ticksPerYear: cfg.ticksPerYear };
};

const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** 島の全状態・年表・判定を 1 つの hash にする (刻みの違いを最も細かく拾う) */
const fullDigest = (world: World, runner: ScenarioRunner) =>
  sha256({ tick: world.snapshot().tick, save: world.serialize(), timeline: runner.timeline(), verdict: runner.verdict() });

/** main.ts と同じ組み立て: rAF の runner が stepByYear で進め、onFrame が毎フレーム runner.update を呼ぶ */
function playByFrames(def: ScenarioDef, opening: Command, speed: Speed, intervals: readonly number[]) {
  const { world, runner } = setup(def);
  runner.intervene(opening);
  const loop = createRunner(
    { step: (n) => stepByYear(world, runner, n), snapshot: () => world.snapshot() },
    { onFrame: (s) => runner.update(s), raf: () => 0, caf: () => {} },
  );
  loop.setSpeed(speed);
  let now = 0;
  loop.frame(now);
  for (let i = 0; runner.verdict().status === 'running'; i++) {
    if (i > 200_000) throw new Error('verdict never came');
    now += intervals[i % intervals.length];
    loop.frame(now);
  }
  return fullDigest(world, runner);
}

/** tests/slow の台本と同じ刻み: 年の境目ごとに update して 1 年分 step する */
function playByScript(def: ScenarioDef, opening: Command) {
  const { world, runner, ticksPerYear } = setup(def);
  runner.intervene(opening);
  for (let y = 0; y <= def.years; y++) {
    if (runner.update(world.snapshot()).status !== 'running') break;
    world.step(ticksPerYear);
  }
  return fullDigest(world, runner);
}

describe('決定論の刻み (M19-04): 速度とフレームの刻みに依らない', () => {
  const def = scenario('sinking', 4);
  const opening: Command = { type: 'set_climate', rainScale: 1.25 };

  it('1x・10x・100x とフレーム間隔の違う 3 通りの結末が、台本 (年の境目ごとの update) の結末と一致する', () => {
    const script = playByScript(def, opening);
    const byFrames = {
      '1x / 16.7 ms': playByFrames(def, opening, 1, [1000 / 60]),
      '10x / 250・90・417 ms': playByFrames(def, opening, 10, [250, 90, 417]),
      '100x / 16・33・3000 ms (上限 200 tick に当たる)': playByFrames(def, opening, 100, [16, 33, 3000]),
    };
    expect(byFrames).toEqual({
      '1x / 16.7 ms': script,
      '10x / 250・90・417 ms': script,
      '100x / 16・33・3000 ms (上限 200 tick に当たる)': script,
    });
  });

  it('判定が出たフレームでは、境目より先へ進めない (島は判定の年の境目で止まる)', () => {
    const { world, runner, ticksPerYear } = setup(def);
    runner.update(world.snapshot());
    stepByYear(world, runner, (def.years + 3) * ticksPerYear);
    expect(runner.verdict().status).not.toBe('running');
    expect(world.snapshot().tick).toBe(def.years * ticksPerYear);
  });

  it('1 回の step で境目をまたいでも、境目ごとに update する (予定の沈降が年ごとに 1 回ずつ本体に入る)', () => {
    const { world, runner, ticksPerYear } = setup(scenario('sinking', 10));
    runner.update(world.snapshot());
    const years: number[] = [];
    const update = runner.update.bind(runner);
    const spy: ScenarioRunner = { ...runner, update: (s) => { years.push(s.tick / ticksPerYear); return update(s); } };
    stepByYear(world, spy, 3 * ticksPerYear + 100);
    expect(years).toEqual([1, 2, 3]);
    expect(world.snapshot().tick).toBe(3 * ticksPerYear + 100);
  });
});

/** 固定の年代記: 石板・seed・tick 付きの介入。本体の係数を変えると結末が変わる */
const CHRONICLE: { scenarioId: string; years: number; commands: readonly { tick: number; command: Command }[] } = {
  scenarioId: 'sinking',
  years: 6,
  commands: [
    { tick: 0, command: { type: 'set_climate', rainScale: 1.25 } },
    { tick: 400, command: spawnClick('deer', 16 * SIZE + 16) },
    { tick: 725, command: spawnClick('rabbit', 12 * SIZE + 18) },
    { tick: 1500, command: disasterClick('plague', 16 * SIZE + 16) },
  ],
};

/**
 * 版ごとの golden。本体 (係数・規則) を変えてこのテストが落ちたら、SIM_VERSION を上げ、新しい版の行を足す。
 * 古い行は消さない (過去の年代記がどの版で何になったかの記録)
 */
const GOLDEN: Readonly<Record<string, string>> = {
  '1': 'a7b5c4c5909f4c4d748cfe7a489882d3d17aae9c6469f5adcce8b5256d8a0aa2',
};

/** 設計書 §5.1 の Digest の中身 (年・判定・種ごとの総数 toPrecision(6)・絶滅した種) の正規化 JSON の SHA-256 */
function replayDigest(): { hash: string; year: number; verdict: string } {
  const def = scenario(CHRONICLE.scenarioId, CHRONICLE.years);
  const { world, runner } = setup(def);
  runner.update(world.snapshot());
  for (const { tick, command } of CHRONICLE.commands) {
    stepByYear(world, runner, tick - world.snapshot().tick);
    runner.intervene(command);
  }
  stepByYear(world, runner, Number.MAX_SAFE_INTEGER);
  const s = world.snapshot();
  const verdict = runner.verdict().status;
  const ids = Object.keys(s.totals).sort();
  const totals = Object.fromEntries(ids.map((id) => [id, Number(s.totals[id].toPrecision(6))]));
  const extinct = ids.filter((id) => s.totals[id] === 0);
  return { hash: sha256({ year: s.year, verdict, totals, extinct }), year: s.year, verdict };
}

describe('golden replay (M19-04)', () => {
  it(`固定の年代記の結末ダイジェストが SIM_VERSION ${SIM_VERSION} の golden と一致する`, () => {
    const d = replayDigest();
    expect(d.year).toBe(CHRONICLE.years);
    expect(d.verdict).not.toBe('running');
    expect(d.hash, `本体の結末が変わった。SIM_VERSION を上げ、GOLDEN に '${String(Number(SIM_VERSION) + 1)}': '${d.hash}' を足す`).toBe(GOLDEN[SIM_VERSION]);
  });
  it('GOLDEN の最新の版が SIM_VERSION で、版ごとの hash はすべて違う', () => {
    const versions = Object.keys(GOLDEN).map(Number);
    expect(Math.max(...versions)).toBe(Number(SIM_VERSION));
    expect(new Set(Object.values(GOLDEN)).size).toBe(versions.length);
  });
});
