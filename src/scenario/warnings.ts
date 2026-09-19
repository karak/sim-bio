import type { WorldSnapshot } from '../simulation/types';
import { landRatio } from './judge';
import type { Condition, ScenarioDef, StartStats } from './types';

export type WarningKind = 'species_low' | 'land_low' | 'power_low' | 'power_capped' | 'upkeep_over_income' | 'civ_declining';

/** 石板に出す警告。key は「同じ警告を年ごとに何度もログに出さない」ための識別子 */
export type Warning = {
  kind: WarningKind;
  /** species_low のとき、その種の id */
  id?: string;
  key: string;
  text: string;
};

/** 警告の材料になる力の情報 (ScenarioRunner.budget() と同じ形)。budget のないシナリオでは null */
export type PowerInfo = { power: number; max: number; incomeLastYear: number; upkeepLastYear: number };

/** civ_declining の材料。前年の文明の段階。文明が無い/前年が無い (最初の年) なら null */
export type CivContext = { prevStage: number } | null;

/** 種の総量がこの割合を下回ると警告 */
export const SPECIES_LOW_RATIO = 0.25;
/** 陸地率がこの割合を下回ると警告 */
export const LAND_LOW_RATIO = 0.5;

/** alive 条件が参照している種の id を集める。警告はこの種だけに出す (勝敗に関わらない種は騒がない) */
export function speciesInCondition(c: Condition): string[] {
  switch (c.type) {
    case 'species_alive':
    case 'species_extinct':
    case 'species_mean':
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
 * power_low: どのコマンドも買えない。power_capped: 上限に達していて収入を捨てている。
 * upkeep_over_income: 直前の年の維持費が収入を超えている。
 * def.ignoreWarnings にある種類は出さない (予言どおりの進行を警告にしないため)。
 * civ_declining: 文明の段階が前年より下がった年に出す (civ 引数を渡したときだけ。省略時は評価しない)。陸のあとに置く。
 */
export function scenarioWarnings(def: ScenarioDef, s: WorldSnapshot, start: StartStats, power: PowerInfo | null, civ: CivContext = null): Warning[] {
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
  if (civ) {
    const stage = s.civ?.stage ?? 0;
    if (stage < civ.prevStage) {
      out.push({ kind: 'civ_declining', key: `civ_declining:${stage}`, text: `文明が衰えている(段階 ${civ.prevStage} → ${stage})` });
    }
  }
  if (def.budget && power) {
    const cheapest = Math.min(def.budget.costs.spawn, def.budget.costs.disaster, def.budget.costs.climate);
    if (power.power < cheapest) out.push({ kind: 'power_low', key: 'power_low', text: `力が足りない(残り ${Math.floor(power.power)})` });
    if (power.power >= power.max && power.incomeLastYear > 0) {
      out.push({ kind: 'power_capped', key: 'power_capped', text: `力が上限(${power.max})に達している。使わなければ収入は捨てられる` });
    }
    if (power.upkeepLastYear > 0 && power.upkeepLastYear > power.incomeLastYear) {
      out.push({
        kind: 'upkeep_over_income',
        key: 'upkeep_over_income',
        text: `維持費が収入を超えている(−${power.upkeepLastYear.toFixed(1)}/年 > +${power.incomeLastYear.toFixed(1)}/年)`,
      });
    }
  }
  const ignore = new Set(def.ignoreWarnings ?? []);
  return out.filter((w) => !ignore.has(w.kind));
}
