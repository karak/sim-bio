import type { WorldSnapshot } from '../../simulation/types';
import { ELEV_M } from '../render/terrain';
import type { Water } from '../render/water';
import type { Grass } from '../render/grass';
import { surgeStep, type SurgeState } from '../fx';
import { OPT } from './options';

export type Sea = { retarget(next: WorldSnapshot): void; raise(m: number): void; step(dt: number): void };

export function createSea(s: WorldSnapshot, home: number, water: Water, grass: Grass): Sea {
  // 沈降 (M22-08): 集落のセルの標高が最初からどれだけ下がったかを、海面の上がりとして見せる
  const elev0 = s.layers.elevation[home];
  water.setLevel(OPT.sink);
  grass.setLevel(OPT.sink);
  // (M22-07 の手直し) 沈む海: 本体の沈降から決まる海面 seaTarget (と調整用の上げ seaExtra) へ、見せる海面 sea.level を上げていく
  let seaTarget = OPT.sink;
  let seaExtra = 0;
  let sea: SurgeState = { level: OPT.sink, surge: 0, hold: 0 };
  return {
    retarget(next) {
      const level = OPT.sink + Math.max(0, elev0 - next.layers.elevation[home]) * ELEV_M;
      // (M22-07 の手直しで変更: 海面はすぐには上げず、fx で SURGE_RATE m/s で追わせ、上がる間は波立ちと流れを見せる (沈む海岸「波立ちがない。流れが見えない。」))
      seaTarget = level;
    },
    raise(m) {
      seaExtra += m;
    },
    step(dt) {
      // (M22-07 の手直し) 沈む海: 海面を追わせ、上がる間の波立ちと流れ
      sea = surgeStep(sea, seaTarget + seaExtra, dt);
      water.setLevel(sea.level);
      grass.setLevel(sea.level);
      water.setSurge(sea.surge);
    },
  };
}
