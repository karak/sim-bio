import { forEachInRadius } from './disaster';
import { SEA_LEVEL } from './terrain';
import { LOAD_RADIUS } from './civilizationLoad';

/**
 * 塔の燃料モデル (M8-08)。設計: docs/design/2026-09-20-level-design-tower.md §3.1/§6-A。
 * 年に一度、集落半径内の熱と鐘樹の材から燃料を徴収する。World には依存しない純粋関数群。
 */

/**
 * 段階ごとに年に必要な燃料の量。index = stage。
 * stage 1〜3 は 0 (初期の文明は燃料を気にしなくてよい)。4 (石) 以降だけ燃料が要る設計 (§3.1)。
 */
export const FUEL_NEED: readonly number[] = [0, 0, 0, 0, 3, 4, 6, 9];

/** 熱 1 単位を消費して得られる燃料の量。tuning: 火山 1 回 (VOLCANO_HEAT) で複数年分の燃料が賄えるように校正 */
export const HEAT_FUEL = 0.8;

/**
 * 鐘樹の立木のうち年に伐り出す割合 (M8-10 の belltree レイヤーが対象)。伐った分は密度から引き、
 * 1:1 で燃料に変わる (灰・枯死への計上は M8-10 の負荷モデル側の役目なのでここではしない)。
 */
export const TIMBER_RATE = 0.3;

/** 燃料が必要量に足りない年がこの年数続くと段階が 1 下がる */
export const FUEL_YEARS = 3;

/**
 * 燃料の蓄えの上限 (必要量の何年分か)。M8-05 v2 の校正で追加。
 * 噴火 1 回の熱をその年に使い切れずに捨てていたため、余った分を蓄えに積めるようにした。
 * 開始時の蓄え (start.fuelStock) が尽きるまでが猶予になり、「燃料が減っていく」のが石板で見える。
 */
export const FUEL_STOCK_YEARS = 4;

export type FuelLayers = {
  /** 局所加熱 [0, ...]。火山などで積み上がり、HEAT_DECAY で減衰する (climate.ts) */
  heat: Float32Array;
  /** 鐘樹の密度 [0,1]。M8-10 で追加される種がまだ無い世界では省略される */
  belltree?: Float32Array;
  elevation: Float32Array;
};

/**
 * home 半径 LOAD_RADIUS[stage] 内から 1 年分の燃料を徴収する。
 * 優先度: まず熱 (heat)。必要量 (FUEL_NEED[stage] / HEAT_FUEL) を超えない範囲で、半径内の熱の残量に
 * 比例して取り除く (heat は 0 未満にならない)。熱だけで足りなければ、残りの不足分を鐘樹の立木から
 * TIMBER_RATE 分だけ比例して伐り出し (belltree レイヤーが無ければ何もしない)、燃料に 1:1 で足す。
 * stage < 1 (未発生) や home 未設定 (-1)、その段階の FUEL_NEED が 0 なら何もせず fuel: 0 を返す。
 */
export function collectFuel(
  stage: number,
  home: number,
  layers: FuelLayers,
  size: number,
  /** 集める上限 (省略時はその段階の必要量)。蓄えの空き分まで集めるときに渡す (M8-05 v2) */
  cap?: number,
): { fuel: number; heatUsed: number; timberUsed: number } {
  const stageNeed = FUEL_NEED[stage] ?? 0;
  const need = cap ?? stageNeed;
  const radius = LOAD_RADIUS[stage] ?? 0;
  if (stageNeed <= 0 || need <= 0 || home < 0 || !(radius > 0)) return { fuel: 0, heatUsed: 0, timberUsed: 0 };

  // 優先度 1: 熱。半径内の熱の総量に対して、必要な熱量 (heatNeeded) を超えない範囲で按分して取る
  let heatTotal = 0;
  forEachInRadius(home, radius, size, (i) => {
    if (layers.elevation[i] >= SEA_LEVEL) heatTotal += layers.heat[i];
  });
  const heatNeeded = need / HEAT_FUEL;
  let heatUsed = 0;
  if (heatTotal > 0 && heatNeeded > 0) {
    heatUsed = Math.min(heatNeeded, heatTotal);
    const k = heatUsed / heatTotal;
    forEachInRadius(home, radius, size, (i) => {
      if (layers.elevation[i] >= SEA_LEVEL && layers.heat[i] > 0) layers.heat[i] = Math.max(0, layers.heat[i] - layers.heat[i] * k);
    });
  }
  let fuel = heatUsed * HEAT_FUEL;

  // 優先度 2: 鐘樹の材。熱だけで足りなければ、残りの不足分だけ立木に比例して伐り出す
  let timberUsed = 0;
  const remaining = need - fuel;
  if (remaining > 0 && layers.belltree) {
    const belltree = layers.belltree;
    let woodTotal = 0;
    forEachInRadius(home, radius, size, (i) => {
      if (layers.elevation[i] >= SEA_LEVEL) woodTotal += belltree[i];
    });
    const potential = woodTotal * TIMBER_RATE;
    if (potential > 0) {
      timberUsed = Math.min(remaining, potential);
      // need が小さく potential の全部を伐る必要が無ければ、按分で控える (frac < 1)
      const frac = timberUsed / potential;
      forEachInRadius(home, radius, size, (i) => {
        if (layers.elevation[i] >= SEA_LEVEL && belltree[i] > 0) belltree[i] -= belltree[i] * TIMBER_RATE * frac;
      });
    }
  }
  fuel += timberUsed;

  return { fuel, heatUsed, timberUsed };
}
