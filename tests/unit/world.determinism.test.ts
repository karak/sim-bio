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

describe('World crystal layer (M8-01)', () => {
  it('same seed → identical crystal, different seed → different crystal', () => {
    const a = World.create(testConfig(), { log: createMemorySink() });
    const b = World.create(testConfig(), { log: createMemorySink() });
    expect(Array.from(a.snapshot().layers.crystal)).toEqual(Array.from(b.snapshot().layers.crystal));
    const c = World.create(testConfig({ seed: 7 }), { log: createMemorySink() });
    expect(Array.from(a.snapshot().layers.crystal)).not.toEqual(Array.from(c.snapshot().layers.crystal));
  });

  it('property: 陸だけに置かれ、総量が 0 でも全セル 1 でもない', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const s = w.snapshot();
    const { elevation, crystal } = s.layers;
    let land = 0;
    let hasCrystal = 0;
    for (let i = 0; i < elevation.length; i++) {
      expect(crystal[i]).toBeGreaterThanOrEqual(0);
      expect(crystal[i]).toBeLessThanOrEqual(1);
      if (elevation[i] < 0.3) {
        // 海は必ず 0
        expect(crystal[i]).toBe(0);
      } else {
        land++;
        if (crystal[i] > 0) hasCrystal++;
      }
    }
    // 総量が 0 でも全セル 1 でもない。陸地の 2%〜15% 程度に収まる (§2.1 の設計目標)
    expect(hasCrystal).toBeGreaterThan(0);
    expect(hasCrystal).toBeLessThan(land);
    const ratio = hasCrystal / land;
    expect(ratio).toBeGreaterThan(0.02);
    expect(ratio).toBeLessThan(0.15);
  });

  it('crystal は tick が進んでも変化しない (掘削は M8-02)', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const before = Array.from(w.snapshot().layers.crystal);
    w.step(360);
    expect(Array.from(w.snapshot().layers.crystal)).toEqual(before);
  });
});
