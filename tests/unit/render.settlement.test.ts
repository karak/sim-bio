import { describe, it, expect } from 'vitest';
import { settlementInstances } from '../../src/render/settlement';
import type { CivState } from '../../src/simulation/civilization';

const civ = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'deer', stage: 3, progress: 0.2, home: 12, population: 4, ...over });

describe('settlementInstances (集落の箱)', () => {
  it('civ が null なら非表示 (count 0)', () => {
    expect(settlementInstances(null, 8)).toEqual({ cell: 0, count: 0 });
  });
  it('stage 0 も非表示', () => {
    expect(settlementInstances(civ({ stage: 0 }), 8)).toEqual({ cell: 0, count: 0 });
  });
  it('home が盤外なら非表示', () => {
    expect(settlementInstances(civ({ home: 100 }), 8)).toEqual({ cell: 0, count: 0 });
    expect(settlementInstances(civ({ home: -1 }), 8)).toEqual({ cell: 0, count: 0 });
  });
  it('stage 3 なら home に 3 個積む', () => {
    expect(settlementInstances(civ({ stage: 3, home: 12 }), 8)).toEqual({ cell: 12, count: 3 });
  });
});
