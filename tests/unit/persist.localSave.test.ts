import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { openIslandStore, type IslandStore } from '../../src/persist/islandStore';
import { createLocalSave, type SaveLog } from '../../src/persist/localSave';
import type { SaveData } from '../../src/simulation/types';
import type { SlotSummary } from '../../src/persist/slots';
import { testConfig } from './helpers';

const EVERY = 90;

/** 置き場の API を通さず、saves の key を直に読む (脇へ退けた記録を確かめる) */
const rawSave = (indexedDB: IDBFactory, key: string): Promise<SaveData | undefined> =>
  new Promise((resolve, reject) => {
    const open = indexedDB.open('biotope-island');
    open.onsuccess = () => {
      const req = open.result.transaction('saves').objectStore('saves').get(key);
      req.onsuccess = () => resolve(req.result as SaveData | undefined);
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });
const settle = () => new Promise((r) => setTimeout(r, 0));
const world = () => World.create(testConfig(), { log: createMemorySink() });
const restore = (s: SaveData) => World.restore(s, { log: createMemorySink() });

type Logged = { level: string; event: string; tick: number } & Record<string, unknown>;

async function setup(opts: { mode?: 'free' | 'scenario'; store?: IslandStore | null; indexedDB?: IDBFactory } = {}) {
  const indexedDB = opts.indexedDB ?? new IDBFactory();
  const store = opts.store === undefined ? await openIslandStore({ indexedDB, now: () => 1000 }) : opts.store;
  const logs: Logged[] = [];
  const saved: SlotSummary[] = [];
  const log: SaveLog = (level, event, tick, extra = {}) => logs.push({ level, event, tick, ...extra });
  const local = createLocalSave({ store, mode: opts.mode ?? 'free', every: EVERY, log, onSaved: (s) => saved.push(s) });
  const autoTick = async () => (await store?.load('auto'))?.tick ?? null;
  return { local, store, logs, saved, autoTick, indexedDB };
}

/** 1 フレームずつ n tick 進めて onTick を呼び、書き込みを待つ */
async function play(local: ReturnType<typeof createLocalSave>, w: World, frames: number, ticksPerFrame: number) {
  for (let i = 0; i < frames; i++) {
    w.step(ticksPerFrame);
    local.onTick(w.snapshot().tick, () => w.serialize());
    await settle();
  }
}

describe('自動保存 (M19-05、N tick ごと)', () => {
  it('前に書いてから N tick 進んだフレームで 1 回だけ書く (40 tick のフレームなら 120・240・360・480)', async () => {
    const { local, logs } = await setup();
    const w = world();
    await play(local, w, 12, 40);
    expect(logs.filter((l) => l.event === 'persist.saved').map((l) => l.tick)).toEqual([120, 240, 360, 480]);
  });

  it('前の書き込みが終わるまで次を書かない (serialize を重ねない)', async () => {
    let serialized = 0;
    const { local } = await setup();
    const w = world();
    const serialize = () => {
      serialized++;
      return w.serialize();
    };
    w.step(100);
    local.onTick(100, serialize);
    w.step(100);
    local.onTick(200, serialize);
    expect(serialized).toBe(1);
    await settle();
    local.onTick(200, serialize);
    expect(serialized).toBe(2);
  });

  it('シナリオでは自動の枠に書かない', async () => {
    const { local, autoTick } = await setup({ mode: 'scenario' });
    const w = world();
    await play(local, w, 5, 90);
    local.flush(() => w.serialize());
    await settle();
    expect(await autoTick()).toBeNull();
  });
});

describe('閉じて開き直すと続きから (M19-05)', () => {
  it('自由モードは自動の枠の島から再開し、そこから N tick 数えて書く', async () => {
    const first = await setup();
    const w = world();
    await play(first.local, w, 3, 100);

    const second = await setup({ indexedDB: first.indexedDB });
    const resumed = await second.local.resume(restore);
    expect(resumed?.snapshot().tick).toBe(300);
    expect(second.logs).toEqual([expect.objectContaining({ event: 'persist.resumed', slot: 'auto', tick: 300 })]);
    if (!resumed) throw new Error('not resumed');
    await play(second.local, resumed, 1, 89);
    expect(await second.autoTick()).toBe(300);
    await play(second.local, resumed, 1, 1);
    expect(await second.autoTick()).toBe(390);
  });

  it('シナリオは自動の枠から戻さない (シナリオ中の読込は予言と矛盾する)', async () => {
    const first = await setup();
    await play(first.local, world(), 1, 100);
    const scenario = await setup({ mode: 'scenario', indexedDB: first.indexedDB });
    expect(await scenario.local.resume(restore)).toBeNull();
    expect(await scenario.autoTick()).toBe(100);
  });

  it('自動の枠が空なら null (新しい島で始める)', async () => {
    const { local, logs } = await setup();
    expect(await local.resume(restore)).toBeNull();
    expect(logs).toEqual([]);
  });

  it('タブが隠れたら、周期を待たずに今の島を書く (一時停止中の島も残る)', async () => {
    const { local, autoTick } = await setup();
    const w = world();
    w.step(37);
    local.flush(() => w.serialize());
    await settle();
    expect(await autoTick()).toBe(37);
  });

  it('読み込んだ・新しくした島は、その場で自動の枠に書き、そこから数え直す', async () => {
    const { local, autoTick } = await setup();
    const old = world();
    await play(local, old, 1, 900);
    expect(await autoTick()).toBe(900);

    const loaded = world();
    loaded.step(100);
    local.replaced(loaded.serialize());
    await settle();
    expect(await autoTick()).toBe(100);
    await play(local, loaded, 1, 89);
    expect(await autoTick()).toBe(100);
    await play(local, loaded, 1, 1);
    expect(await autoTick()).toBe(190);
  });

  it('読めない自動の枠 (版違いなど) からは再開せず、脇へ退けて残し、新しい島を普段どおり自動保存する', async () => {
    const first = await setup();
    await play(first.local, world(), 1, 100);
    const second = await setup({ indexedDB: first.indexedDB });
    const broken = () => {
      throw new Error('unsupported save version');
    };
    expect(await second.local.resume(broken)).toBeNull();
    expect(second.logs).toEqual([
      expect.objectContaining({ level: 'warn', event: 'persist.resume.failed', error: 'Error: unsupported save version', setAside: 'unreadable:auto' }),
    ]);
    expect(await second.autoTick()).toBeNull();
    expect(await second.local.list()).toEqual([]);
    expect((await rawSave(first.indexedDB, 'unreadable:auto'))?.tick).toBe(100);

    const fresh = world();
    await play(second.local, fresh, 1, 90);
    expect(await second.autoTick()).toBe(90);
  });
});

describe('手動の枠 (M19-05)', () => {
  it('枠へ保存すると一覧の行を返し、枠から読み込める。自動の枠は変わらない', async () => {
    const { local, saved, autoTick } = await setup();
    const w = world();
    w.step(400);
    await local.saveSlot('manual-1', w.serialize());
    expect(saved).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 1 }]);
    expect((await local.loadSlot('manual-1', restore))?.snapshot().tick).toBe(400);
    expect(await local.list()).toEqual([{ slot: 'manual-1', savedAt: 1000, year: 1 }]);
    expect(await autoTick()).toBeNull();
  });

  it('枠の島が読めない (restore が投げる) ときは null を返し、warn の記録に原因を残す', async () => {
    const { local, logs } = await setup();
    await local.saveSlot('manual-3', world().serialize());
    const broken = () => {
      throw new Error('unsupported save version');
    };
    expect(await local.loadSlot('manual-3', broken)).toBeNull();
    expect(logs.filter((l) => l.level === 'warn')).toEqual([
      expect.objectContaining({ event: 'persist.load.failed', slot: 'manual-3', error: 'Error: unsupported save version' }),
    ]);
  });

  it('書き込みの失敗は warn の記録に原因を残し、例外にしない', async () => {
    const failing: IslandStore = {
      save: () => Promise.reject(new Error('QuotaExceededError')),
      load: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      setAside: () => Promise.resolve('unreadable:auto'),
    };
    const { local, logs, saved } = await setup({ store: failing });
    await local.saveSlot('manual-2', world().serialize());
    expect(saved).toEqual([]);
    expect(logs).toEqual([expect.objectContaining({ level: 'warn', event: 'persist.save.failed', slot: 'manual-2', error: 'Error: QuotaExceededError' })]);
  });

  it('IndexedDB が使えない (store が null) ときは何も書かず、枠は空として振る舞う', async () => {
    const { local, saved } = await setup({ store: null });
    const w = world();
    await play(local, w, 2, 100);
    await local.saveSlot('manual-1', w.serialize());
    expect(saved).toEqual([]);
    expect(await local.resume(restore)).toBeNull();
    expect(await local.loadSlot('manual-1', restore)).toBeNull();
    expect(await local.list()).toEqual([]);
  });
});
