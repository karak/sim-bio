import type { SaveData } from '../simulation/types';
import type { IslandStore } from './islandStore';
import type { ManualSlot, SlotId, SlotSummary } from './slots';

export type SaveLog = (level: 'info' | 'warn', event: string, tick: number, extra?: Record<string, unknown>) => void;

/** 手元の保存の方針 (M19-05)。どの島をいつ自動の枠に書き、どこから再開するかをここで決める。書き込みの失敗は記録に残して投げない */
export type LocalSave = {
  /** 自由モードで自動の枠があれば、その島を restore して返す */
  resume<W>(restore: (save: SaveData) => W): Promise<W | null>;
  /** 毎フレーム。前に書いてから every tick 進んだら自動の枠に書く */
  onTick(tick: number, serialize: () => SaveData): void;
  /** 読込・新しい島で島を差し替えた直後。自動の枠をその島にし、そこから数え直す */
  replaced(save: SaveData): void;
  /** タブが隠れたとき (閉じる直前を含む)。周期を待たずに書く */
  flush(serialize: () => SaveData): void;
  saveSlot(slot: ManualSlot, save: SaveData): Promise<void>;
  loadSlot(slot: SlotId): Promise<SaveData | null>;
  list(): Promise<readonly SlotSummary[]>;
};

export function createLocalSave(deps: {
  /** IndexedDB が開けなければ null。何も書かず、枠は空として振る舞う */
  store: IslandStore | null;
  /** シナリオの島は自動の枠から戻さず、書きもしない (runner の状態は SaveData に無く、シナリオ中の読込は予言と矛盾する) */
  mode: 'free' | 'scenario';
  every: number;
  log: SaveLog;
  onSaved: (s: SlotSummary) => void;
}): LocalSave {
  const { store, log } = deps;
  const autosaves = deps.mode === 'free';
  let last = 0;
  let writing = false;
  /** 読めない自動の枠を、利用者が島を差し替えるまで上書きしない (版を上げた日に島を黙って失わない) */
  let held = false;

  const write = (slot: SlotId, save: SaveData): Promise<void> => {
    if (!store) return Promise.resolve();
    return store.save(slot, save).then(
      (summary) => {
        deps.onSaved(summary);
        log('info', 'persist.saved', save.tick, { slot });
      },
      (e: unknown) => log('warn', 'persist.save.failed', save.tick, { slot, error: String(e) }),
    );
  };
  const writeAuto = (save: SaveData) => {
    last = save.tick;
    writing = true;
    void write('auto', save).finally(() => {
      writing = false;
    });
  };
  const read = <T>(what: string, fallback: T, p: Promise<T> | undefined): Promise<T> =>
    (p ?? Promise.resolve(fallback)).catch((e: unknown) => {
      log('warn', `persist.${what}.failed`, 0, { error: String(e) });
      return fallback;
    });

  return {
    async resume(restore) {
      if (!autosaves || !store) return null;
      try {
        const save = await store.load('auto');
        if (!save) return null;
        const w = restore(save);
        last = save.tick;
        log('info', 'persist.resumed', save.tick, { slot: 'auto' });
        return w;
      } catch (e) {
        held = true;
        log('warn', 'persist.resume.failed', 0, { error: String(e) });
        return null;
      }
    },
    onTick(tick, serialize) {
      if (!autosaves || held || writing || tick - last < deps.every) return;
      writeAuto(serialize());
    },
    replaced(save) {
      if (!autosaves) return;
      held = false;
      writeAuto(save);
    },
    flush(serialize) {
      if (!autosaves || held) return;
      writeAuto(serialize());
    },
    saveSlot: write,
    loadSlot: (slot) => read('load', null, store?.load(slot)),
    list: () => read('list', [], store?.list()),
  };
}
