import { describe, it, expect } from 'vitest';
import { tabletViewOf, verdictViewOf, type TabletInput } from '../../src/ui/Tablet';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Cargo } from '../../src/simulation/ship';

const names = { wolf: '狼', deer: '鹿' };
const def = { id: 's', title: '試しの石板', kind: 'prevent', prophecy: '予言', years: 100 } as unknown as ScenarioDef;
const withBudget = { ...def, budget: { start: 10, incomePerYear: 1, costs: {} } } as unknown as ScenarioDef;
const running = { status: 'running', reason: '42 年' } as const;
const input = (over: Partial<TabletInput> = {}): TabletInput => ({
  year: 10,
  verdict: running,
  budget: null,
  warnings: [],
  timeline: [],
  prayer: null,
  milestones: [],
  ...over,
});

describe('tabletViewOf (M21-09): 石板の update の文を、DOM に触れずに入りから決める', () => {
  it('年は石板の年数で止め、走っている間は「あと」を付け、判定が出たら理由だけを出す', () => {
    expect(tabletViewOf(def, names, input()).year).toBe('10 / 100 年');
    expect(tabletViewOf(def, names, input({ year: 130 })).year).toBe('100 / 100 年');
    expect(tabletViewOf(def, names, input()).status).toBe('あと 42 年');
    expect(tabletViewOf(def, names, input({ verdict: { status: 'dead', reason: '草が絶えた' } })).status).toBe('草が絶えた');
  });

  it('祈りは種類の文と残りの年数。祈りが無ければ null (行ごと隠す)', () => {
    expect(tabletViewOf(def, names, input({ prayer: { kind: 'wolves', yearsLeft: 3 } })).prayer).toBe('祈り: 狼を減らして(残り 3 年)');
    expect(tabletViewOf(def, names, input()).prayer).toBeNull();
  });

  it('節目は未到達のものだけを並べ、到達した年 (その年を含む) で消える', () => {
    const milestones = [
      { atYear: 5, text: '過ぎた' },
      { atYear: 10, text: '今年' },
      { atYear: 30, text: '星が落ちる' },
    ];
    expect(tabletViewOf(def, names, input({ milestones })).milestones).toEqual(['30 年目: 星が落ちる']);
  });

  it('警告は先頭の 3 つだけ。種の id を持つ警告にだけ「〜を見る」のチップを付け、名前の無い種は id で出す', () => {
    const warnings = [
      { kind: 'species_low', id: 'wolf', key: 'a', text: '狼が減った' },
      { kind: 'power_low', key: 'b', text: '力が足りない' },
      { kind: 'event', id: 'bear', key: 'c', text: '熊が来る' },
      { kind: 'land_low', key: 'd', text: '4 つ目は出さない' },
    ] as const;
    expect(tabletViewOf(def, names, input({ warnings: [...warnings] })).warnings).toEqual([
      { text: '⚠ 狼が減った', chip: { species: 'wolf', label: '狼を見る' } },
      { text: '⚠ 力が足りない', chip: null },
      { text: '⚠ 熊が来る', chip: { species: 'bear', label: 'bearを見る' } },
    ]);
  });

  it('年表は件数を題に、直近の 6 件だけを「年: 文」で並べる', () => {
    const timeline = Array.from({ length: 8 }, (_, i) => ({ year: i + 1, kind: 'intervene' as const, command: { type: 'spawn_species' as const, speciesId: 'deer', cell: 0, amount: 1 } }));
    const tl = tabletViewOf(def, names, input({ timeline })).timeline;
    expect(tl.summary).toBe('年表 (8)');
    expect(tl.lines).toEqual(['3 年: 鹿を放った', '4 年: 鹿を放った', '5 年: 鹿を放った', '6 年: 鹿を放った', '7 年: 鹿を放った', '8 年: 鹿を放った']);
  });

  it('力は budget のある石板だけ。力は切り捨て、直前の年の収入と維持費は 0 なら出さない', () => {
    const budget = { power: 7.9, max: 30, incomeLastYear: 1.26, upkeepLastYear: 0.5 };
    expect(tabletViewOf(withBudget, names, input({ budget })).power).toEqual({ value: '7 / 30', flow: '(+1.3/年、維持 −0.5/年)' });
    expect(tabletViewOf(withBudget, names, input({ budget: { ...budget, incomeLastYear: 0, upkeepLastYear: 0 } })).power).toEqual({ value: '7 / 30', flow: '' });
    expect(tabletViewOf(withBudget, names, input({ budget: { ...budget, incomeLastYear: 1, upkeepLastYear: 0 } })).power?.flow).toBe('(+1.0/年、維持 −0.0/年)');
    expect(tabletViewOf(def, names, input({ budget })).power).toBeNull();
    expect(tabletViewOf(withBudget, names, input({ budget: null })).power).toBeNull();
  });
});

describe('verdictViewOf (M21-09): 判定の板の文と持ち出しの出し分け', () => {
  const stats = { interventions: 4, powerSpent: 12.6, landRatio: 0.42, totals: { deer: 120.4, wolf: 3 } };

  it('題は生き延びた・次の島へ・滅びたの 3 つ。理由はそのまま出す', () => {
    expect(verdictViewOf({ status: 'alive', reason: 'r' }, undefined, def, names)).toMatchObject({ title: '島は生き延びた', reason: 'r' });
    expect(verdictViewOf({ status: 'escaped', reason: 'r' }, undefined, def, names).title).toBe('次の島へ');
    expect(verdictViewOf({ status: 'dead', reason: 'r' }, undefined, def, names).title).toBe('島は滅びた');
  });

  it('内訳は介入の回数・陸地率・種ごとの数の 3 行。使った力は budget のある石板だけ。内訳が無ければ行も無い', () => {
    expect(verdictViewOf({ status: 'alive', reason: 'r', stats }, undefined, def, names).stats).toEqual(['介入 4 回', '陸地率 42%', '鹿 120 · 狼 3']);
    expect(verdictViewOf({ status: 'alive', reason: 'r', stats }, undefined, withBudget, names).stats[0]).toBe('介入 4 回 · 使った力 13');
    expect(verdictViewOf({ status: 'alive', reason: 'r' }, undefined, def, names).stats).toEqual([]);
  });

  it('持ち出しの保存は escaped で持ち出しがあるときだけ、その持ち出しを出す', () => {
    const cargo = { species: ['deer'] } as unknown as Cargo;
    expect(verdictViewOf({ status: 'escaped', reason: 'r' }, cargo, def, names).cargo).toBe(cargo);
    expect(verdictViewOf({ status: 'escaped', reason: 'r' }, undefined, def, names).cargo).toBeNull();
    expect(verdictViewOf({ status: 'alive', reason: 'r' }, cargo, def, names).cargo).toBeNull();
    expect(verdictViewOf({ status: 'dead', reason: 'r' }, cargo, null, names).cargo).toBeNull();
  });
});
