import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SHIP_FAITH, SHIP_NEED, SHIP_STAGE } from '../../src/simulation/ship';
import { LOAD_RADIUS } from '../../src/simulation/civilizationLoad';
import { testConfig, grass, forest, moss } from './helpers';

/** 舟の文明 (草、島中に森があるので材は足りる)。薪の蓄えで燃料切れを避ける */
function mk(over: { stage?: number; faith?: number; fuelStock?: number; shipProgress?: number } = {}) {
  const log = createMemorySink();
  const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
  const w = World.create(
    testConfig({
      civilization: { speciesId: 'grass', start: { stage: over.stage ?? SHIP_STAGE, home, fuelStock: over.fuelStock ?? 900, faith: over.faith ?? 1, shipProgress: over.shipProgress } },
    }),
    { log },
  );
  return { w, log, home };
}
/** 森が全く無い世界 (材不足の門を確かめる用)。forest の initialDensity を 0 に落とす */
const forestZero = { ...forest, initialDensity: 0 };

describe('空の舟 (M10-03、World): launch_ship の門', () => {
  it('文明が無ければ拒否し、状態は変わらない', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(w.snapshot().ship).toBeNull();
    expect(log.find('cmd.rejected')[0]).toMatchObject({ reason: '文明がない' });
  });
  it('段階が帆に満たなければ拒否し、状態は変わらない', () => {
    const { w, log } = mk({ stage: SHIP_STAGE - 1 });
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(w.snapshot().ship).toBeNull();
    expect(log.find('cmd.rejected')[0]).toMatchObject({ reason: '段階が帆に満たない' });
  });
  it('信仰が足りなければ拒否し、理由に信仰の値を含む。状態は変わらない', () => {
    const { w, log } = mk({ faith: SHIP_FAITH - 0.1 });
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(w.snapshot().ship).toBeNull();
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('信仰が足りない');
  });
  it('材が足りなければ拒否し、状態は変わらない', () => {
    const log = createMemorySink();
    const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
    const w = World.create(testConfig({ species: [grass, forestZero, moss], civilization: { speciesId: 'grass', start: { stage: SHIP_STAGE, home, fuelStock: 900, faith: 1 } } }), { log });
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(w.snapshot().ship).toBeNull();
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('材が足りない');
  });
  it('着工中に二度目の launch_ship は拒否 (舟は既に建造中)', () => {
    const { w, log } = mk();
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(w.snapshot().ship).not.toBeNull();
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    expect(log.find('cmd.rejected')[0]).toMatchObject({ reason: '舟は既に建造中' });
  });
});

describe('空の舟 (M10-03、World): 着工の受理と進み', () => {
  it('全ての門を満たせば着工し、ship = { startedYear, progress: 0 } になり sim.ship.started が出る', () => {
    const { w, log } = mk();
    w.dispatch({ type: 'launch_ship' });
    w.step(1);
    const ship = w.snapshot().ship;
    expect(ship).toEqual({ startedYear: 0, progress: 0 });
    const started = log.find('sim.ship.started');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ year: 0 });
    expect(typeof started[0].timber).toBe('number');
  });
  it('年に一度、材を伐って進みに積む: 半径内の森は基準世界より減り、半径の外は変わらない', () => {
    const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
    const cfg = testConfig({ civilization: { speciesId: 'grass', start: { stage: SHIP_STAGE, home, fuelStock: 900, faith: 1 } } });
    const withShip = World.create(cfg, { log: createMemorySink() });
    const baseline = World.create(cfg, { log: createMemorySink() });
    withShip.dispatch({ type: 'launch_ship' });
    withShip.step(360);
    baseline.step(360);
    const s = withShip.snapshot();
    const b = baseline.snapshot();
    expect(s.ship).not.toBeNull();
    expect(s.ship!.progress).toBeGreaterThan(0);
    expect(s.layers.populations.forest[home]).toBeLessThan(b.layers.populations.forest[home]);
    // 半径のずっと外 (LOAD_RADIUS[SHIP_STAGE] を大きく超える距離) は舟の有無で変わらない (applyLoad と同じ半径なので、
    // 文明の負荷そのものも掛からない距離を選ぶ)
    const radius = LOAD_RADIUS[SHIP_STAGE];
    let far = -1;
    for (let i = 0; i < s.layers.elevation.length; i++) {
      if (s.layers.elevation[i] < 0.3) continue;
      const x = i % 32;
      const y = (i - x) / 32;
      const hx = home % 32;
      const hy = (home - hx) / 32;
      if (Math.hypot(x - hx, y - hy) > radius + 4) {
        far = i;
        break;
      }
    }
    expect(far).toBeGreaterThanOrEqual(0);
    expect(s.layers.populations.forest[far]).toBeCloseTo(b.layers.populations.forest[far], 6);
  });
  it('材が 0 になれば進みは頭打ちのまま (sim.ship.progress の cut が 0 になる)', () => {
    const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
    const log = createMemorySink();
    const w = World.create(testConfig({ species: [grass, forestZero, moss], civilization: { speciesId: 'grass', start: { stage: SHIP_STAGE, home, fuelStock: 900, faith: 1, shipProgress: 1 } } }), { log });
    w.step(360);
    expect(w.snapshot().ship).toEqual({ startedYear: 0, progress: 1 });
    const progress = log.find('sim.ship.progress');
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({ cut: 0, progress: 1 });
  });
});

describe('空の舟 (M10-03、World): 完成と信仰の門', () => {
  it('完成しても信仰が SHIP_FAITH 未満なら飛び立たず、sim.ship.waiting が出る。毎年再判定する', () => {
    const { w, log } = mk({ faith: SHIP_FAITH - 0.1, shipProgress: SHIP_NEED - 0.01 });
    w.step(360);
    const ship = w.snapshot().ship!;
    expect(ship.progress).toBeGreaterThanOrEqual(SHIP_NEED);
    expect(ship.launchedYear).toBeUndefined();
    expect(log.find('sim.ship.waiting')).toHaveLength(1);
    expect(log.find('sim.ship.launched')).toHaveLength(0);
  });
  it('信仰が SHIP_FAITH 以上で完成すれば飛び立ち、sim.ship.launched が出る (種の数を含む)', () => {
    const { w, log } = mk({ faith: 1, shipProgress: SHIP_NEED - 0.01 });
    w.step(360);
    const ship = w.snapshot().ship!;
    // 最初の年境界は tick 360 で年 1 (stepCivYearly は tick を進めた後に呼ばれる。works.test.ts と同じ流儀)
    expect(ship.launchedYear).toBe(1);
    const launched = log.find('sim.ship.launched');
    expect(launched).toHaveLength(1);
    expect(typeof launched[0].species).toBe('number');
    expect(Number(launched[0].species)).toBeGreaterThan(0);
    // 飛び立った後は進みも伐採も止まる
    const before = ship.progress;
    w.step(360);
    expect(w.snapshot().ship).toEqual({ startedYear: 0, progress: before, launchedYear: 1 });
  });
});

describe('空の舟 (M10-03、World): 崩壊で失う', () => {
  it('未発進の舟は文明が崩壊 (段階 0) すると失われ、sim.ship.lost が出る', () => {
    const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
    const base = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 1, home, fuelStock: 900, faith: 0.1 } } }), { log: createMemorySink() });
    const save = base.serialize();
    save.ship = { startedYear: 0, progress: 5 };
    const log = createMemorySink();
    const w = World.restore(save, { log });
    expect(w.snapshot().ship).toEqual({ startedYear: 0, progress: 5 });
    // 信仰が低いまま (UNREST_YEARS=3 年) 続けば内乱で段階 1 → 0 (崩壊)。少し余裕を見て 6 年進める
    w.step(360 * 6);
    expect(w.snapshot().civ!.stage).toBe(0);
    expect(w.snapshot().ship).toBeNull();
    expect(log.find('sim.ship.lost')).toHaveLength(1);
  });
  it('既に飛び立った舟は崩壊しても失われない', () => {
    const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
    const base = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 1, home, fuelStock: 900, faith: 0.1 } } }), { log: createMemorySink() });
    const save = base.serialize();
    save.ship = { startedYear: 0, progress: SHIP_NEED, launchedYear: 0 };
    const w = World.restore(save, { log: createMemorySink() });
    w.step(360 * 6);
    expect(w.snapshot().civ!.stage).toBe(0);
    expect(w.snapshot().ship).toEqual({ startedYear: 0, progress: SHIP_NEED, launchedYear: 0 });
  });
});

describe('空の舟 (M10-03、World): 保存・復元、shipProgress の開始指定', () => {
  it('start.shipProgress を指定すると年 0 に着工した舟をその進みで持つ', () => {
    const { w } = mk({ shipProgress: 4.5 });
    expect(w.snapshot().ship).toEqual({ startedYear: 0, progress: 4.5 });
  });
  it('serialize → restore で ship が保たれる', () => {
    const { w } = mk();
    w.dispatch({ type: 'launch_ship' });
    w.step(360);
    const before = w.snapshot().ship;
    expect(before).not.toBeNull();
    const save = w.serialize();
    expect(save.ship).toEqual(before);
    const r = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(r.snapshot().ship).toEqual(before);
  });
  it('古いセーブ (ship 無し) は null として復元できる', () => {
    const { w } = mk();
    const save = w.serialize();
    delete save.ship;
    const r = World.restore(save, { log: createMemorySink() });
    expect(r.snapshot().ship).toBeNull();
  });
});

describe('舟の保存 (M10 レビュー): セーブに舟が無ければ復元後も無い', () => {
  it('start.shipProgress のある設定でも、舟の無いセーブを読めば舟は無い (崩壊で失った舟が戻らない)', () => {
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 5, home: 16 * 32 + 16, fuelStock: 100, shipProgress: 9 } } }), { log: createMemorySink() });
    expect(w.snapshot().ship?.progress).toBe(9);
    const save = w.serialize();
    delete save.ship;
    const r = World.restore(save, { log: createMemorySink() });
    expect(r.snapshot().ship).toBeNull();
  });
});
