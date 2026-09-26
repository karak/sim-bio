import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createRunner, type Runner, type Speed } from '../../src/core/runner';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { SIM_VERSION } from '../../src/simulation/version';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { disasterClick, spawnClick } from '../../src/ui/clicks';
import { CHRONICLE_LIMITS, YEARLY_POINTS, parseChronicle, type ReplayOutcome } from '../../src/harbor/contract';
import { recordChronicle, yearlySeries } from '../../src/chronicle/recorder';
import { digestOf } from '../../src/chronicle/digest';
import { replay, type ReplayIsland } from '../../src/chronicle/replay';
import { FIXTURE_CHRONICLE, FIXTURE_HASH, FIXTURE_SIZE, FIXTURE_YEARS, fixtureIsland } from '../fixtures/chronicle';

const catalog = {
  base: JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>,
  species: JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[],
  scenarios: JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[],
};
const island = fixtureIsland(catalog);
const TICKS = FIXTURE_YEARS * island.config.ticksPerYear;
const SEA = 0;
const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };

type Click = { atTick: number; command: Command };

/**
 * main.ts と同じ組み立てでライブに遊ぶ: 生成の直後に tick 0 の評価、rAF の runner が stepByYear で進め、onFrame が毎フレーム update、
 * onVerdict が速度を 0 にする。クリックは s.tick が atTick に達した最初のフレームの後に、記録器の dispatch を通して打つ
 */
async function playLive(speed: Speed, intervals: readonly number[], clicks: readonly Click[]) {
  let loop: Runner | null = null;
  const world = World.create(island.config, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear, onVerdict: () => loop?.setSpeed(0) });
  runner.update(world.snapshot());
  const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, head, () => runner.totalsByYear());
  const pending = [...clicks];
  const results: boolean[] = [];
  loop = createRunner(
    { step: (n) => stepByYear(world, runner, n), snapshot: () => world.snapshot() },
    {
      onFrame: (s) => {
        runner.update(s);
        while (pending.length > 0 && pending[0].atTick <= s.tick) results.push(recorder.dispatch(pending.shift()!.command).ok);
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
  const after = recorder.dispatch(spawnClick('deer', 16 * FIXTURE_SIZE + 16)).ok;
  const verdict = runner.verdict().status;
  if (verdict === 'running') throw new Error('unreachable');
  return { chronicle: recorder.current(), results, after, digest: await digestOf(world.snapshot(), verdict), history: runner.totalsByYear() };
}

const CLICKS: readonly Click[] = [
  { atTick: 0, command: { type: 'set_climate', rainScale: 1.25 } },
  { atTick: 400, command: spawnClick('deer', 16 * FIXTURE_SIZE + 16) },
  { atTick: 500, command: spawnClick('deer', SEA) },
  { atTick: 720, command: spawnClick('deer', 14 * FIXTURE_SIZE + 17) },
  { atTick: 730, command: { type: 'intercept' } },
  { atTick: 800, command: disasterClick('plague', 16 * FIXTURE_SIZE + 16) },
];

const done = (o: ReplayOutcome) => {
  if (o.kind !== 'done') throw new Error(`replay ${JSON.stringify(o)}`);
  return o.digest;
};

describe('年代記の記録と再生 (M19-06)', { timeout: 60_000 }, () => {
  it('ライブで記録した年代記を JSON に書いて読み、再生した結末の Digest が、1x・100x (クリックの tick が変わる) のどちらのライブの Digest とも一致する', async () => {
    const slow = await playLive(1, [1000 / 60], CLICKS);
    const fast = await playLive(100, [16, 33, 3000], CLICKS);
    expect(slow.chronicle.commands.map((c) => c.tick)).toEqual([0, 400, 720, 800]);
    expect(fast.chronicle.commands.map((c) => c.command)).toEqual(slow.chronicle.commands.map((c) => c.command));
    for (const live of [slow, fast]) {
      const again = done(await replay(JSON.parse(JSON.stringify(live.chronicle)), island));
      expect(again).toEqual(live.digest);
    }
    expect(slow.digest.year).toBe(FIXTURE_YEARS);
    expect(slow.digest.hash).toBe(FIXTURE_HASH);
  });

  it('拒否された命令 (海への放流・的の無い迎撃・判定の後) は載らず、予言の命令 (毎年の沈降) も載らない', async () => {
    const live = await playLive(100, [16, 33, 3000], CLICKS);
    expect(live.results).toEqual([true, true, false, true, false, true]);
    expect(live.after).toBe(false);
    expect(live.chronicle.commands.map((c) => c.command.type)).toEqual(['set_climate', 'spawn_species', 'spawn_species', 'disaster']);
    expect(live.chronicle).toMatchObject(head);
  });

  it('年ごとの種の総数の系列を添える (境目ごとの評価の総数を 4 桁に丸めたもの。年 0 から判定の年まで)', async () => {
    const live = await playLive(100, [16, 33, 3000], CLICKS);
    expect(live.chronicle.yearly).toHaveLength(FIXTURE_YEARS + 1);
    expect(live.chronicle.yearly).toEqual(yearlySeries(live.history));
    const deer = live.history[2].deer;
    expect(deer).toBeGreaterThan(0);
    expect(live.chronicle.yearly[2].deer).toBe(Number(deer.toPrecision(4)));
  });

  it('固定の年代記の Digest が golden と一致する (E2E が Chromium の Web Worker で同じ hash を確かめる)', async () => {
    const d = done(await replay(FIXTURE_CHRONICLE, island));
    expect(d.hash, `golden の hash: '${d.hash}'`).toBe(FIXTURE_HASH);
  });

  it('記録器は World を変えない (dispatch をそのまま通すだけ)', () => {
    const world = World.create(island.config, { log: createMemorySink() });
    const before = JSON.stringify(world.serialize());
    const recorder = recordChronicle({ dispatch: () => ({ ok: true }), snapshot: () => world.snapshot() }, head, () => []);
    recorder.dispatch(spawnClick('deer', 16 * FIXTURE_SIZE + 16));
    expect(JSON.stringify(world.serialize())).toBe(before);
    expect(recorder.current().commands).toEqual([{ tick: 0, command: spawnClick('deer', 16 * FIXTURE_SIZE + 16) }]);
  });

  it('記録した命令は呼び手が後で書き換えても変わらない', () => {
    const recorder = recordChronicle({ dispatch: () => ({ ok: true }), snapshot: () => ({ tick: 5 }) }, head, () => []);
    const c: Command = { type: 'set_climate', rainScale: 1.5 };
    recorder.dispatch(c);
    c.rainScale = 3;
    expect(recorder.current().commands[0].command).toEqual({ type: 'set_climate', rainScale: 1.5 });
  });

  it('resume は保存した年代記の命令を引き継ぎ、その後の命令を後ろに積む。頭 (版・石板・seed) が違えば投げる', () => {
    let tick = 900;
    const recorder = recordChronicle({ dispatch: () => ({ ok: true }), snapshot: () => ({ tick }) }, head, () => []);
    recorder.resume(FIXTURE_CHRONICLE);
    tick = 1000;
    recorder.dispatch({ type: 'intercept' });
    expect(recorder.current().commands).toEqual([...FIXTURE_CHRONICLE.commands, { tick: 1000, command: { type: 'intercept' } }]);
    expect(() => recorder.resume({ ...FIXTURE_CHRONICLE, seed: 7 })).toThrow(/head/);
  });
});

describe('yearlySeries (M19-06)', () => {
  it(`${YEARLY_POINTS} 点を超える年は、最初と最後の年を含めて等間隔に間引く`, () => {
    const history = Array.from({ length: 301 }, (_, y) => ({ deer: y }));
    const s = yearlySeries(history);
    expect(s).toHaveLength(YEARLY_POINTS);
    expect(s[0]).toEqual({ deer: 0 });
    expect(s[YEARLY_POINTS - 1]).toEqual({ deer: 300 });
    expect(s.map((r) => r.deer)).toEqual([...s.map((r) => r.deer)].sort((a, b) => a - b));
  });
});

describe('digestOf (M19-06)', () => {
  const snap = (totals: Record<string, number>, year = 3) => ({ year, totals });

  it('総数を toPrecision(6) に丸め、0 の種を絶滅に並べ、鍵の順に依らず同じ hash にする', async () => {
    const a = await digestOf(snap({ wolf: 0, deer: 1.23456789, grass: 1234.56789 }), 'alive');
    const b = await digestOf(snap({ grass: 1234.56789, deer: 1.23456789, wolf: 0 }), 'alive');
    expect(a).toEqual({ year: 3, verdict: 'alive', totals: { deer: 1.23457, grass: 1234.57, wolf: 0 }, extinct: ['wolf'], hash: b.hash });
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('丸めの 6 桁より下の差は hash を変えず、年・判定・総数のどれかが変われば hash が変わる', async () => {
    const base = await digestOf(snap({ deer: 1.234561 }), 'alive');
    expect((await digestOf(snap({ deer: 1.2345612 }), 'alive')).hash).toBe(base.hash);
    const others = [await digestOf(snap({ deer: 1.23457 }), 'alive'), await digestOf(snap({ deer: 1.234561 }), 'dead'), await digestOf(snap({ deer: 1.234561 }, 4), 'alive')];
    expect(new Set([base.hash, ...others.map((d) => d.hash)]).size).toBe(4);
  });
});

describe('壊れた年代記で再生が止まる (M19-06)', { timeout: 30_000 }, () => {
  const broken = async (input: unknown, opts: Parameters<typeof replay>[2] = {}, at: ReplayIsland = island) => {
    const o = await replay(input, at, opts);
    if (o.kind !== 'broken') throw new Error(`expected broken, got ${JSON.stringify(o)}`);
    return o.error;
  };
  const withCommands = (commands: unknown[]) => ({ ...FIXTURE_CHRONICLE, commands });

  it('年代記でないもの (null・文字列・配列・命令が配列でない) は形で弾く', async () => {
    for (const input of [null, 'chronicle', [], { ...FIXTURE_CHRONICLE, commands: {} }]) {
      expect((await broken(input)).reason).toMatch(/not_object|not_array/);
    }
  });

  it('tick の逆行は弾く', async () => {
    const c = withCommands([FIXTURE_CHRONICLE.commands[1], FIXTURE_CHRONICLE.commands[0]]);
    expect(await broken(c)).toEqual({ path: 'commands[1].tick', reason: 'not_monotonic' });
  });

  it(`長すぎる年代記 (${CHRONICLE_LIMITS.maxCommands} 件を超える) は弾く`, async () => {
    const c = withCommands(Array.from({ length: CHRONICLE_LIMITS.maxCommands + 1 }, () => FIXTURE_CHRONICLE.commands[0]));
    expect(await broken(c)).toEqual({ path: 'commands', reason: 'too_long' });
  });

  it('石板の年数より先の tick と、呼び手の tick の上限より先の tick は、そこまで回さずに弾く', async () => {
    expect(await broken(withCommands([{ tick: TICKS + 1, command: { type: 'intercept' } }]))).toEqual({ path: 'commands[0].tick', reason: 'beyond_limit' });
    expect(await broken(FIXTURE_CHRONICLE, { maxTicks: 500 })).toEqual({ path: 'commands[2].tick', reason: 'beyond_limit' });
  });

  it('呼び手の tick の上限までに判定が出なければ、そこで止める', async () => {
    expect(await broken({ ...FIXTURE_CHRONICLE, commands: [] }, { maxTicks: 2 * island.config.ticksPerYear })).toEqual({ path: '', reason: 'no_verdict' });
  });

  it('予言が出す命令 (sink) と知らない命令は弾く', async () => {
    expect(await broken(withCommands([{ tick: 0, command: { type: 'sink', amount: 1 } }]))).toEqual({ path: 'commands[0].command.type', reason: 'unknown_command' });
    expect(await broken(withCommands([{ tick: 0, command: { type: 'disaster', kind: 'meteor', cell: 0, radius: 1e9 } }]))).toEqual({ path: 'commands[0].command.radius', reason: 'invalid' });
  });

  it('ライブでは受理されない命令 (海への放流) が載っていれば、再生で弾かれたところで止める', async () => {
    expect(await broken(withCommands([{ tick: 10, command: spawnClick('deer', SEA) }]))).toEqual({ path: 'commands[0]', reason: 'rejected:rejected' });
  });

  it('石板の違う島には回さない。版の違う年代記は other_version を返す', async () => {
    expect(await broken(FIXTURE_CHRONICLE, {}, fixtureIsland(catalog, 'tower'))).toEqual({ path: 'scenarioId', reason: 'mismatch' });
    expect(await replay({ ...FIXTURE_CHRONICLE, simVersion: '0' }, island)).toEqual({ kind: 'other_version', simVersion: '0' });
  });

  it('parseChronicle は知らない鍵を落として作り直す (同じ中身は同じ年代記になる)', () => {
    const p = parseChronicle({ ...FIXTURE_CHRONICLE, extra: 1, commands: [{ tick: 0, x: 1, command: { type: 'intercept', y: 2 } }] });
    expect(p).toEqual({ ok: true, value: { ...FIXTURE_CHRONICLE, commands: [{ tick: 0, command: { type: 'intercept' } }] } });
  });

  it('年ごとに onYear を呼び、signal が中断されたらその年の境目で止まる', async () => {
    const years: number[] = [];
    const ctl = new AbortController();
    const o = await replay(FIXTURE_CHRONICLE, island, {
      signal: ctl.signal,
      onYear: (y) => {
        years.push(y);
        if (y === 2) ctl.abort();
      },
    });
    expect(o).toEqual({ kind: 'aborted' });
    expect(years).toEqual([1, 2]);
  });
});
