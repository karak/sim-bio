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
    const json = JSON.stringify(save);
    const b = World.restore(JSON.parse(json), { log: createMemorySink() });
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation));
    expect(b.snapshot().tick).toBe(a.snapshot().tick);
    a.step(100);
    b.step(100);
    expect(Array.from(b.snapshot().layers.vegetation)).toEqual(Array.from(a.snapshot().layers.vegetation));
    expect(b.snapshot().meanTemperature).toBeCloseTo(a.snapshot().meanTemperature, 5);
  });
});
