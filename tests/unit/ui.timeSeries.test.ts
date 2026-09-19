import { describe, it, expect } from 'vitest';
import { TimeSeries } from '../../src/ui/timeSeries';

describe('TimeSeries', () => {
  it('keeps at most capacity points, oldest dropped, in order', () => {
    const t = new TimeSeries(3);
    for (let i = 0; i < 5; i++) t.push(i, { a: i * 10, b: -i });
    expect(t.length).toBe(3);
    expect(t.series('a').map((p) => p.x)).toEqual([2, 3, 4]);
    expect(t.series('a').map((p) => p.y)).toEqual([20, 30, 40]);
    expect(t.latest('b')).toBe(-4);
    expect(t.keys().sort()).toEqual(['a', 'b']);
    expect(t.xRange()).toEqual([2, 4]);
  });
  it('handles missing keys', () => {
    const t = new TimeSeries(2);
    t.push(0, { a: 1 });
    expect(t.series('zzz')).toEqual([]);
    expect(t.latest('zzz')).toBeUndefined();
    expect(new TimeSeries(2).xRange()).toEqual([0, 0]);
  });
  it('clear empties everything', () => {
    const t = new TimeSeries(3);
    t.push(0, { a: 1 });
    t.clear();
    expect(t.length).toBe(0);
    expect(t.keys()).toEqual([]);
    expect(t.xRange()).toEqual([0, 0]);
  });
});
