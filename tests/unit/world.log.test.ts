import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig, fixedNow, grass } from './helpers';

describe('World logging', () => {
  it('emits created, yearly summary, and stamps ts/tick/year', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log, now: fixedNow });
    w.step(720);
    expect(log.find('sim.world.created')).toHaveLength(1);
    const s = log.find('sim.tick.summary');
    expect(s).toHaveLength(2);
    expect(s[0].ts).toBe('2026-01-01T00:00:00.000Z');
    expect(s[1].year).toBe(2);
    expect(typeof s[1].totals).toBe('object');
  });
  it('emits cmd.received and sim.disaster', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.dispatch({ type: 'disaster', kind: 'wildfire', cell: 16 * 32 + 16, radius: 0 });
    w.step(1);
    expect(log.find('cmd.received')).toHaveLength(1);
    expect(log.find('sim.disaster')).toHaveLength(1);
  });
  it('emits sim.species.extinct once when a species dies out', () => {
    const log = createMemorySink();
    const cold = { ...grass, tempRange: [50, 60] as [number, number] };
    const w = World.create(testConfig({ species: [cold] }), { log });
    w.step(360 * 3);
    expect(log.find('sim.species.extinct')).toHaveLength(1);
  });
});
