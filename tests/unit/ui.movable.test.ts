import { describe, it, expect } from 'vitest';
import { clampOffset, moveStep, readOffset, writeOffset, type Frame, type MoveState } from '../../src/ui/movable';

const view = { width: 1000, height: 500 };

describe('clampOffset (M19-15: 判定の板の取っ手を画面の外へ出さない)', () => {
  it('取っ手が画面の内なら位置はそのまま', () => {
    expect(clampOffset({ x: 30, y: -20 }, { left: 100, top: 10, right: 300, bottom: 40 }, view)).toEqual({ x: 30, y: -20 });
  });
  it('左上へはみ出た分だけ戻す', () => {
    expect(clampOffset({ x: -500, y: -300 }, { left: -120, top: -50, right: 80, bottom: -20 }, view)).toEqual({ x: -380, y: -250 });
  });
  it('右下へはみ出た分だけ戻す', () => {
    expect(clampOffset({ x: 900, y: 600 }, { left: 950, top: 520, right: 1150, bottom: 550 }, view)).toEqual({ x: 750, y: 550 });
  });
});

// M21-05: ドラッグを純粋な状態遷移に分ける。画面の大きさと取っ手の矩形 (今の位置で描いたもの) は frame で渡す
const still: MoveState = { at: { x: 0, y: 0 }, drag: null };
/** 取っ手 200x20 を (100, 10) に描いた画面 1000x500 */
const frame: Frame = { grip: { left: 100, top: 10, right: 300, bottom: 30 }, view };
/** 取っ手が描かれていない (板を隠している) とき */
const hidden: Frame = { grip: null, view };

describe('moveStep (M21-05: ドラッグの状態遷移)', () => {
  it('押すと、押した点と今の位置を覚えてドラッグに入る。まだ覚えには書かない', () => {
    const s = { at: { x: 5, y: 7 }, drag: null };
    expect(moveStep(s, { type: 'down', pointerId: 3, x: 150, y: 20 }, frame)).toEqual({
      state: { at: { x: 5, y: 7 }, drag: { pointer: 3, from: { x: 150, y: 20 }, start: { x: 5, y: 7 } } },
      save: false,
      handled: true,
    });
  });

  it('押した指の動きだけ、押した点からのずれの分だけ動く', () => {
    const down = moveStep(still, { type: 'down', pointerId: 3, x: 150, y: 20 }, frame).state;
    expect(moveStep(down, { type: 'move', pointerId: 3, x: 410, y: 140 }, frame)).toEqual({
      state: { at: { x: 260, y: 120 }, drag: { pointer: 3, from: { x: 150, y: 20 }, start: { x: 0, y: 0 } } },
      save: false,
      handled: true,
    });
  });

  it('ほかの指 (pointerId が違う) の動き・離し・キャンセルは何もしない', () => {
    const down = moveStep(still, { type: 'down', pointerId: 3, x: 150, y: 20 }, frame).state;
    expect(moveStep(down, { type: 'move', pointerId: 4, x: 410, y: 140 }, frame)).toEqual({ state: down, save: false, handled: false });
    expect(moveStep(down, { type: 'up', pointerId: 4 }, frame)).toEqual({ state: down, save: false, handled: false });
    expect(moveStep(down, { type: 'cancel', pointerId: 4 }, frame)).toEqual({ state: down, save: false, handled: false });
  });

  it('押していないときの動き・離しは何もしない', () => {
    expect(moveStep(still, { type: 'move', pointerId: 1, x: 410, y: 140 }, frame)).toEqual({ state: still, save: false, handled: false });
    expect(moveStep(still, { type: 'up', pointerId: 1 }, frame)).toEqual({ state: still, save: false, handled: false });
  });

  it('離すとドラッグを終え、その位置を覚えに書く', () => {
    let s = moveStep(still, { type: 'down', pointerId: 3, x: 150, y: 20 }, frame).state;
    s = moveStep(s, { type: 'move', pointerId: 3, x: 410, y: 140 }, frame).state;
    const moved: Frame = { grip: { left: 360, top: 130, right: 560, bottom: 150 }, view };
    expect(moveStep(s, { type: 'up', pointerId: 3 }, moved)).toEqual({ state: { at: { x: 260, y: 120 }, drag: null }, save: true, handled: true });
  });

  it('キャンセル (pointercancel) も離しと同じく、そこまで動いた位置で終えて覚える', () => {
    let s = moveStep(still, { type: 'down', pointerId: 3, x: 150, y: 20 }, frame).state;
    s = moveStep(s, { type: 'move', pointerId: 3, x: 170, y: 30 }, frame).state;
    expect(moveStep(s, { type: 'cancel', pointerId: 3 }, frame)).toEqual({ state: { at: { x: 20, y: 10 }, drag: null }, save: true, handled: true });
  });

  it('矢印キーで 16 px、Shift で 64 px 動き、そのたびに覚えに書く', () => {
    expect(moveStep(still, { type: 'key', key: 'ArrowLeft', shift: false }, frame)).toEqual({ state: { at: { x: -16, y: 0 }, drag: null }, save: true, handled: true });
    expect(moveStep(still, { type: 'key', key: 'ArrowRight', shift: false }, frame).state.at).toEqual({ x: 16, y: 0 });
    expect(moveStep(still, { type: 'key', key: 'ArrowDown', shift: false }, frame).state.at).toEqual({ x: 0, y: 16 });
    expect(moveStep(still, { type: 'key', key: 'ArrowLeft', shift: true }, frame).state.at).toEqual({ x: -64, y: 0 });
    expect(moveStep(still, { type: 'key', key: 'ArrowDown', shift: true }, frame).state.at).toEqual({ x: 0, y: 64 });
  });

  it('矢印でないキーは受けない (既定の動きを止めない)', () => {
    expect(moveStep(still, { type: 'key', key: 'Enter', shift: false }, frame)).toEqual({ state: still, save: false, handled: false });
    expect(moveStep(still, { type: 'key', key: 'Tab', shift: true }, frame)).toEqual({ state: still, save: false, handled: false });
  });

  it('動いた先で取っ手が画面の外へ出るなら、画面の内へ寄せる (左上・右下)', () => {
    const down = moveStep(still, { type: 'down', pointerId: 1, x: 150, y: 20 }, frame).state;
    // 左上へ 500 px: 取っ手は left -400, top -490 → 左端・上端へ戻す
    expect(moveStep(down, { type: 'move', pointerId: 1, x: -350, y: -480 }, frame).state.at).toEqual({ x: -100, y: -10 });
    // 右下へ 2000 px: 取っ手は right 2300, bottom 2030 → 右端・下端へ戻す
    expect(moveStep(down, { type: 'move', pointerId: 1, x: 2150, y: 2020 }, frame).state.at).toEqual({ x: 700, y: 470 });
    // Shift+上: 取っ手は top -54 → 上端へ戻す
    expect(moveStep(still, { type: 'key', key: 'ArrowUp', shift: true }, frame).state.at).toEqual({ x: 0, y: -10 });
  });

  it('取っ手の矩形は今の位置で描いたものとして、動かした先へずらしてから寄せる', () => {
    // 今 (600, 0) で取っ手は left 700 .. right 900。右へ 64 px なら right 964 で収まる
    expect(moveStep({ at: { x: 600, y: 0 }, drag: null }, { type: 'key', key: 'ArrowRight', shift: true }, { grip: { left: 700, top: 10, right: 900, bottom: 30 }, view }).state.at).toEqual({ x: 664, y: 0 });
    // 今 (664, 0) で right 964。もう 64 px だと right 1028 → 右端 1000 まで
    expect(moveStep({ at: { x: 664, y: 0 }, drag: null }, { type: 'key', key: 'ArrowRight', shift: true }, { grip: { left: 764, top: 10, right: 964, bottom: 30 }, view }).state.at).toEqual({ x: 700, y: 0 });
  });

  it('取っ手が描かれていない (板を隠している) ときは寄せない', () => {
    const s = { at: { x: 5000, y: -5000 }, drag: null };
    expect(moveStep(s, { type: 'show' }, hidden)).toEqual({ state: s, save: false, handled: true });
    expect(moveStep(s, { type: 'key', key: 'ArrowLeft', shift: false }, hidden).state.at).toEqual({ x: 4984, y: -5000 });
  });

  it('見せ直す (show) と、覚えた位置を今の画面の内へ寄せ直す。覚えには書かない', () => {
    const s = { at: { x: 900, y: 0 }, drag: null };
    // 画面が狭くなった: 取っ手は right 1200 → 右端 1000 まで戻す
    const drawn: Frame = { grip: { left: 1000, top: 10, right: 1200, bottom: 30 }, view };
    expect(moveStep(s, { type: 'show' }, drawn)).toEqual({ state: { at: { x: 700, y: 0 }, drag: null }, save: false, handled: true });
  });
});

/** Storage の getItem / setItem だけを持つ置き場。broken なら読み書きで投げる (プライベートの窓など) */
function memoryStore(init: Record<string, string> = {}, broken = false) {
  const map = new Map(Object.entries(init));
  return {
    map,
    getItem: (k: string) => {
      if (broken) throw new Error('SecurityError');
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
  };
}

describe('readOffset / writeOffset (M21-05: 位置の覚えの読み書き。置き場は引数で渡す)', () => {
  it('書いた位置を JSON で置き、読めば同じ位置が返る', () => {
    const store = memoryStore();
    writeOffset(store, 'k', { x: 244, y: 56 });
    expect(store.map.get('k')).toBe('{"x":244,"y":56}');
    expect(readOffset(store, 'k')).toEqual({ x: 244, y: 56 });
  });

  it('何も無い・壊れた・数でない中身は、動かしていない (0, 0) とする', () => {
    expect(readOffset(memoryStore(), 'k')).toEqual({ x: 0, y: 0 });
    expect(readOffset(memoryStore({ k: '{oops' }), 'k')).toEqual({ x: 0, y: 0 });
    expect(readOffset(memoryStore({ k: '{"x":"1","y":2}' }), 'k')).toEqual({ x: 0, y: 0 });
    expect(readOffset(memoryStore({ k: '{"x":null,"y":2}' }), 'k')).toEqual({ x: 0, y: 0 });
    expect(readOffset(memoryStore({ k: '7' }), 'k')).toEqual({ x: 0, y: 0 });
  });

  it('余計な項目は落として x, y だけを返す', () => {
    expect(readOffset(memoryStore({ k: '{"x":1,"y":2,"z":3}' }), 'k')).toEqual({ x: 1, y: 2 });
  });

  it('読めない・書けない置き場でも投げない', () => {
    const store = memoryStore({}, true);
    expect(readOffset(store, 'k')).toEqual({ x: 0, y: 0 });
    expect(() => writeOffset(store, 'k', { x: 1, y: 2 })).not.toThrow();
  });
});
