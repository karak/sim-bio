import type { WorldSnapshot } from '../simulation/types';
import { landRatio } from './judge';
import type { Condition, ScenarioDef, StartStats } from './types';

/** 石板に出す警告。key は「同じ警告を年ごとに何度もログに出さない」ための識別子 */
export type Warning = {
  kind: 'species_low' | 'land_low' | 'power_low' | 'upkeep_over_income';
  /** species_low のとき、その種の id */
  id?: string;
  key: string;
  text: string;
};

/** 警告の材料になる力の情報 (ScenarioRunner.budget() と同じ形)。budget のないシナリオでは null */
export type PowerInfo = { power: number; incomeLastYear: number; upkeepLastYear: number };

/** 種の総量がこの割合を下回ると警告 */
export const SPECIES_LOW_RATIO = 0.25;
/** 陸地率がこの割合を下回ると警告 */
export const LAND_LOW_RATIO = 0.5;

/** alive 条件が参照している種の id を集める。警告はこの種だけに出す (勝敗に関わらない種は騒がない) */
export function speciesInCondition(c: Condition): string[] {
  switch (c.type) {
    case 'species_alive':
    case 'species_extinct':
      return c.ids;
    case 'total_ratio_vs_start':
      return [c.id];
    case 'all':
    case 'any':
      return c.of.flatMap(speciesInCondition);
    default:
      return [];
  }
}

/**
 * 年に 1 回評価する純粋関数。順番は「勝敗に近いもの」から: 種 → 陸 → 力。
 * species_low: 基準 (start) の 25% 未満。land_low: 基準の陸地率の半分未満。
 * power_low: どのコマンドも買えない。upkeep_over_income: 直前の年の維持費が収入を超えている。
 */
export function scenarioWarnings(def: ScenarioDef, s: WorldSnapshot, start: StartStats, power: PowerInfo | null): Warning[] {
  const out: Warning[] = [];
  const ids = [...new Set(speciesInCondition(def.alive))];
  for (const id of ids) {
    const base = start.totals[id] ?? 0;
    if (base <= 0) continue;
    const ratio = (s.totals[id] ?? 0) / base;
    if (ratio < SPECIES_LOW_RATIO) {
      const name = s.species.find((d) => d.id === id)?.name ?? id;
      out.push({ kind: 'species_low', id, key: `species_low:${id}`, text: `${name}が減っている(基準の ${Math.round(ratio * 100)}%)` });
    }
  }
  if (start.landRatio > 0) {
    const ratio = landRatio(s) / start.landRatio;
    if (ratio < LAND_LOW_RATIO) out.push({ kind: 'land_low', key: 'land_low', text: `陸が減っている(基準の ${Math.round(ratio * 100)}%)` });
  }
  if (def.budget && power) {
    const cheapest = Math.min(def.budget.costs.spawn, def.budget.costs.disaster, def.budget.costs.climate);
    if (power.power < cheapest) out.push({ kind: 'power_low', key: 'power_low', text: `力が足りない(残り ${Math.floor(power.power)})` });
    if (power.upkeepLastYear > 0 && power.upkeepLastYear > power.incomeLastYear) {
      out.push({
        kind: 'upkeep_over_income',
        key: 'upkeep_over_income',
        text: `維持費が収入を超えている(−${power.upkeepLastYear.toFixed(1)}/年 > +${power.incomeLastYear.toFixed(1)}/年)`,
      });
    }
  }
  return out;
}
