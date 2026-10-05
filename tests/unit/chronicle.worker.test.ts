import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { handleReplayRequest } from '../../src/chronicle/replay';
import { replayInWorker, type ReplayPort } from '../../src/chronicle/replayInWorker';
import { FIXTURE_CHRONICLE, FIXTURE_HASH, FIXTURE_YEARS, fixtureIsland } from '../fixtures/chronicle';

const island = fixtureIsland({
  base: JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>,
  species: JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[],
  scenarios: JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[],
});

/** Worker の代わりに、同じ handleReplayRequest を次の macrotask で回す。要求は structured clone を通す (Worker と同じく参照を渡さない) */
function inProcessPort(log: string[]): () => ReplayPort {
  return () => {
    let stopped = false;
    return {
      start(req, on) {
        setTimeout(() => void handleReplayRequest(structuredClone(req), (m) => {
          if (!stopped) on.message(structuredClone(m));
        }), 0);
      },
      stop() {
        stopped = true;
        log.push('stop');
      },
    };
  };
}

describe('replayInWorker (M19-06)', { timeout: 30_000 }, () => {
  it('年ごとの進みを onYear に渡し、結末を返して Worker を止める', async () => {
    const log: string[] = [];
    const years: number[] = [];
    const o = await replayInWorker(FIXTURE_CHRONICLE, island, { port: inProcessPort(log), onYear: (y) => years.push(y) });
    expect(o.kind === 'done' && o.digest.hash).toBe(FIXTURE_HASH);
    expect(years).toEqual(Array.from({ length: FIXTURE_YEARS }, (_, i) => i + 1));
    expect(log).toEqual(['stop']);
  });

  it('壊れた年代記は Worker の中で broken になって返る', async () => {
    const o = await replayInWorker({ ...FIXTURE_CHRONICLE, commands: 'x' }, island, { port: inProcessPort([]) });
    expect(o).toEqual({ kind: 'broken', error: { path: 'commands', reason: 'not_array' } });
  });

  it('中断すると結末を待たずに aborted を返して Worker を止め、その後の知らせは捨てる', async () => {
    const log: string[] = [];
    const ctl = new AbortController();
    const years: number[] = [];
    const o = await replayInWorker(FIXTURE_CHRONICLE, island, {
      port: inProcessPort(log),
      signal: ctl.signal,
      onYear: (y) => {
        years.push(y);
        ctl.abort();
      },
    });
    expect(o).toEqual({ kind: 'aborted' });
    expect(years).toEqual([1]);
    expect(log).toEqual(['stop']);
  });

  it('始める前に中断されていれば Worker を作らない', async () => {
    let made = 0;
    const o = await replayInWorker(FIXTURE_CHRONICLE, island, { signal: AbortSignal.abort(), port: () => { made++; return inProcessPort([])(); } });
    expect(o).toEqual({ kind: 'aborted' });
    expect(made).toBe(0);
  });

  it('Worker が落ちる・作れないときは crashed を返す (投げない)', async () => {
    const failing: ReplayPort = { start: (_req, on) => on.error('boom'), stop: () => {} };
    expect(await replayInWorker(FIXTURE_CHRONICLE, island, { port: () => failing })).toEqual({ kind: 'crashed', reason: 'boom' });
    const o = await replayInWorker(FIXTURE_CHRONICLE, island, { port: () => { throw new Error('no worker'); } });
    expect(o).toEqual({ kind: 'crashed', reason: 'Error: no worker' });
  });
});
