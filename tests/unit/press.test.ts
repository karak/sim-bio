import { describe, it, expect } from 'vitest';
import { DRAG_THRESHOLD_PX, IDLE, pressStep, type PressInput, type PressState } from '../../src/ui/press';

const run = (events: PressInput[], from: PressState = IDLE) =>
  events.reduce<{ state: PressState; actions: string[] }>(
    (acc, e) => {
      const r = pressStep(acc.state, e);
      return { state: r.state, actions: [...acc.actions, r.action] };
    },
    { state: from, actions: [] },
  );
const down = (pointerId: number, x = 100, y = 100): PressInput => ({ type: 'down', pointerId, x, y });
const move = (pointerId: number, x: number, y: number): PressInput => ({ type: 'move', pointerId, x, y });

describe('押しとドラッグの判別 (M26-03)', () => {
  it('動かさずに離すと押し (選ぶ)', () => {
    expect(run([down(1), { type: 'up', pointerId: 1 }]).actions).toEqual(['none', 'press']);
  });

  it('しきい値以内の揺れは押し、超えて動かすとドラッグ (選ばない)', () => {
    const t = DRAG_THRESHOLD_PX;
    expect(run([down(1), move(1, 100 + t, 100), { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('press');
    expect(run([down(1), move(1, 100 + t + 1, 100), { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('drag');
  });

  it('距離は斜めも測り、いったん超えたら戻しても押しに戻らない', () => {
    const far = 100 + DRAG_THRESHOLD_PX;
    expect(run([down(1), move(1, far, far), { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('drag');
    expect(run([down(1), move(1, 200, 100), move(1, 100, 100), { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('drag');
  });

  it('キャンセルは選ばず、状態を空に戻す', () => {
    const r = run([down(1), { type: 'cancel', pointerId: 1 }]);
    expect(r.actions).toEqual(['none', 'cancel']);
    expect(r.state).toEqual(IDLE);
  });

  it('押していない間の move・up は何もしない', () => {
    expect(run([move(1, 5, 5), { type: 'up', pointerId: 1 }]).actions).toEqual(['none', 'none']);
  });

  it('別の指の move・up・cancel は押している指を乱さない', () => {
    const r = run([down(1), move(2, 500, 500), { type: 'up', pointerId: 2 }, { type: 'cancel', pointerId: 2 }, { type: 'up', pointerId: 1 }]);
    expect(r.actions).toEqual(['none', 'none', 'none', 'none', 'press']);
  });

  it('2 本目の指が降りたらつまみ操作とみなし、どちらを離しても選ばない', () => {
    expect(run([down(1), down(2), { type: 'up', pointerId: 2 }, { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('drag');
  });

  it('離したあとの次の押しは新しく始まる', () => {
    expect(run([down(1), move(1, 300, 300), { type: 'up', pointerId: 1 }, down(1), { type: 'up', pointerId: 1 }]).actions.at(-1)).toBe('press');
  });

  it('入力の状態を書き換えない', () => {
    const s = pressStep(IDLE, down(1)).state;
    const before = JSON.stringify(s);
    pressStep(s, move(1, 300, 300));
    expect(JSON.stringify(s)).toBe(before);
  });
});
