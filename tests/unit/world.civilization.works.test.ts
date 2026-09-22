import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { INTERCEPT_NEED, WORKS_RATE } from '../../src/simulation/works';
import { testConfig } from './helpers';

/** 星の文明 (草、島中にあるので民は足りる)。薪の蓄えで燃料切れを避ける */
function mk(faith: number) {
  const log = createMemorySink();
  const home = Math.floor(32 / 2) * 32 + Math.floor(32 / 2);
  const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 7, home, fuelStock: 900, faith } } }), { log });
  return { w, log };
}
const total = (w: World) => w.snapshot().layers.crystal.reduce((a, b) => a + b, 0);

describe('星の工事と迎撃 (M10-02、World)', () => {
  it('星は年に一度 WORKS_RATE を備蓄に積み、島の輝石がその分減り、sim.civ.works が出る', () => {
    const { w, log } = mk(1);
    const before = total(w);
    w.step(360 * 2);
    const civ = w.snapshot().civ!;
    expect(civ.works).toBeDefined();
    expect(civ.works!.stock).toBeCloseTo(WORKS_RATE * 2, 5);
    expect(civ.works!.stopped).toBe(false);
    expect(before - total(w)).toBeCloseTo(WORKS_RATE * 2, 4);
    expect(log.find('sim.civ.works').length).toBe(2);
  });
  it('信仰が足りなければ工事は止まり、備蓄は増えない', () => {
    const { w } = mk(0.3);
    w.step(360 * 2);
    const civ = w.snapshot().civ!;
    expect(civ.works).toEqual({ stock: 0, stopped: true });
  });
  it('intercept は備蓄不足なら cmd.rejected (理由つき) で何も変わらず、足りれば備蓄を消費して intercepted が増える', () => {
    const { w, log } = mk(1);
    w.step(360);
    // dispatch は次の step で適用される (既存のコマンドと同じ)
    w.dispatch({ type: 'intercept' });
    w.step(1);
    const rejected = log.find('cmd.rejected');
    expect(rejected.length).toBe(1);
    expect(String(rejected[0].reason)).toContain('備蓄が足りない');
    expect(w.snapshot().civ!.intercepted).toBeUndefined();
    // 備蓄を満たした状態を save/restore で作る
    const save = w.serialize();
    save.civ!.works = { stock: INTERCEPT_NEED, stopped: false };
    const r = World.restore(save, { log: createMemorySink() });
    r.dispatch({ type: 'intercept' });
    r.step(1);
    const civ = r.snapshot().civ!;
    expect(civ.intercepted).toBe(1);
    expect(civ.works!.stock).toBeCloseTo(0, 6);
    // works と intercepted は保存に往復する
    const r2 = World.restore(r.serialize(), { log: createMemorySink() });
    expect(r2.snapshot().civ!.intercepted).toBe(1);
    expect(r2.snapshot().civ!.works).toEqual({ stock: 0, stopped: false });
  });
});
