import { describe, it, expect } from 'vitest';
import { amplitudeRatio, countPeaks, secondHalf } from '../../src/simulation/oscillation';

const sine = (n: number, period: number, amp = 1, base = 2) =>
  Array.from({ length: n }, (_, i) => base + amp * Math.sin((2 * Math.PI * i) / period));

describe('oscillation metrics', () => {
  it('counts peaks of a sine wave', () => {
    expect(countPeaks(sine(60, 10))).toBe(6);
  });
  it('damped wave has small amplitude ratio in the second half', () => {
    const damped = sine(60, 10).map((v, i) => 2 + (v - 2) * Math.exp(-i / 8));
    expect(amplitudeRatio(secondHalf(damped))).toBeLessThan(0.1);
    expect(amplitudeRatio(damped)).toBeGreaterThan(0.3);
  });
  it('constant series has zero peaks and zero amplitude', () => {
    const flat = new Array(30).fill(5);
    expect(countPeaks(flat)).toBe(0);
    expect(amplitudeRatio(flat)).toBe(0);
    expect(amplitudeRatio([])).toBe(0);
  });
  it('minProminence ignores tiny bumps', () => {
    const noisy = sine(60, 10).map((v, i) => v + (i % 2 ? 0.01 : 0));
    expect(countPeaks(noisy, 0.05)).toBe(6);
  });
});
