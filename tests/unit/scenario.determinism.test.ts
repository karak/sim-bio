import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createRunner, type Runner, type Speed } from '../../src/core/runner';
import { createScenarioRunner, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { SIM_VERSION } from '../../src/simulation/version';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { disasterClick, spawnClick } from '../../src/simulation/commands';
import { runChronicle } from '../../src/chronicle/replay';
import { resolveCivilizationStart } from '../../src/simulation/civilization';

/**
 * 決定論の刻み (M19-04、設計書 2026-09-26-cloudflare-architecture.md §1.3 C6)。
 * 同じ seed・同じ介入なら、速度とフレームの刻みに依らず同じ結末になる。golden replay は本体の結末を版ごとに固定する。
 */
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
const SIZE = 32;

type Timed = { tick: number; command: Command };

const scenario = (id: string, years: number): ScenarioDef => {
  const def = defs.find((d) => d.id === id);
  if (!def) throw new Error(`scenario ${id} missing`);
  return { ...def, years };
};

const setup = (def: ScenarioDef, onVerdict?: () => void) => {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
  };
  const world = World.create(cfg, { log: createMemorySink() });
  const runner = createScenarioRunner(def, world, { ticksPerYear: cfg.ticksPerYear, onVerdict });
  return { world, runner, ticksPerYear: cfg.ticksPerYear };
};

const sha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** 島の全状態・年表・判定を 1 つの hash にする (刻みの違いを最も細かく拾う) */
const fullDigest = (world: World, runner: ScenarioRunner) =>
  sha256({ tick: world.snapshot().tick, save: world.serialize(), timeline: runner.timeline(), verdict: runner.verdict() });

/**
 * app/scenarioSession.ts と同じ組み立て: rAF の runner が stepByYear で進め、onFrame (app/frame.ts) が毎フレーム runner.update を呼び、onVerdict が速度を 0 にする。
 * opening は最初のフレームの前に打つ介入。clicks は s.tick が atTick に達した最初のフレームで打つ介入で、打った tick を記録して返す
 */
function playByFrames(def: ScenarioDef, speed: Speed, intervals: readonly number[], opts: { opening?: Command; clicks?: readonly { atTick: number; command: Command }[] } = {}) {
  let loop: Runner | null = null;
  const { world, runner } = setup(def, () => loop?.setSpeed(0));
  if (opts.opening) runner.intervene(opts.opening);
  const pending = [...(opts.clicks ?? [])];
  const record: Timed[] = [];
  loop = createRunner(
    { step: (n) => stepByYear(world, runner, n), snapshot: () => world.snapshot() },
    {
      onFrame: (s) => {
        runner.update(s);
        while (pending.length > 0 && pending[0].atTick <= s.tick && runner.verdict().status === 'running') {
          const { command } = pending.shift()!;
          runner.intervene(command);
          record.push({ tick: s.tick, command });
        }
      },
      raf: () => 0,
      caf: () => {},
    },
  );
  loop.setSpeed(speed);
  let now = 0;
  loop.frame(now);
  for (let i = 0; runner.verdict().status === 'running'; i++) {
    if (i > 200_000) throw new Error('verdict never came');
    now += intervals[i % intervals.length];
    loop.frame(now);
  }
  return { digest: fullDigest(world, runner), record };
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

/**
 * 年代記の再生: 最初の update の後、tick 付きの介入をその tick で打ち、判定まで進める。
 * 境目ちょうどの介入は、その境目の update の後に打つ (ライブでもクリックは境目を越えたフレームの update の後に来る)
 */
function replay(def: ScenarioDef, commands: readonly Timed[]) {
  const { world, runner, ticksPerYear } = setup(def);
  expect(runChronicle(world, runner, commands, { maxTicks: def.years * ticksPerYear })).toEqual({ kind: 'done' });
  return { world, runner };
}

const SPEEDS: readonly { name: string; speed: Speed; intervals: readonly number[] }[] = [
  { name: '1x / 16.7 ms', speed: 1, intervals: [1000 / 60] },
  { name: '10x / 250・90・417 ms', speed: 10, intervals: [250, 90, 417] },
  { name: '100x / 16・33・3000 ms (上限 200 tick に当たる)', speed: 100, intervals: [16, 33, 3000] },
  { name: '1000x (開発用、M19-16) / 16・50・250 ms (上限 200 tick に当たる)', speed: 1000, intervals: [16, 50, 250] },
];

describe('決定論の刻み (M19-04): 速度とフレームの刻みに依らない', { timeout: 30_000 }, () => {
  const def = scenario('sinking', 4);
  const opening: Command = { type: 'set_climate', rainScale: 1.25 };

  it('1x・10x・100x・1000x とフレーム間隔の違う 4 通りの結末が、台本 (年の境目ごとの update) の結末と一致する', () => {
    const script = playByScript(def, opening);
    const byFrames = Object.fromEntries(SPEEDS.map(({ name, speed, intervals }) => [name, playByFrames(def, speed, intervals, { opening }).digest]));
    expect(byFrames).toEqual(Object.fromEntries(SPEEDS.map(({ name }) => [name, script])));
  });

  it('年の途中と境目ちょうど (1x なら tick 720) のクリックも、打った tick を記録して再生すれば、4 通りとも実際の結末と一致する', () => {
    const clicks = [
      { atTick: 500, command: spawnClick('deer', 16 * SIZE + 16) },
      { atTick: 720, command: spawnClick('deer', 14 * SIZE + 17) },
      { atTick: 800, command: disasterClick('plague', 16 * SIZE + 16) },
    ];
    for (const { name, speed, intervals } of SPEEDS) {
      const live = playByFrames(def, speed, intervals, { opening, clicks });
      expect(live.record.map((r) => r.command), name).toEqual(clicks.map((c) => c.command));
      if (speed === 1) expect(live.record.map((r) => r.tick)).toEqual([500, 720, 800]);
      const again = replay(def, [{ tick: 0, command: opening }, ...live.record]);
      expect(fullDigest(again.world, again.runner), name).toBe(live.digest);
    }
  });

  it('判定が出たら境目より先へ進めない (島は判定の年の境目で止まり、判定の後に呼んでも進まない)', () => {
    const { world, runner, ticksPerYear } = setup(def);
    runner.update(world.snapshot());
    stepByYear(world, runner, (def.years + 3) * ticksPerYear);
    expect(runner.verdict().status).not.toBe('running');
    expect(world.snapshot().tick).toBe(def.years * ticksPerYear);
    stepByYear(world, runner, ticksPerYear);
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

/** 固定の年代記: 石板・seed・tick 付きの介入 (境目ちょうどの 720 を含む)。本体の係数を変えると結末が変わる */
const CHRONICLE: { scenarioId: string; years: number; commands: readonly Timed[] } = {
  scenarioId: 'sinking',
  years: 6,
  commands: [
    { tick: 0, command: { type: 'set_climate', rainScale: 1.25 } },
    { tick: 400, command: spawnClick('deer', 16 * SIZE + 16) },
    { tick: 720, command: spawnClick('deer', 14 * SIZE + 17) },
    { tick: 725, command: spawnClick('rabbit', 12 * SIZE + 18) },
    { tick: 1500, command: disasterClick('plague', 16 * SIZE + 16) },
  ],
};

/**
 * 版ごとの golden。本体 (係数・規則) を変えてこのテストが落ちたら、SIM_VERSION を上げ、新しい版の行を足す。
 * 古い行は消さない (過去の年代記がどの版で何になったかの記録)
 */
// 1 行は版ごとの「年代記 → hash」。版 2 (M21-03 見える星) は沈む欠片の結末を変えないので、K1 が結末を変える年代記 (WITNESS) を足した。
// 版を上げたら、前の版の行と少なくとも 1 つの年代記の hash が違うか、新しい年代記が加わっている (上げた証拠がある) こと
const GOLDEN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '1': { sinking: 'efc90e40c735aaddb775b20b68dcd7460222667ae20ee269f03f6617222f7ea6' },
  '2': { sinking: 'efc90e40c735aaddb775b20b68dcd7460222667ae20ee269f03f6617222f7ea6', 'intercept-tower': 'f570a165831e62cb384c05a7ff2f868c14fcffc686303660222395e506a5e6a1' },
};

/**
 * 版 2 の証人 (M21-03 K1): 星の文明 (備蓄 2.7) を島の中心に据え、6 年目の星の窓を 3 年にした迎撃の塔。4 年目の頭に撃つ (どちらの規則でも受理される)。
 * 版 1 の規則 (窓が無く毎年積む) なら撃った後の備蓄は 1.14、版 2 では 0〜2 年目が窓の外 (灯に焚く) なので 0.06。
 * 種の総数は変わらないので、この年代記の digest には文明の備蓄・迎撃の数・星が見えているかを足す (toPrecision(6))
 */
const WITNESS_DEF: ScenarioDef = {
  ...scenario('intercept-tower', 8),
  start: { seed: 42, size: SIZE, civilization: { speciesId: 'deer', stage: 7, home: 16 * SIZE + 16, fuelStock: 600, faith: 0.9, worksStock: 2.7 } },
  schedule: [{ atYear: 6, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 48 } }],
  starSignYears: 3,
  milestones: [],
};
const CHRONICLES: Readonly<Record<string, { def: ScenarioDef; commands: readonly Timed[] }>> = {
  sinking: { def: scenario(CHRONICLE.scenarioId, CHRONICLE.years), commands: CHRONICLE.commands },
  'intercept-tower': { def: WITNESS_DEF, commands: [{ tick: 4 * 360 + 10, command: { type: 'intercept' } }] },
};

/** 文明の開始 (start.civilization) も据える再生。沈む欠片の golden は replay (文明なし) のまま */
function replayWithCiv(def: ScenarioDef, commands: readonly Timed[]) {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d })),
    seed: def.start?.seed ?? base.seed,
    civilization: resolveCivilizationStart(def.start?.civilization, SIZE),
  };
  const world = World.create(cfg, { log: createMemorySink() });
  const runner = createScenarioRunner(def, world, { ticksPerYear: cfg.ticksPerYear });
  expect(runChronicle(world, runner, commands, { maxTicks: def.years * cfg.ticksPerYear })).toEqual({ kind: 'done' });
  return { world, runner };
}

/** 設計書 §5.1 の Digest の中身 (年・判定・種ごとの総数 toPrecision(6)・絶滅した種) の正規化 JSON の SHA-256 */
function replayDigest(id = 'sinking', def?: ScenarioDef): { hash: string; year: number; verdict: string } {
  const c = CHRONICLES[id];
  const { world, runner } = id === 'sinking' ? replay(c.def, c.commands) : replayWithCiv(def ?? c.def, c.commands);
  const s = world.snapshot();
  const verdict = runner.verdict().status;
  const ids = Object.keys(s.totals).sort();
  const totals = Object.fromEntries(ids.map((id) => [id, Number(s.totals[id].toPrecision(6))]));
  const extinct = ids.filter((id) => s.totals[id] === 0);
  if (id === 'sinking') return { hash: sha256({ year: s.year, verdict, totals, extinct }), year: s.year, verdict };
  const civ = { stock: Number((s.civ?.works?.stock ?? 0).toPrecision(6)), intercepted: s.civ?.intercepted ?? 0, starVisible: s.civ?.starVisible ?? null };
  return { hash: sha256({ year: s.year, verdict, totals, extinct, civ }), year: s.year, verdict };
}

describe('golden replay (M19-04)', () => {
  it(`固定の年代記の結末ダイジェストが SIM_VERSION ${SIM_VERSION} の golden と一致する`, () => {
    const d = replayDigest();
    expect(d.year).toBe(CHRONICLE.years);
    expect(d.verdict).not.toBe('running');
    expect(d.hash, `本体の結末が変わった。SIM_VERSION を上げ、GOLDEN に '${String(Number(SIM_VERSION) + 1)}': '${d.hash}' を足す`).toBe(GOLDEN[SIM_VERSION].sinking);
  });
  it(`版 ${SIM_VERSION} の golden の年代記 (沈む欠片以外) もすべて一致する`, { timeout: 60_000 }, () => {
    for (const id of Object.keys(GOLDEN[SIM_VERSION]).filter((k) => k !== 'sinking')) {
      const d = replayDigest(id);
      expect(d.verdict, id).not.toBe('running');
      expect(d.hash, `${id} の結末が変わった`).toBe(GOLDEN[SIM_VERSION][id]);
    }
  });
  it('GOLDEN の最新の版が SIM_VERSION で、版ごとの行はすべて前の版と違う (上げた証拠がある)', () => {
    const versions = Object.keys(GOLDEN).map(Number).sort((a, b) => a - b);
    expect(Math.max(...versions)).toBe(Number(SIM_VERSION));
    for (let i = 1; i < versions.length; i++) expect(GOLDEN[String(versions[i])]).not.toEqual(GOLDEN[String(versions[i - 1])]);
  });
  it('版 2 の証人: 見える星の窓を外す (版 1 の規則と同じく毎年積む) と、撃った後の備蓄が変わり digest が変わる', { timeout: 60_000 }, () => {
    const k1 = replayDigest('intercept-tower');
    const v1 = replayDigest('intercept-tower', { ...WITNESS_DEF, starSignYears: undefined });
    expect(k1.verdict).toBe('dead');
    expect(v1.hash).not.toBe(k1.hash);
  });
});
