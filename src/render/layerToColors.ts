import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';

export type LayerKind = 'terrain' | 'temperature' | 'moisture' | 'vegetation' | 'vitality' | `species:${string}`;

type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const lerp = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const SEA_DEEP = hex('#244D6B');
const SEA_SHALLOW = hex('#3E7FA8');
const SAND = hex('#C7B67A');
const GREEN = hex('#2F6B37');
const ROCK = hex('#8F8A7A');
const SNOW = hex('#E8E6DF');
const COLD = hex('#4C7BC9');
const MILD = hex('#E8D66B');
const HOT = hex('#D9563C');
const DRY = hex('#F2E7C6');
const WET = hex('#2F6EA8');
const DARK = hex('#1A1A1A');
const VIT_LOW = hex('#2A2622');
const VIT_HIGH = hex('#8FD3C4');

function seaColor(e: number): RGB {
  return lerp(SEA_DEEP, SEA_SHALLOW, clamp01(e / SEA_LEVEL));
}

/** スナップショットとレイヤー種別から頂点色 (RGB [0,1] × size²) を作る純粋関数。 */
export function layerToColors(
  s: Pick<WorldSnapshot, 'size' | 'layers' | 'species'>,
  layer: LayerKind,
  out?: Float32Array,
): Float32Array {
  const n = s.size * s.size;
  const o = out ?? new Float32Array(n * 3);
  const L = s.layers;
  const speciesId = layer.startsWith('species:') ? layer.slice(8) : null;
  const def = speciesId ? s.species.find((d) => d.id === speciesId) : undefined;
  const tint = def ? hex(def.color) : GREEN;
  const pop = speciesId ? L.populations[speciesId] : undefined;
  for (let i = 0; i < n; i++) {
    const e = L.elevation[i];
    let c: RGB;
    if (e < SEA_LEVEL) {
      c = seaColor(e);
    } else {
      switch (layer) {
        case 'terrain': {
          c = lerp(SAND, GREEN, clamp01(L.vegetation[i]));
          if (e > 0.8) c = lerp(c, ROCK, clamp01((e - 0.8) / 0.1));
          if (e > 0.9) c = lerp(c, SNOW, clamp01((e - 0.9) / 0.1));
          break;
        }
        case 'temperature': {
          const t = L.temperature[i];
          c = t < 15 ? lerp(COLD, MILD, clamp01((t + 5) / 20)) : lerp(MILD, HOT, clamp01((t - 15) / 15));
          break;
        }
        case 'moisture':
          c = lerp(DRY, WET, clamp01(L.moisture[i]));
          break;
        case 'vegetation':
          c = lerp(SAND, GREEN, clamp01(L.vegetation[i]));
          break;
        case 'vitality':
          c = lerp(VIT_LOW, VIT_HIGH, clamp01(L.vitality[i]));
          break;
        default:
          c = lerp(DARK, tint, clamp01(pop ? pop[i] : 0));
      }
    }
    o[i * 3] = c[0];
    o[i * 3 + 1] = c[1];
    o[i * 3 + 2] = c[2];
  }
  return o;
}
