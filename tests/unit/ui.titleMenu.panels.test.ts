import { describe, it, expect } from 'vitest';
import { CONFIG_ROWS, scenarioRowsOf, slotRowsOf } from '../../src/ui/titleMenu';
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

describe('石板の板の並び scenarioRowsOf (M24-03、W/F new-game-*.svg、docs/uiux/2026-10-04-title-flow.md の M24-03 への申し送り)', () => {
  const defs = [
    { id: 'sinking', title: '沈む欠片', kind: 'endure', years: 100, prophecy: '島は沈む。', hidden: undefined },
    { id: 'test-quick', title: '試し読み', kind: 'endure', years: 5, prophecy: '試し。', hidden: true },
    { id: 'enrichment', title: '豊かさの罠', kind: 'prevent', years: 100, prophecy: '豊かさが罠になる。' },
    { id: 'sky-ship', title: '空の舟', kind: 'escape', years: 200, prophecy: '舟を出せ。' },
  ] as const;

  it('操作画面の石板 (Tablet の select) と同じく hidden を除き、同じ順。題・種類と年数・予言を出す。続きを読む前は添え書きが無く「この石板で始める」', () => {
    expect(scenarioRowsOf(defs, {})).toEqual([
      { id: 'sinking', title: '沈む欠片', meta: '耐える · 100 年', prophecy: '島は沈む。', note: null, start: 'この石板で始める' },
      { id: 'enrichment', title: '豊かさの罠', meta: '防ぐ · 100 年', prophecy: '豊かさが罠になる。', note: null, start: 'この石板で始める' },
      { id: 'sky-ship', title: '空の舟', meta: '逃がす · 200 年', prophecy: '舟を出せ。', note: null, start: 'この石板で始める' },
    ]);
  });

  it('判定の前の続きがある石板は「続きあり · N 年」で「続きから始める」。判定の出た石板は開き直すと初めから (M19-14) なので、そう添えて「この石板で始める」', () => {
    const rows = scenarioRowsOf(defs, {
      sinking: { scenarioId: 'sinking', year: 34, finished: false },
      enrichment: { scenarioId: 'enrichment', year: 100, finished: true },
      'sky-ship': null,
    });
    expect(rows.map((r) => [r.id, r.note, r.start])).toEqual([
      ['sinking', '続きあり · 34 年', '続きから始める'],
      ['enrichment', '判定が出ている · 開くと初めから', 'この石板で始める'],
      ['sky-ship', null, 'この石板で始める'],
    ]);
  });
});
