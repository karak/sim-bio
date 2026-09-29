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

/**
 * 見ている種が変わった時と、種のレイヤーを開き直した時に onChange を呼ぶ。acknowledge はプレイヤーがその種のレイヤーを開いた (既存の告知を既読にしてよい) 時だけ true。
 * 観察画面から戻っただけの時は false (観察中は石板が隠れていて、その間の告知を読めていない)。
 * 戻った後に同じ種のチップを押すと、見ている種は変わらないが既読にする必要があるので、acknowledge の時は変化が無くても知らせる
 */
export function createViewedSpecies(onChange: (id: string | null, opts: { acknowledge: boolean }) => void): ViewedSpecies {
  let selected: string | null = null;
  let observing = false;
  let last: string | null = null;
  const sync = (acknowledge: boolean) => {
    const v = observing ? null : selected;
    const ack = acknowledge && v !== null;
    if (v === last && !ack) return;
    last = v;
    onChange(v, { acknowledge: ack });
  };
  return {
    select(id) {
      selected = id;
      sync(true);
    },
    setObserving(on) {
      observing = on;
      sync(false);
    },
  };
}
