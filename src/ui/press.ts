/**
 * 島の画面で「押した」と「カメラをドラッグした」を分ける (M26-03)。DOM に触れない純粋な状態遷移。
 * 動かさずに離したときだけ press (セルを選ぶ)。しきい値を超えて動いた・指が増えた・キャンセルされたときは選ばない。
 * しきい値は押した点からの距離 (px)。マウスの手ぶれと指の揺れは 6 px に収まり、カメラを回すドラッグは数 px で超える
 */
export const DRAG_THRESHOLD_PX = 10;

/** 押している指と、押した点。moved はしきい値を超えた (または指が増えた) 後 true のまま */
export type PressState = { pointer: number; from: { x: number; y: number }; moved: boolean } | null;
export const IDLE: PressState = null;

export type PressInput =
  | { type: 'down' | 'move'; pointerId: number; x: number; y: number }
  | { type: 'up' | 'cancel'; pointerId: number };

/** press: 押しで終わった (選ぶ)。drag: ドラッグで終わった (選ばない)。cancel: 取り消された。none: 途中 */
export type PressAction = 'none' | 'press' | 'drag' | 'cancel';
export type PressStep = { state: PressState; action: PressAction };

export function pressStep(s: PressState, e: PressInput): PressStep {
  const none = { state: s, action: 'none' as const };
  switch (e.type) {
    case 'down':
      // 2 本目の指はつまみ操作 (カメラ)。押しにはしない。同じ指の down が重なるのは up の取りこぼしなので押し直す
      return s && s.pointer !== e.pointerId ? { state: { ...s, moved: true }, action: 'none' } : { state: { pointer: e.pointerId, from: { x: e.x, y: e.y }, moved: false }, action: 'none' };
    case 'move':
      if (s?.pointer !== e.pointerId || s.moved) return none;
      return Math.hypot(e.x - s.from.x, e.y - s.from.y) > DRAG_THRESHOLD_PX ? { state: { ...s, moved: true }, action: 'none' } : none;
    case 'up':
      if (s?.pointer !== e.pointerId) return none;
      return { state: IDLE, action: s.moved ? 'drag' : 'press' };
    case 'cancel':
      if (s?.pointer !== e.pointerId) return none;
      return { state: IDLE, action: 'cancel' };
  }
}
