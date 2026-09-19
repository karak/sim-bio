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
