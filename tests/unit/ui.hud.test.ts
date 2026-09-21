import { describe, it, expect } from 'vitest';
import { formatCiv } from '../../src/ui/Hud';
import type { CivState } from '../../src/simulation/civilization';

describe('formatCiv (HUD の文明の 1 行)', () => {
  it('civ が null なら null (行を出さない)', () => {
    expect(formatCiv(null)).toBeNull();
  });
  it('stage 0 でも null', () => {
    const civ: CivState = { speciesId: 'deer', stage: 0, progress: 0.5, home: 10, population: 3 };
    expect(formatCiv(civ)).toBeNull();
  });
  it('段階名・進みの %・民の数を整形する', () => {
    // 進みは NEED[6]=3.2 に対する割合 (0.4/3.2=12.5% → 13%)。民は密度の和を 100 倍して見せる (M8-06)
    const civ: CivState = { speciesId: 'deer', stage: 6, progress: 0.4, home: 10, population: 12 };
    expect(formatCiv(civ)).toBe('文明 塔(6) · 進み 13% · 民 1200');
  });
  it('progress・population は四捨五入する', () => {
    // NEED[4]=1.8 に対する割合 (0.126/1.8=7%)。population*100 = 360
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360');
  });
  it('faith があれば小数 2 桁で「· 信仰 0.62」を足す (M9-01)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 4, progress: 0.126, home: 10, population: 3.6, faith: 0.62 };
    expect(formatCiv(civ)).toBe('文明 石(4) · 進み 7% · 民 360 · 信仰 0.62');
  });
  it('faith が undefined なら信仰の表示は出ない (M9-01)', () => {
    const civ: CivState = { speciesId: 'deer', stage: 6, progress: 0.4, home: 10, population: 12 };
    expect(formatCiv(civ)).toBe('文明 塔(6) · 進み 13% · 民 1200');
  });
});

describe('formatCiv の採掘の停止 (M9-03)', () => {
  it('miningStopped なら末尾に「· 採掘 止」を足し、そうでなければ出さない', () => {
    const civ: CivState = { speciesId: 'deer', stage: 3, progress: 0, home: 10, population: 1, faith: 0.7, miningStopped: true };
    expect(formatCiv(civ)).toBe('文明 歌(3) · 進み 0% · 民 100 · 信仰 0.70 · 採掘 止');
    expect(formatCiv({ ...civ, miningStopped: false })).toBe('文明 歌(3) · 進み 0% · 民 100 · 信仰 0.70');
  });
});
