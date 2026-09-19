import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';

const landCell = (w: World) => {
  const s = w.snapshot();
  for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.elevation[i] >= 0.3) return i;
  throw new Error('no land');
};

describe('World commands', () => {
  it('disaster lowers vegetation at the cell after next step', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    w.step(360 * 5);
    const c = landCell(w);
    const before = w.snapshot().layers.vegetation[c];
    expect(before).toBeGreaterThan(0.05);
    w.dispatch({ type: 'disaster', kind: 'meteor', cell: c, radius: 2 });
    w.step(1);
    expect(w.snapshot().layers.vegetation[c]).toBeLessThan(before * 0.2);
  });
  it('spawn_species raises totals', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const c = landCell(w);
    const before = w.snapshot().totals.forest;
    w.dispatch({ type: 'spawn_species', speciesId: 'forest', cell: c, amount: 0.9 });
    w.step(1);
    expect(w.snapshot().totals.forest).toBeGreaterThan(before);
  });
  it('set_climate changes temperature next step', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    w.step(1);
    const t = w.snapshot().meanTemperature;
    w.dispatch({ type: 'set_climate', tempOffset: 5 });
    w.step(1);
    expect(w.snapshot().meanTemperature).toBeGreaterThan(t + 4);
  });
  it('rejects invalid commands with a log record', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.dispatch({ type: 'spawn_species', speciesId: 'nope', cell: 0, amount: 1 });
    w.dispatch({ type: 'disaster', kind: 'meteor', cell: 999999, radius: 1 });
    w.step(1);
    expect(log.find('cmd.rejected')).toHaveLength(2);
  });
  it('sink lowers land ratio and drowned cells lose vegetation', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.step(360);
    const before = w.snapshot();
    let landBefore = 0;
    for (let i = 0; i < before.layers.elevation.length; i++) if (before.layers.elevation[i] >= 0.3) landBefore++;
    w.dispatch({ type: 'sink', amount: 0.1 });
    w.step(1);
    const after = w.snapshot();
    let landAfter = 0;
    for (let i = 0; i < after.layers.elevation.length; i++) {
      if (after.layers.elevation[i] >= 0.3) landAfter++;
      else expect(after.layers.vegetation[i]).toBe(0);
    }
    expect(landAfter).toBeLessThan(landBefore);
    const rec = log.find('sim.sink')[0];
    expect(rec.drownedCells).toBe(landBefore - landAfter);
    w.dispatch({ type: 'sink', amount: 0 });
    w.step(1);
    expect(log.find('cmd.rejected')).toHaveLength(1);
  });
});

describe('spawn_species radius', () => {
  const inRadius = (size: number, center: number, r: number) => {
    const cx = center % size;
    const cy = (center - cx) / size;
    const cells: number[] = [];
    for (let i = 0; i < size * size; i++) {
      const x = i % size;
      const y = (i - x) / size;
      if (Math.hypot(x - cx, y - cy) <= r) cells.push(i);
    }
    return cells;
  };
  /** コマンドは次の step で適用されるので、放流なしで 1 tick 進めた対照世界との差分で見る */
  const diffAfterSpawn = (cmd: Parameters<World['dispatch']>[0]) => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const ctl = World.create(testConfig(), { log: createMemorySink() });
    w.dispatch(cmd);
    w.step(1);
    ctl.step(1);
    const a = w.snapshot().layers.populations.grass;
    const b = ctl.snapshot().layers.populations.grass;
    return { w, diff: Float32Array.from(a, (v, i) => v - b[i]) };
  };
  it('radius 省略時は中心セルだけに放つ (既存動作)', () => {
    const probe = World.create(testConfig(), { log: createMemorySink() });
    const c = landCell(probe);
    const { w, diff } = diffAfterSpawn({ type: 'spawn_species', speciesId: 'grass', cell: c, amount: 0.4 });
    expect(diff[c]).toBeGreaterThan(0.3);
    for (const i of inRadius(w.snapshot().size, c, 1)) if (i !== c) expect(Math.abs(diff[i])).toBeLessThan(0.02);
  });
  it('radius 1 で半径内の陸セルすべてに放ち、海セルは 0 のまま、半径外は触らない', () => {
    const probe = World.create(testConfig(), { log: createMemorySink() });
    const s0 = probe.snapshot();
    const c = landCell(probe);
    const target = inRadius(s0.size, c, 1);
    const { w, diff } = diffAfterSpawn({ type: 'spawn_species', speciesId: 'grass', cell: c, amount: 0.5, radius: 1 });
    const after = w.snapshot().layers.populations.grass;
    let landHit = 0;
    for (const i of target) {
      if (s0.layers.elevation[i] >= 0.3) {
        landHit++;
        expect(diff[i]).toBeGreaterThan(0.4);
      } else expect(after[i]).toBe(0);
    }
    expect(landHit).toBeGreaterThan(1);
    const targetSet = new Set(target);
    for (let i = 0; i < diff.length; i++) if (!targetSet.has(i)) expect(Math.abs(diff[i])).toBeLessThan(0.02);
  });
});
