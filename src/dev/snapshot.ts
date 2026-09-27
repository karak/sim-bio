import { fail, isObject, type Parsed } from '../core/parse';
import type { Chronicle } from '../harbor/chronicle';
import type { SaveData } from '../simulation/types';
import { SIM_VERSION } from '../simulation/version';

/**
 * 状態の受け渡し (M19-16)。手元の置き場 (IndexedDB の 1 つの DB の全 store) と今の島を JSON 1 つに写し、受入の画面へ送る。
 * AI は受け取った写しを restoreDb で別のブラウザ (Playwright・fake-indexeddb) の置き場へ流し込み、同じ URL を開いて同じ状態を再現する
 */
export type DbDump = {
  name: string;
  /** 0 は置き場がまだ無かった (流し込むと消すだけ) */
  version: number;
  stores: Record<string, { keyPath: string | null; entries: [IDBValidKey, unknown][] }>;
};

export const SNAPSHOT_FORMAT = 'biotope-dev-snapshot/1';

export type DevSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  createdAt: string;
  /** 写したときの画面の URL。再現ではこの道を開く */
  url: string;
  player: string | null;
  simVersion: string;
  db: DbDump;
  /** 今の島。置き場の自動保存より新しい (写す直前の島) */
  current: { save: SaveData; chronicle: Chronicle | null };
};

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** 置き場を開かずに作らない: まだ無い DB を開いたら、作る transaction を取り消して空の写しにする */
export async function dumpDb(indexedDB: IDBFactory, name: string): Promise<DbDump> {
  const req = indexedDB.open(name);
  let fresh = false;
  req.onupgradeneeded = () => {
    fresh = true;
    req.transaction?.abort();
  };
  const db = await done(req).catch((e: unknown) => {
    if (fresh) return null;
    throw e;
  });
  if (!db) return { name, version: 0, stores: {} };
  try {
    const names = [...db.objectStoreNames];
    if (names.length === 0) return { name, version: db.version, stores: {} };
    const tx = db.transaction(names);
    const rows = await Promise.all(
      names.map(async (n) => {
        const store = tx.objectStore(n);
        // 同じ transaction の getAllKeys と getAll は、同じ中身を同じ鍵の順で返す
        const [keys, values] = await Promise.all([done(store.getAllKeys()), done(store.getAll())]);
        const keyPath = typeof store.keyPath === 'string' ? store.keyPath : null;
        return [n, { keyPath, entries: keys.map((k, i): [IDBValidKey, unknown] => [k, values[i]]) }] as const;
      }),
    );
    return { name, version: db.version, stores: Object.fromEntries(rows) };
  } finally {
    db.close();
  }
}

export async function captureSnapshot(deps: {
  indexedDB: IDBFactory;
  dbName: string;
  url: string;
  player: string | null;
  current: DevSnapshot['current'];
  now: () => number;
}): Promise<DevSnapshot> {
  return {
    format: SNAPSHOT_FORMAT,
    createdAt: new Date(deps.now()).toISOString(),
    url: deps.url,
    player: deps.player,
    simVersion: SIM_VERSION,
    db: await dumpDb(deps.indexedDB, deps.dbName),
    current: deps.current,
  };
}

/**
 * 写しを置き場へ流し込む。今の中身は消す (写しの状態だけになる)。
 * 外の名前を使わない (Playwright の fixture が toString で page に渡し、画面の中で動かす。tests/fixtures/devSnapshot.ts)
 */
export async function restoreDb(indexedDB: IDBFactory, dump: DbDump): Promise<void> {
  const settle = <T>(req: IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  await settle(indexedDB.deleteDatabase(dump.name));
  if (dump.version === 0) return;
  const open = indexedDB.open(dump.name, dump.version);
  open.onupgradeneeded = () => {
    for (const [n, s] of Object.entries(dump.stores)) open.result.createObjectStore(n, s.keyPath === null ? undefined : { keyPath: s.keyPath });
  };
  const db = await settle(open);
  const names = Object.keys(dump.stores);
  if (names.length > 0) {
    const tx = db.transaction(names, 'readwrite');
    for (const [n, s] of Object.entries(dump.stores)) {
      const store = tx.objectStore(n);
      for (const [k, v] of s.entries) {
        if (s.keyPath === null) store.put(v, k);
        else store.put(v);
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  }
  db.close();
}

/** 受入の画面のサーバーから読んだ写しの境界。中身の島 (SaveData) は World.restore が確かめる */
export function parseDevSnapshot(raw: unknown): Parsed<DevSnapshot> {
  if (!isObject(raw) || raw.format !== SNAPSHOT_FORMAT) return fail('format', 'unknown');
  for (const k of ['url', 'createdAt', 'simVersion'] as const) if (typeof raw[k] !== 'string') return fail(k, 'invalid');
  if (raw.player !== null && typeof raw.player !== 'string') return fail('player', 'invalid');
  const db = raw.db;
  if (!isObject(db) || typeof db.name !== 'string' || typeof db.version !== 'number' || !isObject(db.stores)) return fail('db', 'invalid');
  for (const [n, s] of Object.entries(db.stores)) {
    if (!isObject(s) || !Array.isArray(s.entries) || (s.keyPath !== null && typeof s.keyPath !== 'string')) return fail(`db.stores.${n}`, 'invalid');
  }
  if (!isObject(raw.current) || !isObject(raw.current.save)) return fail('current.save', 'invalid');
  return { ok: true, value: raw as DevSnapshot };
}
