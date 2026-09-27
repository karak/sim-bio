import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore } from '../../src/persist/islandStore';
import { checkSlot, planSlotLoad, putPendingSlot, slotSaveOf, takePendingSlot, type SlotSave } from '../../src/persist/slotSave';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { recordChronicle } from '../../src/chronicle/recorder';
import { SIM_VERSION } from '../../src/simulation/version';
import { resumeIsland } from '../fixtures/resumeIsland';

const island = resumeIsland('test-quick', 5);
const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };

/** main.ts と同じ組み立ての石板を n tick 進め、介入を 1 つ受けた枠の包みを返す */
function scenarioSlot(n: number): Extract<SlotSave, { stage: 'scenario' }> {
  const world = World.create(island.config, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear });
  runner.update(world.snapshot());
  const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, head, () => runner.totalsByYear());
  expect(recorder.dispatch({ type: 'set_climate', rainScale: 1.1 }).ok).toBe(true);
  stepByYear(world, runner, n);
  return { stage: 'scenario', scenarioId: head.scenarioId, save: world.serialize(), runner: runner.save(), chronicle: recorder.current() };
}
const freeSlot = (): SlotSave => ({ stage: 'free', save: World.create(island.config, { log: createMemorySink() }).serialize() });

describe('枠とファイルの包み (M19-17)', () => {
  it('包みはそのまま読み、包みの無い古い SaveData は自由モードの枠として読む', () => {
    const slot = scenarioSlot(10);
    expect(slotSaveOf(slot)).toBe(slot);
    const bare = slot.save;
    expect(slotSaveOf(bare)).toEqual({ stage: 'free', save: bare });
  });

  it('自由モードでは自由モードの枠だけを読み、石板の枠は弾く', () => {
    const free = freeSlot();
    expect(checkSlot(free, { stage: 'free' })).toEqual({ ok: true, value: free });
    expect(checkSlot(scenarioSlot(10), { stage: 'free' })).toEqual({ ok: false, reason: 'stage scenario:test-quick, here free' });
  });

  it('石板では同じ石板の枠だけを、続きからの復帰と同じ確かめ (版・石板・seed・runner の状態) を通して読む', () => {
    const slot = scenarioSlot(100);
    const here = { stage: 'scenario' as const, head };
    expect(checkSlot(slot, here)).toEqual({ ok: true, value: slot });
    expect(checkSlot(freeSlot(), here)).toEqual({ ok: false, reason: 'stage free, here scenario:test-quick' });
    expect(checkSlot({ ...slot, chronicle: { ...slot.chronicle, seed: 7 } }, here)).toEqual({ ok: false, reason: 'chronicle head differs' });
    expect(checkSlot({ ...slot, runner: { ...slot.runner, version: 0 as unknown as 1 } }, here)).toEqual({ ok: false, reason: 'unsupported runner state version 0' });
    expect(checkSlot({ ...slot, chronicle: { ...slot.chronicle, commands: 'x' as unknown as [] } }, here)).toMatchObject({ ok: false, reason: expect.stringMatching(/^chronicle: commands /) });
  });

  it('判定の出た石板の枠も読める (判定の後にも保存できる)', () => {
    const slot = scenarioSlot(10 * 360);
    expect(slot.runner.verdict.status).toBe('dead');
    expect(checkSlot(slot, { stage: 'scenario', head })).toEqual({ ok: true, value: slot });
  });
});

describe('枠を読む操作の行き先 (M19-17 §4)', () => {
  const titleOf = (id: string) => ({ 'test-quick': '試し読み' })[id] ?? id;
  it('同じ舞台の枠はその場で差し替え、違う舞台の枠はその舞台へ移る。どれも確かめの文を持つ', () => {
    expect(planSlotLoad({ stage: 'free' }, { stage: 'free' }, titleOf)).toEqual({ kind: 'replace', confirm: '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)' });
    expect(planSlotLoad({ stage: 'scenario', scenarioId: 'test-quick' }, { stage: 'scenario', head }, titleOf)).toEqual({
      kind: 'replace',
      confirm: '石板を枠の時点に戻しますか (今の続きは上書きされます)',
    });
    expect(planSlotLoad({ stage: 'scenario', scenarioId: 'test-quick' }, { stage: 'free' }, titleOf)).toEqual({
      kind: 'navigate',
      to: { stage: 'scenario', scenarioId: 'test-quick' },
      confirm: '石板『試し読み』の枠です。石板を開いて読みますか',
    });
    expect(planSlotLoad({ stage: 'free' }, { stage: 'scenario', head }, titleOf)).toEqual({
      kind: 'navigate',
      to: { stage: 'free' },
      confirm: '自由モードの枠です。自由モードを開いて読みますか',
    });
    expect(planSlotLoad({ stage: 'scenario', scenarioId: 'other' }, { stage: 'scenario', head }, titleOf).kind).toBe('navigate');
  });

  it('移った先で読む枠の名前は sessionStorage に 1 回だけ置く (読み直しで二度読まない)', () => {
    const items = new Map<string, string>();
    const storage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) };
    expect(takePendingSlot(storage)).toBeNull();
    putPendingSlot(storage, 'manual-2');
    expect(takePendingSlot(storage)).toBe('manual-2');
    expect(takePendingSlot(storage)).toBeNull();
    items.set('biotope-pending-slot', 'manual-9');
    expect(takePendingSlot(storage)).toBeNull();
  });
});

describe('枠の置き場 (M19-17、包みと一覧の舞台)', () => {
  it('石板の枠は包みごと書いて読め、一覧の行に舞台と石板を載せる', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const slot = scenarioSlot(400);
    expect(await store.save('manual-1', slot)).toEqual({ slot: 'manual-1', savedAt: 1000, year: 1, stage: 'scenario', scenarioId: 'test-quick' });
    expect(await store.load('manual-1')).toEqual(slot);
    expect(await store.list()).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 1, stage: 'scenario', scenarioId: 'test-quick' }]);
  });

  it('ファイルから読んだ違う舞台の包みは、枠の一覧に出さずに置き、移った先で読める', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const slot = scenarioSlot(10);
    await store.stashImport(slot);
    expect(await store.load('import')).toEqual(slot);
    expect(await store.list()).toEqual([]);
  });

  it('M19-17 より前の枠 (包みの無い SaveData・舞台の無い一覧の行) は自由モードの枠として読む', async () => {
    const indexedDB = new IDBFactory();
    const store = await openIslandStore({ indexedDB, now: () => 1000 });
    const bare = freeSlot().save;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('biotope-island');
      open.onsuccess = () => {
        const tx = open.result.transaction(['saves', 'slots'], 'readwrite');
        tx.objectStore('saves').put(bare, 'manual-3');
        tx.objectStore('slots').put({ slot: 'manual-3', savedAt: 500, year: 0 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
    expect(await store.load('manual-3')).toEqual({ stage: 'free', save: bare });
    expect(await store.list()).toEqual([{ slot: 'manual-3', savedAt: 500, year: 0, stage: 'free' }]);
  });
});
