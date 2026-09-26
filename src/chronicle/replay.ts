import type { ParseError } from '../core/parse';
import { createScenarioRunner, type ScenarioRunner } from '../scenario/ScenarioRunner';
import { stepByYear } from '../scenario/stepByYear';
import type { ScenarioDef } from '../scenario/types';
import type { WorldConfig, WorldSnapshot } from '../simulation/types';
import { SIM_VERSION } from '../simulation/version';
import { World } from '../simulation/World';
import { parseChronicle, type ReplayOutcome, type TimedCommand } from './contract';
import { digestOf } from './digest';

/**
 * 回し直す島。石板と、その石板の島の WorldConfig (main.ts が ?scenario から組み立てるものと同じ)。
 * Worker へは structured clone で渡すので、関数を持たないデータにしてある
 */
export type ReplayIsland = { def: ScenarioDef; config: WorldConfig };

export type ReplayOptions = {
  /** tick の上限。石板の年数 (def.years × ticksPerYear) より小さければこちらで止める */
  maxTicks?: number;
  /** 年の境目を越えるたびに、開始からの年で呼ぶ (進みの表示用) */
  onYear?: (year: number) => void;
  /** 年の境目ごとに見る。Worker の中の中断は呼び手が Worker ごと止める (replayInWorker) */
  signal?: AbortSignal;
};

type SteppableWorld = { step(n: number): void; snapshot(): WorldSnapshot };
export type RunResult = { kind: 'done' } | { kind: 'broken'; error: ParseError } | { kind: 'aborted' };

/**
 * 年代記の命令を、ライブと同じ順で打ち直す (M19-04 の順序の契約)。
 * 最初に tick 0 の評価 (update)、命令ごとに stepByYear でその tick まで進めて intervene、最後に判定まで進める。
 * 境目ちょうどの命令は、その境目の update の後に打つ (ライブのクリックも、境目を越えたフレームの update の後に来る)。
 * ライブの記録は受理された命令だけなので、再生で弾かれた命令・判定の後の命令は、年代記が壊れている印として止める
 */
export function runChronicle(world: SteppableWorld, runner: ScenarioRunner, commands: readonly TimedCommand[], opts: ReplayOptions & { maxTicks: number }): RunResult {
  const advance = (to: number): RunResult => {
    let tick = world.snapshot().tick;
    while (tick < to && runner.verdict().status === 'running') {
      const s = world.snapshot();
      const toYear = runner.ticksToNextYear(s);
      const k = Math.min(to - tick, toYear);
      stepByYear(world, runner, k);
      tick += k;
      if (k === toYear) {
        opts.onYear?.(runner.yearOf(world.snapshot()));
        if (opts.signal?.aborted) return { kind: 'aborted' };
      }
    }
    return { kind: 'done' };
  };

  if (opts.signal?.aborted) return { kind: 'aborted' };
  runner.update(world.snapshot());
  for (const [i, { tick, command }] of commands.entries()) {
    if (tick > opts.maxTicks) return { kind: 'broken', error: { path: `commands[${i}].tick`, reason: 'beyond_limit' } };
    const moved = advance(tick);
    if (moved.kind !== 'done') return moved;
    if (world.snapshot().tick !== tick) return { kind: 'broken', error: { path: `commands[${i}]`, reason: 'after_verdict' } };
    const res = runner.intervene(command);
    if (!res.ok) return { kind: 'broken', error: { path: `commands[${i}]`, reason: `rejected:${res.reason}` } };
  }
  const finished = advance(opts.maxTicks);
  if (finished.kind !== 'done') return finished;
  return runner.verdict().status === 'running' ? { kind: 'broken', error: { path: '', reason: 'no_verdict' } } : { kind: 'done' };
}

const SILENT = { write: () => {} };

/**
 * 年代記を回し直して結末の要約を返す (設計書 §5.2)。Web Worker から呼ぶ (replay.worker.ts)。同じ版なら同じ Digest を返す。
 * 例外を投げない: 壊れた年代記は broken、版違いは other_version、本体が投げたら crashed
 */
export async function replay(input: unknown, island: ReplayIsland, opts: ReplayOptions = {}): Promise<ReplayOutcome> {
  const parsed = parseChronicle(input);
  if (!parsed.ok) return { kind: 'broken', error: parsed.error };
  const c = parsed.value;
  if (c.simVersion !== SIM_VERSION) return { kind: 'other_version', simVersion: c.simVersion };
  if (c.scenarioId !== island.def.id) return { kind: 'broken', error: { path: 'scenarioId', reason: 'mismatch' } };
  try {
    const { ticksPerYear } = island.config;
    const world = World.create({ ...island.config, seed: c.seed }, { log: SILENT });
    const runner = createScenarioRunner(island.def, world, { ticksPerYear });
    const maxTicks = Math.min(island.def.years * ticksPerYear, opts.maxTicks ?? Number.POSITIVE_INFINITY);
    const run = runChronicle(world, runner, c.commands, { ...opts, maxTicks });
    if (run.kind !== 'done') return run;
    const verdict = runner.verdict().status;
    if (verdict === 'running') return { kind: 'broken', error: { path: '', reason: 'no_verdict' } };
    return { kind: 'done', digest: await digestOf(world.snapshot(), verdict) };
  } catch (e) {
    return { kind: 'crashed', reason: String(e) };
  }
}

export type ReplayRequest = { chronicle: unknown; island: ReplayIsland; maxTicks?: number };
export type ReplayMessage = { kind: 'year'; year: number } | { kind: 'outcome'; outcome: ReplayOutcome };

/** Worker の中の本体 (replay.worker.ts)。年ごとの進みと結末を post で返す */
export async function handleReplayRequest(req: ReplayRequest, post: (m: ReplayMessage) => void): Promise<void> {
  const outcome = await replay(req.chronicle, req.island, { maxTicks: req.maxTicks, onYear: (year) => post({ kind: 'year', year }) });
  post({ kind: 'outcome', outcome });
}
