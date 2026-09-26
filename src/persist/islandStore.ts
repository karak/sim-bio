import type { SaveData } from '../simulation/types';

export const MANUAL_SLOTS = ['manual-1', 'manual-2', 'manual-3'] as const;
export type ManualSlot = (typeof MANUAL_SLOTS)[number];
export type SlotId = 'auto' | ManualSlot;
export const SLOTS: readonly SlotId[] = ['auto', ...MANUAL_SLOTS];

export type SlotSummary = { slot: SlotId; savedAt: number; year: number };
type SaveRecord = SlotSummary & { data: SaveData };

/** 島の手元の保存 (M19-05)。SaveData は数 MB になり localStorage に複数は入らないので IndexedDB に置く */
export type IslandStore = {
  /** 書いた枠の一覧の 1 行を返す (一覧を読み直さずに表示を更新できる) */
  save(slot: SlotId, data: SaveData): Promise<SlotSummary>;
  load(slot: SlotId): Promise<SaveData | null>;
  /** 保存のある枠だけを SLOTS の順に返す */
  list(): Promise<readonly SlotSummary[]>;
};

const DB_NAME = 'biotope-island';
/**
 * 版 n への移行は UPGRADES[n - 1]。年代記 (M19-06) や outbox・取り下げ鍵 (M19-09) の store は、使う版で末尾に足す。
 * 並びを変えたり消したりすると、既に開いた利用者の DB と食い違う
 */
const UPGRADES: readonly ((db: IDBDatabase) => void)[] = [(db) => db.createObjectStore('saves', { keyPath: 'slot' })];

export function parseSlotId(value: string): SlotId | null {
  return SLOTS.find((s) => s === value) ?? null;
}

const requestDone = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

function openDb(indexedDB: IDBFactory): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, UPGRADES.length);
  req.onupgradeneeded = (e) => {
    for (const upgrade of UPGRADES.slice(e.oldVersion)) upgrade(req.result);
  };
  return requestDone(req).then((db) => {
    // 別のタブが新しい版で開こうとしたら譲る。握ったままだと向こうの移行が止まる
    db.onversionchange = () => db.close();
    return db;
  });
}

export async function openIslandStore(deps: { indexedDB: IDBFactory; now: () => number }): Promise<IslandStore> {
  const db = await openDb(deps.indexedDB);
  const saves = (mode: IDBTransactionMode) => db.transaction('saves', mode).objectStore('saves');
  return {
    async save(slot, data) {
      const summary: SlotSummary = { slot, savedAt: deps.now(), year: Math.floor(data.tick / data.config.ticksPerYear) };
      const store = saves('readwrite');
      store.put({ ...summary, data } satisfies SaveRecord);
      await transactionDone(store.transaction);
      return summary;
    },
    async load(slot) {
      const record: SaveRecord | undefined = await requestDone(saves('readonly').get(slot));
      return record?.data ?? null;
    },
    async list() {
      const records: SaveRecord[] = await requestDone(saves('readonly').getAll());
      return records
        .map(({ slot, savedAt, year }) => ({ slot, savedAt, year }))
        .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    },
  };
}
