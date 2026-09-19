import { describe, it, expect } from 'vitest';
import { stepClimate, type ClimateState } from '../../src/simulation/climate';
import type { WorldConfig } from '../../src/simulation/types';

const cfg = (over: Partial<WorldConfig['climate']> = {}, fb = 0): WorldConfig => ({
  seed: 1,
  size: 4,
  ticksPerYear: 360,
  species: [],
  climate: { seasonAmplitudeTemp: 8, seasonAmplitudeRain: 0.1, tempOffset: 0, rainScale: 1, ...over },
  feedback: { vegetationToRain: fb, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 },
});

const state = (): ClimateState => {
  const n = 16;
  const s = {
    elevation: new Float32Array(n),
    moistureBase: new Float32Array(n).fill(0.5),
    heat: new Float32Array(n),
    temperature: new Float32Array(n),
    moisture: new Float32Array(n),
    vegetation: new Float32Array(n),
  };
  s.elevation.fill(0.5);
  s.elevation[0] = 0.1;
  s.elevation[5] = 0.9;
  return s;
};

describe('stepClimate', () => {
  it('higher elevation is colder', () => {
    const s = state();
    stepClimate(s, cfg(), 0);
    expect(s.temperature[5]).toBeLessThan(s.temperature[6]);
  });
  it('south (larger y) is warmer', () => {
    const s = state();
    stepClimate(s, cfg(), 0);
    expect(s.temperature[14]).toBeGreaterThan(s.temperature[2]);
  });
  it('season moves temperature', () => {
    const a = state();
    const b = state();
    stepClimate(a, cfg(), 90);
    stepClimate(b, cfg(), 270);
    expect(a.temperature[6]).toBeGreaterThan(b.temperature[6]);
  });
  it('tempOffset shifts uniformly', () => {
    const a = state();
    const b = state();
    stepClimate(a, cfg(), 0);
    stepClimate(b, cfg({ tempOffset: 3 }), 0);
    expect(b.temperature[6] - a.temperature[6]).toBeCloseTo(3, 5);
  });
  it('sea cells have moisture 1 and rainScale scales land', () => {
    const a = state();
    const b = state();
    stepClimate(a, cfg(), 0);
    stepClimate(b, cfg({ rainScale: 0.5 }), 0);
    expect(a.moisture[0]).toBe(1);
    expect(b.moisture[6]).toBeLessThan(a.moisture[6]);
  });
  it('vegetation feedback raises moisture only when coefficient > 0', () => {
    const a = state();
    const b = state();
    a.vegetation.fill(1);
    b.vegetation.fill(1);
    stepClimate(a, cfg({}, 0), 0);
    stepClimate(b, cfg({}, 0.2), 0);
    expect(b.moisture[6]).toBeGreaterThan(a.moisture[6]);
  });
  it('heat decays', () => {
    const s = state();
    s.heat[6] = 5;
    stepClimate(s, cfg(), 0);
    expect(s.heat[6]).toBeCloseTo(5 * 0.998, 6);
  });
});
