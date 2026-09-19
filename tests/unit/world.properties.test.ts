import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';

describe('World properties (seed 42, 100 years)', () => {
  const w = World.create(testConfig(), { log: createMemorySink() });
  w.step(360 * 100);
  const s = w.snapshot();

  it('no NaN/Infinity anywhere', () => {
    for (const arr of [s.layers.temperature, s.layers.moisture, s.layers.vegetation]) {
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
    }
  });
  it('vegetation within [0,1]', () => {
    for (let i = 0; i < s.layers.vegetation.length; i++) {
      expect(s.layers.vegetation[i]).toBeGreaterThanOrEqual(0);
      expect(s.layers.vegetation[i]).toBeLessThanOrEqual(1);
    }
  });
  it('vegetation ratio between 5% and 95% of land', () => {
    let land = 0;
    let veg = 0;
    for (let i = 0; i < s.layers.elevation.length; i++) {
      if (s.layers.elevation[i] >= 0.3) {
        land++;
        veg += s.layers.vegetation[i];
      }
    }
    const ratio = veg / land;
    expect(ratio).toBeGreaterThan(0.05);
    expect(ratio).toBeLessThan(0.95);
  });
  it('tick/year bookkeeping', () => {
    expect(s.tick).toBe(36000);
    expect(s.year).toBe(100);
    expect(s.dayOfYear).toBe(0);
  });
  it('with feedback 0, mean temperature repeats yearly', () => {
    const w0 = World.create(
      testConfig({ feedback: { vegetationToRain: 0, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 } }),
      { log: createMemorySink() },
    );
    w0.step(360 + 100);
    const t1 = w0.snapshot().meanTemperature;
    w0.step(360);
    expect(w0.snapshot().meanTemperature).toBeCloseTo(t1, 6);
  });
});
