import type { Command, WorldSnapshot } from '../simulation/types';
import { civVitality, judgeScenario, landRatio, startStats, vitalityRatio } from './judge';
import type { ScenarioDef, StartStats, Verdict } from './types';
import { scenarioWarnings, type CivContext, type Warning } from './warnings';
import type { PrayerKind } from '../simulation/prayer';

/** 年表の 1 行。石板が種名などに整形して出す */
export type TimelineEvent =
  | { year: number; kind: 'intervene'; command: Command }
  | { year: number; kind: 'scheduled'; command: Command }
  | { year: number; kind: 'power_exhausted' }
  | { year: number; kind: 'warning'; warning: Warning }
  | { year: number; kind: 'verdict'; verdict: Verdict }
  /** 文明の段階が年をまたいで変わった (M8-04)。from/to は STAGE_NAMES の index */
  | { year: number; kind: 'civ_stage'; from: number; to: number }
  /** 文明の信仰が年をまたいで |Δ| >= 0.1 動いた (M9-01) */
  | { year: number; kind: 'civ_faith'; from: number; to: number }
  /** 勅令の結果 (M9-03)。obeyed なら民が採掘を止めた/再開した、でなければ聞かなかった (faith はそのときの信仰) */
  | { year: number; kind: 'civ_edict'; edict: 'stop_mining' | 'resume_mining'; obeyed: boolean; faith: number }
  /** 文明の祈りが出た・応えられた・無視された (M9-02) */
  | { year: number; kind: 'prayer'; phase: 'issued' | 'answered' | 'ignored'; prayer: PrayerKind };

type RunnerWorld = { dispatch(cmd: Command): void; snapshot(): WorldSnapshot };

/** 信仰の年表イベント (civ_faith) を積む閾値。前年との差の絶対値がこれ以上のときだけ積む (M9-01) */
const FAITH_TIMELINE_THRESHOLD = 0.1;

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
  /** 現在有効な祈りと残り年数 (石板表示用、M9-02)。祈りが無ければ null */
  prayer(): { kind: PrayerKind; yearsLeft: number } | null;
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
  opts: {
    onVerdict?: (v: Verdict) => void;
    onPowerExhausted?: () => void;
    onWarning?: (w: Warning) => void;
    /** 祈りが出た・応えられた・無視された年に呼ぶ (M9-02)。onWarning と同じ形 */
    onPrayer?: (e: Extract<TimelineEvent, { kind: 'prayer' }>) => void;
    ticksPerYear?: number;
  } = {},
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
  /** 年ごとの集落の生気平均の履歴 (M9-03、civHistory と同じ並び)。civ_vitality の years 判定用 */
  const civVitalityHistory: number[] = [];
  /** 前年の勅令 (M9-03)。年を跨いで新しい勅令が記録されていれば年表に積む */
  let lastEdictYear: number | null = first.civ?.edict?.year ?? null;
  /** 前年の文明の段階。civ_declining の判定に使う。最初の年はまだ「前年」が無いので null */
  let prevCivStage: number | null = null;
  /** 一度ログに出した警告の key。同じ警告を毎年出さない */
  const warned = new Set<string>();
  const timeline: TimelineEvent[] = [];
  let currentYear = 0;
  /** 直近に見た文明の段階。年をまたいで変わったら timeline に積む (M8-04) */
  let lastCivStage = first.civ?.stage ?? 0;
  /** 直近に見た信仰の値。文明が無い・stage 0 のあいだは null (M9-01) */
  let lastCivFaith: number | null = first.civ?.faith ?? null;
  /** 祈り (M9-02): 直近の年次評価で報告済みの issuedYear。同じ祈りを二重に issued 扱いしないための目印 */
  let lastPrayerIssuedYear: number | null = first.civ?.prayer?.issuedYear ?? null;
  /** 祈り (M9-02): 直近に見た祈りの種類。解決 (answered/ignored) された時点では civ.prayer が消えているので、
   * 「何が解決されたか」を answered/ignored の件数が増えた瞬間まで覚えておく */
  let lastPrayerKind: PrayerKind | null = first.civ?.prayer?.kind ?? null;
  /** 祈り (M9-02): 直近に見た応えた・無視した回数。前年と比べて増えていれば TimelineEvent を積む */
  let lastPrayersAnswered = first.civ?.prayersAnswered ?? 0;
  let lastPrayersIgnored = first.civ?.prayersIgnored ?? 0;
  /** 祈り (M9-02): 石板が毎フレーム読む現在の祈り。年次評価を待たず、最新の snapshot でそのまま更新する */
  let currentPrayer = first.civ?.prayer ?? null;

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
      // 勅令 (M9-03) は言葉なので力は要らない (信仰の門が代わり)
      case 'civ_edict':
        return 0;
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
    prayer: () => (currentPrayer ? { kind: currentPrayer.kind, yearsLeft: Math.max(0, currentPrayer.deadlineYear - currentYear) } : null),
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
      // 予定コマンド (fireDue) と同じく cell = -1 (島の中心) と半径の縮尺を解決してから流す。
      // 以前は resolve を通さず生の cmd を dispatch していたため、プレイヤー操作由来の介入で
      // cell: -1 を使うと (-1, 0) 相当の意図しない位置に適用されていた (M8-05 で発覚)
      world.dispatch(resolve(cmd));
      timeline.push({ year: currentYear, kind: 'intervene', command: cmd });
      return { ok: true };
    },
    update(s) {
      if (verdict.status !== 'running') return verdict;
      const year = yearOf(s);
      currentYear = year;
      // 祈り (M9-02): 石板が毎フレーム読めるように、年次評価を待たず最新の値に更新しておく
      currentPrayer = s.civ?.prayer ?? null;
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
        civVitalityHistory.push(civVitality(s));
        prevCivStage = civStage;
        if (civStage !== lastCivStage) {
          timeline.push({ year, kind: 'civ_stage', from: lastCivStage, to: civStage });
          lastCivStage = civStage;
        }
        // 信仰 (M9-01): 前年・今年とも値があり、差の絶対値が閾値以上のときだけ積む。
        // 発生前 (undefined → 値が付く年) は「前年の値」が無いので積まない
        const civFaith = s.civ?.faith;
        if (civFaith !== undefined && lastCivFaith !== null && Math.abs(civFaith - lastCivFaith) >= FAITH_TIMELINE_THRESHOLD) {
          timeline.push({ year, kind: 'civ_faith', from: lastCivFaith, to: civFaith });
        }
        if (civFaith !== undefined) lastCivFaith = civFaith;
        // 祈り (M9-02): 前年と比べて解決 (無視 → 応えた の順、World の内部順序に合わせる) → 発生の順で積む。
        // 解決の種類は civ.prayer が消えた後には残らないので、直近に見ていた種類 (lastPrayerKind) で補う
        const prayersIgnored = s.civ?.prayersIgnored ?? 0;
        if (prayersIgnored > lastPrayersIgnored && lastPrayerKind) {
          const e: TimelineEvent = { year, kind: 'prayer', phase: 'ignored', prayer: lastPrayerKind };
          timeline.push(e);
          opts.onPrayer?.(e);
        }
        lastPrayersIgnored = prayersIgnored;
        const prayersAnswered = s.civ?.prayersAnswered ?? 0;
        if (prayersAnswered > lastPrayersAnswered && lastPrayerKind) {
          const e: TimelineEvent = { year, kind: 'prayer', phase: 'answered', prayer: lastPrayerKind };
          timeline.push(e);
          opts.onPrayer?.(e);
        }
        lastPrayersAnswered = prayersAnswered;
        const prayerNow = s.civ?.prayer ?? null;
        if (prayerNow && prayerNow.issuedYear !== lastPrayerIssuedYear) {
          const e: TimelineEvent = { year, kind: 'prayer', phase: 'issued', prayer: prayerNow.kind };
          timeline.push(e);
          opts.onPrayer?.(e);
          lastPrayerIssuedYear = prayerNow.issuedYear;
        }
        if (prayerNow) lastPrayerKind = prayerNow.kind;
        // 勅令 (M9-03): 新しい勅令が記録されていれば、従ったか (採掘の停止/再開) 聞かなかったかを年表に積む
        const edict = s.civ?.edict;
        if (edict && edict.year !== lastEdictYear) {
          timeline.push({ year, kind: 'civ_edict', edict: edict.kind, obeyed: edict.obeyed, faith: edict.faith });
          lastEdictYear = edict.year;
        }
        verdict = judgeScenario(def, { snapshot: s, start, year, interventions, history, civHistory, civVitalityHistory, areaScale });
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
