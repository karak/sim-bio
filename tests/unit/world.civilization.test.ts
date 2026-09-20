import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { MINE_RADIUS, NEED, MINE_RATE } from '../../src/simulation/civilization';
import { testConfig, grass, moss } from './helpers';

/** testConfig() の地形 (seed 42, size 32) の陸で最も輝石が多いセルを探す。地形は決定論なので毎回同じ */
function bestCrystalCell(): number {
  const probe = World.create(testConfig(), { log: createMemorySink() });
  const s = probe.snapshot();
  let home = -1;
  let best = 0;
  for (let i = 0; i < s.layers.crystal.length; i++) {
    if (s.layers.elevation[i] >= SEA_LEVEL && s.layers.crystal[i] > best) {
      best = s.layers.crystal[i];
      home = i;
    }
  }
  expect(home).toBeGreaterThanOrEqual(0);
  return home;
}

describe('World civilization wiring (M8-02)', () => {
  it('config.civilization が無い既定の世界では civ は null で、summary に civStage は出ない', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.step(360);
    expect(w.snapshot().civ).toBeNull();
    const summary = log.find('sim.tick.summary');
    expect(summary).toHaveLength(1);
    expect(summary[0].civStage).toBeUndefined();
  });

  it('発生条件を満たすと stage 0 → 1 になり sim.civ.emerged を出す (振動しない草だけの世界)', () => {
    // 捕食者がいない草は速やかに一定密度 (振幅比 0) に収束し、植生 (=自分自身) も高いので発生条件を満たす
    const log = createMemorySink();
    const w = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass' } }), { log });
    w.step(360 * 10);
    const snap = w.snapshot();
    expect(snap.civ?.stage).toBe(1);
    expect(snap.civ?.home).toBeGreaterThanOrEqual(0);
    const events = log.find('sim.civ.emerged');
    expect(events).toHaveLength(1);
    expect(events[0].speciesId).toBe('grass');
    expect(events[0].home).toBe(snap.civ?.home);
  });

  it('civilization を設定すると snapshot().civ に反映され、summary に civStage/civProgress が出る', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    expect(w.snapshot().civ).toEqual({ speciesId: 'grass', stage: 4, progress: 0, home, population: 0 });
    w.step(360);
    const summary = log.find('sim.tick.summary');
    expect(summary).toHaveLength(1);
    expect(typeof summary[0].civStage).toBe('number');
    expect(typeof summary[0].civProgress).toBe('number');
  });

  it('stage >= 1 なら毎 tick、home 周辺の輝石が掘られて減る', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log: createMemorySink() });
    const before = w.snapshot().layers.crystal[home];
    w.step(50);
    const after = w.snapshot().layers.crystal[home];
    expect(after).toBeLessThan(before);
  });

  it('NEED に到達すると sim.civ.stage をログに出す', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    // stage 2 → 3 で試す (M8-08: FUEL_NEED は stage 4 以降だけ 0 でないので、燃料切れの段階下げと
    // 競合しない範囲で採掘による段階上昇だけを見たい)
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 2, home } } }), { log });
    // NEED[2] を MINE_RATE[2] で掘り切るのに必要な tick 数より十分多く回す
    const ticksNeeded = Math.ceil(NEED[2] / MINE_RATE[2]) + 20;
    w.step(ticksNeeded);
    const events = log.find('sim.civ.stage');
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].from).toBe(2);
    expect(events[0].to).toBe(3);
    expect(typeof events[0].year).toBe('number');
  });

  it('save/restore で civ が丸ごと往復する', () => {
    const home = bestCrystalCell();
    const a = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 2, home } } }), { log: createMemorySink() });
    a.step(200);
    const save = a.serialize();
    expect(save.civ).toBeDefined();
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(b.snapshot().civ).toEqual(a.snapshot().civ);
  });

  it('config.civilization の無い世界の serialize には civ が入らない', () => {
    const a = World.create(testConfig(), { log: createMemorySink() });
    const save = a.serialize();
    expect(save.civ).toBeUndefined();
  });

  it('MINE_RADIUS[stage] の外の輝石は掘られない', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 1, home } } }), { log: createMemorySink() });
    const before = Array.from(w.snapshot().layers.crystal);
    w.step(50);
    const after = w.snapshot().layers.crystal;
    const elevation = w.snapshot().layers.elevation;
    const size = w.snapshot().size;
    const cx = home % size;
    const cy = (home - cx) / size;
    const radius = MINE_RADIUS[1];
    for (let i = 0; i < after.length; i++) {
      if (elevation[i] < SEA_LEVEL) continue;
      const x = i % size;
      const y = (i - x) / size;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) expect(after[i]).toBeCloseTo(before[i], 6);
    }
  });
});
