import type { Command, WorldSnapshot } from '../simulation/types';
import { judgeScenario, landRatio, startStats, vitalityRatio } from './judge';
import type { ScenarioDef, StartStats, Verdict } from './types';
import { scenarioWarnings, type CivContext, type Warning } from './warnings';

/** 年表の 1 行。石板が種名などに整形して出す */
export type TimelineEvent =
  | { year: number; kind: 'intervene'; command: Command }
  | { year: number; kind: 'scheduled'; command: Command }
  | { year: number; kind: 'power_exhausted' }
  | { year: number; kind: 'warning'; warning: Warning }
  | { year: number; kind: 'verdict'; verdict: Verdict };

type RunnerWorld = { dispatch(cmd: Command): void; snapshot(): WorldSnapshot };

/** intervene が弾いた理由。budget = 力が足りない、finished = 既に判定が確定している */
export type InterveneResult = { ok: true } | { ok: false; reason: 'budget' | 'finished' };

/** 石板に出す力の残量情報。budget のないシナリオでは null */
export type BudgetInfo = { power: number; max: number; incomeLastYear: number; upkeepLastYear: number };

export type ScenarioRunner = {
  readonly def: ScenarioDef;
  /** 毎フレーム呼ぶ。予定コマンドの発火と年次判定を行う */
  update(s: WorldSnapshot): Verdict;
  /** プレイヤーの介入。回数を数えて world に流す。budget があれば値段を引き、足りなければ弾く */
  intervene(cmd: Command): InterveneResult;
  /** 開始からの年 */
  yearOf(s: WorldSnapshot): number;
  verdict(): Verdict;
  interventions(): number;
  /** 現在の星の力。budget のないシナリオでは常に 0 */
  power(): number;
  /** 石板表示用の力の情報。budget のないシナリオでは null */
  budget(): BudgetInfo | null;
  /** 直近の年次評価で出た警告 (年に 1 回更新) */
  warnings(): Warning[];
  /** 出来事の年表 (介入、予定イベント、力切れ、警告の初回、勝敗)。古い順 */
  timeline(): TimelineEvent[];
};

/**
 * 石板の予言を実行する。予定コマンド (滅びの進行) を年に合わせて dispatch し、年が変わるたびに判定する。
 * 判定が確定したら以後は何もしない。
 */
export function createScenarioRunner(
  def: ScenarioDef,
  world: RunnerWorld,
  opts: { onVerdict?: (v: Verdict) => void; onPowerExhausted?: () => void; onWarning?: (w: Warning) => void; ticksPerYear?: number } = {},
): ScenarioRunner {
  const first = world.snapshot();
  const startTick = first.tick;
  const ticksPerYear = opts.ticksPerYear ?? 360;
  let start: StartStats = startStats(first);
  const size = first.size;
  const baselineYear = def.baselineYear ?? 0;
  const scale = size / (def.referenceSize ?? 128);
  /** 総量 (セル密度の和) はセル数に比例するので、species_mean の min は面積比で合わせる */
  const areaScale = scale * scale;
  const fired = new Set<string>();
  let lastYear = -1;
  let interventions = 0;
  let verdict: Verdict = { status: 'running', reason: `${def.years} 年` };

  const budgetDef = def.budget;
  const budgetMax = budgetDef ? (budgetDef.max ?? budgetDef.start * 3) : 0;
  let power = budgetDef?.start ?? 0;
  let incomeLastYear = 0;
  let upkeepLastYear = 0;
  let powerSpent = 0;
  let warnings: Warning[] = [];
  /** 年ごとの総量の履歴 (species_mean の判定用)。年に 1 件 */
  const history: Record<string, number>[] = [];
  /** 年ごとの文明の段階の履歴 (civ_stage の years 判定用)。history と同じ並びで年に 1 件 */
  const civHistory: number[] = [];
  /** 前年の文明の段階。civ_declining の判定に使う。最初の年はまだ「前年」が無いので null */
  let prevCivStage: number | null = null;
  /** 一度ログに出した警告の key。同じ警告を毎年出さない */
  const warned = new Set<string>();
  const timeline: TimelineEvent[] = [];
  let currentYear = 0;

  const yearOf = (s: WorldSnapshot) => Math.floor((s.tick - startTick) / ticksPerYear);

  const resolve = (cmd: Command): Command => {
    let c = cmd;
    // cell = -1 は島の中心
    if ('cell' in c && c.cell === -1) c = { ...c, cell: Math.floor(size / 2) * size + Math.floor(size / 2) };
    // 半径は referenceSize 基準なので size に比例させる
    if (c.type === 'disaster') c = { ...c, radius: Math.max(0, Math.round(c.radius * scale)) };
    return c;
  };

  const fireDue = (year: number) => {
    for (const [idx, sc] of def.schedule.entries()) {
      const last = sc.untilYear ?? sc.atYear;
      for (let y = sc.atYear; y <= Math.min(year, last); y += sc.everyYears ?? Number.POSITIVE_INFINITY) {
        const key = `${idx}@${y}`;
        if (fired.has(key)) continue;
        fired.add(key);
        world.dispatch(resolve(sc.command));
        // 毎年繰り返す進行 (沈降など) は年表に出さない。単発の予定イベントだけ
        if (!sc.everyYears) timeline.push({ year: y, kind: 'scheduled', command: sc.command });
        if (!sc.everyYears) break;
      }
    }
  };

  /** コマンド 1 回の値段。budget が無ければ常に 0 (無料) */
  const costOf = (cmd: Command): number => {
    if (!budgetDef) return 0;
    switch (cmd.type) {
      case 'spawn_species':
        return budgetDef.costs.spawn;
      case 'disaster':
        return budgetDef.costs.disaster;
      case 'set_climate':
        return budgetDef.costs.climate;
      case 'sink':
        return 0;
    }
  };

  /** 年が変わるたびの力の増減。power < 0 になったら 0 にして気候を既定へ戻す */
  const applyBudgetYearChange = (s: WorldSnapshot) => {
    if (!budgetDef) return;
    const income = budgetDef.incomePerYear * landRatio(s) * vitalityRatio(s);
    const { rainScale, tempOffset } = s.climate;
    const upkeep = Math.abs(rainScale - 1) * budgetDef.upkeepPerYear.rainScale + Math.abs(tempOffset) * budgetDef.upkeepPerYear.tempOffset;
    incomeLastYear = income;
    upkeepLastYear = upkeep;
    power += income - upkeep;
    if (power < 0) {
      power = 0;
      world.dispatch({ type: 'set_climate', rainScale: 1, tempOffset: 0 });
      timeline.push({ year: currentYear, kind: 'power_exhausted' });
      opts.onPowerExhausted?.();
    } else {
      power = Math.min(power, budgetMax);
    }
  };

  return {
    def,
    yearOf,
    interventions: () => interventions,
    verdict: () => verdict,
    power: () => power,
    budget: () => (budgetDef ? { power, max: budgetMax, incomeLastYear, upkeepLastYear } : null),
    warnings: () => warnings,
    timeline: () => timeline,
    intervene(cmd) {
      if (verdict.status !== 'running') return { ok: false, reason: 'finished' };
      const cost = costOf(cmd);
      if (budgetDef && power < cost) return { ok: false, reason: 'budget' };
      if (budgetDef) {
        power -= cost;
        powerSpent += cost;
      }
      interventions++;
      world.dispatch(cmd);
      timeline.push({ year: currentYear, kind: 'intervene', command: cmd });
      return { ok: true };
    },
    update(s) {
      if (verdict.status !== 'running') return verdict;
      const year = yearOf(s);
      currentYear = year;
      fireDue(year);
      if (year !== lastYear) {
        // 最初の呼び出し (lastYear === -1) はまだ 1 年も経っていないので力は動かさない
        const isFirstCheck = lastYear === -1;
        lastYear = year;
        if (year === baselineYear) start = startStats(s);
        if (!isFirstCheck) applyBudgetYearChange(s);
        const civ: CivContext = prevCivStage === null ? null : { prevStage: prevCivStage };
        warnings = scenarioWarnings(def, s, start, budgetDef ? { power, max: budgetMax, incomeLastYear, upkeepLastYear } : null, civ);
        for (const w of warnings) {
          if (warned.has(w.key)) continue;
          warned.add(w.key);
          timeline.push({ year, kind: 'warning', warning: w });
          opts.onWarning?.(w);
        }
        history.push({ ...s.totals });
        const civStage = s.civ?.stage ?? 0;
        civHistory.push(civStage);
        prevCivStage = civStage;
        verdict = judgeScenario(def, { snapshot: s, start, year, interventions, history, civHistory, areaScale });
        if (verdict.status !== 'running') {
          verdict = { ...verdict, stats: { interventions, powerSpent, landRatio: landRatio(s), totals: { ...s.totals } } };
          timeline.push({ year, kind: 'verdict', verdict });
          opts.onVerdict?.(verdict);
        }
      }
      return verdict;
    },
  };
}
