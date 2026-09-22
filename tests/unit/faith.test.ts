import { describe, it, expect } from 'vitest';
import {
  commandKey, updateFaith, FAITH_UP, FAITH_DOWN, FAITH_DISASTER, FAITH_DECAY, FAITH_ANSWER, FAITH_IGNORE, formatFaith,
  updateFaithCap, FAITH_CAP_INITIAL, FAITH_CAP_IGNORE, FAITH_CAP_ANSWER, FAITH_CAP_RECOVER,
} from '../../src/simulation/faith';
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
  it('build_tower は星の行為として build_tower を数える (M10-01)', () => {
    expect(commandKey({ type: 'build_tower', cell: 0 })).toBe('build_tower');
    expect(commandKey({ type: 'build_tower', cell: 0, rainScale: 2, tempOffset: 1 })).toBe('build_tower');
  });
  it('tower_power は勅令と同じく言葉/自動処理なので数えない (null、M10-01)', () => {
    expect(commandKey({ type: 'tower_power', active: false })).toBeNull();
    expect(commandKey({ type: 'tower_power', active: true })).toBeNull();
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

describe('updateFaith の answered/ignored (M9-02, 境界値)', () => {
  it('answered/ignored を省略すると今までどおり (既存の呼び出し・テストは変わらない)', () => {
    const withOmitted = updateFaith(0.5, { recent: [], disasters: 0 });
    const withZero = updateFaith(0.5, { recent: [], disasters: 0, answered: 0, ignored: 0 });
    expect(withOmitted).toBe(withZero);
    expect(withOmitted).toBeCloseTo(0.5 * (1 - FAITH_DECAY), 6);
  });
  it('祈りに応えた 1 件で +FAITH_ANSWER (減衰の前に掛かる)', () => {
    const result = updateFaith(0.5, { recent: [], disasters: 0, answered: 1 });
    expect(result).toBeCloseTo((0.5 + FAITH_ANSWER) * (1 - FAITH_DECAY), 6);
    expect(result).toBeGreaterThan(0.5 * (1 - FAITH_DECAY));
  });
  it('祈りを無視した 1 件で −FAITH_IGNORE (減衰の前に掛かる)', () => {
    const result = updateFaith(0.5, { recent: [], disasters: 0, ignored: 1 });
    expect(result).toBeCloseTo((0.5 - FAITH_IGNORE) * (1 - FAITH_DECAY), 6);
    expect(result).toBeLessThan(0.5 * (1 - FAITH_DECAY));
  });
  it('災害の後・減衰の前に掛かる (災害・儀式・応えた/無視したが同じ年に重なっても順序どおり)', () => {
    const result = updateFaith(0.5, { recent: ['a', 'a', 'a'], disasters: 1, answered: 1, ignored: 1 });
    // (0.5 + FAITH_UP [儀式] − FAITH_DISASTER [災害] + FAITH_ANSWER − FAITH_IGNORE) × (1 − FAITH_DECAY)
    expect(result).toBeCloseTo((0.5 + FAITH_UP - FAITH_DISASTER + FAITH_ANSWER - FAITH_IGNORE) * (1 - FAITH_DECAY), 6);
  });
  it('応えた・無視した回数が複数なら回数分だけ効く', () => {
    const result = updateFaith(0.5, { recent: [], disasters: 0, answered: 2, ignored: 1 });
    expect(result).toBeCloseTo((0.5 + 2 * FAITH_ANSWER - FAITH_IGNORE) * (1 - FAITH_DECAY), 6);
  });
  it('0 未満・1 超にならない (answered/ignored ありの性質テスト)', () => {
    let prev = 0.5;
    for (let i = 0; i < 100; i++) {
      prev = updateFaith(prev, { recent: [], disasters: 0, answered: Math.floor(Math.random() * 3), ignored: Math.floor(Math.random() * 3) });
      expect(prev).toBeGreaterThanOrEqual(0);
      expect(prev).toBeLessThanOrEqual(1);
    }
  });
});

// 型チェック用: Command のすべての type を commandKey が扱えることを確認する
const _allCommandTypes: Command['type'][] = ['spawn_species', 'set_climate', 'disaster', 'sink', 'build_tower', 'tower_power'];
void _allCommandTypes;

describe('formatFaith (M9-05)', () => {
  it('小数 2 桁の切り捨て。0.597 は 0.59 (0.60 と出ると勅令の門 0.6 に足りない理由が読めない)', () => {
    expect(formatFaith(0.597)).toBe('0.59');
    expect(formatFaith(0.6)).toBe('0.60');
    expect(formatFaith(0.57)).toBe('0.57');
    expect(formatFaith(1)).toBe('1.00');
    expect(formatFaith(0)).toBe('0.00');
  });
});

describe('updateFaithCap (M10R-02, 境界値)', () => {
  it('無視で FAITH_CAP_IGNORE だけ下がる', () => {
    const result = updateFaithCap(FAITH_CAP_INITIAL, { answered: 0, ignored: 1, prayerPending: false });
    expect(result).toBeCloseTo(FAITH_CAP_INITIAL - FAITH_CAP_IGNORE, 6);
  });
  it('応えで FAITH_CAP_ANSWER だけ上がる', () => {
    const result = updateFaithCap(0.5, { answered: 1, ignored: 0, prayerPending: false });
    expect(result).toBeCloseTo(0.5 + FAITH_CAP_ANSWER, 6);
  });
  it('祈りの無い年 (pending なし・応え/無視とも 0) は FAITH_CAP_RECOVER だけ回復する', () => {
    const result = updateFaithCap(0.5, { answered: 0, ignored: 0, prayerPending: false });
    expect(result).toBeCloseTo(0.5 + FAITH_CAP_RECOVER, 6);
  });
  it('祈りが有効なまま (pending) の年は、応え/無視が 0 でも回復しない', () => {
    const result = updateFaithCap(0.5, { answered: 0, ignored: 0, prayerPending: true });
    expect(result).toBe(0.5);
  });
  it('無視した年は pending であっても回復と重ねず、無視の分だけ下がる', () => {
    const result = updateFaithCap(0.5, { answered: 0, ignored: 1, prayerPending: true });
    expect(result).toBeCloseTo(0.5 - FAITH_CAP_IGNORE, 6);
  });
  it('応えた・無視した回数が複数なら回数分だけ効く', () => {
    const result = updateFaithCap(0.5, { answered: 2, ignored: 1, prayerPending: false });
    expect(result).toBeCloseTo(0.5 + 2 * FAITH_CAP_ANSWER - FAITH_CAP_IGNORE, 6);
  });
  it('1 を超えない (応え続けても FAITH_CAP_INITIAL = 1 で頭打ち)', () => {
    let cap = FAITH_CAP_INITIAL;
    for (let i = 0; i < 10; i++) cap = updateFaithCap(cap, { answered: 1, ignored: 0, prayerPending: false });
    expect(cap).toBe(1);
  });
  it('0 未満にならない (無視し続けても 0 で下げ止まる)', () => {
    let cap = 0;
    for (let i = 0; i < 10; i++) cap = updateFaithCap(cap, { answered: 0, ignored: 1, prayerPending: false });
    expect(cap).toBe(0);
  });
});
