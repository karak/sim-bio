/**
 * 自動保存の周期 (M19-05)。前に書いた tick から every tick 進んだら 1 回書く。
 * 1 フレームで何 tick 飛んでも 1 回にし、書き込み中は次を書かない (1 回で 1.6 MB ほどの SaveData を作って渡す。size 128)
 */
export function createAutosave(deps: {
  every: number;
  /** 再開した島ではその tick から数える */
  startTick: number;
  write: (tick: number) => Promise<unknown>;
  onError: (e: unknown) => void;
}): { onTick(tick: number): void } {
  let last = deps.startTick;
  let writing = false;
  return {
    onTick(tick) {
      // 古い保存を読み込むと tick が戻る。戻った島から数え直す
      if (tick < last) last = tick;
      if (writing || tick - last < deps.every) return;
      last = tick;
      writing = true;
      deps
        .write(tick)
        .catch(deps.onError)
        .finally(() => {
          writing = false;
        });
    },
  };
}
