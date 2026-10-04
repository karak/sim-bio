import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner, type RunnerState, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { SIM_VERSION } from '../../src/simulation/version';
import type { Command, SaveData } from '../../src/simulation/types';
import type { Chronicle, Digest } from '../../src/harbor/chronicle';
import { recordChronicle, type ChronicleRecorder } from '../../src/chronicle/recorder';
import { digestOf } from '../../src/chronicle/digest';
import { replay, type ReplayIsland } from '../../src/chronicle/replay';
import type { InterveneResult } from '../../src/scenario/ScenarioRunner';
import { resumeIsland, RESUME_SIZE } from '../fixtures/resumeIsland';

/**
 * シナリオの続きから (M19-14)。途中で閉じて (SaveData・RunnerState・年代記を JSON にして) 開き直した島を最後まで回した結末が、
 * 閉じずに回した結末と同じになることを、Digest と年代記の再生で示す
 */
type Click = { tick: number; command: Command };
type Closed = { save: SaveData; runner: RunnerState; chronicle: Chronicle };
type Island = { world: World; runner: ScenarioRunner; recorder: ChronicleRecorder<InterveneResult> };

/** main.ts と同じ組み立て: 島・runner・記録器を作り、クリックより前に tick 0 (開き直したらその tick) の評価を済ませる */
function open(island: ReplayIsland, closed?: Closed): Island {
  const log = { log: createMemorySink() };
  const world = closed ? World.restore(closed.save, log) : World.create(island.config, log);
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear }, closed?.runner);
  const recorder = recordChronicle(
    { dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() },
    { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed },
    () => runner.totalsByYear(),
  );
  if (closed) recorder.resume(closed.chronicle);
  runner.update(world.snapshot());
  return { world, runner, recorder };
}

/** フレームの刻み (tick)。年の境目をまたぐものと、またがないものを混ぜる */
const FRAMES = [7, 90, 200, 33, 361];

/**
 * ライブに遊ぶ: フレームごとに stepByYear で進め、onFrame と同じく update してからクリックを記録器に通す。
 * closeAt の tick に着いたら (クリックの後で) 閉じて開き直す。閉じる・クリックの tick にはフレームを切って必ず止まる
 */
async function play(island: ReplayIsland, clicks: readonly Click[], closeAt: number | null) {
  let s = open(island);
  let closed: Closed | null = null;
  const pending = [...clicks];
  for (let i = 0; s.runner.verdict().status === 'running'; i++) {
    if (i > 10_000) throw new Error('verdict never came');
    const tick = s.world.snapshot().tick;
    s.runner.update(s.world.snapshot());
    while (pending.length > 0 && pending[0].tick === tick) expect(s.recorder.dispatch(pending.shift()!.command)).toEqual({ ok: true });
    if (closeAt === tick && !closed) {
      closed = JSON.parse(JSON.stringify({ save: s.world.serialize(), runner: s.runner.save(), chronicle: s.recorder.current() })) as Closed;
      s = open(island, closed);
    }
    const stops = [pending[0]?.tick, closed ? undefined : (closeAt ?? undefined)].filter((t): t is number => t !== undefined && t > tick);
    stepByYear(s.world, s.runner, Math.min(FRAMES[i % FRAMES.length], ...stops.map((t) => t - tick)));
  }
  const verdict = s.runner.verdict().status;
  if (verdict === 'running') throw new Error('unreachable');
  const digest: Digest = await digestOf(s.world.snapshot(), verdict);
  return { digest, chronicle: s.recorder.current(), timeline: s.runner.timeline(), save: s.world.serialize(), closed };
}

const center = Math.floor(RESUME_SIZE / 2) * RESUME_SIZE + Math.floor(RESUME_SIZE / 2);

/** 石板ごとに、年の中に溜まる状態が多いところで閉じる */
const CASES: readonly { name: string; island: ReplayIsland; clicks: readonly Click[]; closeAts: readonly { name: string; tick: number }[] }[] = [
  {
    name: 'no-answer (文明・祈り・力・狼の予定)',
    island: resumeIsland('no-answer', 8),
    clicks: [
      { tick: 0, command: { type: 'set_climate', rainScale: 1.1 } },
      { tick: 5, command: { type: 'disaster', kind: 'plague', cell: center, radius: 2 } },
      { tick: 400, command: { type: 'spawn_species', speciesId: 'deer', cell: center, amount: 0.5, radius: 1 } },
      { tick: 2200, command: { type: 'set_climate', rainScale: 1 } },
    ],
    closeAts: [
      { name: '年の途中 (介入を積んだ直後)', tick: 400 },
      { name: '狼が下りた年の境目 (予定の命令が積まれたまま)', tick: 6 * 360 },
    ],
  },
  {
    name: 'sinking (毎年の沈降・力)',
    island: resumeIsland('sinking', 5),
    clicks: [
      { tick: 0, command: { type: 'set_climate', rainScale: 1.25 } },
      { tick: 720, command: { type: 'spawn_species', speciesId: 'deer', cell: center, amount: 0.5, radius: 1 } },
    ],
    closeAts: [
      { name: '年の境目 (沈降が積まれたまま)', tick: 2 * 360 },
      { name: '年の途中', tick: 3 * 360 + 123 },
    ],
  },
  {
    name: 'test-intercept (迎撃)',
    island: resumeIsland('test-intercept', 5),
    clicks: [{ tick: 10, command: { type: 'intercept' } }],
    closeAts: [{ name: '迎撃を撃った直後 (まだ本体が適用していない)', tick: 10 }],
  },
];

describe('シナリオの続きから (M19-14): 途中で閉じて開き直しても、閉じずに回した結末と同じ', { timeout: 120_000 }, () => {
  for (const c of CASES) {
    describe(c.name, () => {
      let live: ReturnType<typeof play> | null = null;
      for (const at of c.closeAts) {
        it(`${at.name} で閉じて開き直した島の Digest・年表・島・年代記が、閉じずに回したものと同じで、その年代記を回し直しても同じ Digest になる`, async () => {
          live ??= play(c.island, c.clicks, null);
          const [a, b] = await Promise.all([live, play(c.island, c.clicks, at.tick)]);
          expect(b.closed?.save.tick).toBe(at.tick);
          expect(b.digest).toEqual(a.digest);
          expect(b.timeline).toEqual(a.timeline);
          expect(b.save).toEqual(a.save);
          expect(b.chronicle).toEqual(a.chronicle);
          expect(await replay(b.chronicle, c.island)).toEqual({ kind: 'done', digest: a.digest });
        });
      }
    });
  }

  it('迎撃の石板は、閉じる前に撃った迎撃で隕石が取り消されたまま続く', async () => {
    const c = CASES[2];
    const b = await play(c.island, c.clicks, 10);
    expect(b.timeline.filter((e) => e.kind === 'intercepted')).toEqual([{ year: 0, kind: 'intercepted', atYear: 3 }]);
    expect(b.timeline.some((e) => e.kind === 'scheduled')).toBe(false);
  });
});

describe('RunnerState (M19-14)', () => {
  const island = resumeIsland('no-answer', 8);

  it('JSON にして戻しても同じ値になる', () => {
    const s = open(island);
    stepByYear(s.world, s.runner, 2 * 360 + 50);
    const state = s.runner.save();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('save は写しを返す (取り出した後に runner が進んでも変わらない)', () => {
    const s = open(island);
    const state = s.runner.save();
    const before = JSON.stringify(state);
    stepByYear(s.world, s.runner, 2 * 360);
    s.runner.intervene({ type: 'set_climate', rainScale: 1.1 });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('別の石板の状態では作れない', () => {
    const s = open(island);
    const other = resumeIsland('sinking', 5);
    const world = World.create(other.config, { log: createMemorySink() });
    expect(() => createScenarioRunner(other.def, world, { ticksPerYear: 360 }, s.runner.save())).toThrow(/no-answer/);
  });
});
