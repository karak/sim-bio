import type { WorldConfig, SpeciesDef } from '../../src/simulation/types';

export const grass: SpeciesDef = {
  id: 'grass', name: '草', trophic: 'plant', growthRate: 0.04, mortality: 0.02,
  tempRange: [-2, 32], moistureRange: [0.15, 0.85], diffusion: 0.05, assetId: 'grass', color: '#6FBF7C',
};
export const forest: SpeciesDef = {
  id: 'forest', name: '森', trophic: 'plant', growthRate: 0.015, mortality: 0.01,
  tempRange: [2, 26], moistureRange: [0.45, 1], diffusion: 0.02, assetId: 'forest', color: '#2E6B37',
};
export const testConfig = (over: Partial<WorldConfig> = {}): WorldConfig => ({
  seed: 42,
  size: 32,
  ticksPerYear: 360,
  species: [grass, forest],
  climate: { seasonAmplitudeTemp: 8, seasonAmplitudeRain: 0.1, tempOffset: 0, rainScale: 1 },
  feedback: { vegetationToRain: 0.1, vegetationToTemp: 0, co2ToTemp: 0, iceAlbedo: 0 },
  ...over,
});
export const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');
