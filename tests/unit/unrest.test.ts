import { describe, it, expect } from 'vitest';
import { applyUnrest, stepUnrest, UNREST_FAITH, UNREST_SURVIVORS, UNREST_YEARS } from '../../src/simulation/unrest';
import { SUPPORT_RADIUS } from '../../src/simulation/civilization';

describe('stepUnrest (M9-03 内乱)', () => {
  it('信仰が UNREST_FAITH 未満の年が UNREST_YEARS 続いた年に内乱。境界値: ちょうど UNREST_FAITH は低くない', () => {
    let st = 0;
    for (let y = 1; y < UNREST_YEARS; y++) {
      const r = stepUnrest(UNREST_FAITH - 0.01, st);
      expect(r.unrest).toBe(false);
      st = r.streak;
    }
    const r = stepUnrest(UNREST_FAITH - 0.01, st);
    expect(r.unrest).toBe(true);
    expect(r.streak).toBe(0);
    expect(stepUnrest(UNREST_FAITH, UNREST_YEARS - 1)).toEqual({ streak: 0, unrest: false });
  });
  it('間に信仰が戻る年があれば連続が切れる', () => {
    let st = stepUnrest(0.1, 0).streak;
    st = stepUnrest(0.1, st).streak;
    st = stepUnrest(0.5, st).streak;
    expect(st).toBe(0);
    expect(stepUnrest(0.1, st).unrest).toBe(false);
  });
});

describe('applyUnrest', () => {
  it('集落の支え半径内の陸セルだけ UNREST_SURVIVORS 倍。半径の外と海は変わらない。home が無ければ何もしない', () => {
    const size = 32;
    const n = size * size;
    const elevation = new Float32Array(n).fill(0.5);
    const pops = new Float32Array(n).fill(1);
    const home = 16 * size + 16;
    const sea = home + 1;
    elevation[sea] = 0;
    applyUnrest(pops, home, elevation, size);
    expect(pops[home]).toBe(UNREST_SURVIVORS);
    expect(pops[home + SUPPORT_RADIUS]).toBe(UNREST_SURVIVORS);
    expect(pops[home + SUPPORT_RADIUS + 1]).toBe(1);
    expect(pops[sea]).toBe(1);
    const untouched = new Float32Array(n).fill(1);
    applyUnrest(untouched, -1, elevation, size);
    expect(untouched.every((v) => v === 1)).toBe(true);
  });
});
