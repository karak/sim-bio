import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { testConfig } from './helpers';

const total = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

describe('輝石の倍率 crystalScale (M10-02、脈を薄くする舞台装置)', () => {
  it('省略時と 1 は同じ。0.5 なら開始時の輝石 (crystal と crystal0) が半分になり、脈の形 (veins) は変わらない', () => {
    const w1 = World.create(testConfig(), { log: createMemorySink() });
    const w2 = World.create(testConfig({ crystalScale: 1 }), { log: createMemorySink() });
    const wh = World.create(testConfig({ crystalScale: 0.5 }), { log: createMemorySink() });
    expect(total(w1.crystal0)).toBeGreaterThan(0);
    expect(total(w2.crystal0)).toBeCloseTo(total(w1.crystal0), 5);
    expect(total(wh.crystal0)).toBeCloseTo(total(w1.crystal0) / 2, 5);
    expect(total(wh.snapshot().layers.crystal)).toBeCloseTo(total(w1.crystal0) / 2, 5);
    expect(Array.from(wh.veins)).toEqual(Array.from(w1.veins));
  });
  it('save/restore で config の倍率が残り、古いセーブ (crystal0 なし) でも同じ倍率で再生成される', () => {
    const w = World.create(testConfig({ crystalScale: 0.5 }), { log: createMemorySink() });
    const save = w.serialize();
    expect(save.config.crystalScale).toBe(0.5);
    const r = World.restore(structuredClone(save), { log: createMemorySink() });
    expect(total(r.crystal0)).toBeCloseTo(total(w.crystal0), 5);
    delete save.crystal0;
    const r2 = World.restore(save, { log: createMemorySink() });
    expect(total(r2.crystal0)).toBeCloseTo(total(w.crystal0), 5);
  });
});
