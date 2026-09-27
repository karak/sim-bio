/**
 * プレイヤーがいま地図で見ている種 (M21-02 D5)。HUD で選んだ種レイヤーと、観察画面に入っているかから決める。
 * 観察画面の間は 2D の地図を描かないので、選んでいても見ていないとみなす (その間に出た告知を黙って失わないため)
 */
export type ViewedSpecies = {
  /** HUD で選んでいる種のレイヤー。種以外のレイヤーなら null */
  select(id: string | null): void;
  /** 観察画面に入っているか。毎フレーム呼んでよい */
  setObserving(on: boolean): void;
};

/** 見ている種が変わった時だけ onChange を呼ぶ */
export function createViewedSpecies(onChange: (id: string | null) => void): ViewedSpecies {
  let selected: string | null = null;
  let observing = false;
  let last: string | null = null;
  const sync = () => {
    const v = observing ? null : selected;
    if (v === last) return;
    last = v;
    onChange(v);
  };
  return {
    select(id) {
      selected = id;
      sync();
    },
    setObserving(on) {
      observing = on;
      sync();
    },
  };
}
