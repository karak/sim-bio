import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore } from '../../src/persist/islandStore';
import type { SlotSave } from '../../src/persist/slotSave';
import { testConfig } from './helpers';

const world = () => World.create(testConfig(), { log: createMemorySink() });
const free = (w: World): SlotSave => ({ stage: 'free', save: w.serialize() });

describe('手元の保存の置き場 (M19-05、IndexedDB)', () => {
  it('手動の枠に保存した島を読み込むと、続きが同じに進む', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const a = world();
    a.step(400);
    await store.save('manual-2', free(a));

    const loaded = await store.load('manual-2');
    if (!loaded) throw new Error('manual-2 is empty');
    const b = World.restore(loaded.save, { log: createMemorySink() });
    expect(b.snapshot().tick).toBe(400);
    a.step(50);
    b.step(50);
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation));
  });

  it('空の枠は null を返す', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    expect(await store.load('manual-1')).toBeNull();
  });

  it('一覧は保存した枠だけを、自動・枠 1・枠 2・枠 3 の順に、保存した時刻と年で返す', async () => {
    let clock = 1000;
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => clock });
    const a = world();
    a.step(360 * 2 + 5);
    expect(await store.save('manual-3', free(a))).toEqual({ slot: 'manual-3', savedAt: 1000, year: 2, stage: 'free' });
    clock = 2000;
    a.step(360);
    await store.save('auto', free(a));

    expect(await store.list()).toEqual([
      { slot: 'auto', savedAt: 2000, year: 3, stage: 'free' },
      { slot: 'manual-3', savedAt: 1000, year: 2, stage: 'free' },
    ]);
  });

  it('同じ枠へ保存し直すと上書きされ、枠は増えない', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const a = world();
    await store.save('manual-1', free(a));
    a.step(360);
    await store.save('manual-1', free(a));

    expect(await store.list()).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 1, stage: 'free' }]);
    expect((await store.load('manual-1'))?.save.tick).toBe(360);
  });

  it('脇へ退けた枠は一覧と読込から消え、退けた先の key を返す', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const a = world();
    a.step(10);
    await store.save('auto', free(a));
    await store.save('manual-1', free(a));

    expect(await store.setAside('auto')).toBe('unreadable:auto');
    expect(await store.load('auto')).toBeNull();
    expect(await store.list()).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 0, stage: 'free' }]);
  });

  it('開き直しても (同じ IndexedDB の別の接続でも) 保存が残る', async () => {
    const indexedDB = new IDBFactory();
    const first = await openIslandStore({ indexedDB, now: () => 1000 });
    const a = world();
    a.step(10);
    await first.save('auto', free(a));

    const second = await openIslandStore({ indexedDB, now: () => 2000 });
    expect((await second.load('auto'))?.save.tick).toBe(10);
    expect(await second.list()).toEqual([{ slot: 'auto', savedAt: 1000, year: 0, stage: 'free' }]);
  });
});
