import { describe, it, expect } from 'vitest';
import { continueNoteOf, menuKeyOf, titleMenuOf } from '../../src/ui/titleMenu';
import type { SlotSummary } from '../../src/persist/slots';

const savedAt = new Date(2026, 9, 4, 18, 40).getTime();
const auto: SlotSummary = { slot: 'auto', savedAt, year: 12, stage: 'free' };

describe('タイトルのメニューの並び titleMenuOf (M24-01)', () => {
  it('続きが無ければ 4 行 (新規ゲーム・ロード・港・コンフィグ)、既定は新規ゲーム', () => {
    const m = titleMenuOf(null);
    expect(m.items.map((i) => i.label)).toEqual(['新規ゲーム', 'ロード', '港', 'コンフィグ']);
    expect(m.items[m.focus].id).toBe('new');
  });

  it('続きがあれば「続きから」を先頭に足し、既定にする。要約を添える', () => {
    const m = titleMenuOf(auto);
    expect(m.items.map((i) => i.label)).toEqual(['続きから', '新規ゲーム', 'ロード', '港', 'コンフィグ']);
    expect(m.focus).toBe(0);
    expect(m.items[0]).toEqual({ id: 'continue', label: '続きから', note: '自由モード · 12 年 · 10/04 18:40' });
  });

  it('要約は舞台・年・保存の日時 (月/日 時:分、0 で埋める)', () => {
    expect(continueNoteOf({ ...auto, year: 0, savedAt: new Date(2026, 0, 2, 3, 4).getTime() })).toBe('自由モード · 0 年 · 01/02 03:04');
  });
});

describe('メニューのキー menuKeyOf (M24-01、矢印・Enter・Esc)', () => {
  const rows: [key: string, at: number, count: number, out: ReturnType<typeof menuKeyOf>][] = [
    ['ArrowDown', 0, 4, { kind: 'move', to: 1 }],
    ['ArrowDown', 3, 4, { kind: 'move', to: 0 }],
    ['ArrowUp', 0, 4, { kind: 'move', to: 3 }],
    ['ArrowUp', 2, 5, { kind: 'move', to: 1 }],
    ['Home', 3, 4, { kind: 'move', to: 0 }],
    ['End', 0, 5, { kind: 'move', to: 4 }],
    ['Enter', 2, 4, { kind: 'activate', at: 2 }],
    [' ', 1, 4, null],
    ['Escape', 1, 4, { kind: 'back' }],
    ['a', 1, 4, null],
  ];
  it.each(rows)('%s (at %i of %i)', (key, at, count, out) => {
    expect(menuKeyOf(key, at, count)).toEqual(out);
  });
});
