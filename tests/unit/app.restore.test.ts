import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { recordChronicle } from '../../src/chronicle/recorder';
import { SIM_VERSION } from '../../src/simulation/version';
import type { IslandStore } from '../../src/persist/islandStore';
import type { LocalSave, SaveLog } from '../../src/persist/localSave';
import type { SlotSave } from '../../src/persist/slotSave';
import type { Restore } from '../../src/app/place';
import { restoreIsland, type RestoreDeps } from '../../src/app/restore';
import { resumeIsland } from '../fixtures/resumeIsland';

const island = resumeIsland('test-quick', 5);
const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };
const ORDER: readonly Restore[] = [{ from: 'slot', slot: 'manual-1' }, { from: 'scenario' }, { from: 'auto' }];

/** 石板の島を n tick 進めた、置き場の石板の続き (島・runner・年代記) */
function scenarioSave(n: number) {
  const world = World.create(island.config, { log: createMemorySink() });
  const runner = createScenarioRunner(island.def, world, { ticksPerYear: island.config.ticksPerYear });
  runner.update(world.snapshot());
  const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, head, () => runner.totalsByYear());
  world.step(n);
  return { save: world.serialize(), runner: runner.save(), chronicle: recorder.current() };
}
const freeSave = (n: number) => {
  const world = World.create(island.config, { log: createMemorySink() });
  world.step(n);
  return world.serialize();
};

type Has = { slot?: SlotSave; scenario?: ReturnType<typeof scenarioSave>; auto?: ReturnType<typeof freeSave> };

/** 置き場の偽物。どの置き場を読んだかを順に残す */
function setup(has: Has, over: Partial<RestoreDeps> = {}) {
  const read: string[] = [];
  const logs: { event: string; extra: Record<string, unknown> }[] = [];
  const localSave: Pick<LocalSave, 'loadSlot' | 'resume'> = {
    loadSlot: async (_slot, open) => (read.push('slot'), has.slot ? open(has.slot) : null),
    resume: async (restore, accept) => (read.push('auto'), has.auto && (accept?.(has.auto) ?? true) ? restore(has.auto) : null),
  };
  const store = {
    loadScenario: async () => (read.push('scenario'), has.scenario ? { ...has.scenario, chronicle: { ok: true, value: has.scenario.chronicle } } : null),
    setAsideScenario: async () => 'aside',
  } as unknown as IslandStore;
  const persistLog: SaveLog = (_level, event, _tick, extra = {}) => logs.push({ event, extra });
  const deps: RestoreDeps = { localSave, store, head, log: createMemorySink(), persistLog, seed: null, pending: null, ...over };
  return { deps, read, logs };
}

describe('起動の島の戻し方 restoreIsland (M27-03)', () => {
  it('並びどおり (枠 → 石板の続き → 自動の枠) に試し、最初に戻せた島で止める', async () => {
    const { deps, read } = setup({ scenario: scenarioSave(30), auto: freeSave(10) });
    const { resumed, fromSlot } = await restoreIsland(ORDER, deps);
    expect(read).toEqual(['slot', 'scenario']);
    expect(resumed?.world.snapshot().tick).toBe(30);
    expect(resumed?.runner?.scenarioId).toBe(head.scenarioId);
    expect(resumed?.chronicle?.scenarioId).toBe(head.scenarioId);
    expect(fromSlot).toBe(false);
  });

  it('fromSlot は枠から戻したときだけ。枠を読めれば後ろは読まない', async () => {
    const { deps, read } = setup({ slot: { stage: 'free', save: freeSave(20) }, auto: freeSave(10) }, { head: null });
    const { resumed, fromSlot } = await restoreIsland(ORDER, deps);
    expect(read).toEqual(['slot']);
    expect(resumed?.world.snapshot().tick).toBe(20);
    expect(fromSlot).toBe(true);
  });

  it('枠の包みは今の舞台と照らす。違う舞台の枠は戻さず投げる (読む側の loadSlot が受け止める)', async () => {
    const { deps } = setup({ slot: { stage: 'free', save: freeSave(20) } });
    await expect(restoreIsland(ORDER, deps)).rejects.toThrow('stage free, here scenario');
  });

  it('石板の頭が無ければ (自由モード・訪問) 石板の続きは読まずに次へ', async () => {
    const { deps, read } = setup({ scenario: scenarioSave(30), auto: freeSave(10) }, { head: null });
    const { resumed, fromSlot } = await restoreIsland(ORDER, deps);
    expect(read).toEqual(['slot', 'auto']);
    expect(resumed?.world.snapshot().tick).toBe(10);
    expect(resumed?.runner).toBeUndefined();
    expect(fromSlot).toBe(false);
  });

  it('自動の枠の続きは URL の seed= の島だけ戻す (M26-10)', async () => {
    const { deps } = setup({ auto: freeSave(10) }, { head: null, seed: island.config.seed + 1 });
    expect((await restoreIsland([{ from: 'auto' }], deps)).resumed).toBeNull();
    const same = setup({ auto: freeSave(10) }, { head: null, seed: island.config.seed });
    expect((await restoreIsland([{ from: 'auto' }], same.deps)).resumed?.world.snapshot().tick).toBe(10);
  });

  it('移ってきた枠が戻せなければ persist.slot.load.failed を残す。戻せたら残さない', async () => {
    const failed = setup({ auto: freeSave(10) }, { head: null, pending: 'manual-2' });
    expect((await restoreIsland(ORDER, failed.deps)).resumed?.world.snapshot().tick).toBe(10);
    expect(failed.logs).toEqual([{ event: 'persist.slot.load.failed', extra: { slot: 'manual-2' } }]);
    const loaded = setup({ slot: { stage: 'free', save: freeSave(20) } }, { head: null, pending: 'manual-2' });
    await restoreIsland(ORDER, loaded.deps);
    expect(loaded.logs).toEqual([]);
  });

  it('(M24-02) タイトルのロードから移ってきた枠 (pending に無く、戻し方の先頭にだけある) も、戻せなければ persist.slot.load.failed を残す', async () => {
    const failed = setup({ auto: freeSave(10) }, { head: null, pending: null });
    expect((await restoreIsland(ORDER, failed.deps)).resumed?.world.snapshot().tick).toBe(10);
    expect(failed.logs).toEqual([{ event: 'persist.slot.load.failed', extra: { slot: 'manual-1' } }]);
  });

  it('何も戻せなければ null (新しい島を作る)', async () => {
    const { deps } = setup({}, { head: null });
    expect(await restoreIsland(ORDER, deps)).toEqual({ resumed: null, fromSlot: false });
  });
});
