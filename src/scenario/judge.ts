import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';
import type { Condition, ScenarioDef, StartStats, Verdict } from './types';

export type JudgeInput = {
  snapshot: WorldSnapshot;
  start: StartStats;
  /** 開始からの年 */
  year: number;
  /** プレイヤーの介入回数 (dispatch したコマンド数) */
  interventions: number;
};

export function landRatio(s: WorldSnapshot): number {
  let land = 0;
  const e = s.layers.elevation;
  for (let i = 0; i < e.length; i++) if (e[i] >= SEA_LEVEL) land++;
  return land / e.length;
}

export function vegetationRatio(s: WorldSnapshot): number {
  let land = 0;
  let v = 0;
  const e = s.layers.elevation;
  for (let i = 0; i < e.length; i++) {
    if (e[i] < SEA_LEVEL) continue;
    land++;
    v += s.layers.vegetation[i];
  }
  return land ? v / land : 0;
}

export function vitalityRatio(s: WorldSnapshot): number {
  let land = 0;
  let v = 0;
  const e = s.layers.elevation;
  for (let i = 0; i < e.length; i++) {
    if (e[i] < SEA_LEVEL) continue;
    land++;
    v += s.layers.vitality[i];
  }
  return land ? v / land : 0;
}

export function startStats(s: WorldSnapshot): StartStats {
  return { landRatio: landRatio(s), totals: { ...s.totals } };
}

const inRange = (v: number, min?: number, max?: number) => (min === undefined || v >= min) && (max === undefined || v <= max);

/** 条件を評価する。戻り値は真偽と、人が読める説明。 */
export function evaluate(c: Condition, input: JudgeInput): { ok: boolean; why: string } {
  const s = input.snapshot;
  switch (c.type) {
    case 'species_alive': {
      const dead = c.ids.filter((id) => (s.totals[id] ?? 0) <= 0);
      return { ok: dead.length === 0, why: dead.length ? `絶滅: ${dead.join(', ')}` : `生存: ${c.ids.join(', ')}` };
    }
    case 'species_extinct': {
      const alive = c.ids.filter((id) => (s.totals[id] ?? 0) > 0);
      return { ok: alive.length === 0, why: alive.length ? `まだ生きている: ${alive.join(', ')}` : `絶滅: ${c.ids.join(', ')}` };
    }
    case 'land_ratio': {
      const v = landRatio(s);
      return { ok: inRange(v, c.min, c.max), why: `陸地率 ${(v * 100).toFixed(0)}%` };
    }
    case 'vegetation_ratio': {
      const v = vegetationRatio(s);
      return { ok: inRange(v, c.min, c.max), why: `植生率 ${(v * 100).toFixed(0)}%` };
    }
    case 'vitality_ratio': {
      const v = vitalityRatio(s);
      return { ok: inRange(v, c.min, c.max), why: `生気 ${(v * 100).toFixed(0)}%` };
    }
    case 'total_ratio_vs_start': {
      const base = input.start.totals[c.id] ?? 0;
      const v = base > 0 ? (s.totals[c.id] ?? 0) / base : 0;
      return { ok: inRange(v, c.min, c.max), why: `${c.id} は開始時の ${v.toFixed(2)} 倍` };
    }
    case 'year_reached':
      return { ok: input.year >= c.year, why: `${input.year} 年目` };
    case 'no_intervention':
      return { ok: input.interventions === 0, why: input.interventions ? `介入 ${input.interventions} 回` : '無介入' };
    case 'all': {
      const rs = c.of.map((x) => evaluate(x, input));
      const bad = rs.find((r) => !r.ok);
      return { ok: !bad, why: bad ? bad.why : rs.map((r) => r.why).join(' / ') };
    }
    case 'any': {
      const rs = c.of.map((x) => evaluate(x, input));
      const good = rs.find((r) => r.ok);
      return { ok: !!good, why: good ? good.why : rs.map((r) => r.why).join(' / ') };
    }
  }
}

/**
 * 年次判定。dead を先に評価し、次に years 到達時の alive を評価する。
 * どちらでもなければ running。
 */
export function judgeScenario(def: ScenarioDef, input: JudgeInput): Verdict {
  if (def.dead) {
    const d = evaluate(def.dead, input);
    if (d.ok) return { status: 'dead', reason: d.why };
  }
  if (input.year >= def.years) {
    const a = evaluate(def.alive, input);
    return a.ok ? { status: 'alive', reason: a.why } : { status: 'dead', reason: `予言の年に条件を満たせず: ${a.why}` };
  }
  return { status: 'running', reason: `${def.years - input.year} 年` };
}
