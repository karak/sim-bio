import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';

describe('World determinism', () => {
  it('same config → identical snapshots after 2 years', () => {
    const a = World.create(testConfig(), { log: createMemorySink() });
    const b = World.create(testConfig(), { log: createMemorySink() });
    a.step(720);
    b.step(720);
    expect(Array.from(a.snapshot().layers.vegetation)).toEqual(Array.from(b.snapshot().layers.vegetation));
    expect(a.snapshot().totals).toEqual(b.snapshot().totals);
  });
  it('different seed → different terrain', () => {
    const a = World.create(testConfig({ seed: 1 }), { log: createMemorySink() });
    const b = World.create(testConfig({ seed: 2 }), { log: createMemorySink() });
    expect(Array.from(a.snapshot().layers.elevation)).not.toEqual(Array.from(b.snapshot().layers.elevation));
  });
});
