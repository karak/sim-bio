import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';

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
});
