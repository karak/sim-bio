import { describe, it, expect } from 'vitest';
import { DAY_CYCLE_S, daylightAt, lightDirAt, mixHex, phaseAt } from '../../src/observe/daylight';

describe('観察画面 (M22-07): 昼夜', () => {
  it('6 分で 1 周し、負の時刻も 0〜1 に折り返す', () => {
    expect(DAY_CYCLE_S).toBe(360);
    expect(phaseAt(0)).toBe(0);
    expect(phaseAt(180)).toBeCloseTo(0.5);
    expect(phaseAt(360 + 36)).toBeCloseTo(0.1);
    expect(phaseAt(-36)).toBeCloseTo(0.9);
  });

  it('昼は夜の強さ 0、深夜は 1。昼 (夜の強さ < 0.1) が 1 周の半分より長い', () => {
    expect(daylightAt(0.3).night).toBe(0);
    expect(daylightAt(0.8).night).toBe(1);
    let day = 0;
    for (let i = 0; i < 1000; i++) if (daylightAt(i / 1000).night < 0.1) day++;
    expect(day).toBeGreaterThan(500);
  });

  it('光は常に地平の上 (8° 以上) から来る。日は朝に東、夕に西、正午に南寄りで最も高い', () => {
    for (let i = 0; i < 100; i++) expect(lightDirAt(i / 100).y).toBeGreaterThanOrEqual(Math.sin((8 * Math.PI) / 180) - 1e-9);
    expect(lightDirAt(0.05).x).toBeGreaterThan(0.5);
    expect(lightDirAt(0.58).x).toBeLessThan(-0.5);
    const noon = lightDirAt(0.315);
    expect(noon.z).toBeGreaterThan(0.4);
    expect(noon.y).toBeGreaterThan(Math.sin((55 * Math.PI) / 180));
    const d = lightDirAt(0.2);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
  });

  it('キーの間は色を線形に補間し、1 周の端 (0 と 1) は同じ色でつながる', () => {
    expect(mixHex('#000000', '#FF8040', 0.5)).toBe('#804020');
    expect(daylightAt(0).fog).toBe(daylightAt(0.99999).fog);
    expect(daylightAt(0.3).fog).toBe('#B9CED3');
  });
});
