import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { FUEL_NEED, FUEL_YEARS } from '../../src/simulation/civilizationFuel';
import { testConfig } from './helpers';

/** testConfig() の中心セル。既定のシナリオ開始地点と同じ規約 (resolveCivilizationStart) */
function centerHome(size: number): number {
  return Math.floor(size / 2) * size + Math.floor(size / 2);
}

describe('World volcanoCell (M8-08)', () => {
  it('config.volcanoCell が無ければ標高最大の陸セルを既定にし、snapshot にも同じ値が入る', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const snap = w.snapshot();
    let expected = -1;
    let best = -Infinity;
    for (let i = 0; i < snap.layers.elevation.length; i++) {
      if (snap.layers.elevation[i] >= SEA_LEVEL && snap.layers.elevation[i] > best) {
        best = snap.layers.elevation[i];
        expected = i;
      }
    }
    expect(w.volcanoCell()).toBe(expected);
    expect(snap.volcanoCell).toBe(expected);
  });

  it('config.volcanoCell があればそれを使う (M8-09 の校正: 標高最大セルは寒すぎて炎蜥蜴が湧かないため、暖かい低地を指定できる)', () => {
    const size = 32;
    const warmCell = centerHome(size); // 標高最大セルとは限らない任意のセル。ここでは中心を仮の「暖かい低地」とする
    const w = World.create(testConfig({ size, volcanoCell: warmCell }), { log: createMemorySink() });
    expect(w.volcanoCell()).toBe(warmCell);
    expect(w.snapshot().volcanoCell).toBe(warmCell);
  });
});

describe('World tower fuel (M8-08)', () => {
  it('stage 6、熱が全く無い状態が FUEL_YEARS 年続くと段階が 1 下がる (reason: fuel)', () => {
    const size = 32;
    const home = centerHome(size);
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 6, home } } }), { log });
    expect(FUEL_NEED[6]).toBeGreaterThan(0);
    // DECLINE_YEARS (4、population/vitality の衰退) より短い FUEL_YEARS (3) 年だけ回す。
    // これなら population/vitality 由来の衰退は (4 年連続に届かないので) まだ起きようがなく、
    // 段階が下がるとすればそれは燃料切れだけだと言い切れる
    w.step(360 * FUEL_YEARS);
    const fuelDrops = log.find('sim.civ.stage').filter((r) => (r as { reason?: string }).reason === 'fuel');
    expect(fuelDrops).toHaveLength(1);
    expect(fuelDrops[0].from).toBe(6);
    expect(fuelDrops[0].to).toBe(5);
    const civ = w.snapshot().civ;
    expect(civ?.stage).toBe(5);
    expect(civ?.fuel?.shortYears).toBe(0); // 下げた直後にリセットされている
  });

  it('火山セルへの噴火で、翌年の燃料は必要量を満たす (レバーが効く)', () => {
    const size = 32;
    // 文明の home を火山セルに合わせ、噴火の熱がそのまま集落の燃料圏に乗るようにする
    const probe = World.create(testConfig({ size }), { log: createMemorySink() });
    const volcano = probe.volcanoCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ size, civilization: { speciesId: 'grass', start: { stage: 6, home: volcano } } }), { log });
    w.dispatch({ type: 'disaster', kind: 'volcano', cell: volcano, radius: 9 });
    w.step(360); // 1 年目: 噴火直後の熱で燃料を賄う
    const year1 = w.snapshot().civ?.fuel;
    expect(year1?.need).toBe(FUEL_NEED[6]);
    expect(year1?.last).toBeGreaterThanOrEqual(year1!.need);
    expect(year1?.shortYears).toBe(0);
  });

  it('レバー感度: 噴火 1 回の熱だけで、追加の噴火なしにもう 1 年分も燃料が賄える (合計 2 年分以上)', () => {
    // collectFuel は 1 年あたり need を超えて取らない設計 (無駄遣いしない) なので、噴火の効きは
    // 単年の fuel.last の大きさではなく「同じ熱だまりが何年分の需要を賄えるか」で測る
    // (docs/design/2026-09-20-level-design-tower.md §5「噴火 1 回で必要量の 2 年分以上」)
    const size = 32;
    const probe = World.create(testConfig({ size }), { log: createMemorySink() });
    const volcano = probe.volcanoCell();
    const w = World.create(testConfig({ size, civilization: { speciesId: 'grass', start: { stage: 6, home: volcano } } }), { log: createMemorySink() });
    w.dispatch({ type: 'disaster', kind: 'volcano', cell: volcano, radius: 9 });
    w.step(360);
    const year1 = w.snapshot().civ?.fuel;
    expect(year1?.last).toBeGreaterThanOrEqual(year1!.need);
    // 追加の噴火なしで 2 年目
    w.step(360);
    const year2 = w.snapshot().civ?.fuel;
    expect(year2?.last).toBeGreaterThanOrEqual(year2!.need);
    expect(year2?.shortYears).toBe(0);
  });

  it('save/restore で fuel が往復する', () => {
    const size = 32;
    const home = centerHome(size);
    const a = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 6, home } } }), { log: createMemorySink() });
    a.step(360); // 少なくとも 1 年進めて fuel を設定させる
    expect(a.snapshot().civ?.fuel).toBeDefined();
    const save = a.serialize();
    expect(save.civ?.fuel).toEqual(a.snapshot().civ?.fuel);
    const b = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    expect(b.snapshot().civ?.fuel).toEqual(a.snapshot().civ?.fuel);
  });
});
