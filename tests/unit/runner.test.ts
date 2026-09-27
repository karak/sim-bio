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
