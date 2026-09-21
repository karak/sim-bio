import type { WorldSnapshot } from '../simulation/types';
import { landRatio } from './judge';
import { FUEL_YEARS } from '../simulation/civilizationFuel';
import { UNREST_FAITH, UNREST_YEARS } from '../simulation/unrest';
import { formatFaith } from '../simulation/faith';
import type { Condition, ScenarioDef, StartStats } from './types';

export type WarningKind = 'species_low' | 'land_low' | 'power_low' | 'power_capped' | 'upkeep_over_income' | 'civ_declining' | 'fuel_low' | 'faith_low' | 'civ_vitality_low';

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
/** 信仰がこれを下回ると警告 (M9-03)。内乱の閾値 UNREST_FAITH (0.3) より手前で知らせる */
export const FAITH_LOW = 0.4;
/** 集落の生気がこれを下回ると警告 (M9-05)。霊脈枯れの alive (3 割) より手前で知らせる。衰退の VITALITY_FLOOR (0.1) はさらに下 */
export const CIV_VITALITY_LOW = 0.5;

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
  // 塔の燃料 (M8-08): 直近の年次実績が必要量に足りていない年に出す
  // M8-06 (v2): 蓄えの導入後は「その年に集めた量」ではなく蓄えと負債で判断する。集めた量が 0 でも蓄えがあれば塔は立つので、
  // 蓄えが 1 年分を割った年に「心細い」、負債が積み上がっている年に「足りない(不足 N 年分)」を出す
  if (s.civ?.fuel && s.civ.fuel.need > 0) {
    const { stock, need, debt } = s.civ.fuel;
    if (debt > 0) {
      out.push({ kind: 'fuel_low', key: 'fuel_low', text: `塔の燃料が足りない(不足 ${(debt / need).toFixed(1)} 年分。${FUEL_YEARS} 年分で一段崩れる)` });
    } else if (stock < need) {
      out.push({ kind: 'fuel_low', key: 'fuel_low:stock', text: `塔の燃料が心細い(蓄え ${Math.round(stock)} / 年に ${Math.round(need)})` });
    }
  }
  // 信仰 (M9-03): 文明があり信仰が生まれていて、FAITH_LOW を下回った年に出す
  if (s.civ?.faith !== undefined && s.civ.faith < FAITH_LOW) {
    out.push({ kind: 'faith_low', key: 'faith_low', text: `民の信仰が揺らいでいる(${formatFaith(s.civ.faith)}。${UNREST_FAITH} を ${UNREST_YEARS} 年割れば内乱)` });
  }
  // 集落の生気 (M9-05): 霊脈が細ると苔を放っても戻らないので、早めに知らせる
  if (s.civ?.vitality !== undefined && s.civ.stage >= 1 && s.civ.vitality < CIV_VITALITY_LOW) {
    out.push({ kind: 'civ_vitality_low', key: 'civ_vitality_low', text: `集落の生気が痩せている(${Math.round(s.civ.vitality * 100)}%。霊脈が細ると苔を放っても戻らない)` });
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
