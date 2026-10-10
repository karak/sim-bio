import { describe, it, expect } from 'vitest';
import { createViewedSpecies } from '../../src/ui/viewedSpecies';

describe('createViewedSpecies (M21-02 D5: いま地図で見ている種)', () => {
  const setup = () => {
    const calls: [string | null, { acknowledge: boolean }][] = [];
    return { calls, v: createViewedSpecies((id, opts) => calls.push([id, opts])) };
  };
  it('種のレイヤーを選ぶとその種 (既存の告知を既読にする)、種以外に切り替えると null を知らせる。同じ種を選び直すと既読にし直す。null が続く時は知らせない', () => {
    const { calls, v } = setup();
    v.select('wolf');
    v.select('wolf');
    v.select(null);
    v.select(null);
    expect(calls).toEqual([['wolf', { acknowledge: true }], ['wolf', { acknowledge: true }], [null, { acknowledge: false }]]);
  });
  it('観察画面に入っている間は、選んでいても見ていないとみなし null。出たら選んでいる種に戻るが、既存の告知は既読にしない (観察中は石板が隠れていて読めていない)', () => {
    const { calls, v } = setup();
    v.select('wolf');
    v.setObserving(true);
    v.setObserving(true);
    v.setObserving(false);
    expect(calls).toEqual([['wolf', { acknowledge: true }], [null, { acknowledge: false }], ['wolf', { acknowledge: false }]]);
  });
  it('観察画面から戻った後に同じ種を選び直すと (チップを押すと)、観察中に出た告知を既読にする', () => {
    const { calls, v } = setup();
    v.select('wolf');
    v.setObserving(true);
    v.setObserving(false);
    v.select('wolf');
    expect(calls).toEqual([
      ['wolf', { acknowledge: true }],
      [null, { acknowledge: false }],
      ['wolf', { acknowledge: false }],
      ['wolf', { acknowledge: true }],
    ]);
  });
  it('観察画面の中で種を選び直しても知らせず、出た時にその種を既読にせず知らせる', () => {
    const { calls, v } = setup();
    v.setObserving(true);
    v.select('deer');
    expect(calls).toEqual([]);
    v.setObserving(false);
    expect(calls).toEqual([['deer', { acknowledge: false }]]);
  });
});
