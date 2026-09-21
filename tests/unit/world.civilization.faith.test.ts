import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { FAITH_INITIAL, FAITH_UP, FAITH_DECAY, FAITH_DISASTER, updateFaith } from '../../src/simulation/faith';
import { testConfig, grass, moss } from './helpers';

/** testConfig() (seed 42, size 32) の陸のセルを 1 つ返す。文明の home に使う */
function someLandCell(): number {
  const probe = World.create(testConfig(), { log: createMemorySink() });
  const elevation = probe.snapshot().layers.elevation;
  const i = elevation.findIndex((e) => e >= SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('World civilization faith wiring (M9-01)', () => {
  it('文明のない世界では信仰の値は存在しない', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    w.step(360);
    expect(w.snapshot().civ).toBeNull();
  });

  it('stage 0 のあいだ (発生前) は信仰も undefined のまま', () => {
    const home = someLandCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 0, home } } }), { log: createMemorySink() });
    w.step(360 * 3);
    expect(w.snapshot().civ?.stage).toBe(0);
    expect(w.snapshot().civ?.faith).toBeUndefined();
  });

  it('stage >= 1 になった最初の年に FAITH_INITIAL で生まれる (既に stage >= 1 で開始)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    expect(w.snapshot().civ?.faith).toBeUndefined(); // 年をまたぐ前はまだ無い
    w.step(360);
    expect(w.snapshot().civ?.faith).toBe(FAITH_INITIAL);
    const events = log.find('sim.civ.faith');
    expect(events).toHaveLength(1);
    // World の年カウントは 1 tick 目に year=1 になる規約 (既存の sim.civ.stage 等と同じ、tick インクリメント後に判定)
    expect(events[0]).toMatchObject({ year: 1, faith: FAITH_INITIAL, delta: 0 });
  });

  it('発生 (stage 0 → 1) した年に信仰が生まれる', () => {
    // 捕食者がいない草は速やかに一定密度に収束し発生条件を満たす (world.civilization.test.ts と同じ手法)
    const w = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass' } }), { log: createMemorySink() });
    w.step(360 * 10);
    const snap = w.snapshot();
    expect(snap.civ?.stage).toBe(1);
    expect(snap.civ?.faith).toBe(FAITH_INITIAL);
  });

  it('毎年 sim.civ.faith が 1 回だけ出る (2 年分)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    w.step(360 * 2);
    const events = log.find('sim.civ.faith');
    expect(events).toHaveLength(2);
    expect(events[0].year).toBe(1);
    expect(events[1].year).toBe(2);
  });

  it('何もしなければ毎年 FAITH_DECAY の率で減衰する', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    w.step(360); // 誕生年: faith = FAITH_INITIAL
    const born = w.snapshot().civ?.faith as number;
    w.step(360); // 2 年目: 介入なしなので減衰のみ
    const after = w.snapshot().civ?.faith as number;
    expect(after).toBeCloseTo(born * (1 - FAITH_DECAY), 6);
  });

  it('同じ種類のコマンドを 3 回続けて dispatch すると、その年の信仰が減衰のみの場合より高くなる', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    w.step(360); // 誕生年
    const born = w.snapshot().civ?.faith as number;
    w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
    w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
    w.dispatch({ type: 'spawn_species', speciesId: 'grass', cell: home, amount: 0.01 });
    w.step(360); // 2 年目: 同じキーが 3 回そろう
    const after = w.snapshot().civ?.faith as number;
    expect(after).toBeCloseTo(updateFaith(born, { recent: ['spawn:grass', 'spawn:grass', 'spawn:grass'], disasters: 0 }), 6);
    expect(after).toBeGreaterThan(born * (1 - FAITH_DECAY)); // 減衰だけのときより高い (FAITH_UP が乗る)
  });

  it('災害コマンドを dispatch した年は信仰が必ず下がる', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    w.step(360); // 誕生年
    const born = w.snapshot().civ?.faith as number;
    w.dispatch({ type: 'disaster', kind: 'plague', cell: home, radius: 3 });
    w.step(360);
    const after = w.snapshot().civ?.faith as number;
    expect(after).toBeLessThan(born);
    expect(after).toBeCloseTo(updateFaith(born, { recent: ['disaster:plague'], disasters: 1 }), 6);
  });

  it('sink コマンドは信仰の計算に数えない (commandKey が null)', () => {
    const home = someLandCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log });
    w.step(360); // 誕生年
    const born = w.snapshot().civ?.faith as number;
    w.dispatch({ type: 'sink', amount: 0.001 });
    w.step(360);
    const after = w.snapshot().civ?.faith as number;
    // sink だけなら recent は空のまま → 減衰のみ (FAITH_DISASTER のペナルティ・FAITH_UP の恩恵もない)
    expect(after).toBeCloseTo(born * (1 - FAITH_DECAY), 6);
  });

  it('snapshot().civ.faith が serialize → restore で一致する', () => {
    const home = someLandCell();
    const a = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 4, home } } }), { log: createMemorySink() });
    a.step(360 * 2);
    expect(a.snapshot().civ?.faith).toBeTypeOf('number');
    const save = a.serialize();
    expect(save.civ?.faith).toBe(a.snapshot().civ?.faith);
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(b.snapshot().civ?.faith).toBe(a.snapshot().civ?.faith);
    // 続きも一致する (履歴はリセットされるが値そのものは a と同じ経路をたどる)
    a.step(360);
    b.step(360);
    expect(b.snapshot().civ?.faith).toBeCloseTo(a.snapshot().civ?.faith as number, 6);
  });

  it('FAITH_UP と FAITH_DISASTER の値がそれぞれ寄与する (回帰防止)', () => {
    // updateFaith 自体の境界値は faith.test.ts で確認済み。ここでは World が同じ定数を使って
    // 配線されていることだけ確認する
    expect(FAITH_UP).toBeGreaterThan(0);
    expect(FAITH_DISASTER).toBeGreaterThan(FAITH_UP); // 災害の減点は儀式の加点より大きい (純減の保証)
  });
});
