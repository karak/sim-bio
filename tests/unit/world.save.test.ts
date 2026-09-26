import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { testConfig } from './helpers';
import { resumeIsland } from '../fixtures/resumeIsland';
import type { Command, SaveData, WorldMemory } from '../../src/simulation/types';

/** testConfig() (seed 42, size 32) の陸のセルを 1 つ返す。文明の home に使う */
function someLandCell(): number {
  const probe = World.create(testConfig(), { log: createMemorySink() });
  const elevation = probe.snapshot().layers.elevation;
  const i = elevation.findIndex((e) => e >= SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('World save/restore', () => {
  it('round-trips snapshot exactly and continues identically', () => {
    const a = World.create(testConfig(), { log: createMemorySink() });
    a.step(400);
    a.dispatch({ type: 'set_climate', tempOffset: 2 });
    a.step(10);
    const save = a.serialize();
    expect(save.grazed).toHaveLength(32 * 32);
    expect(save.vitality).toHaveLength(32 * 32);
    expect(save.litter).toHaveLength(32 * 32);
    expect(save.crystal).toHaveLength(32 * 32);
    const json = JSON.stringify(save);
    const b = World.restore(JSON.parse(json), { log: createMemorySink() });
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation));
    expect(Array.from(b.snapshot().layers.crystal)).toEqual(Array.from(a.snapshot().layers.crystal));
    expect(b.snapshot().tick).toBe(a.snapshot().tick);
    a.step(100);
    b.step(100);
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation));
    expect(b.snapshot().meanTemperature).toBeCloseTo(a.snapshot().meanTemperature, 5);
  });

  it('古いセーブ (crystal 無し) を読み込むと seed から決定論的に埋め直される', () => {
    const a = World.create(testConfig(), { log: createMemorySink() });
    const save = a.serialize();
    delete save.crystal;
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(Array.from(b.snapshot().layers.crystal)).toEqual(Array.from(a.snapshot().layers.crystal));
  });

  it('civilization ありのセーブは civ ごと往復し、続きも一致する (M8-02)', () => {
    const a = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 3, home: someLandCell() } } }), { log: createMemorySink() });
    a.step(200);
    const save = a.serialize();
    expect(save.civ).toEqual(a.snapshot().civ);
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(b.snapshot().civ).toEqual(a.snapshot().civ);
    a.step(100);
    b.step(100);
    expect(b.snapshot().civ).toEqual(a.snapshot().civ);
  });
});

describe('途中で閉じた島の続き (M19-14): 年の中と年をまたぐ数えもセーブに持つ', { timeout: 60_000 }, () => {
  const { config } = resumeIsland('no-answer', 0);
  const home = config.civilization?.start?.home ?? -1;
  const T = config.ticksPerYear;
  const YEARS = 5;
  const commands: readonly { tick: number; command: Command }[] = [
    // 集落の 4 マス北。草の芽吹いた最初の年なら燃え広がる
    { tick: 50, command: { type: 'disaster', kind: 'wildfire', cell: home - 4 * config.size, radius: 0 } },
    { tick: 100, command: { type: 'set_climate', rainScale: 1.3 } },
    { tick: 500, command: { type: 'disaster', kind: 'plague', cell: home, radius: 3 } },
    { tick: 900, command: { type: 'spawn_species', speciesId: 'deer', cell: home, amount: 0.5, radius: 1 } },

  ];

  /** cut の tick で serialize → JSON → restore する。queued なら、その tick の命令を積んでから閉じる (積んだまま step していない) */
  function play(cut: number | null, queued = false): { years: string[]; last: SaveData; closed?: SaveData } {
    let w = World.create(config, { log: createMemorySink() });
    const years: string[] = [];
    let closed: SaveData | undefined;
    for (let t = 0; t < YEARS * T; t++) {
      const dispatch = () => commands.filter((c) => c.tick === t).forEach((c) => w.dispatch(c.command));
      if (queued) dispatch();
      if (t === cut) {
        closed = JSON.parse(JSON.stringify(w.serialize())) as SaveData;
        w = World.restore(closed, { log: createMemorySink() });
      }
      if (!queued) dispatch();
      w.step(1);
      if ((t + 1) % T === 0) years.push(JSON.stringify(w.serialize()));
    }
    return { years, last: w.serialize(), closed };
  }

  const live = play(null);

  const closedWith = {
    none: () => true,
    fire: (m: WorldMemory) => m.fire.includes(1) && m.burnt.some((b) => b > 0),
    queue: (m: WorldMemory) => m.queue.length === 1,
  };
  it.each([
    ['年の境目 (2 年目の初め)', 2 * T, false, closedWith.none],
    ['年の途中 (2 年目の半ば)', 2 * T + 180, false, closedWith.none],
    ['山火事が燃えている最中', 52, false, closedWith.fire],
    ['介入を積んだ直後 (まだ step していない)', 900, true, closedWith.queue],
  ])('%s で閉じて開き直した島は、閉じずに回した島と毎年の終わりのセーブが最後の桁まで同じ', (_, cut, queued, holds) => {
    const resumed = play(cut, queued);
    const memory = resumed.closed?.memory;
    if (!memory) throw new Error('closed without memory');
    expect(holds(memory)).toBe(true);
    expect(resumed.years.findIndex((y, i) => y !== live.years[i])).toBe(-1);
    expect(resumed.last).toEqual(live.last);
  });

  it('文明の数え (信仰の履歴・祈りの基準) が溜まっている', () => {
    expect(live.last.memory?.civ?.faithHistory.length).toBeGreaterThan(0);
    expect(live.last.memory?.civ?.prayerHistory.length).toBeGreaterThan(0);
  });

  it('JSON にできる (祈りの間の -Infinity は null にする)', () => {
    const fresh = World.create(config, { log: createMemorySink() }).serialize();
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
  });

  it('memory の無い古いセーブも読め、restore の直後から数え直す (M19-05 までの挙動)', () => {
    const w = World.create(config, { log: createMemorySink() });
    w.step(T + 10);
    const old: SaveData = { ...w.serialize(), memory: undefined };
    const b = World.restore(JSON.parse(JSON.stringify(old)) as SaveData, { log: createMemorySink() });
    expect(b.snapshot().tick).toBe(T + 10);
    b.step(T);
    expect(b.serialize().memory?.civ?.faithHistory).toHaveLength(1);
  });
});
