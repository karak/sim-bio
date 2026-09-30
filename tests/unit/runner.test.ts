import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/core/runner';

const fakeWorld = () => {
  let t = 0;
  return { step(n = 1) { t += n; }, snapshot: () => ({ tick: t }) as never, ticks: () => t };
};

describe('createRunner', () => {
  it('advances ticks proportional to speed and elapsed time', () => {
    const w = fakeWorld();
    let frames = 0;
    const r = createRunner(w, { onFrame: () => frames++, raf: () => 0, caf: () => {} });
    r.setSpeed(10);
    r.frame(0);
    r.frame(1000);
    expect(w.ticks()).toBe(10);
    r.frame(1500);
    expect(w.ticks()).toBe(15);
    expect(frames).toBe(3);
  });
  it('speed 0 still calls onFrame but does not step', () => {
    const w = fakeWorld();
    let frames = 0;
    const r = createRunner(w, { onFrame: () => frames++, raf: () => 0, caf: () => {} });
    r.setSpeed(0);
    r.frame(0);
    r.frame(5000);
    expect(w.ticks()).toBe(0);
    expect(frames).toBe(2);
  });
  it('step の中で速度が 0 にされても (判定の onVerdict、M19-04)、次のフレームの前に速度を戻せば進む', () => {
    let t = 0;
    let stopInside = true;
    const r = createRunner(
      { step(n = 1) { t += n; if (stopInside) { stopInside = false; r.setSpeed(0); } }, snapshot: () => ({ tick: t }) as never },
      { onFrame: () => {}, raf: () => 0, caf: () => {} },
    );
    r.setSpeed(10);
    r.frame(0);
    r.frame(1000);
    expect(t).toBe(10);
    expect(r.getSpeed()).toBe(0);
    r.setSpeed(10);
    r.frame(2000);
    expect(t).toBe(20);
  });
  it('caps ticks per frame', () => {
    const w = fakeWorld();
    const r = createRunner(w, { onFrame: () => {}, raf: () => 0, caf: () => {}, maxTicksPerFrame: 50 });
    r.setSpeed(100);
    r.frame(0);
    r.frame(10000);
    expect(w.ticks()).toBe(50);
  });
  it('1000x (開発用、M19-16) は 1 秒に 1000 tick 進め、遅れたフレームでも既定の上限 200 tick で止め、遅れを持ち越さない', () => {
    const w = fakeWorld();
    const r = createRunner(w, { onFrame: () => {}, raf: () => 0, caf: () => {} });
    r.setSpeed(1000);
    r.frame(0);
    r.frame(100);
    expect(w.ticks()).toBe(100);
    r.frame(1100);
    expect(w.ticks()).toBe(300);
    r.frame(1116);
    expect(w.ticks()).toBe(316);
  });
  it('start schedules frames via raf and stop cancels', () => {
    const w = fakeWorld();
    const cbs: ((t: number) => void)[] = [];
    let cancelled = -1;
    const r = createRunner(w, {
      onFrame: () => {},
      raf: (cb) => { cbs.push(cb); return cbs.length; },
      caf: (id) => { cancelled = id; },
    });
    r.setSpeed(1);
    r.start();
    expect(cbs).toHaveLength(1);
    cbs[0](0);
    expect(cbs).toHaveLength(2);
    r.stop();
    expect(cancelled).toBe(2);
  });
});

describe('createRunner の年ごとの拾い (M25-02: グラフの点はフレームの間隔で変わらない)', () => {
  const TPY = 360;
  const yearsSeen = (speed: 1 | 10 | 100 | 1000, frameMs: number, totalTicks: number) => {
    let t = 0;
    const ticks: number[] = [];
    const r = createRunner(
      { step(n = 1) { t += n; }, snapshot: () => ({ tick: t, year: Math.floor(t / TPY) }) as never },
      { onFrame: () => {}, onYear: (s) => ticks.push(s.tick), ticksPerYear: TPY, raf: () => 0, caf: () => {} },
    );
    r.setSpeed(speed);
    let now = 0;
    r.frame(now);
    while (t < totalTicks) {
      now += frameMs;
      r.frame(now);
    }
    return ticks;
  };

  it('年の境目 (tick が ticksPerYear の倍数) ちょうどで onYear を呼ぶ。速さとフレームの間隔が違っても同じ tick の列になる', () => {
    const slow = yearsSeen(1, 1000, 3 * TPY);
    const fast = yearsSeen(1000, 16, 3 * TPY);
    const choppy = yearsSeen(1000, 90, 3 * TPY);
    expect(slow).toEqual([360, 720, 1080]);
    expect(fast).toEqual(slow);
    expect(choppy).toEqual(slow);
  });

  it('1 フレームが年の境目をまたぐとき、境目で止めて点を拾い、残りを進める (総 tick は変わらない)', () => {
    let t = 0;
    const seen: number[] = [];
    const r = createRunner(
      { step(n = 1) { t += n; }, snapshot: () => ({ tick: t, year: Math.floor(t / TPY) }) as never },
      { onFrame: () => {}, onYear: (s) => seen.push(s.tick), ticksPerYear: TPY, raf: () => 0, caf: () => {} },
    );
    r.setSpeed(1000);
    r.frame(0);
    r.frame(190);
    r.frame(380);
    expect(seen).toEqual([360]);
    expect(t).toBe(380);
  });

  it('判定 (step の中で速度が 0 にされる) が出た年の境目で止め、そのフレームの残りは進めない', () => {
    let t = 0;
    const seen: number[] = [];
    const r = createRunner(
      { step(n = 1) { t += n; if (t === TPY) r.setSpeed(0); }, snapshot: () => ({ tick: t, year: Math.floor(t / TPY) }) as never },
      { onFrame: () => {}, onYear: (s) => seen.push(s.tick), ticksPerYear: TPY, raf: () => 0, caf: () => {} },
    );
    r.setSpeed(1000);
    r.frame(0);
    r.frame(190);
    r.frame(380);
    r.frame(570);
    expect(t).toBe(TPY);
    expect(seen).toEqual([TPY]);
  });

  it('advance(n) は速さに関わらずちょうど n tick 進め、年の境目で onYear を呼び、最後に onFrame を 1 回呼ぶ', () => {
    let t = 0;
    let frames = 0;
    const seen: number[] = [];
    const r = createRunner(
      { step(n = 1) { t += n; }, snapshot: () => ({ tick: t, year: Math.floor(t / TPY) }) as never },
      { onFrame: () => frames++, onYear: (s) => seen.push(s.tick), ticksPerYear: TPY, raf: () => 0, caf: () => {} },
    );
    r.setSpeed(0);
    r.advance(800);
    expect(t).toBe(800);
    expect(seen).toEqual([360, 720]);
    expect(frames).toBe(1);
  });

  it('ticksPerYear の指定が無ければ、これまでどおり 1 回の step で進める', () => {
    const calls: number[] = [];
    let t = 0;
    const r = createRunner({ step(n = 1) { calls.push(n); t += n; }, snapshot: () => ({ tick: t }) as never }, { onFrame: () => {}, raf: () => 0, caf: () => {} });
    r.setSpeed(1000);
    r.frame(0);
    r.frame(190);
    expect(calls).toEqual([190]);
  });
});
