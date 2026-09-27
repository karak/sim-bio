import { describe, it, expect } from 'vitest';
import { createViewedSpecies } from '../../src/ui/viewedSpecies';

describe('createViewedSpecies (M21-02 D5: いま地図で見ている種)', () => {
  const setup = () => {
    const calls: (string | null)[] = [];
    return { calls, v: createViewedSpecies((id) => calls.push(id)) };
  };
  it('種のレイヤーを選ぶとその種、種以外に切り替えると null を知らせる。変わらない時は知らせない', () => {
    const { calls, v } = setup();
    v.select('wolf');
    v.select('wolf');
    v.select(null);
    v.select(null);
    expect(calls).toEqual(['wolf', null]);
  });
  it('観察画面に入っている間は、選んでいても見ていないとみなし null。出たら選んでいる種に戻る', () => {
    const { calls, v } = setup();
    v.select('wolf');
    v.setObserving(true);
    v.setObserving(true);
    v.setObserving(false);
    expect(calls).toEqual(['wolf', null, 'wolf']);
  });
  it('観察画面の中で種を選び直しても知らせず、出た時にその種を知らせる', () => {
    const { calls, v } = setup();
    v.setObserving(true);
    v.select('deer');
    expect(calls).toEqual([]);
    v.setObserving(false);
    expect(calls).toEqual(['deer']);
  });
});
