import type { WorldSnapshot } from '../simulation/types';
import { SEA_LEVEL } from '../simulation/terrain';
import { meanAround, SUPPORT_RADIUS } from '../simulation/civilization';
import { formatFaith } from '../simulation/faith';
import type { Condition, ScenarioDef, StartStats, Verdict } from './types';

export type JudgeInput = {
  snapshot: WorldSnapshot;
  start: StartStats;
  /** 開始からの年 */
  year: number;
  /** プレイヤーの介入回数 (dispatch したコマンド数) */
  interventions: number;
  /** 年ごとの総量の履歴 (開始年から今年まで)。species_mean が使う。省略時は今年の totals だけ */
  history?: Record<string, number>[];
  /** 総量の面積スケール (size / referenceSize)²。species_mean の min は referenceSize のグリッドで書くので、実行時の size に合わせて掛ける。省略時 1 */
  areaScale?: number;
  /** 年ごとの文明の段階の履歴 (開始年から今年まで、history と同じ並び)。civ_stage の years が使う。省略時は今年の段階だけ */
  civHistory?: number[];
  /** 年ごとの集落の生気平均の履歴 (M9-03、civHistory と同じ並び)。civ_vitality の years が使う。省略時は今年の値だけ */
  civVitalityHistory?: number[];
};

/** 集落の支え半径 SUPPORT_RADIUS 内の陸セルの生気の平均 (M9-03)。文明が無い・集落が無ければ 0 */
export function civVitality(s: WorldSnapshot): number {
  const home = s.civ?.home ?? -1;
  if (home < 0) return 0;
  return meanAround(s.layers.vitality, home, SUPPORT_RADIUS, s.layers.elevation, s.size);
}

/** 文明の段階の名前 (0 = なし〜7 = 星)。src/simulation/civilization.ts の STAGE_NAMES と揃える (M8-02 未着地のため暫定でここに置く) */
const STAGE_NAMES = ['なし', '巣', '火', '歌', '石', '帆', '塔', '星'];
const civStageLabel = (n: number) => `${n}(${STAGE_NAMES[n] ?? '?'})`;

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
  const name = (id: string) => s.species.find((d) => d.id === id)?.name ?? id;
  switch (c.type) {
    case 'species_alive': {
      const dead = c.ids.filter((id) => (s.totals[id] ?? 0) <= 0);
      return { ok: dead.length === 0, why: dead.length ? `絶滅: ${dead.map(name).join(', ')}` : `生存: ${c.ids.map(name).join(', ')}` };
    }
    case 'species_mean': {
      const hist = (input.history ?? [s.totals]).slice(-c.years);
      const mean = (id: string) => hist.reduce((a, t) => a + (t[id] ?? 0), 0) / hist.length;
      const min = c.min * (input.areaScale ?? 1);
      const small = c.ids.filter((id) => mean(id) < min);
      const label = `${c.years} 年平均`;
      return {
        ok: small.length === 0,
        why: small.length
          ? `群れが小さい(${label}): ${small.map((id) => `${name(id)} ${mean(id).toFixed(1)} (< ${min.toFixed(1)})`).join(', ')}`
          : `群れが残った(${label}): ${c.ids.map((id) => `${name(id)} ${mean(id).toFixed(1)}`).join(', ')}`,
      };
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
    case 'civ_stage': {
      const stage = s.civ?.stage ?? 0;
      if (c.years !== undefined) {
        const hist = (input.civHistory ?? [stage]).slice(-c.years);
        const minStage = hist.length ? Math.min(...hist) : stage;
        const ok = inRange(minStage, c.min, c.max);
        return { ok, why: ok ? `文明の段階 ${civStageLabel(minStage)}` : `文明の段階が ${civStageLabel(minStage)} まで下がった` };
      }
      const ok = inRange(stage, c.min, c.max);
      return { ok, why: ok ? `文明の段階 ${civStageLabel(stage)}` : `文明の段階が ${civStageLabel(stage)} まで下がった` };
    }
    case 'faith': {
      const faith = s.civ?.faith ?? 0;
      const ok = inRange(faith, c.min, c.max);
      return { ok, why: `信仰 ${formatFaith(faith)}` };
    }
    case 'prayers_answered': {
      const n = s.civ?.prayersAnswered ?? 0;
      const ok = inRange(n, c.min, c.max);
      return { ok, why: n === 0 ? '祈りに一度も応えなかった' : `祈りに ${n} 回応えた` };
    }
    case 'civ_vitality': {
      const now = civVitality(s);
      const hist = c.years !== undefined ? (input.civVitalityHistory ?? [now]).slice(-c.years) : [now];
      const v = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : now;
      const ok = inRange(v, c.min, c.max);
      return { ok, why: ok ? `集落の生気 ${(v * 100).toFixed(0)}%` : `集落の生気が ${(v * 100).toFixed(0)}% まで落ちた` };
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
