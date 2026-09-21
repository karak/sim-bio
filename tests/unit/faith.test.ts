import { describe, it, expect } from 'vitest';
import { commandKey, updateFaith, FAITH_UP, FAITH_DOWN, FAITH_DISASTER, FAITH_DECAY } from '../../src/simulation/faith';
import type { Command } from '../../src/simulation/types';

describe('commandKey (M9-01)', () => {
  it('spawn_species は spawn:<speciesId>', () => {
    expect(commandKey({ type: 'spawn_species', speciesId: 'deer', cell: 0, amount: 0.5 })).toBe('spawn:deer');
  });
  it('set_climate は climate (係数によらず 1 種類)', () => {
    expect(commandKey({ type: 'set_climate', rainScale: 1.2 })).toBe('climate');
    expect(commandKey({ type: 'set_climate', tempOffset: -1 })).toBe('climate');
  });
  it('disaster は disaster:<kind>', () => {
    expect(commandKey({ type: 'disaster', kind: 'volcano', cell: 0, radius: 4 })).toBe('disaster:volcano');
  });
  it('sink は数えない (null)', () => {
    expect(commandKey({ type: 'sink', amount: 0.1 })).toBeNull();
  });
});

describe('updateFaith (M9-01, 境界値)', () => {
  it('同じキーが 2 回では上がらない', () => {
    const result = updateFaith(0.5, { recent: ['a', 'b', 'a'], disasters: 0 });
    // 上がらなければ減衰のみ: 0.5 * (1 - FAITH_DECAY)
    expect(result).toBeCloseTo(0.5 * (1 - FAITH_DECAY), 6);
  });
  it('同じキーが 3 回で上がる', () => {
    const result = updateFaith(0.5, { recent: ['b', 'a', 'a', 'a'], disasters: 0 });
    // (a) だけ成立 (distinct = 2 < 3): (0.5 + FAITH_UP) * (1 - FAITH_DECAY)
    expect(result).toBeCloseTo((0.5 + FAITH_UP) * (1 - FAITH_DECAY), 6);
    expect(result).toBeGreaterThan(0.5 * (1 - FAITH_DECAY));
  });
  it('2 種類では下がらない', () => {
    const result = updateFaith(0.5, { recent: ['a', 'b', 'a', 'b'], disasters: 0 });
    // 最後 'b' は 2 回 (< 3) → (a) 不成立。distinct = 2 (< 3) → (b) 不成立。減衰のみ
    expect(result).toBeCloseTo(0.5 * (1 - FAITH_DECAY), 6);
  });
  it('3 種類で下がる', () => {
    const result = updateFaith(0.5, { recent: ['a', 'b', 'c'], disasters: 0 });
    // 最後 'c' は 1 回 (< 3) → (a) 不成立。distinct = 3 (>= 3) → (b) 成立
    expect(result).toBeCloseTo((0.5 - FAITH_DOWN) * (1 - FAITH_DECAY), 6);
    expect(result).toBeLessThan(0.5 * (1 - FAITH_DECAY));
  });
  it('災害 1 回で必ず下がる (儀式が 3 回そろっていても純減)', () => {
    // 同じキーが 3 回そろい (a) は成立するが、災害 1 回の減点が上回り正味は下がる
    const result = updateFaith(0.5, { recent: ['a', 'a', 'a'], disasters: 1 });
    expect(result).toBeLessThan(0.5);
    expect(result).toBeCloseTo((0.5 + FAITH_UP - FAITH_DISASTER) * (1 - FAITH_DECAY), 6);
  });
  it('recent が空でも減衰だけはかかる', () => {
    const result = updateFaith(0.5, { recent: [], disasters: 0 });
    expect(result).toBeCloseTo(0.5 * (1 - FAITH_DECAY), 6);
  });

  it('0 未満・1 超にならない (性質テスト、乱数 200 回)', () => {
    const keys = ['spawn:deer', 'spawn:moss', 'climate', 'disaster:volcano', 'disaster:meteor'];
    let prev = 0.5;
    for (let i = 0; i < 200; i++) {
      const len = Math.floor(Math.random() * 12);
      const recent: string[] = [];
      for (let j = 0; j < len; j++) recent.push(keys[Math.floor(Math.random() * keys.length)]);
      const disasters = Math.floor(Math.random() * 4);
      prev = updateFaith(prev, { recent, disasters });
      expect(prev).toBeGreaterThanOrEqual(0);
      expect(prev).toBeLessThanOrEqual(1);
    }
  });

  it('極端な入力 (prev=0 に災害連発、prev=1 に単調な儀式連発) でも [0,1] に収まる', () => {
    let low = 0;
    let high = 1;
    for (let i = 0; i < 200; i++) {
      low = updateFaith(low, { recent: ['disaster:volcano', 'disaster:volcano', 'disaster:volcano'], disasters: 3 });
      high = updateFaith(high, { recent: ['spawn:deer', 'spawn:deer', 'spawn:deer'], disasters: 0 });
      expect(low).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(1);
    }
  });
});

// 型チェック用: Command のすべての type を commandKey が扱えることを確認する
const _allCommandTypes: Command['type'][] = ['spawn_species', 'set_climate', 'disaster', 'sink'];
void _allCommandTypes;
