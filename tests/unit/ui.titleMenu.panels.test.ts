import { describe, it, expect } from 'vitest';
import { CONFIG_ROWS, slotRowsOf } from '../../src/ui/titleMenu';
import type { SlotSummary } from '../../src/persist/slots';
import { DEFAULT_CONFIG, MOTIONS, QUALITIES, START_SPEEDS } from '../../src/persist/config';

const savedAt = new Date(2026, 9, 4, 18, 40).getTime();
const titleOf = (id: string) => ({ sinking: '沈む欠片' })[id] ?? id;

describe('ロードの板の枠の並び slotRowsOf (M24-02、W/F load-*.svg)', () => {
  it('自動の枠と枠 1〜3 をいつも 4 行並べ、空の枠は note が null (押せない)。中身は「舞台 · 年 · 保存の日時」', () => {
    const slots: SlotSummary[] = [
      { slot: 'auto', savedAt, year: 12, stage: 'free' },
      { slot: 'manual-1', savedAt: new Date(2026, 9, 3, 21, 12).getTime(), year: 34, stage: 'scenario', scenarioId: 'sinking' },
      { slot: 'manual-2', savedAt: new Date(2026, 9, 2, 9, 5).getTime(), year: 80, stage: 'free' },
    ];
    expect(slotRowsOf(slots, titleOf)).toEqual([
      { slot: 'auto', name: '自動の枠', note: '自由モード · 12 年 · 10/04 18:40' },
      { slot: 'manual-1', name: '枠 1', note: '石板『沈む欠片』 · 34 年 · 10/03 21:12' },
      { slot: 'manual-2', name: '枠 2', note: '自由モード · 80 年 · 10/02 09:05' },
      { slot: 'manual-3', name: '枠 3', note: null },
    ]);
  });

  it('何も保存が無ければ 4 行とも空', () => {
    expect(slotRowsOf([], titleOf).map((r) => r.note)).toEqual([null, null, null, null]);
  });
});

describe('コンフィグの板の行 CONFIG_ROWS (M24-02、W/F config-*.svg、決めること 2 の案 A)', () => {
  it('画質・動きを減らす・最初の速さの 3 行。札は置き場の値の並びと同じ数と順', () => {
    expect(CONFIG_ROWS.map((r) => r.legend)).toEqual(['画質', '動きを減らす', '最初の速さ']);
    expect(CONFIG_ROWS.map((r) => r.choices.map((c) => c.label))).toEqual([
      ['自動', '軽い', 'きれい'],
      ['OS に従う', '入', '切'],
      ['1x', '10x'],
    ]);
    expect(CONFIG_ROWS.map((r) => r.choices.map((c) => c.value))).toEqual([[...QUALITIES], [...MOTIONS], [...START_SPEEDS]]);
    expect(CONFIG_ROWS.map((r) => r.key)).toEqual(Object.keys(DEFAULT_CONFIG));
  });
});
