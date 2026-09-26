import type { SaveData } from '../simulation/types';
import { SLOTS, type SlotId, type SlotSummary } from './slots';

/** 島の手元の保存 (M19-05)。SaveData は数 MB になり localStorage に複数は入らないので IndexedDB に置く */
export type IslandStore = {
  /** 書いた枠の一覧の 1 行を返す (一覧を読み直さずに表示を更新できる) */
  save(slot: SlotId, data: SaveData): Promise<SlotSummary>;
  load(slot: SlotId): Promise<SaveData | null>;
  /** 保存のある枠だけを SLOTS の順に返す */
  list(): Promise<readonly SlotSummary[]>;
  /** 読めない枠 (版違いなど) を saves の別の key へ移し、枠を空ける。移した先の key を返す */
  setAside(slot: SlotId): Promise<string>;
};

const DB_NAME = 'biotope-island';
/**
 * 版 n への移行は UPGRADES[n - 1]。年代記 (M19-06) や outbox・取り下げ鍵 (M19-09) の store は、使う版で末尾に足す。
 * 並びを変えたり消したりすると、既に開いた利用者の DB と食い違う。
 * slots は一覧の行だけを持つ。一覧のために saves を読むと、Chromium で 4 枠 130 ms ほどかかる (size 128)
 */
const UPGRADES: readonly ((db: IDBDatabase) => void)[] = [
  (db) => {
    db.createObjectStore('saves');
    db.createObjectStore('slots', { keyPath: 'slot' });
  },
];

const requestDone = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// error の event の時点では tx.error がまだ null なので、abort で原因を受け取る
const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
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
  return {
    async save(slot, data) {
      const summary: SlotSummary = { slot, savedAt: deps.now(), year: Math.floor(data.tick / data.config.ticksPerYear) };
      const tx = db.transaction(['saves', 'slots'], 'readwrite');
      tx.objectStore('saves').put(data, slot);
      tx.objectStore('slots').put(summary);
      await transactionDone(tx);
      return summary;
    },
    async load(slot) {
      const data: SaveData | undefined = await requestDone(db.transaction('saves').objectStore('saves').get(slot));
      return data ?? null;
    },
    async list() {
      const rows: SlotSummary[] = await requestDone(db.transaction('slots').objectStore('slots').getAll());
      return rows.sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot));
    },
    async setAside(slot) {
      const key = `unreadable:${slot}`;
      const tx = db.transaction(['saves', 'slots'], 'readwrite');
      const saves = tx.objectStore('saves');
      const req = saves.get(slot);
      req.onsuccess = () => {
        saves.put(req.result, key);
        saves.delete(slot);
        tx.objectStore('slots').delete(slot);
      };
      await transactionDone(tx);
      return key;
    },
  };
}
