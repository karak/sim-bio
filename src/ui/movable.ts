/**
 * 板を取っ手で動かす (M19-15)。判定の板が下の画面 (観察画面の入口など) を覆うときの暫定の手当て。
 * ドラッグと矢印キー (Shift で大きく) で動き、取っ手は画面の外へ出さない。位置はそのタブの間だけ (sessionStorage) 覚える
 */
export type Offset = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

const STEP = 16;
const BIG_STEP = 64;
const KEYS: Readonly<Record<string, Offset>> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

/** 取っ手の矩形 (今の位置で描いたもの) が画面の内に収まるよう、位置を寄せ直す。純粋な関数 */
export function clampOffset(at: Offset, grip: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number }): Offset {
  const dx = Math.max(0, -grip.left) - Math.max(0, grip.right - view.width);
  const dy = Math.max(0, -grip.top) - Math.max(0, grip.bottom - view.height);
  return { x: at.x + dx, y: at.y + dy };
}

/** 板の位置と、押している指 (押した点と押したときの位置) (M21-05) */
export type MoveState = { at: Offset; drag: { pointer: number; from: Offset; start: Offset } | null };
/** 取っ手に来た出来事。show は板を見せた直後 */
export type MoveInput =
  | { type: 'down' | 'move'; pointerId: number; x: number; y: number }
  | { type: 'up' | 'cancel'; pointerId: number }
  | { type: 'key'; key: string; shift: boolean }
  | { type: 'show' };
/** 今の位置 (state.at) で描いた取っ手の矩形 (描かれていなければ null) と画面の大きさ */
export type Frame = { grip: Rect | null; view: { width: number; height: number } };
/** save: 位置を覚えに書く。handled: 出来事を受けた (キーなら既定の動きを止める) */
export type MoveStep = { state: MoveState; save: boolean; handled: boolean };

/** next へ動かす。取っ手の矩形を next へずらし、画面の外へ出るなら寄せる */
function place(s: MoveState, next: Offset, f: Frame): Offset {
  const g = f.grip;
  if (!g) return next;
  const dx = next.x - s.at.x;
  const dy = next.y - s.at.y;
  return clampOffset(next, { left: g.left + dx, top: g.top + dy, right: g.right + dx, bottom: g.bottom + dy }, f.view);
}

/** ドラッグの状態遷移 (M21-05)。DOM に触れない純粋な関数。makeMovable はこれを出来事ごとに呼んで translate と覚えへ写す */
export function moveStep(s: MoveState, e: MoveInput, f: Frame): MoveStep {
  const skip = { state: s, save: false, handled: false };
  switch (e.type) {
    case 'down':
      return { state: { at: s.at, drag: { pointer: e.pointerId, from: { x: e.x, y: e.y }, start: s.at } }, save: false, handled: true };
    case 'move': {
      const d = s.drag;
      if (d?.pointer !== e.pointerId) return skip;
      return { state: { at: place(s, { x: d.start.x + e.x - d.from.x, y: d.start.y + e.y - d.from.y }, f), drag: d }, save: false, handled: true };
    }
    case 'up':
    case 'cancel':
      if (s.drag?.pointer !== e.pointerId) return skip;
      return { state: { at: s.at, drag: null }, save: true, handled: true };
    case 'key': {
      const dir = KEYS[e.key];
      if (!dir) return skip;
      const step = e.shift ? BIG_STEP : STEP;
      return { state: { at: place(s, { x: s.at.x + dir.x * step, y: s.at.y + dir.y * step }, f), drag: s.drag }, save: true, handled: true };
    }
    case 'show':
      return { state: { at: place(s, s.at, f), drag: s.drag }, save: false, handled: true };
  }
}

/** 位置の覚えの置き場 (M21-05)。sessionStorage か、試験の置き場 */
export type OffsetStore = Pick<Storage, 'getItem' | 'setItem'>;

export function readOffset(store: OffsetStore, key: string): Offset {
  try {
    const v = JSON.parse(store.getItem(key) ?? 'null') as unknown;
    if (v && typeof v === 'object' && Number.isFinite((v as Offset).x) && Number.isFinite((v as Offset).y)) return { x: (v as Offset).x, y: (v as Offset).y };
  } catch {
    // 読めない置き場 (プライベートの窓など) は動かしていないものとする
  }
  return { x: 0, y: 0 };
}

export function writeOffset(store: OffsetStore, key: string, at: Offset) {
  try {
    store.setItem(key, JSON.stringify(at));
  } catch {
    // 覚えられなくても、その場では動く
  }
}

/** 部品の外 (画面の大きさ・覚えの置き場) (M21-05)。試験では差し替える */
export type MovableEnv = { view(): { width: number; height: number }; store: OffsetStore };

/** ブラウザの画面と sessionStorage。sessionStorage を引くだけで投げる窓もあるので、読み書きのたびに引く */
const browserEnv: MovableEnv = {
  view: () => ({ width: innerWidth, height: innerHeight }),
  store: { getItem: (k) => sessionStorage.getItem(k), setItem: (k, v) => sessionStorage.setItem(k, v) },
};

/** board を grip で動かせるようにする。show は board を見せた直後に呼び、覚えた位置を画面に収め直す */
export function makeMovable(board: HTMLElement, grip: HTMLElement, key: string, env: MovableEnv = browserEnv): { show(): void } {
  let state: MoveState = { at: readOffset(env.store, key), drag: null };
  const frame = (): Frame => {
    const r = grip.getBoundingClientRect();
    return { grip: r.width === 0 ? null : r, view: env.view() };
  };
  const draw = () => {
    board.style.translate = `${state.at.x}px ${state.at.y}px`;
  };
  // 取っ手の矩形は、いつも state.at で描いたものを測る (moveStep の Frame の約束)
  const apply = (e: MoveInput): MoveStep => {
    const r = moveStep(state, e, frame());
    state = r.state;
    draw();
    if (r.save) writeOffset(env.store, key, state.at);
    return r;
  };
  draw();
  apply({ type: 'show' });

  grip.addEventListener('pointerdown', (e) => {
    apply({ type: 'down', pointerId: e.pointerId, x: e.clientX, y: e.clientY });
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => void apply({ type: 'move', pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  grip.addEventListener('pointerup', (e) => void apply({ type: 'up', pointerId: e.pointerId }));
  grip.addEventListener('pointercancel', (e) => void apply({ type: 'cancel', pointerId: e.pointerId }));
  grip.addEventListener('keydown', (e) => {
    if (apply({ type: 'key', key: e.key, shift: e.shiftKey }).handled) e.preventDefault();
  });
  return { show: () => void apply({ type: 'show' }) };
}
