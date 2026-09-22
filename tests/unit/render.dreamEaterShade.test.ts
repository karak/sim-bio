import { describe, it, expect } from 'vitest';
import { dreamEaterShade } from '../../src/render/dreamEaterShade';
import { SUPPORT_RADIUS } from '../../src/simulation/civilization';
import type { CivState } from '../../src/simulation/civilization';

const civ = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'deer', stage: 3, progress: 0.2, home: 12, population: 4, ...over });

describe('dreamEaterShade (夢喰いの影、M10R-03)', () => {
  it('dreamEater が null なら非表示', () => {
    expect(dreamEaterShade(null, civ(), 8)).toEqual({ cell: 0, radius: 0, visible: false });
  });
  it('civ が null なら非表示', () => {
    expect(dreamEaterShade({ since: 3 }, null, 8)).toEqual({ cell: 0, radius: 0, visible: false });
  });
  it('home が盤外なら非表示', () => {
    expect(dreamEaterShade({ since: 3 }, civ({ home: 100 }), 8)).toEqual({ cell: 0, radius: 0, visible: false });
    expect(dreamEaterShade({ since: 3 }, civ({ home: -1 }), 8)).toEqual({ cell: 0, radius: 0, visible: false });
  });
  it('現れていれば home に支え半径 (SUPPORT_RADIUS) の円を出す', () => {
    expect(dreamEaterShade({ since: 3 }, civ({ home: 12 }), 8)).toEqual({ cell: 12, radius: SUPPORT_RADIUS, visible: true });
  });
});
