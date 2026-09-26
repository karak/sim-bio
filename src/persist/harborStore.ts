import type { Chronicle, Digest } from '../harbor/chronicle';
import { parseChronicleId, parseWithdrawKey, type ChronicleId, type InscriptionId, type WithdrawKey } from '../harbor/contract';
import { openDb, requestDone, transactionDone } from './islandStore';

/** 港へ出す 1 件 (M19-09)。閉港のあいだ outbox に置き、同じ id・同じ鍵で送り直す */
export type Outbound = { id: ChronicleId; chronicle: Chronicle; digest: Digest; inscription: InscriptionId };

/**
 * 港のクライアントの手元の置き場 (設計書 §3.1 の outbox・keys)。島の置き場 (islandStore) と同じ DB の別の store に置く。
 * outbox の値は境界として港のクライアントがカタログで parse し直すので、ここは unknown で返す
 */
export type HarborStore = {
  /** id ごとに 1 つ。同じ年代記を 2 度入れても 1 つ */
  enqueue(o: Outbound): Promise<void>;
  queued(): Promise<readonly unknown[]>;
  dequeue(id: string): Promise<void>;
  /** 置いた鍵があればそれを、無ければ fresh() を置いて返す。1 つの transaction で読んで書くので、出港と再送が別の鍵を置かない */
  claimKey(id: ChronicleId, fresh: () => WithdrawKey): Promise<WithdrawKey>;
  /** 読めない鍵 (形の壊れた値) は持っていないものとして null */
  keyOf(id: ChronicleId): Promise<WithdrawKey | null>;
  forgetKey(id: ChronicleId): Promise<void>;
  /** 読める鍵を持つ年代記 (自分が出港したもの) */
  ownIds(): Promise<ReadonlySet<ChronicleId>>;
};

const readKey = (v: unknown): WithdrawKey | null => {
  const k = parseWithdrawKey(v);
  return k.ok ? k.value : null;
};

const ownOf = (entries: Iterable<[unknown, unknown]>): ReadonlySet<ChronicleId> => {
  const ids = new Set<ChronicleId>();
  for (const [id, key] of entries) {
    const parsed = parseChronicleId(id);
    if (parsed.ok && readKey(key) !== null) ids.add(parsed.value);
  }
  return ids;
};

export async function openHarborStore(deps: { indexedDB: IDBFactory }): Promise<HarborStore> {
  const db = await openDb(deps.indexedDB);
  const write = async (store: 'outbox' | 'keys', f: (s: IDBObjectStore) => void) => {
    const tx = db.transaction(store, 'readwrite');
    f(tx.objectStore(store));
    await transactionDone(tx);
  };
  return {
    enqueue: (o) => write('outbox', (s) => s.put(o, o.id)),
    queued: () => requestDone<unknown[]>(db.transaction('outbox').objectStore('outbox').getAll()),
    dequeue: (id) => write('outbox', (s) => s.delete(id)),
    async claimKey(id, fresh) {
      const tx = db.transaction('keys', 'readwrite');
      const keys = tx.objectStore('keys');
      const claimed = new Promise<WithdrawKey>((resolve) => {
        const req = keys.get(id);
        req.onsuccess = () => {
          const key = readKey(req.result) ?? fresh();
          if (key !== req.result) keys.put(key, id);
          resolve(key);
        };
      });
      await transactionDone(tx);
      return claimed;
    },
    keyOf: async (id) => readKey(await requestDone<unknown>(db.transaction('keys').objectStore('keys').get(id))),
    forgetKey: (id) => write('keys', (s) => s.delete(id)),
    async ownIds() {
      const store = db.transaction('keys').objectStore('keys');
      const [ids, keys] = await Promise.all([requestDone<IDBValidKey[]>(store.getAllKeys()), requestDone<unknown[]>(store.getAll())]);
      return ownOf(ids.map((id, i) => [id, keys[i]]));
    },
  };
}

/** IndexedDB が開けないとき (プライベートの窓など)。outbox はそのタブの間だけ残る */
export function createMemoryHarborStore(): HarborStore {
  const outbox = new Map<string, Outbound>();
  const keys = new Map<ChronicleId, WithdrawKey>();
  return {
    enqueue: async (o) => void outbox.set(o.id, structuredClone(o)),
    queued: async () => [...outbox.values()].map((o) => structuredClone(o)),
    dequeue: async (id) => void outbox.delete(id),
    async claimKey(id, fresh) {
      const claimed = readKey(keys.get(id)) ?? fresh();
      keys.set(id, claimed);
      return claimed;
    },
    keyOf: async (id) => readKey(keys.get(id)),
    forgetKey: async (id) => void keys.delete(id),
    ownIds: async () => ownOf(keys.entries()),
  };
}
