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
  it('caps ticks per frame', () => {
    const w = fakeWorld();
    const r = createRunner(w, { onFrame: () => {}, raf: () => 0, caf: () => {}, maxTicksPerFrame: 50 });
    r.setSpeed(100);
    r.frame(0);
    r.frame(10000);
    expect(w.ticks()).toBe(50);
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
