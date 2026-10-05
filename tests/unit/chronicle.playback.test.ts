import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createRunner, type Speed } from '../../src/core/runner';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { digestOf } from '../../src/chronicle/digest';
import { createPlayback } from '../../src/chronicle/playback';
import type { Chronicle } from '../../src/harbor/chronicle';
import { FIXTURE_CHRONICLE, FIXTURE_HASH, fixtureIsland } from '../fixtures/chronicle';

const island = fixtureIsland({
  base: JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>,
  species: JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[],
  scenarios: JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[],
});

/** 訪問の画面と同じ組み立て: 生成の直後に tick 0 の評価、rAF の runner が playback.step で進め、onFrame が毎フレーム update */
async function visitLive(chronicle: Chronicle, speed: Speed, intervals: readonly number[]) {
  const world = World.create({ ...island.config, seed: chronicle.seed }, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear });
  runner.update(world.snapshot());
  const playback = createPlayback(world, runner, chronicle.commands);
  const loop = createRunner({ step: (n) => playback.step(n), snapshot: () => world.snapshot() }, { onFrame: (s) => void runner.update(s), raf: () => 0, caf: () => {} });
  loop.setSpeed(speed);
  let now = 0;
  loop.frame(now);
  for (let i = 0; runner.verdict().status === 'running' && playback.broken() === null; i++) {
    if (i > 200_000) throw new Error('verdict never came');
    now += intervals[i % intervals.length];
    loop.frame(now);
  }
  const verdict = runner.verdict().status;
  return { broken: playback.broken(), timeline: runner.timeline(), digest: verdict === 'running' ? null : await digestOf(world.snapshot(), verdict) };
}

describe('訪問の再生 createPlayback (M19-09)', () => {
  it.each([
    [1, [16, 17, 50]],
    [100, [16, 33, 7, 250]],
  ] as const)('速度 %sx・フレームの間隔が揃わなくても、年代記の命令を記録の tick で打ち、照合の再生と同じ結末になる', async (speed, intervals) => {
    const r = await visitLive(FIXTURE_CHRONICLE, speed, intervals);
    expect(r.broken).toBeNull();
    expect(r.digest?.hash).toBe(FIXTURE_HASH);
    expect(r.timeline.filter((e) => e.kind === 'intervene')).toHaveLength(FIXTURE_CHRONICLE.commands.length);
  });

  it('打てない命令 (判定の後・門で弾かれる) に着いたら止まり、壊れた場所を返す', async () => {
    const past = { ...FIXTURE_CHRONICLE, commands: [...FIXTURE_CHRONICLE.commands, { tick: 10 * 360, command: { type: 'intercept' as const } }] };
    const r = await visitLive(past, 100, [50]);
    expect(r.digest?.hash).toBe(FIXTURE_HASH);
    expect(r.broken).toBeNull();

    const rejected = { ...FIXTURE_CHRONICLE, commands: [{ tick: 10, command: { type: 'intercept' as const } }] };
    const bad = await visitLive(rejected, 100, [50]);
    expect(bad.broken).toEqual({ path: 'commands[0]', reason: expect.stringMatching(/^rejected:/) });
  });
});
