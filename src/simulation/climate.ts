import { SEA_LEVEL } from './terrain';
import type { WorldConfig } from './types';

export type ClimateState = {
  elevation: Float32Array;
  moistureBase: Float32Array;
  /** 火山などによる局所的な加熱。毎 tick 減衰 */
  heat: Float32Array;
  temperature: Float32Array;
  moisture: Float32Array;
  vegetation: Float32Array;
};

export const BASE_TEMP = 14;
/** 北端 -6℃ .. 南端 +6℃ */
export const LAT_AMPLITUDE = 6;
/** 海面から最高点までの気温低下 */
export const LAPSE = 20;
/** 半減期 ≒ 346 tick (約 1 年) */
export const HEAT_DECAY = 0.998;

/**
 * 標高・緯度・季節・オフセットから気温を、基礎水分・季節・降水スケール・植生フィードバックから水分を更新する。
 * 海セルの水分は常に 1。
 */
export function stepClimate(s: ClimateState, config: WorldConfig, dayOfYear: number): void {
  const { size, ticksPerYear } = config;
  const phase = (2 * Math.PI * dayOfYear) / ticksPerYear;
  const seasonT = config.climate.seasonAmplitudeTemp * Math.sin(phase);
  const seasonR = config.climate.seasonAmplitudeRain * Math.cos(phase);
  const fb = config.feedback.vegetationToRain;
  for (let y = 0; y < size; y++) {
    const lat = (y / size - 0.5) * 2;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const e = s.elevation[i];
      const landH = Math.max(0, e - SEA_LEVEL) / (1 - SEA_LEVEL);
      s.temperature[i] = BASE_TEMP + config.climate.tempOffset + LAT_AMPLITUDE * lat - LAPSE * landH + seasonT + s.heat[i];
      s.heat[i] *= HEAT_DECAY;
      if (e < SEA_LEVEL) {
        s.moisture[i] = 1;
        continue;
      }
      const m = s.moistureBase[i] * config.climate.rainScale + seasonR + fb * s.vegetation[i];
      s.moisture[i] = m < 0 ? 0 : m > 1 ? 1 : m;
    }
  }
}
