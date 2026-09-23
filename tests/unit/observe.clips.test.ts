import { describe, it, expect } from 'vitest';
import { clipFor, rabbitClip, wolfClip } from '../../src/observe/render/creatures';
import type { Agent } from '../../src/observe/agents';

const agent = (over: Partial<Agent>): Agent => ({ id: 1, species: 'wolf', role: 'wild', x: 0, z: 0, heading: 0, state: 'idle', t: 0, ...over });

describe('観察画面 (M22-05): 状態 → クリップ', () => {
  it('月鹿: 倒れて 2 秒で fallHold に移り、還るあいだも fallHold', () => {
    expect(clipFor('fall', 1.9)).toBe('fall');
    expect(clipFor('fall', 2)).toBe('fallHold');
    expect(clipFor('return', 0)).toBe('fallHold');
    expect(clipFor('chase', 0)).toBe('run');
  });

  it('灰狼: 忍び寄りは stalk、追って獲物に 3 m 未満まで迫ると pounce、離れていれば run', () => {
    const prey = agent({ id: 9, species: 'deer', x: 2.5 });
    const find = (id: number) => (id === 9 ? prey : undefined);
    expect(wolfClip(agent({ state: 'stalk', target: { agent: 9 } }), find)).toBe('stalk');
    expect(wolfClip(agent({ state: 'chase', target: { agent: 9 } }), find)).toBe('pounce');
    expect(wolfClip(agent({ state: 'chase', x: -10, target: { agent: 9 } }), find)).toBe('run');
    expect(wolfClip(agent({ state: 'chase', target: { agent: 5 } }), find)).toBe('run');
    expect(wolfClip(agent({ state: 'fall', t: 3 }), find)).toBe('fallHold');
  });

  it('土兎: 歩きは hop、立ち止まりは id が 3 の倍数なら alert、逃げは run', () => {
    expect(rabbitClip(agent({ species: 'rabbit', state: 'walk' }))).toBe('hop');
    expect(rabbitClip(agent({ species: 'rabbit', id: 3, state: 'idle' }))).toBe('alert');
    expect(rabbitClip(agent({ species: 'rabbit', id: 4, state: 'idle' }))).toBe('idle');
    expect(rabbitClip(agent({ species: 'rabbit', state: 'flee' }))).toBe('run');
    expect(rabbitClip(agent({ species: 'rabbit', state: 'graze' }))).toBe('graze');
  });
});
