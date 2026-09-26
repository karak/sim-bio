import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore, type IslandStore, type ScenarioSave } from '../../src/persist/islandStore';
import { createScenarioAutosave, resumeScenario } from '../../src/persist/scenarioSave';
import type { SaveLog } from '../../src/persist/localSave';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { recordChronicle } from '../../src/chronicle/recorder';
import { SIM_VERSION } from '../../src/simulation/version';
import { resumeIsland } from '../fixtures/resumeIsland';
import { digestOf } from '../../src/chronicle/digest';
import { createHarbor } from '../../src/harbor/client';
import { openHarborStore } from '../../src/persist/harborStore';
import { catalogFrom } from '../fixtures/fakeHarbor';
import { readFileSync } from 'node:fs';

const read = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: read('scenarios'), species: read('species'), inscriptions: read('inscriptions') });

const EVERY = 90;
const island = resumeIsland('test-quick', 5);
const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };

type Logged = { level: string; event: string; tick: number } & Record<string, unknown>;

/** main.ts と同じ組み立ての石板。介入は記録器を通す */
function scenarioIsland() {
  const world = World.create(island.config, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear });
  runner.update(world.snapshot());
  const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, head, () => runner.totalsByYear());
  const capture = (): ScenarioSave => ({ save: world.serialize(), runner: runner.save(), chronicle: recorder.current() });
  return { world, runner, recorder, capture };
}

/** 書き込みの確定を待つ (fake-indexeddb の transaction は数 macrotask かかる) */
const pending: Promise<unknown>[] = [];
const settle = async () => {
  await Promise.allSettled(pending);
  await new Promise((r) => setTimeout(r, 0));
};
const tracked = (store: IslandStore): IslandStore => ({
  ...store,
  saveScenario: (id, s) => {
    const p = store.saveScenario(id, s);
    pending.push(p);
    return p;
  },
});

async function setup() {
  const store = tracked(await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 }));
  const logs: Logged[] = [];
  const log: SaveLog = (level, event, tick, extra = {}) => logs.push({ level, event, tick, ...extra });
  return { store, logs, log };
}
const restoreTick = (s: ScenarioSave) => World.restore(s.save, { log: createMemorySink() }).snapshot().tick;

describe('石板の途中の島の自動保存 (M19-14)', () => {
  it('前に書いた tick から 90 tick 進むまで書かず、進んだら 1 回書く。開き直すとその tick から続く', async () => {
    const { store, logs, log } = await setup();
    const s = scenarioIsland();
    const autosave = createScenarioAutosave({ store, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: s.capture });
    for (const n of [40, 40, 40]) {
      stepByYear(s.world, s.runner, n);
      autosave.onTick(s.world.snapshot().tick);
      await settle();
    }
    expect(logs.filter((l) => l.event === 'persist.scenario.saved').map((l) => l.tick)).toEqual([120]);
    expect(await resumeScenario({ store, head, log }, restoreTick)).toBe(120);
    expect(logs.at(-1)).toMatchObject({ level: 'info', event: 'persist.scenario.resumed', tick: 120 });
  });

  it('島・runner の状態・年代記を同じ tick で書く (年代記は chronicles にも入り、港への出港が読める)', async () => {
    const { store, log } = await setup();
    const s = scenarioIsland();
    stepByYear(s.world, s.runner, 200);
    expect(s.recorder.dispatch({ type: 'set_climate', rainScale: 1.1 }).ok).toBe(true);
    createScenarioAutosave({ store, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: s.capture }).flush();
    await settle();
    const loaded = await store.loadScenario(head.scenarioId);
    expect(loaded?.save.tick).toBe(200);
    expect(loaded?.runner.timeline).toEqual([{ year: 0, kind: 'intervene', command: { type: 'set_climate', rainScale: 1.1 } }]);
    expect(loaded?.chronicle).toEqual({ ok: true, value: s.recorder.current() });
    expect(await store.loadChronicle(head.scenarioId)).toEqual({ ok: true, value: s.recorder.current() });
  });

  it('判定の出た石板は戻さず (石板の初めから)、続きも年代記も消さない', async () => {
    const { store, logs, log } = await setup();
    const s = scenarioIsland();
    stepByYear(s.world, s.runner, 10 * 360);
    expect(s.runner.verdict().status).toBe('dead');
    createScenarioAutosave({ store, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: s.capture }).flush();
    await settle();
    expect(await resumeScenario({ store, head, log }, restoreTick)).toBeNull();
    expect(logs.at(-1)).toMatchObject({ level: 'info', event: 'persist.scenario.finished', status: 'dead' });
    expect(await store.loadScenario(head.scenarioId)).not.toBeNull();
  });

  it.each([
    ['runner の状態の版が違う', (s: ScenarioSave) => ({ ...s, runner: { ...s.runner, version: 0 as unknown as 1 } }), 'unsupported runner state version 0'],
    ['年代記の seed が違う (別の島)', (s: ScenarioSave) => ({ ...s, chronicle: { ...s.chronicle, seed: 7 } }), 'chronicle head differs'],
    ['年代記が壊れている (tick の逆行)', (s: ScenarioSave) => ({ ...s, chronicle: { ...s.chronicle, commands: [{ tick: 5, command: { type: 'intercept' as const } }, { tick: 1, command: { type: 'intercept' as const } }] } }), 'chronicle: commands[1].tick not_monotonic'],
    ['SaveData の版が違う (restore が投げる)', (s: ScenarioSave) => ({ ...s, save: { ...s.save, version: 2 as unknown as 1 } }), 'Error: unsupported save version 2'],
  ])('%s続きは脇へ退け、石板の初めからにする (記録に理由を残す)', async (_, spoil, reason) => {
    const { store, logs, log } = await setup();
    const s = scenarioIsland();
    stepByYear(s.world, s.runner, 100);
    await store.saveScenario(head.scenarioId, spoil(s.capture()));
    expect(await resumeScenario({ store, head, log }, restoreTick)).toBeNull();
    expect(logs).toEqual([expect.objectContaining({ level: 'warn', event: 'persist.scenario.resume.failed', reason, setAside: `unreadable:${head.scenarioId}` })]);
    expect(await store.loadScenario(head.scenarioId)).toBeNull();
  });

  it('IndexedDB が開けなければ何も書かず、続きも無い', async () => {
    const logs: Logged[] = [];
    const log: SaveLog = (level, event, tick, extra = {}) => logs.push({ level, event, tick, ...extra });
    const s = scenarioIsland();
    const autosave = createScenarioAutosave({ store: null, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: s.capture });
    stepByYear(s.world, s.runner, 200);
    autosave.onTick(200);
    autosave.flush();
    expect(await resumeScenario({ store: null, head, log }, restoreTick)).toBeNull();
    expect(logs).toEqual([]);
  });

  it('書き込みの失敗は warn の記録に原因を残し、例外にしない', async () => {
    const { store, logs, log } = await setup();
    const failing: IslandStore = { ...store, saveScenario: () => Promise.reject(new Error('QuotaExceededError')) };
    const s = scenarioIsland();
    createScenarioAutosave({ store: failing, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: s.capture }).flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(logs).toEqual([expect.objectContaining({ level: 'warn', event: 'persist.scenario.save.failed', error: 'Error: QuotaExceededError' })]);
  });
});

/** M19-06 の版 2 の DB (saves・slots・chronicles) を作り、年代記を 1 本入れて閉じる */
const openV2WithChronicle = (indexedDB: IDBFactory, chronicle: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('biotope-island', 2);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('saves');
      open.result.createObjectStore('slots', { keyPath: 'slot' });
      open.result.createObjectStore('chronicles');
    };
    open.onsuccess = () => {
      const tx = open.result.transaction('chronicles', 'readwrite');
      tx.objectStore('chronicles').put(chronicle, head.scenarioId);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });

describe('石板の途中の島の置き場 (M19-14、IndexedDB の版 3)', () => {
  it('M19-06 の版 2 の DB を開くと置き場を足し、年代記はそのまま残る。年代記だけで続きの島が無ければ null', async () => {
    const indexedDB = new IDBFactory();
    const chronicle = scenarioIsland().recorder.current();
    await openV2WithChronicle(indexedDB, chronicle);
    const store = await openIslandStore({ indexedDB, now: () => 1000 });
    expect(await store.loadChronicle(head.scenarioId)).toEqual({ ok: true, value: chronicle });
    expect(await store.loadScenario(head.scenarioId)).toBeNull();
    const s = scenarioIsland();
    await store.saveScenario(head.scenarioId, s.capture());
    expect((await store.loadScenario(head.scenarioId))?.save.tick).toBe(0);
  });
});

describe('判定の出た年代記は、次の挑戦の自動保存に上書きされない (M19-14 の直し)', () => {
  it('判定の後に閉じて開き直し、次の挑戦が 90 tick 進んで書いても、終わった年代記と要約は港へ出せるまま残る', async () => {
    const indexedDB = new IDBFactory();
    const store = tracked(await openIslandStore({ indexedDB, now: () => 1000 }));
    const harbor = createHarbor({ linkBase: 'https://island.test', store: await openHarborStore({ indexedDB }), catalog, turnstile: async () => ({ kind: 'unavailable' }) });
    const logs: Logged[] = [];
    const log: SaveLog = (level, event, tick, extra = {}) => logs.push({ level, event, tick, ...extra });

    const done = scenarioIsland();
    expect(done.recorder.dispatch({ type: 'set_climate', rainScale: 1.1 }).ok).toBe(true);
    stepByYear(done.world, done.runner, 10 * 360);
    const status = done.runner.verdict().status;
    if (status === 'running') throw new Error('判定が出ていない');
    createScenarioAutosave({ store, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: done.capture }).flush();
    const finished = { chronicle: done.recorder.current(), digest: await digestOf(done.world.snapshot(), status) };
    await harbor.keepFinished(finished);
    await settle();

    expect(await resumeScenario({ store, head, log }, restoreTick)).toBeNull();
    const next = scenarioIsland();
    const autosave = createScenarioAutosave({ store, scenarioId: head.scenarioId, every: EVERY, log, from: 0, capture: next.capture });
    stepByYear(next.world, next.runner, EVERY);
    autosave.onTick(next.world.snapshot().tick);
    await settle();

    expect(await store.loadChronicle(head.scenarioId)).toEqual({ ok: true, value: next.recorder.current() });
    expect(next.recorder.current().commands).toEqual([]);
    expect(await harbor.finished(head.scenarioId)).toEqual(finished);
  });
});
