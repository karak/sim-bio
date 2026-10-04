import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { recordChronicle } from '../../src/chronicle/recorder';
import { SIM_VERSION } from '../../src/simulation/version';
import type { SlotSave } from '../../src/persist/slotSave';
import type { ChronicleId } from '../../src/harbor/contract';
import { atOf, bootPlanOf, planOp, runPlan, searchFor, slotControlsOf, type At, type Effect, type Op, type Plan } from '../../src/app/place';
import { resumeIsland } from '../fixtures/resumeIsland';

const island = resumeIsland('test-quick', 5);
const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };
const titleOf = (id: string) => ({ 'test-quick': '試し読み', sinking: '沈む欠片' })[id] ?? id;

const free: At = { stage: 'free' };
const running: At = { stage: 'scenario', head, finished: false };
const finished: At = { stage: 'scenario', head, finished: true };
const visit: At = { stage: 'visit' };

/** main.ts と同じ組み立ての石板を n tick 進め、介入を 1 つ受けた枠の包み */
function scenarioSlot(n: number): Extract<SlotSave, { stage: 'scenario' }> {
  const world = World.create(island.config, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear });
  runner.update(world.snapshot());
  const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, head, () => runner.totalsByYear());
  expect(recorder.dispatch({ type: 'set_climate', rainScale: 1.1 }).ok).toBe(true);
  stepByYear(world, runner, n);
  return { stage: 'scenario', scenarioId: head.scenarioId, save: world.serialize(), runner: runner.save(), chronicle: recorder.current() };
}
const freeSlot: Extract<SlotSave, { stage: 'free' }> = { stage: 'free', save: World.create(island.config, { log: createMemorySink() }).serialize() };
const kinds = (effects: readonly Effect[]) => effects.map((e) => e.kind);

describe('操作の確かめと行き先 planOp (M21-07)', () => {
  it('planOp (M21-07): 新しい島は、自由モードでは確かめて島を作り直し、石板では確かめて石板を初めからにする。訪問では何もしない', () => {
    expect(planOp({ kind: 'new_island' }, free, titleOf)).toEqual({
      ask: { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)', ok: '新しい島を始める' },
      effects: [{ kind: 'new_world' }],
    });
    for (const at of [running, finished]) {
      expect(planOp({ kind: 'new_island' }, at, titleOf)).toEqual({
        ask: { title: '石板を初めから', message: '今の続きを捨てて、石板を初めからやり直しますか (判定の出た島は港へ出せるまま残ります)', ok: '初めからやり直す' },
        effects: [{ kind: 'new_world' }, { kind: 'restart', from: null }],
      });
    }
    expect(planOp({ kind: 'new_island' }, visit, titleOf)).toEqual({ ask: null, effects: [] });
  });

  it('planOp (M21-07): 同じ舞台の枠は確かめて差し替え、石板の枠なら石板を枠の時点から始め直して、その場で続きに書く', () => {
    expect(planOp({ kind: 'load', data: freeSlot, slot: 'manual-1' }, free, titleOf)).toEqual({
      ask: { title: '枠の島を読み込む', message: '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)', ok: '読み込む' },
      effects: [{ kind: 'replace', save: freeSlot.save, slot: 'manual-1' }],
    });
    expect(planOp({ kind: 'load', data: freeSlot, slot: null }, free, titleOf).effects).toEqual([{ kind: 'replace', save: freeSlot.save, slot: null }]);

    const slot = scenarioSlot(100);
    for (const at of [running, finished]) {
      expect(planOp({ kind: 'load', data: slot, slot: 'manual-2' }, at, titleOf)).toEqual({
        ask: { title: '枠の島を読み込む', message: '石板を枠の時点に戻しますか (今の続きは上書きされます)', ok: '読み込む' },
        effects: [
          { kind: 'replace', save: slot.save, slot: 'manual-2' },
          { kind: 'restart', from: { runner: slot.runner, chronicle: slot.chronicle } },
        ],
      });
    }
    // 読めない枠 (別の seed の年代記) も今と同じく確かめてから、島を差し替えずに記録だけ残す
    const other = { ...slot, chronicle: { ...slot.chronicle, seed: 7 } };
    expect(planOp({ kind: 'load', data: other, slot: 'manual-2' }, running, titleOf)).toEqual({
      ask: expect.objectContaining({ title: '枠の島を読み込む' }),
      effects: [{ kind: 'refuse', slot: 'manual-2', tick: slot.save.tick, error: 'Error: chronicle head differs' }],
    });
    // runner の無いファイルは確かめの中で投げる。投げずに、確かめてから記録に残す
    const bare = { ...slot, runner: undefined } as unknown as SlotSave;
    expect(planOp({ kind: 'load', data: bare, slot: null }, running, titleOf)).toEqual({
      ask: expect.objectContaining({ title: '枠の島を読み込む' }),
      effects: [{ kind: 'refuse', slot: null, tick: slot.save.tick, error: expect.stringMatching(/^TypeError: /) }],
    });
  });

  it('planOp (M21-07): 違う舞台の枠は確かめてから、読む枠の名前を置いてその舞台へ移る。ファイルなら置き場 (import) に置いてから移る', () => {
    const slot = scenarioSlot(10);
    expect(planOp({ kind: 'load', data: slot, slot: 'manual-2' }, free, titleOf)).toEqual({
      ask: { title: '舞台を移って読む', message: '石板『試し読み』の枠です。石板を開いて読みますか', ok: '移って読む' },
      effects: [{ kind: 'put_pending', slot: 'manual-2' }, { kind: 'flush' }, { kind: 'go', scenarioId: 'test-quick' }],
    });
    expect(planOp({ kind: 'load', data: slot, slot: null }, free, titleOf).effects).toEqual([
      { kind: 'stash_import', data: slot },
      { kind: 'put_pending', slot: 'import' },
      { kind: 'flush' },
      { kind: 'go', scenarioId: 'test-quick' },
    ]);
    expect(planOp({ kind: 'load', data: freeSlot, slot: null }, finished, titleOf)).toEqual({
      ask: { title: '舞台を移って読む', message: '自由モードの枠です。自由モードを開いて読みますか', ok: '移って読む' },
      effects: [{ kind: 'stash_import', data: freeSlot }, { kind: 'put_pending', slot: 'import' }, { kind: 'flush' }, { kind: 'go', scenarioId: null }],
    });
    const sinking = { ...slot, scenarioId: 'sinking' };
    expect(planOp({ kind: 'load', data: sinking, slot: 'manual-3' }, running, titleOf)).toEqual({
      ask: { title: '舞台を移って読む', message: '石板『沈む欠片』の枠です。石板を開いて読みますか', ok: '移って読む' },
      effects: [{ kind: 'put_pending', slot: 'manual-3' }, { kind: 'flush' }, { kind: 'go', scenarioId: 'sinking' }],
    });
  });

  // 表の読み方: ask は確かめの題 (null は確かめない)、to は確かめを受けた後に行うことの種類。
  // 枠へ保存は書いてある枠への上書き、読込は自由モードの枠 1 を読む。
  // 「枠を上書きする」と、判定の出た石板を離れる (「判定の出た島を離れる」) の 2 つは M21-04 の慎重な確かめで、残すかはユーザーの判断を待っている
  const ops: Record<string, Op> = {
    新しい島: { kind: 'new_island' },
    枠の読込: { kind: 'load', data: freeSlot, slot: 'manual-1' },
    枠へ保存: { kind: 'slot_save', slot: 'manual-1', overwrites: '枠 1 · 自由 · 3 年' },
    石板を選ぶ: { kind: 'select', scenarioId: 'test-quick' },
    訪れる: { kind: 'visit', href: '/?scenario=test-quick&visit=abc' },
  };
  const ats: Record<string, At> = { 自由: free, 走っている石板: running, 判定の出た石板: finished, 訪問: visit };
  const table: { op: string; at: string; ask: string | null; to: Effect['kind'][] }[] = [
    { op: '新しい島', at: '自由', ask: '新しい島', to: ['new_world'] },
    { op: '新しい島', at: '走っている石板', ask: '石板を初めから', to: ['new_world', 'restart'] },
    { op: '新しい島', at: '判定の出た石板', ask: '石板を初めから', to: ['new_world', 'restart'] },
    { op: '新しい島', at: '訪問', ask: null, to: [] },
    { op: '枠の読込', at: '自由', ask: '枠の島を読み込む', to: ['replace'] },
    { op: '枠の読込', at: '走っている石板', ask: '舞台を移って読む', to: ['put_pending', 'flush', 'go'] },
    { op: '枠の読込', at: '判定の出た石板', ask: '舞台を移って読む', to: ['put_pending', 'flush', 'go'] },
    { op: '枠の読込', at: '訪問', ask: null, to: [] },
    { op: '枠へ保存', at: '自由', ask: '枠を上書きする', to: ['save_slot'] },
    { op: '枠へ保存', at: '走っている石板', ask: '枠を上書きする', to: ['save_slot'] },
    { op: '枠へ保存', at: '判定の出た石板', ask: '枠を上書きする', to: ['save_slot'] },
    { op: '枠へ保存', at: '訪問', ask: null, to: [] },
    { op: '石板を選ぶ', at: '自由', ask: null, to: ['flush', 'go'] },
    { op: '石板を選ぶ', at: '走っている石板', ask: null, to: ['flush', 'go'] },
    { op: '石板を選ぶ', at: '判定の出た石板', ask: '判定の出た島を離れる', to: ['flush', 'go'] },
    { op: '石板を選ぶ', at: '訪問', ask: null, to: ['flush', 'go'] },
    { op: '訪れる', at: '自由', ask: null, to: ['assign'] },
    { op: '訪れる', at: '走っている石板', ask: null, to: ['assign'] },
    { op: '訪れる', at: '判定の出た石板', ask: '判定の出た島を離れる', to: ['assign'] },
    { op: '訪れる', at: '訪問', ask: null, to: ['assign'] },
  ];
  it.each(table)('planOp (M21-07): 操作 × 舞台 (自由・走っている石板・判定の出た石板・訪問) の表で、確かめの有無と行き先が決まる: $op × $at', ({ op, at, ask, to }) => {
    const plan = planOp(ops[op], ats[at], titleOf);
    expect({ ask: plan.ask?.title ?? null, to: kinds(plan.effects) }).toEqual({ ask, to });
  });

  it('planOp (M21-07): 行き先の中身。空きの枠へは確かめずに保存し、石板を選ぶと書き切ってからその石板へ、訪れる札はその道へ移る', () => {
    expect(planOp({ kind: 'slot_save', slot: 'manual-3', overwrites: null }, running, titleOf)).toEqual({ ask: null, effects: [{ kind: 'save_slot', slot: 'manual-3' }] });
    expect(planOp({ kind: 'select', scenarioId: null }, finished, titleOf).effects).toEqual([{ kind: 'flush' }, { kind: 'go', scenarioId: null }]);
    expect(planOp({ kind: 'visit', href: '/?scenario=sinking&visit=abc' }, free, titleOf).effects).toEqual([{ kind: 'assign', href: '/?scenario=sinking&visit=abc' }]);
  });
});

describe('今いる舞台と、確かめてから行う順 (M21-07)', () => {
  it('atOf (M21-07): 訪問なら訪問、石板なら判定が出ているか (runner が無ければ出ていない)、ほかは自由モード', () => {
    expect(atOf(true, head, 'dead')).toEqual({ stage: 'visit' });
    expect(atOf(false, head, 'running')).toEqual({ stage: 'scenario', head, finished: false });
    expect(atOf(false, head, null)).toEqual({ stage: 'scenario', head, finished: false });
    for (const status of ['alive', 'dead', 'escaped'] as const) expect(atOf(false, head, status)).toEqual({ stage: 'scenario', head, finished: true });
    expect(atOf(false, null, null)).toEqual({ stage: 'free' });
  });

  it('runPlan (M21-07): 確かめを断れば何もせず、受ければ effects を並びどおりに行い、失敗した所で残りをやめる', async () => {
    const plan: Plan = { ask: { title: 't', message: 'm', ok: 'o' }, effects: [{ kind: 'flush' }, { kind: 'go', scenarioId: null }] };
    const done: string[] = [];
    const perform = async (e: Effect) => (done.push(e.kind), true);
    await runPlan(plan, async () => false, perform);
    expect(done).toEqual([]);
    await runPlan(plan, async () => true, perform);
    expect(done).toEqual(['flush', 'go']);

    const asked: string[] = [];
    done.length = 0;
    const failing: Plan = { ask: null, effects: [{ kind: 'replace', save: freeSlot.save, slot: 'manual-1' }, { kind: 'restart', from: null }] };
    await runPlan(failing, async (a) => (asked.push(a.title), true), async (e) => (done.push(e.kind), e.kind !== 'replace'));
    expect({ asked, done }).toEqual({ asked: [], done: ['replace'] });
  });
});

const scenarios = [{ id: 'test-quick' }, { id: 'sinking' }];
const visitId = 'ab'.repeat(32) as ChronicleId;

describe('起動の舞台と戻し方 bootPlanOf (M21-07)', () => {
  it('bootPlanOf (M21-07): 知らない石板の URL は自由モードで開き、scenario と visit だけを消して player・dev は残す', () => {
    expect(bootPlanOf(`?scenario=nope&player=a&visit=${visitId}&dev=1`, scenarios, null)).toEqual({
      scenario: null,
      visitId: null,
      unknown: { scenarioId: 'nope', search: '?player=a&dev=1' },
      restore: [{ from: 'auto' }],
    });
    expect(bootPlanOf('?scenario=nope', scenarios, null).unknown).toEqual({ scenarioId: 'nope', search: '' });
    expect(bootPlanOf('?scenario=sinking&player=a', scenarios, null)).toMatchObject({ scenario: { id: 'sinking' }, unknown: null });
    expect(bootPlanOf('?player=a', scenarios, null)).toMatchObject({ scenario: null, unknown: null });
  });

  it('bootPlanOf (M21-07): 移ってきた枠があればそれから、無ければ石板は石板の続き・自由モードは自動の枠から戻す。訪問ではどれも戻さない', () => {
    expect(bootPlanOf('', scenarios, 'manual-2').restore).toEqual([{ from: 'slot', slot: 'manual-2' }, { from: 'auto' }]);
    expect(bootPlanOf('', scenarios, null).restore).toEqual([{ from: 'auto' }]);
    expect(bootPlanOf('?scenario=test-quick', scenarios, 'import').restore).toEqual([{ from: 'slot', slot: 'import' }, { from: 'scenario' }]);
    expect(bootPlanOf('?scenario=test-quick', scenarios, null).restore).toEqual([{ from: 'scenario' }]);
    expect(bootPlanOf(`?scenario=test-quick&visit=${visitId}`, scenarios, 'manual-1')).toMatchObject({ scenario: { id: 'test-quick' }, visitId, restore: [] });
    // 訪問の道は石板の中だけ (自由モードではその島を組めない)。読めない visit は訪問にしない
    expect(bootPlanOf(`?visit=${visitId}`, scenarios, null)).toMatchObject({ visitId: null, restore: [{ from: 'auto' }] });
    expect(bootPlanOf('?scenario=test-quick&visit=nope', scenarios, null)).toMatchObject({ visitId: null, restore: [{ from: 'scenario' }] });
  });
});

describe('石板を選んだ先の検索語 searchFor (M21-07)', () => {
  it('searchFor (M21-07): scenario だけを差し替え、ほかの検索語 (player・dev) は残す', () => {
    expect(searchFor('?scenario=test-quick&player=a&dev=1', 'sinking')).toBe('scenario=sinking&player=a&dev=1');
    expect(searchFor('?scenario=test-quick&dev=1', null)).toBe('dev=1');
    expect(searchFor('?player=a', 'sinking')).toBe('player=a&scenario=sinking');
  });
  it('searchFor (M26-02): 訪問中に石板を選ぶと visit を落とし、選んだ石板は自分の島として開く (他の検索語は残す)', () => {
    const next = searchFor(`?scenario=test-quick&visit=${visitId}&dev=1`, 'sinking');
    expect(next).toBe('scenario=sinking&dev=1');
    expect(bootPlanOf(`?${next}`, scenarios, null)).toMatchObject({ scenario: { id: 'sinking' }, visitId: null, restore: [{ from: 'scenario' }] });
    expect(searchFor(`?scenario=test-quick&visit=${visitId}`, null)).toBe('');
  });
  it('searchFor (M26-08): 「もう一度」は visit を残し、同じ訪問を開き直す。訪問が無ければ何も足さない', () => {
    const next = searchFor(`?scenario=test-quick&visit=${visitId}&dev=1`, 'test-quick', { keepVisit: true });
    expect(next).toBe(`scenario=test-quick&visit=${visitId}&dev=1`);
    expect(bootPlanOf(`?${next}`, scenarios, null)).toMatchObject({ scenario: { id: 'test-quick' }, visitId, restore: [] });
    expect(searchFor('?scenario=test-quick&dev=1', 'test-quick', { keepVisit: true })).toBe('scenario=test-quick&dev=1');
  });
});

describe('訪問中の「もう一度」 planOp retry (M26-08)', () => {
  it('planOp (M26-08): もう一度は visit を残す行き先 (keepVisit)、石板を選ぶは残さない。確かめは石板を選ぶと同じ', () => {
    const retry: Op = { kind: 'retry', scenarioId: 'test-quick' };
    expect(planOp(retry, visit, titleOf)).toEqual({ ask: null, effects: [{ kind: 'flush' }, { kind: 'go', scenarioId: 'test-quick', keepVisit: true }] });
    expect(planOp({ kind: 'select', scenarioId: 'test-quick' }, visit, titleOf)).toEqual({ ask: null, effects: [{ kind: 'flush' }, { kind: 'go', scenarioId: 'test-quick' }] });
    expect(planOp(retry, finished, titleOf).ask).toEqual(planOp({ kind: 'select', scenarioId: 'test-quick' }, finished, titleOf).ask);
    expect(planOp(retry, finished, titleOf).ask).not.toBeNull();
  });
});

describe('枠の札 slotControlsOf (M21-07)', () => {
  it('slotControlsOf (M21-07): 訪問では枠への保存・読込・ファイルの読込・新しい島を押せず、自動の枠へは保存できない', () => {
    const why = '訪れている島は差し替えられない (他人の島)';
    expect(slotControlsOf({ visiting: true, slot: 'manual-1', filled: true })).toEqual({ save: false, load: false, file: false, newIsland: false, why });
    expect(slotControlsOf({ visiting: true, slot: 'auto', filled: true })).toEqual({ save: false, load: false, file: false, newIsland: false, why });
    expect(slotControlsOf({ visiting: false, slot: 'auto', filled: true })).toEqual({ save: false, load: true, file: true, newIsland: true, why: '' });
    expect(slotControlsOf({ visiting: false, slot: 'manual-1', filled: false })).toEqual({ save: true, load: false, file: true, newIsland: true, why: '' });
    expect(slotControlsOf({ visiting: false, slot: 'manual-1', filled: true })).toEqual({ save: true, load: true, file: true, newIsland: true, why: '' });
  });
});
