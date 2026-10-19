import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SIM_VERSION } from '../../src/simulation/version';
import { planSlotLoad, type SlotSave } from '../../src/persist/slotSave';
import type { SlotId } from '../../src/persist/slots';
import type { Continuation } from '../../src/persist/lastStage';
import { titleStepOf, type TitleAction, type TitleStep } from '../../src/ui/titleMenu';
import { resumeIsland } from '../fixtures/resumeIsland';

/**
 * タイトルのメニューの行き先 (M24-02)。メニューの行と板の札 → 行き先 (舞台・読む枠・確かめの有無)。
 * 読込と新しい島は操作画面と同じ planOp (M21-07) を、タイトル (舞台なし) から通る
 */
const island = resumeIsland('test-quick', 5);
const titleOf = (id: string) => ({ 'test-quick': '試し読み' })[id] ?? id;
const savedAt = new Date(2026, 9, 4, 18, 40).getTime();

const freeSlot: SlotSave = { stage: 'free', save: World.create(island.config, { log: createMemorySink() }).serialize() };
// 行き先の表は包みの舞台しか見ない (中身の確かめは移った先の起動が restoreIsland の checkSlot で行う)
const scenarioSlot = { stage: 'scenario', scenarioId: 'test-quick', save: freeSlot.save } as unknown as SlotSave;

const freeCont: Continuation = { stage: 'free', year: 12, savedAt };
const scenarioCont: Continuation = { stage: 'scenario', scenarioId: 'test-quick', title: '試し読み', year: 3, savedAt };

/** 表の 1 行の読み: to は舞台 (free・石板の id・板の名前・何もしない)、slot は移った先で読む枠 (null は読まない)、stash はファイルを置き場に置くか、fresh は新しい seed を引くか、ask は確かめの題 (null は確かめない) */
type Row = { to: string; slot: SlotId | 'import' | null; stash: boolean; fresh: boolean; ask: string | null };

function rowOf(step: TitleStep): Row {
  switch (step.kind) {
    case 'stay':
      return { to: 'stay', slot: null, stash: false, fresh: false, ask: null };
    case 'panel':
      return { to: `panel:${step.panel}`, slot: null, stash: false, fresh: false, ask: null };
    case 'enter':
      return { to: step.choice.kind === 'free' ? 'free' : step.choice.scenarioId, slot: null, stash: false, fresh: false, ask: null };
    case 'plan': {
      const effects = step.plan.effects;
      const go = effects.find((e) => e.kind === 'go');
      const pending = effects.find((e) => e.kind === 'put_pending');
      return {
        to: go?.kind === 'go' ? (go.scenarioId ?? 'free') : 'none',
        slot: pending?.kind === 'put_pending' ? pending.slot : null,
        stash: effects.some((e) => e.kind === 'stash_import'),
        fresh: effects.some((e) => e.kind === 'new_world'),
        ask: step.plan.ask?.title ?? null,
      };
    }
  }
}

const actions: Record<string, TitleAction> = {
  続きから: { kind: 'item', id: 'continue' },
  新規ゲーム: { kind: 'item', id: 'new' },
  ロード: { kind: 'item', id: 'load' },
  港: { kind: 'item', id: 'harbor' },
  コンフィグ: { kind: 'item', id: 'config' },
  '新規ゲーム > 自由モード': { kind: 'new_free' },
  '新規ゲーム > 石板を選ぶ': { kind: 'scenarios' },
  'ロード > 自動の枠 (自由モード)': { kind: 'load', data: freeSlot, slot: 'auto' },
  'ロード > 枠 1 (自由モード)': { kind: 'load', data: freeSlot, slot: 'manual-1' },
  'ロード > 枠 2 (石板)': { kind: 'load', data: scenarioSlot, slot: 'manual-2' },
  'ロード > ファイル (自由モード)': { kind: 'load', data: freeSlot, slot: null },
  'ロード > ファイル (石板)': { kind: 'load', data: scenarioSlot, slot: null },
};

const hands: Record<string, { continuation: Continuation | null; freeSaved: boolean }> = {
  空: { continuation: null, freeSaved: false },
  自動の枠あり: { continuation: freeCont, freeSaved: true },
  石板の続きだけ: { continuation: scenarioCont, freeSaved: false },
};

const table: ({ action: string; hand: string } & Row)[] = [
  { action: '続きから', hand: '自動の枠あり', to: 'free', slot: null, stash: false, fresh: false, ask: null },
  { action: '続きから', hand: '石板の続きだけ', to: 'test-quick', slot: null, stash: false, fresh: false, ask: null },
  { action: '続きから', hand: '空', to: 'stay', slot: null, stash: false, fresh: false, ask: null },
  // 新規ゲーム: 自動の枠が無ければそのまま seed 42 の最初の島 (M24-01 の道)。あれば板 (自由モード・石板を選ぶ) を開く
  { action: '新規ゲーム', hand: '空', to: 'free', slot: null, stash: false, fresh: false, ask: null },
  { action: '新規ゲーム', hand: '石板の続きだけ', to: 'free', slot: null, stash: false, fresh: false, ask: null },
  { action: '新規ゲーム', hand: '自動の枠あり', to: 'panel:new', slot: null, stash: false, fresh: false, ask: null },
  { action: 'ロード', hand: '空', to: 'panel:load', slot: null, stash: false, fresh: false, ask: null },
  { action: 'ロード', hand: '自動の枠あり', to: 'panel:load', slot: null, stash: false, fresh: false, ask: null },
  { action: '港', hand: '空', to: 'panel:harbor', slot: null, stash: false, fresh: false, ask: null },
  { action: 'コンフィグ', hand: '空', to: 'panel:config', slot: null, stash: false, fresh: false, ask: null },
  // 新規ゲームの板の自由モード: 自動の枠があれば確かめてから新しい seed の島 (M26-10)。無ければ確かめずに seed 42
  { action: '新規ゲーム > 自由モード', hand: '自動の枠あり', to: 'free', slot: null, stash: false, fresh: true, ask: '新しい島' },
  { action: '新規ゲーム > 自由モード', hand: '空', to: 'free', slot: null, stash: false, fresh: false, ask: null },
  { action: '新規ゲーム > 石板を選ぶ', hand: '自動の枠あり', to: 'panel:scenarios', slot: null, stash: false, fresh: false, ask: null },
  // ロード: タイトルには舞台が無いので、いつも包みの舞台へ移って読む (確かめは「舞台を移って読む」)
  { action: 'ロード > 自動の枠 (自由モード)', hand: '自動の枠あり', to: 'free', slot: 'auto', stash: false, fresh: false, ask: '舞台を移って読む' },
  { action: 'ロード > 枠 1 (自由モード)', hand: '自動の枠あり', to: 'free', slot: 'manual-1', stash: false, fresh: false, ask: '舞台を移って読む' },
  { action: 'ロード > 枠 1 (自由モード)', hand: '空', to: 'free', slot: 'manual-1', stash: false, fresh: false, ask: '舞台を移って読む' },
  { action: 'ロード > 枠 2 (石板)', hand: '自動の枠あり', to: 'test-quick', slot: 'manual-2', stash: false, fresh: false, ask: '舞台を移って読む' },
  { action: 'ロード > ファイル (自由モード)', hand: '空', to: 'free', slot: 'import', stash: true, fresh: false, ask: '舞台を移って読む' },
  { action: 'ロード > ファイル (石板)', hand: '石板の続きだけ', to: 'test-quick', slot: 'import', stash: true, fresh: false, ask: '舞台を移って読む' },
];

describe('タイトルのメニューの行き先 titleStepOf (M24-02)', () => {
  it.each(table)('titleStepOf: $action ($hand の手元) → $to', ({ action, hand, ...row }) => {
    expect(rowOf(titleStepOf(actions[action], { ...hands[hand], titleOf }))).toEqual(row);
  });

  it('titleStepOf: 新規ゲームの板の自由モードは、操作画面の「新しい島」と同じ確かめの文を出し、新しい島の後に自由モードへ移る', () => {
    expect(titleStepOf({ kind: 'new_free' }, { ...hands['自動の枠あり'], titleOf })).toEqual({
      kind: 'plan',
      plan: {
        ask: { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)', ok: '新しい島を始める' },
        effects: [{ kind: 'new_world' }, { kind: 'go', scenarioId: null }],
      },
    });
  });

  it('titleStepOf: 枠の読込は操作画面の「違う舞台の枠」と同じ並び (読む枠を置き、書き切り、移る)。ファイルは置き場 (import) に置いてから', () => {
    expect(titleStepOf({ kind: 'load', data: scenarioSlot, slot: 'manual-2' }, { ...hands['空'], titleOf })).toEqual({
      kind: 'plan',
      plan: {
        ask: { title: '舞台を移って読む', message: '石板『試し読み』の枠です。石板を開いて読みますか', ok: '移って読む' },
        effects: [{ kind: 'put_pending', slot: 'manual-2' }, { kind: 'flush' }, { kind: 'go', scenarioId: 'test-quick' }],
      },
    });
    expect(titleStepOf({ kind: 'load', data: freeSlot, slot: null }, { ...hands['空'], titleOf })).toEqual({
      kind: 'plan',
      plan: {
        ask: { title: '舞台を移って読む', message: '自由モードの枠です。自由モードを開いて読みますか (自動の枠は上書きされます)', ok: '移って読む' },
        effects: [{ kind: 'stash_import', data: freeSlot }, { kind: 'put_pending', slot: 'import' }, { kind: 'flush' }, { kind: 'go', scenarioId: null }],
      },
    });
  });
});

describe('タイトルから枠を読む行き先 planSlotLoad (M24-02)', () => {
  const head = { simVersion: SIM_VERSION, scenarioId: 'test-quick', seed: island.config.seed };

  it('planSlotLoad: タイトル (舞台なし) からは、どの枠も包みの舞台へ移って読む。自由モードの枠は自動の枠が上書きされると添える', () => {
    expect(planSlotLoad({ stage: 'free' }, { stage: 'title' }, titleOf)).toEqual({
      kind: 'navigate',
      to: { stage: 'free' },
      confirm: '自由モードの枠です。自由モードを開いて読みますか (自動の枠は上書きされます)',
    });
    expect(planSlotLoad({ stage: 'scenario', scenarioId: 'test-quick' }, { stage: 'title' }, titleOf)).toEqual({
      kind: 'navigate',
      to: { stage: 'scenario', scenarioId: 'test-quick' },
      confirm: '石板『試し読み』の枠です。石板を開いて読みますか',
    });
  });

  it('planSlotLoad: 舞台の中の文は変えない (操作画面の移って読む文は自動の枠に触れない)', () => {
    expect(planSlotLoad({ stage: 'free' }, { stage: 'scenario', head }, titleOf).confirm).toBe('自由モードの枠です。自由モードを開いて読みますか');
  });
});
