import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore } from '../../src/persist/islandStore';
import { recordChronicle } from '../../src/chronicle/recorder';
import { FIXTURE_CHRONICLE } from '../fixtures/chronicle';
import { testConfig } from './helpers';

const DB = 'biotope-island';

/** M19-05 の版 1 の DB を、そのときの移行 (saves と slots だけ) で作り、自動の枠に 1 件入れて閉じる */
const openV1WithSave = (indexedDB: IDBFactory, save: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('saves');
      open.result.createObjectStore('slots', { keyPath: 'slot' });
    };
    open.onsuccess = () => {
      const tx = open.result.transaction(['saves', 'slots'], 'readwrite');
      tx.objectStore('saves').put(save, 'auto');
      tx.objectStore('slots').put({ slot: 'auto', savedAt: 500, year: 0 });
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });

const putRaw = (indexedDB: IDBFactory, key: string, value: unknown): Promise<void> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open(DB);
    open.onsuccess = () => {
      const tx = open.result.transaction('chronicles', 'readwrite');
      tx.objectStore('chronicles').put(value, key);
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    open.onerror = () => reject(open.error);
  });

describe('年代記の置き場 (M19-06、IndexedDB)', () => {
  it('保存した年代記を開き直して読み、記録器に引き継ぐと、その後の命令が後ろに積まれる', async () => {
    const indexedDB = new IDBFactory();
    const first = await openIslandStore({ indexedDB, now: () => 1000 });
    await first.saveChronicle('sinking', FIXTURE_CHRONICLE);

    const second = await openIslandStore({ indexedDB, now: () => 2000 });
    const loaded = await second.loadChronicle('sinking');
    expect(loaded).toEqual({ ok: true, value: FIXTURE_CHRONICLE });
    if (!loaded?.ok) throw new Error('unreachable');
    const recorder = recordChronicle({ dispatch: () => ({ ok: true }), snapshot: () => ({ tick: 900 }) }, FIXTURE_CHRONICLE, () => []);
    recorder.resume(loaded.value);
    recorder.dispatch({ type: 'intercept' });
    expect(recorder.current().commands).toEqual([...FIXTURE_CHRONICLE.commands, { tick: 900, command: { type: 'intercept' } }]);
  });

  it('石板ごとに 1 本。同じ石板へ書き直すと上書きし、無い石板は null', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    await store.saveChronicle('sinking', FIXTURE_CHRONICLE);
    await store.saveChronicle('sinking', { ...FIXTURE_CHRONICLE, commands: [] });
    expect(await store.loadChronicle('sinking')).toEqual({ ok: true, value: { ...FIXTURE_CHRONICLE, commands: [] } });
    expect(await store.loadChronicle('tower')).toBeNull();
  });

  it('置き場の値が年代記として読めなければ、拒否の理由を返す (境界で parse する)', async () => {
    const indexedDB = new IDBFactory();
    const store = await openIslandStore({ indexedDB, now: () => 1000 });
    await putRaw(indexedDB, 'sinking', { ...FIXTURE_CHRONICLE, commands: [{ tick: -1, command: { type: 'intercept' } }] });
    expect(await store.loadChronicle('sinking')).toEqual({ ok: false, error: { path: 'commands[0].tick', reason: 'invalid' } });
  });

  it('M19-05 の版 1 の DB を開くと、年代記の置き場を足し、自動の枠の島と一覧はそのまま残す', async () => {
    const indexedDB = new IDBFactory();
    const w = World.create(testConfig(), { log: createMemorySink() });
    w.step(10);
    await openV1WithSave(indexedDB, w.serialize());

    const store = await openIslandStore({ indexedDB, now: () => 1000 });
    expect((await store.load('auto'))?.tick).toBe(10);
    expect(await store.list()).toEqual([{ slot: 'auto', savedAt: 500, year: 0 }]);
    await store.saveChronicle('sinking', FIXTURE_CHRONICLE);
    expect((await store.loadChronicle('sinking'))?.ok).toBe(true);
  });
});
