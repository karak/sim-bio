import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { ChronicleId, WithdrawKey } from '../../src/harbor/contract';
import { openHarborStore } from '../../src/persist/harborStore';
import { openIslandStore } from '../../src/persist/islandStore';
import { captureSnapshot, parseDevSnapshot, restoreDb } from '../../src/dev/snapshot';
import { FIXTURE_CHRONICLE } from '../fixtures/chronicle';
import { testConfig } from './helpers';

const id = 'a'.repeat(64) as ChronicleId;
const key = 'K'.repeat(43) as WithdrawKey;

async function seeded(dbName: string) {
  const indexedDB = new IDBFactory();
  const island = await openIslandStore({ indexedDB, now: () => 1000, dbName });
  const harbor = await openHarborStore({ indexedDB, dbName });
  const world = World.create(testConfig(), { log: createMemorySink() });
  world.step(400);
  await island.save('manual-2', { stage: 'free', save: world.serialize() });
  await island.saveChronicle('sinking', FIXTURE_CHRONICLE);
  await harbor.claimKey(id, () => key);
  await harbor.claim({ kind: 'counted', id });
  return { indexedDB, world };
}

describe('状態の受け渡し (M19-16)', () => {
  it('手元の置き場を JSON に写し、別のブラウザの置き場へ流し込むと、枠・年代記・取り下げ鍵・控えが同じに読める', async () => {
    const { indexedDB, world } = await seeded('biotope-island@alice');
    const snap = await captureSnapshot({
      indexedDB,
      dbName: 'biotope-island@alice',
      url: 'http://localhost:8787/?scenario=sinking&player=alice',
      player: 'alice',
      current: { save: world.serialize(), chronicle: FIXTURE_CHRONICLE },
      now: () => Date.UTC(2026, 8, 27),
    });
    const parsed = parseDevSnapshot(JSON.parse(JSON.stringify(snap)));
    if (!parsed.ok) throw new Error(parsed.error.reason);

    const other = new IDBFactory();
    await restoreDb(other, parsed.value.db);
    const island = await openIslandStore({ indexedDB: other, now: () => 2000, dbName: 'biotope-island@alice' });
    const harbor = await openHarborStore({ indexedDB: other, dbName: 'biotope-island@alice' });
    expect(await island.list()).toEqual([{ slot: 'manual-2', savedAt: 1000, year: 1, stage: 'free' }]);
    expect((await island.load('manual-2'))?.save.tick).toBe(400);
    expect(await island.loadChronicle('sinking')).toEqual({ ok: true, value: FIXTURE_CHRONICLE });
    expect(await harbor.keyOf(id)).toBe(key);
    expect(await harbor.has({ kind: 'counted', id })).toBe(true);
    expect(parsed.value).toMatchObject({ format: 'biotope-dev-snapshot/1', createdAt: '2026-09-27T00:00:00.000Z', player: 'alice', url: 'http://localhost:8787/?scenario=sinking&player=alice' });
    expect(World.restore(parsed.value.current.save, { log: createMemorySink() }).snapshot().tick).toBe(400);
  });

  it('流し込む前の置き場の中身は残さない (写しの状態だけになる)', async () => {
    const { indexedDB } = await seeded('biotope-island');
    const snap = await captureSnapshot({ indexedDB: new IDBFactory(), dbName: 'biotope-island', url: 'http://localhost/', player: null, current: { save: World.create(testConfig(), { log: createMemorySink() }).serialize(), chronicle: null }, now: () => 0 });

    await restoreDb(indexedDB, snap.db);
    const island = await openIslandStore({ indexedDB, now: () => 1 });
    expect(await island.list()).toEqual([]);
    expect(await island.loadChronicle('sinking')).toBeNull();
  });

  it.each([
    ['形の違う JSON', { format: 'other' }],
    ['置き場の無い写し', { format: 'biotope-dev-snapshot/1', url: 'x', createdAt: 'x', player: null, current: {}, db: null }],
  ])('%s は読まない', (_name, raw) => {
    expect(parseDevSnapshot(raw).ok).toBe(false);
  });
});
