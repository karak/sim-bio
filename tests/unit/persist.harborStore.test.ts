import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { digestOf } from '../../src/chronicle/digest';
import type { CargoId, ChronicleId, InscriptionId, WithdrawKey } from '../../src/harbor/contract';
import { createMemoryHarborStore, openHarborStore, type HarborStore, type Outbound } from '../../src/persist/harborStore';
import { openIslandStore } from '../../src/persist/islandStore';
import { FIXTURE_CHRONICLE, FIXTURE_CHRONICLE_ID } from '../fixtures/chronicle';

const id = FIXTURE_CHRONICLE_ID as ChronicleId;
const other = 'a'.repeat(64) as ChronicleId;
const keyA = 'A'.repeat(43) as WithdrawKey;
const keyB = 'B'.repeat(43) as WithdrawKey;
const outbound: Outbound = { id, chronicle: FIXTURE_CHRONICLE, digest: await digestOf({ year: 3, totals: { deer: 1 } }, 'alive'), inscription: 'still-here' as InscriptionId };

const STORES: [string, () => Promise<HarborStore>][] = [
  ['IndexedDB', () => openHarborStore({ indexedDB: new IDBFactory() })],
  ['メモリ (IndexedDB が開けないとき)', async () => createMemoryHarborStore()],
];

describe.each(STORES)('港の手元の置き場 (M19-09、%s)', (_name, open) => {
  it('outbox は id ごとに 1 つ。同じ年代記を 2 度入れても 1 つで、出したら消える', async () => {
    const store = await open();
    await store.enqueue(outbound);
    await store.enqueue(outbound);
    expect(await store.queued()).toEqual([outbound]);
    await store.dequeue(id);
    expect(await store.queued()).toEqual([]);
  });

  it('取り下げ鍵は最初に置いたものが残る (outbox の再送も同じ鍵で送る)', async () => {
    const store = await open();
    expect(await store.claimKey(id, () => keyA)).toBe(keyA);
    expect(await store.claimKey(id, () => keyB)).toBe(keyA);
    expect(await store.keyOf(id)).toBe(keyA);
    expect(await store.keyOf(other)).toBeNull();
  });

  it('鍵を持つ年代記の id を返し、取り下げたら鍵を消す', async () => {
    const store = await open();
    await store.claimKey(id, () => keyA);
    await store.claimKey(other, () => keyB);
    expect([...(await store.ownIds())].sort()).toEqual([other, id].sort());
    await store.forgetKey(id);
    expect(await store.keyOf(id)).toBeNull();
    expect([...(await store.ownIds())]).toEqual([other]);
  });

  it('控え (M19-10・11): 最初の claim だけが true。release すれば、もう一度 claim できる。受け取りと数えは別の控え', async () => {
    const store = await open();
    const cargo = { kind: 'received', id: 'c0ffee' as CargoId } as const;
    expect(await store.has(cargo)).toBe(false);
    expect(await store.claim(cargo)).toBe(true);
    expect(await store.has(cargo)).toBe(true);
    expect(await store.claim(cargo)).toBe(false);
    expect(await store.has({ kind: 'counted', id: 'c0ffee' as ChronicleId })).toBe(false);
    expect(await store.claim({ kind: 'counted', id })).toBe(true);
    expect(await store.claim({ kind: 'received', id: 'beef' as CargoId })).toBe(true);
    await store.release(cargo);
    expect(await store.has(cargo)).toBe(false);
    expect(await store.claim(cargo)).toBe(true);
    expect(await store.claim({ kind: 'counted', id })).toBe(false);
  });

  it('判定の出た島 (M19-14 の直し) は石板ごとに最後の 1 つ。無い石板は null', async () => {
    const store = await open();
    expect(await store.finishedOf('sinking')).toBeNull();
    await store.keepFinished('sinking', { chronicle: FIXTURE_CHRONICLE, digest: outbound.digest });
    await store.keepFinished('sinking', { chronicle: { ...FIXTURE_CHRONICLE, seed: 7 }, digest: outbound.digest });
    expect(await store.finishedOf('sinking')).toEqual({ chronicle: { ...FIXTURE_CHRONICLE, seed: 7 }, digest: outbound.digest });
    expect(await store.finishedOf('tower')).toBeNull();
  });

  it('同時の claim も 1 つだけが true (受け取るを二度押しても、1 回しか受け取らない)', async () => {
    const store = await open();
    const cargo = { kind: 'received', id: 'c0ffee' as CargoId } as const;
    expect(await Promise.all([store.claim(cargo), store.claim(cargo), store.claim(cargo)])).toEqual([true, false, false]);
  });
});

describe('港の手元の置き場 (IndexedDB の版)', () => {
  it('島の置き場と同じ DB に並び、島の保存 (M19-05・06) の store を壊さない', async () => {
    const indexedDB = new IDBFactory();
    const island = await openIslandStore({ indexedDB, now: () => 1 });
    await island.saveChronicle('sinking', FIXTURE_CHRONICLE);
    const harbor = await openHarborStore({ indexedDB });
    await harbor.enqueue(outbound);
    expect(await island.loadChronicle('sinking')).toEqual({ ok: true, value: FIXTURE_CHRONICLE });
    expect(await harbor.queued()).toEqual([outbound]);
  });

  it('置き場の鍵が壊れていれば (手で書き換えた) 持っていないものとして扱う', async () => {
    const indexedDB = new IDBFactory();
    const harbor = await openHarborStore({ indexedDB });
    await harbor.claimKey(id, () => 'short' as WithdrawKey);
    expect(await harbor.keyOf(id)).toBeNull();
    expect([...(await harbor.ownIds())]).toEqual([]);
  });

  it('判定の出た島は開き直しても残る', async () => {
    const indexedDB = new IDBFactory();
    await (await openHarborStore({ indexedDB })).keepFinished('sinking', { chronicle: FIXTURE_CHRONICLE, digest: outbound.digest });
    expect(await (await openHarborStore({ indexedDB })).finishedOf('sinking')).toEqual({ chronicle: FIXTURE_CHRONICLE, digest: outbound.digest });
  });

  it('控え (M19-10・11) は開き直しても残る', async () => {
    const indexedDB = new IDBFactory();
    const first = await openHarborStore({ indexedDB });
    await first.claim({ kind: 'received', id: 'c0ffee' as CargoId });
    const again = await openHarborStore({ indexedDB });
    expect(await again.claim({ kind: 'received', id: 'c0ffee' as CargoId })).toBe(false);
  });
});
