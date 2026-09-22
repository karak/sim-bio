import { describe, it, expect } from 'vitest';
import { stepWorks, canIntercept, applyIntercept, WORKS_FAITH, WORKS_RATE, INTERCEPT_NEED } from '../../src/simulation/works';
import { MAX_STAGE, type CivState } from '../../src/simulation/civilization';

const SIZE = 16;
const N = SIZE * SIZE;
const HOME = 8 * SIZE + 8;
const mkCiv = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'deer', stage: MAX_STAGE, progress: 0, home: HOME, population: 5, faith: 1, ...over });
const mkCrystal = (v = 0.1) => new Float32Array(N).fill(v);
const land = new Float32Array(N).fill(0.5);
const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

describe('星の工事 (M10-02): stepWorks', () => {
  it('星でなければ何もしない (works も付かない、輝石も減らない)', () => {
    const c = mkCrystal();
    const r = stepWorks(mkCiv({ stage: 6 }), c, land, SIZE);
    expect(r.mined).toBe(0);
    expect(r.civ.works).toBeUndefined();
    expect(sum(c)).toBeCloseTo(0.1 * N, 6);
  });
  it('星なら年に WORKS_RATE を採掘半径の輝石から備蓄に積み、その分だけ輝石が減る', () => {
    const c = mkCrystal();
    const before = sum(c);
    const r = stepWorks(mkCiv(), c, land, SIZE);
    expect(r.mined).toBeCloseTo(WORKS_RATE, 6);
    expect(r.civ.works).toEqual({ stock: WORKS_RATE, stopped: false });
    expect(before - sum(c)).toBeCloseTo(WORKS_RATE, 5);
  });
  it('信仰が WORKS_FAITH 未満の年は止まる (stopped、備蓄も輝石も変わらない)', () => {
    const c = mkCrystal();
    const r = stepWorks(mkCiv({ faith: WORKS_FAITH - 0.01, works: { stock: 1, stopped: false } }), c, land, SIZE);
    expect(r.mined).toBe(0);
    expect(r.civ.works).toEqual({ stock: 1, stopped: true });
    expect(sum(c)).toBeCloseTo(0.1 * N, 6);
    // 信仰が戻れば再開する
    const r2 = stepWorks(r.civ, c, land, SIZE);
    expect(r2.civ.works).toEqual({ stock: 1, stopped: true });
    const r3 = stepWorks({ ...r.civ, faith: WORKS_FAITH }, c, land, SIZE);
    expect(r3.civ.works!.stopped).toBe(false);
    expect(r3.civ.works!.stock).toBeCloseTo(1 + WORKS_RATE, 6);
  });
  it('勅令「採掘を止めよ」の間は工事も掘らない (M10R-05: 備蓄と輝石は変わらず、stopped は立たない。再開すれば積む)', () => {
    const c = mkCrystal();
    const r = stepWorks(mkCiv({ miningStopped: true, works: { stock: 1, stopped: false } }), c, land, SIZE);
    expect(r.mined).toBe(0);
    expect(r.civ.works).toEqual({ stock: 1, stopped: false });
    expect(sum(c)).toBeCloseTo(0.1 * N, 6);
    const r2 = stepWorks({ ...r.civ, miningStopped: false }, c, land, SIZE);
    expect(r2.civ.works!.stock).toBeCloseTo(1 + WORKS_RATE, 6);
  });
  it('備蓄が INTERCEPT_NEED に達しても掘り続ける (星は掘るのをやめない。M10 の通し実行で、止めると霊脈枯れの勅令の意味が消えた)', () => {
    const c = mkCrystal();
    const r = stepWorks(mkCiv({ works: { stock: INTERCEPT_NEED - 0.05, stopped: false } }), c, land, SIZE);
    expect(r.mined).toBeCloseTo(WORKS_RATE, 6);
    expect(r.civ.works!.stock).toBeCloseTo(INTERCEPT_NEED - 0.05 + WORKS_RATE, 6);
    const r2 = stepWorks(r.civ, c, land, SIZE);
    expect(r2.mined).toBeCloseTo(WORKS_RATE, 6);
    expect(r2.civ.works!.stock).toBeCloseTo(INTERCEPT_NEED - 0.05 + 2 * WORKS_RATE, 6);
  });
  it('輝石が尽きていれば残量までしか積めない', () => {
    const c = mkCrystal(0);
    c[HOME] = 0.05;
    const r = stepWorks(mkCiv(), c, land, SIZE);
    expect(r.mined).toBeCloseTo(0.05, 6);
    expect(c[HOME]).toBeCloseTo(0, 6);
  });
});

describe('迎撃 (M10-02): canIntercept / applyIntercept', () => {
  it('文明が無い・星でない・備蓄不足はそれぞれの理由で拒否', () => {
    expect(canIntercept(null)).toEqual({ ok: false, reason: '文明がない' });
    expect(canIntercept(mkCiv({ stage: 6, works: { stock: 10, stopped: false } }))).toEqual({ ok: false, reason: '段階が星に満たない' });
    const r = canIntercept(mkCiv({ works: { stock: INTERCEPT_NEED - 0.5, stopped: false } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('備蓄が足りない');
    expect(canIntercept(mkCiv()).ok).toBe(false);
  });
  it('備蓄が足りれば ok。applyIntercept で備蓄が INTERCEPT_NEED 減り、回数が 1 増える', () => {
    const civ = mkCiv({ works: { stock: INTERCEPT_NEED + 0.2, stopped: false } });
    expect(canIntercept(civ)).toEqual({ ok: true });
    const after = applyIntercept(civ);
    expect(after.works!.stock).toBeCloseTo(0.2, 6);
    expect(after.intercepted).toBe(1);
    expect(applyIntercept(after).intercepted).toBe(2);
    expect(civ.intercepted).toBeUndefined();
  });
});
