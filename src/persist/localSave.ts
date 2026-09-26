import type { SaveData } from '../simulation/types';
import type { IslandStore } from './islandStore';
import type { ManualSlot, SlotId, SlotSummary } from './slots';

export type SaveLog = (level: 'info' | 'warn', event: string, tick: number, extra?: Record<string, unknown>) => void;

/** 手元の保存の方針 (M19-05)。どの島をいつ自動の枠に書き、どこから再開するかをここで決める。書き込みの失敗は記録に残して投げない */
export type LocalSave = {
  /**
   * 閉じる前の続きから。自由モードで自動の枠があれば、その島を restore して返す。シナリオは自動保存から戻さない (シナリオ中の読込は予言と矛盾する)。
   * 読めない自動の枠は脇へ退け、新しい島を普段どおり自動保存する (版を上げた日に島を黙って上書きしない)
   */
  resume<W>(restore: (save: SaveData) => W): Promise<W | null>;
  /**
   * 毎フレーム。自動保存の周期: 前に書いた tick から every tick 進んだら 1 回書く。
   * 1 フレームで何 tick 飛んでも 1 回にし、書き込み中は次を書かない (1 回で 1.6 MB ほどの SaveData を作って渡す。size 128)
   */
  onTick(tick: number, serialize: () => SaveData): void;
  /** 読込・新しい島で島を差し替えた直後。自動の枠をその島にし、そこから数え直す */
  replaced(save: SaveData): void;
  /** タブが隠れたとき (閉じる直前を含む)。周期を待たずに書く */
  flush(serialize: () => SaveData): void;
  saveSlot(slot: ManualSlot, save: SaveData): Promise<void>;
  /** 読めない枠 (restore が投げる) は null にして記録に残す */
  loadSlot<W>(slot: SlotId, restore: (save: SaveData) => W): Promise<W | null>;
  list(): Promise<readonly SlotSummary[]>;
};

export function createLocalSave(deps: {
  /** IndexedDB が開けなければ null。何も書かず、枠は空として振る舞う */
  store: IslandStore | null;
  /**
   * シナリオの島は自動の枠から戻さず、書きもしない (runner の状態は SaveData に無く、シナリオ中の読込は予言と矛盾する)。
   * シナリオの島は自動の枠に書かない。書くと次に自由モードで開いたとき、シナリオの途中の島が続きとして出てしまう
   */
  mode: 'free' | 'scenario';
  every: number;
  log: SaveLog;
  onSaved: (s: SlotSummary) => void;
}): LocalSave {
  const { store, log } = deps;
  const autosaves = deps.mode === 'free';
  /** 再開した島ではその tick から数える */
  let last = 0;
  let writing = false;

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
  // replaced と flush は書き込み中でも重ねて書く。IndexedDB は作った順に transaction を確定させるので、最後に作ったものが残る
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
      const save = await read('load', null, store.load('auto'));
      if (!save) return null;
      try {
        const w = restore(save);
        last = save.tick;
        log('info', 'persist.resumed', save.tick, { slot: 'auto' });
        return w;
      } catch (e) {
        const setAside = await store.setAside('auto').catch((err: unknown) => `failed: ${String(err)}`);
        log('warn', 'persist.resume.failed', save.tick, { error: String(e), setAside });
        return null;
      }
    },
    onTick(tick, serialize) {
      if (!autosaves || writing || tick - last < deps.every) return;
      writeAuto(serialize());
    },
    replaced(save) {
      if (!autosaves) return;
      writeAuto(save);
    },
    flush(serialize) {
      if (!autosaves) return;
      writeAuto(serialize());
    },
    saveSlot: write,
    async loadSlot(slot, restore) {
      const save = await read('load', null, store?.load(slot));
      if (!save) return null;
      try {
        return restore(save);
      } catch (e) {
        log('warn', 'persist.load.failed', save.tick, { slot, error: String(e) });
        return null;
      }
    },
    list: () => read('list', [], store?.list()),
  };
}
