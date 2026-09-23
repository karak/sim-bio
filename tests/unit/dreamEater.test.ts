import { describe, it, expect } from 'vitest';
import { applyDreamEater, stepDreamEater, DREAM_CAP, DREAM_EAT, DREAM_LEAVE, DREAM_STAGE } from '../../src/simulation/dreamEater';
import { SUPPORT_RADIUS } from '../../src/simulation/civilization';

describe('stepDreamEater (M10R-03 出現/退去)', () => {
  it('段階 ≥ DREAM_STAGE かつ faithCap < DREAM_CAP でだけ出現する。境界値: ちょうど DREAM_CAP は出現しない', () => {
    const r = stepDreamEater(null, { stage: DREAM_STAGE, faithCap: DREAM_CAP - 0.01 }, 10);
    expect(r).toEqual({ state: { since: 10 }, appeared: true, left: false });
    const boundary = stepDreamEater(null, { stage: DREAM_STAGE, faithCap: DREAM_CAP }, 10);
    expect(boundary).toEqual({ state: null, appeared: false, left: false });
  });
  it('段階 < DREAM_STAGE では faithCap が低くても出現しない', () => {
    const r = stepDreamEater(null, { stage: DREAM_STAGE - 1, faithCap: 0 }, 10);
    expect(r).toEqual({ state: null, appeared: false, left: false });
  });
  it('faithCap が undefined (まだ計算されていない) なら満ちているとみなし出現しない', () => {
    const r = stepDreamEater(null, { stage: DREAM_STAGE }, 10);
    expect(r).toEqual({ state: null, appeared: false, left: false });
  });
  it('出現中、faithCap が DREAM_CAP と DREAM_LEAVE の間なら留まる (appeared/left とも false、state は変わらない)', () => {
    const state = { since: 3 };
    const r = stepDreamEater(state, { stage: DREAM_STAGE, faithCap: (DREAM_CAP + DREAM_LEAVE) / 2 }, 20);
    expect(r).toEqual({ state, appeared: false, left: false });
  });
  it('faithCap ≥ DREAM_LEAVE で去る。境界値: ちょうど DREAM_LEAVE は去る', () => {
    const state = { since: 3 };
    const r = stepDreamEater(state, { stage: DREAM_STAGE, faithCap: DREAM_LEAVE }, 20);
    expect(r).toEqual({ state: null, appeared: false, left: true });
    const stays = stepDreamEater(state, { stage: DREAM_STAGE, faithCap: DREAM_LEAVE - 0.01 }, 20);
    expect(stays.left).toBe(false);
  });
  it('出現中は段階が下がっていても留まる (退去は faithCap だけで判定する)', () => {
    const state = { since: 3 };
    const r = stepDreamEater(state, { stage: 0, faithCap: DREAM_CAP - 0.01 }, 20);
    expect(r).toEqual({ state, appeared: false, left: false });
  });
});

describe('applyDreamEater', () => {
  it('集落の支え半径内の陸セルだけ (1 − DREAM_EAT) 倍。半径の外と海は変わらない。home が無ければ何もしない', () => {
    const size = 32;
    const n = size * size;
    const elevation = new Float32Array(n).fill(0.5);
    const pops = new Float32Array(n).fill(1);
    const home = 16 * size + 16;
    const sea = home + 1;
    elevation[sea] = 0;
    applyDreamEater(pops, home, elevation, size);
    expect(pops[home]).toBeCloseTo(1 - DREAM_EAT, 6);
    expect(pops[home + SUPPORT_RADIUS]).toBeCloseTo(1 - DREAM_EAT, 6);
    expect(pops[home + SUPPORT_RADIUS + 1]).toBe(1);
    expect(pops[sea]).toBe(1);
    const untouched = new Float32Array(n).fill(1);
    applyDreamEater(untouched, -1, elevation, size);
    expect(untouched.every((v) => v === 1)).toBe(true);
  });
});
