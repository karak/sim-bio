import { fail, type Parsed } from '../core/parse';
import type { SaveData } from '../simulation/types';
import { parseChronicle, type Chronicle } from '../harbor/chronicle';
import type { RunnerState } from '../scenario/ScenarioRunner';
import { SLOTS, type PendingSlot, type SlotId, type SlotSummary } from './slots';
import { slotSaveOf, type SlotSave } from './slotSave';

/** 島の手元の保存 (M19-05)。SaveData は数 MB になり localStorage に複数は入らないので IndexedDB に置く */
export type IslandStore = {
  /** 書いた枠の一覧の 1 行を返す (一覧を読み直さずに表示を更新できる) */
  save(slot: SlotId, data: SlotSave): Promise<SlotSummary>;
  /** 包みの無い古い SaveData は自由モードの枠として返す (M19-17) */
  load(slot: PendingSlot): Promise<SlotSave | null>;
  /** ファイルから読んだ違う舞台の包みを、一覧に出さずに置く。移った先で load('import') で読む (M19-17) */
  stashImport(data: SlotSave): Promise<void>;
  /** 保存のある枠だけを SLOTS の順に返す */
  list(): Promise<readonly SlotSummary[]>;
  /** 読めない枠 (版違いなど) を saves の別の key へ移し、枠を空ける。移した先の key を返す */
  setAside(slot: SlotId): Promise<string>;
  /** 石板ごとに最後の年代記を 1 本置く (M19-06)。同じ石板へ書けば上書き */
  saveChronicle(scenarioId: string, c: Chronicle): Promise<void>;
  /** 無ければ null。置き場の値は境界として parseChronicle に通し、読めなければ拒否の理由を返す */
  loadChronicle(scenarioId: string): Promise<Parsed<Chronicle> | null>;
  /**
   * 石板の途中の島 (M19-14)。島・runner の状態・年代記の 3 つを 1 つの transaction で書く (同じ tick のものしか並ばない)。
   * 島と runner は石板ごとに 1 つ (scenarios)、年代記は saveChronicle と同じ置き場 (chronicles) に書く
   */
  saveScenario(scenarioId: string, s: ScenarioSave): Promise<void>;
  /** 無ければ null。年代記は loadChronicle と同じく parseChronicle に通す */
  loadScenario(scenarioId: string): Promise<{ save: SaveData; runner: RunnerState; chronicle: Parsed<Chronicle> } | null>;
  /** 読めない石板の途中の島を scenarios の別の key へ移す。年代記は残す (港への出港に使える)。移した先の key を返す */
  setAsideScenario(scenarioId: string): Promise<string>;
};

/** 石板の途中で閉じた島の続き (M19-14) */
export type ScenarioSave = { save: SaveData; runner: RunnerState; chronicle: Chronicle };

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
  // 版 2 (M19-06): 年代記。key は scenarioId
  (db) => {
    db.createObjectStore('chronicles');
  },
  // 版 3 (M19-09): 港へ出す年代記の outbox と、取り下げ鍵。key はどちらも年代記の id (persist/harborStore.ts)
  (db) => {
    db.createObjectStore('outbox');
    db.createObjectStore('keys');
  },
  // 版 4 (M19-14): 石板の途中の島と runner の状態 ({save, runner})。key は scenarioId
  (db) => {
    db.createObjectStore('scenarios');
  },
  // 版 5 (M19-10・11): 手元の控え (受け取った積荷・回避率に数えた年代記)。key は "received:<積荷の id>" と "counted:<年代記の id>" (persist/harborStore.ts)
  (db) => {
    db.createObjectStore('marks');
  },
  // 版 6 (M19-14 の直し): 判定の出た島 ({chronicle, digest})。key は scenarioId (persist/harborStore.ts)
  (db) => {
    db.createObjectStore('finished');
  },
];

export const requestDone = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// error の event の時点では tx.error がまだ null なので、abort で原因を受け取る
export const transactionDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });

export function openDb(indexedDB: IDBFactory): Promise<IDBDatabase> {
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
      const { save } = data;
      const stage = data.stage === 'free' ? { stage: data.stage } : { stage: data.stage, scenarioId: data.scenarioId };
      const summary: SlotSummary = { slot, savedAt: deps.now(), year: Math.floor(save.tick / save.config.ticksPerYear), ...stage };
      const tx = db.transaction(['saves', 'slots'], 'readwrite');
      tx.objectStore('saves').put(data, slot);
      tx.objectStore('slots').put(summary);
      await transactionDone(tx);
      return summary;
    },
    async load(slot) {
      const raw: unknown = await requestDone(db.transaction('saves').objectStore('saves').get(slot));
      return raw === undefined ? null : slotSaveOf(raw);
    },
    async stashImport(data) {
      const tx = db.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(data, 'import');
      await transactionDone(tx);
    },
    async list() {
      // M19-17 より前の行は舞台を持たない。そのころの枠は自由モードの島だけ
      const rows = (await requestDone<SlotSummary[]>(db.transaction('slots').objectStore('slots').getAll())).map((r): SlotSummary => ('stage' in r ? r : { ...(r as SlotSummary), stage: 'free' }));
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
    async saveChronicle(scenarioId, c) {
      const tx = db.transaction('chronicles', 'readwrite');
      tx.objectStore('chronicles').put(c, scenarioId);
      await transactionDone(tx);
    },
    async loadChronicle(scenarioId) {
      const raw: unknown = await requestDone(db.transaction('chronicles').objectStore('chronicles').get(scenarioId));
      return raw === undefined ? null : parseChronicle(raw);
    },
    async saveScenario(scenarioId, { save, runner, chronicle }) {
      const tx = db.transaction(['scenarios', 'chronicles'], 'readwrite');
      tx.objectStore('scenarios').put({ save, runner }, scenarioId);
      tx.objectStore('chronicles').put(chronicle, scenarioId);
      await transactionDone(tx);
    },
    async loadScenario(scenarioId) {
      const tx = db.transaction(['scenarios', 'chronicles']);
      const [island, raw] = await Promise.all([
        requestDone<{ save: SaveData; runner: RunnerState } | undefined>(tx.objectStore('scenarios').get(scenarioId)),
        requestDone<unknown>(tx.objectStore('chronicles').get(scenarioId)),
      ]);
      if (!island) return null;
      return { ...island, chronicle: raw === undefined ? fail('', 'missing') : parseChronicle(raw) };
    },
    async setAsideScenario(scenarioId) {
      const key = `unreadable:${scenarioId}`;
      const tx = db.transaction('scenarios', 'readwrite');
      const scenarios = tx.objectStore('scenarios');
      const req = scenarios.get(scenarioId);
      req.onsuccess = () => {
        scenarios.put(req.result, key);
        scenarios.delete(scenarioId);
      };
      await transactionDone(tx);
      return key;
    },
  };
}
