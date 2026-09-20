import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { testConfig } from './helpers';

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
