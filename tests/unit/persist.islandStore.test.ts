import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore, parseSlotId } from '../../src/persist/islandStore';
import { createAutosave } from '../../src/persist/autosave';
import { testConfig } from './helpers';

const world = () => World.create(testConfig(), { log: createMemorySink() });

describe('手元の保存 (M19-05)', () => {
  it('手動の枠に保存した島を読み込むと、続きが同じに進む', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const a = world();
    a.step(400);
    await store.save('manual-2', a.serialize());

    const loaded = await store.load('manual-2');
    if (!loaded) throw new Error('manual-2 is empty');
    const b = World.restore(loaded, { log: createMemorySink() });
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
    expect(await store.save('manual-3', a.serialize())).toEqual({ slot: 'manual-3', savedAt: 1000, year: 2 });
    clock = 2000;
    a.step(360);
    await store.save('auto', a.serialize());

    expect(await store.list()).toEqual([
      { slot: 'auto', savedAt: 2000, year: 3 },
      { slot: 'manual-3', savedAt: 1000, year: 2 },
    ]);
  });

  it('同じ枠へ保存し直すと上書きされ、枠は増えない', async () => {
    const store = await openIslandStore({ indexedDB: new IDBFactory(), now: () => 1000 });
    const a = world();
    await store.save('manual-1', a.serialize());
    a.step(360);
    await store.save('manual-1', a.serialize());

    expect(await store.list()).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 1 }]);
    expect((await store.load('manual-1'))?.tick).toBe(360);
  });

  it('開き直しても (同じ IndexedDB の別の接続でも) 保存が残る', async () => {
    const indexedDB = new IDBFactory();
    const first = await openIslandStore({ indexedDB, now: () => 1000 });
    const a = world();
    a.step(10);
    await first.save('auto', a.serialize());

    const second = await openIslandStore({ indexedDB, now: () => 2000 });
    expect((await second.load('auto'))?.tick).toBe(10);
  });

  it('枠の id は決まった 4 つだけを受ける (select の値は境界で読む)', () => {
    expect(parseSlotId('auto')).toBe('auto');
    expect(parseSlotId('manual-3')).toBe('manual-3');
    expect(parseSlotId('manual-4')).toBeNull();
    expect(parseSlotId('')).toBeNull();
  });
});

describe('自動保存 (N tick ごと)', () => {
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  it('開始から N tick 進むたびに 1 回だけ書く (1 フレームで何 tick 飛んでも 1 回)', async () => {
    const writes: number[] = [];
    const auto = createAutosave({ every: 90, startTick: 0, write: (tick) => { writes.push(tick); return Promise.resolve(); }, onError: () => {} });
    for (const t of [30, 89, 90, 150, 179, 180, 600]) {
      auto.onTick(t);
      await nextFrame();
    }
    expect(writes).toEqual([90, 180, 600]);
  });

  it('再開した島では、再開した tick から数える', async () => {
    const writes: number[] = [];
    const auto = createAutosave({ every: 90, startTick: 1000, write: (tick) => { writes.push(tick); return Promise.resolve(); }, onError: () => {} });
    for (const t of [1000, 1089, 1090]) {
      auto.onTick(t);
      await nextFrame();
    }
    expect(writes).toEqual([1090]);
  });

  it('古い保存を読み込んで tick が戻ったら、戻った tick から数え直す', async () => {
    const writes: number[] = [];
    const auto = createAutosave({ every: 90, startTick: 0, write: (tick) => { writes.push(tick); return Promise.resolve(); }, onError: () => {} });
    for (const t of [900, 100, 189, 190]) {
      auto.onTick(t);
      await nextFrame();
    }
    expect(writes).toEqual([900, 190]);
  });

  it('前の書き込みが終わるまで次を書かない (重い serialize を重ねない)', async () => {
    const writes: number[] = [];
    let finish = () => {};
    const auto = createAutosave({
      every: 90,
      startTick: 0,
      write: (tick) => {
        writes.push(tick);
        return new Promise<void>((resolve) => { finish = resolve; });
      },
      onError: () => {},
    });
    auto.onTick(90);
    auto.onTick(180);
    expect(writes).toEqual([90]);
    finish();
    await nextFrame();
    auto.onTick(200);
    expect(writes).toEqual([90, 200]);
  });

  it('書き込みの失敗は onError に渡し、次の周期でまた書く', async () => {
    const writes: number[] = [];
    const errors: unknown[] = [];
    const auto = createAutosave({
      every: 90,
      startTick: 0,
      write: (tick) => {
        writes.push(tick);
        return tick === 90 ? Promise.reject(new Error('quota')) : Promise.resolve();
      },
      onError: (e) => errors.push(e),
    });
    auto.onTick(90);
    await nextFrame();
    auto.onTick(180);
    expect(writes).toEqual([90, 180]);
    expect(errors).toEqual([new Error('quota')]);
  });

  it('自動保存の枠に World を N tick ごとに書き、開き直すと最後に書いた tick から続く', async () => {
    const indexedDB = new IDBFactory();
    const store = await openIslandStore({ indexedDB, now: () => 1000 });
    const a = world();
    const pending: Promise<unknown>[] = [];
    const auto = createAutosave({
      every: 90,
      startTick: 0,
      write: () => {
        const p = store.save('auto', a.serialize());
        pending.push(p);
        return p;
      },
      onError: (e) => { throw e; },
    });
    for (let i = 0; i < 5; i++) {
      a.step(40);
      auto.onTick(a.snapshot().tick);
      await Promise.all(pending);
    }

    const reopened = await openIslandStore({ indexedDB, now: () => 2000 });
    expect((await reopened.load('auto'))?.tick).toBe(120);
  });
});
