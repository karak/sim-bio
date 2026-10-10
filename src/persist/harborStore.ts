import { parseChronicleId, parseWithdrawKey, type ChronicleId, type WithdrawKey } from '../harbor/contract';
import type { HarborStore, Mark, Outbound } from '../harbor/store';
import { openDb, requestDone, transactionDone } from './islandStore';

const markKey = (m: Mark) => `${m.kind}:${m.id}`;

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

export async function openHarborStore(deps: { indexedDB: IDBFactory; dbName?: string }): Promise<HarborStore> {
  const db = await openDb(deps.indexedDB, deps.dbName);
  const write = async (store: 'outbox' | 'keys' | 'marks' | 'finished', f: (s: IDBObjectStore) => void) => {
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
      // 同じ transaction の getAllKeys と getAll は、同じ中身を同じ鍵の順で返す
      const [ids, keys] = await Promise.all([requestDone<IDBValidKey[]>(store.getAllKeys()), requestDone<unknown[]>(store.getAll())]);
      return ownOf(ids.map((id, i) => [id, keys[i]]));
    },
    async claim(m) {
      const tx = db.transaction('marks', 'readwrite');
      const marks = tx.objectStore('marks');
      const claimed = new Promise<boolean>((resolve) => {
        const req = marks.getKey(markKey(m));
        req.onsuccess = () => {
          if (req.result === undefined) marks.put(true, markKey(m));
          resolve(req.result === undefined);
        };
      });
      await transactionDone(tx);
      return claimed;
    },
    has: async (m) => (await requestDone(db.transaction('marks').objectStore('marks').getKey(markKey(m)))) !== undefined,
    release: (m) => write('marks', (s) => s.delete(markKey(m))),
    keepFinished: (scenarioId, island) => write('finished', (s) => s.put(island, scenarioId)),
    finishedOf: async (scenarioId) => (await requestDone<unknown>(db.transaction('finished').objectStore('finished').get(scenarioId))) ?? null,
  };
}

/** IndexedDB が開けないとき (プライベートの窓など)。outbox はそのタブの間だけ残る */
export function createMemoryHarborStore(): HarborStore {
  const outbox = new Map<string, Outbound>();
  const keys = new Map<ChronicleId, WithdrawKey>();
  const marks = new Set<string>();
  const finished = new Map<string, unknown>();
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
    async claim(m) {
      if (marks.has(markKey(m))) return false;
      marks.add(markKey(m));
      return true;
    },
    has: async (m) => marks.has(markKey(m)),
    release: async (m) => void marks.delete(markKey(m)),
    keepFinished: async (scenarioId, island) => void finished.set(scenarioId, structuredClone(island)),
    finishedOf: async (scenarioId) => structuredClone(finished.get(scenarioId)) ?? null,
  };
}
