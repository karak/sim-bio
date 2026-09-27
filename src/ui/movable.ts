/**
 * 板を取っ手で動かす (M19-15)。判定の板が下の画面 (観察画面の入口など) を覆うときの暫定の手当て。
 * ドラッグと矢印キー (Shift で大きく) で動き、取っ手は画面の外へ出さない。位置はそのタブの間だけ (sessionStorage) 覚える
 */
export type Offset = { x: number; y: number };

const STEP = 16;
const BIG_STEP = 64;
const KEYS: Readonly<Record<string, Offset>> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };

/** 取っ手の矩形 (今の位置で描いたもの) が画面の内に収まるよう、位置を寄せ直す。純粋な関数 */
export function clampOffset(at: Offset, grip: { left: number; top: number; right: number; bottom: number }, view: { width: number; height: number }): Offset {
  const dx = Math.max(0, -grip.left) - Math.max(0, grip.right - view.width);
  const dy = Math.max(0, -grip.top) - Math.max(0, grip.bottom - view.height);
  return { x: at.x + dx, y: at.y + dy };
}

function readOffset(key: string): Offset {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null') as unknown;
    if (v && typeof v === 'object' && Number.isFinite((v as Offset).x) && Number.isFinite((v as Offset).y)) return { x: (v as Offset).x, y: (v as Offset).y };
  } catch {
    // 読めない置き場 (プライベートの窓など) は動かしていないものとする
  }
  return { x: 0, y: 0 };
}

function writeOffset(key: string, at: Offset) {
  try {
    sessionStorage.setItem(key, JSON.stringify(at));
  } catch {
    // 覚えられなくても、その場では動く
  }
}

/** board を grip で動かせるようにする。show は board を見せた直後に呼び、覚えた位置を画面に収め直す */
export function makeMovable(board: HTMLElement, grip: HTMLElement, key: string): { show(): void } {
  let at = readOffset(key);
  const place = (next: Offset) => {
    board.style.translate = `${next.x}px ${next.y}px`;
    const r = grip.getBoundingClientRect();
    at = r.width === 0 ? next : clampOffset(next, r, { width: innerWidth, height: innerHeight });
    board.style.translate = `${at.x}px ${at.y}px`;
  };
  place(at);

  let drag: { pointer: number; from: Offset; start: Offset } | null = null;
  grip.addEventListener('pointerdown', (e) => {
    drag = { pointer: e.pointerId, from: { x: e.clientX, y: e.clientY }, start: at };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (drag?.pointer !== e.pointerId) return;
    place({ x: drag.start.x + e.clientX - drag.from.x, y: drag.start.y + e.clientY - drag.from.y });
  });
  const drop = (e: PointerEvent) => {
    if (drag?.pointer !== e.pointerId) return;
    drag = null;
    writeOffset(key, at);
  };
  grip.addEventListener('pointerup', drop);
  grip.addEventListener('pointercancel', drop);
  grip.addEventListener('keydown', (e) => {
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    const step = e.shiftKey ? BIG_STEP : STEP;
    place({ x: at.x + dir.x * step, y: at.y + dir.y * step });
    writeOffset(key, at);
  });
  return { show: () => place(at) };
}
