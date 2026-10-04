import type { Command, WorldSnapshot } from '../simulation/types';
import { civVitality, judgeScenario, landRatio, startStats, vitalityRatio } from './judge';
import type { ScenarioDef, StartStats, Verdict } from './types';
import { scenarioWarnings, type CivContext, type Warning } from './warnings';
import type { PrayerKind } from '../simulation/prayer';
import type { CivState } from '../simulation/civilization';
import { canIntercept, INTERCEPT_NEED } from '../simulation/works';
import { TOWER_COST, TOWER_RAIN_SCALE_DEFAULT, TOWER_TEMP_OFFSET_DEFAULT, TOWER_UPKEEP } from '../simulation/weatherTower';

/** 年表の 1 行。石板が種名などに整形して出す */
export type TimelineEvent =
  | { year: number; kind: 'intervene'; command: Command }
  | { year: number; kind: 'scheduled'; command: Command; text?: string }
  | { year: number; kind: 'power_exhausted' }
  | { year: number; kind: 'warning'; warning: Warning }
  | { year: number; kind: 'verdict'; verdict: Verdict }
  /** 文明の段階が年をまたいで変わった (M8-04)。from/to は STAGE_NAMES の index */
  | { year: number; kind: 'civ_stage'; from: number; to: number }
  /** 文明の信仰が年をまたいで |Δ| >= 0.1 動いた (M9-01) */
  | { year: number; kind: 'civ_faith'; from: number; to: number }
  /** 信仰の上限 (民の記憶) が年をまたいで |Δ| >= FAITH_TIMELINE_THRESHOLD 動いた (M10R-02) */
  | { year: number; kind: 'civ_faith_cap'; from: number; to: number }
  /** 勅令の結果 (M9-03)。obeyed なら民が採掘を止めた/再開した、でなければ聞かなかった (faith はそのときの信仰) */
  | { year: number; kind: 'civ_edict'; edict: 'stop_mining' | 'resume_mining'; obeyed: boolean; faith: number }
  /** 文明の祈りが出た・応えられた・無視された (M9-02) */
  | { year: number; kind: 'prayer'; phase: 'issued' | 'answered' | 'ignored' | 'withdrawn'; prayer: PrayerKind }
  /** 気象塔を建てた (M10-01)。build_tower の intervene はこれを積む (汎用の intervene とは分ける) */
  | { year: number; kind: 'tower'; cell: number; rainScale: number; tempOffset: number }
  /** 気象塔の維持費が力を上回り、全ての塔が止まった (M10-01) */
  | { year: number; kind: 'tower_stopped' }
  /** 力が戻り、止まっていた気象塔が動き出した (M10-01) */
  | { year: number; kind: 'tower_resumed' }
  /** 迎撃 (M10-02): atYear 年目に予定されていた隕石を取り消した */
  | { year: number; kind: 'intercepted'; atYear: number }
  /** 夢喰いが集落に現れた・去った (M10R-03)。faithCap はそのときの信仰の上限 (石板の文言に使う) */
  | { year: number; kind: 'dream_eater'; phase: 'appeared' | 'left'; faithCap: number };

/** dispatch の戻り値は World の validate の結果 (M10 レビュー)。偽の world (テスト) は void でよく、その場合は受理とみなす */
type RunnerWorld = { dispatch(cmd: Command, opts?: { fromStar?: boolean }): void | { ok: true } | { ok: false; reason: string }; snapshot(): WorldSnapshot };

/** 信仰の年表イベント (civ_faith) を積む閾値。前年との差の絶対値がこれ以上のときだけ積む (M9-01) */
const FAITH_TIMELINE_THRESHOLD = 0.1;

/**
 * intervene が弾いた理由。budget = 力が足りない、finished = 既に判定が確定している、
 * no_target = 取り消せる予定隕石が無い (M10-02)、rejected = 民の側の条件 (星でない・備蓄不足) で迎撃できない (M10-02)
 */
export type InterveneResult = { ok: true } | { ok: false; reason: 'budget' | 'finished' | 'no_target' | 'rejected' };

/** 石板に出す力の残量情報。budget のないシナリオでは null */
export type BudgetInfo = { power: number; max: number; incomeLastYear: number; upkeepLastYear: number };

export type ScenarioRunner = {
  readonly def: ScenarioDef;
  // M19-04: 年の境目では stepByYear が境目ちょうどの snapshot で update を呼ぶ。同じ年のうちに何度呼んでも、年次評価と予定の発火は 1 回きり
  /** 毎フレーム呼ぶ。予定コマンドの発火と年次判定を行う */
  update(s: WorldSnapshot): Verdict;
  /** プレイヤーの介入。回数を数えて world に流す。budget があれば値段を引き、足りなければ弾く */
  intervene(cmd: Command): InterveneResult;
  /** 開始からの年 */
  yearOf(s: WorldSnapshot): number;
  /** 次の年の境目までの tick 数 (1〜ticksPerYear)。境目ちょうどなら ticksPerYear。stepByYear が 1 回の step をここで切る (M19-04) */
  ticksToNextYear(s: WorldSnapshot): number;
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
  /** 年の境目ごとの評価で見た種の総数。年 0 から 1 年に 1 件 (年代記の折れ線、M19-06) */
  totalsByYear(): readonly Readonly<Record<string, number>>[];
  /** 石板に出す予言の節目 (M10-02)。迎撃で取り消した隕石の年の節目は消える */
  milestones(): { atYear: number; text: string }[];
  /** 迎撃で取り消せる次の予定隕石の年 (M10-02)。無ければ null。HUD が迎撃の可否に使う */
  nextMeteorYear(): number | null;
  /** 今の状態の写し (M19-14)。SaveData と同じ tick で取り、createScenarioRunner の restored に渡せば続きから進む */
  save(): RunnerState;
};

/** RunnerState の形の版。形を変えたら上げる (古い版の状態は読まず、石板の初めからにする) */
export const RUNNER_STATE_VERSION = 1;

/**
 * runner の状態 (M19-14)。JSON にできるものだけ (Set は配列にする)。
 * 石板の定義 (def) と島から決まるもの (大きさ・力の上限) は持たず、生成のときに求め直す
 */
export type RunnerState = {
  version: typeof RUNNER_STATE_VERSION;
  scenarioId: string;
  startTick: number;
  start: StartStats;
  fired: string[];
  cancelled: number[];
  lastYear: number;
  interventions: number;
  verdict: Verdict;
  power: number;
  incomeLastYear: number;
  upkeepLastYear: number;
  powerSpent: number;
  warnings: Warning[];
  history: Record<string, number>[];
  civHistory: number[];
  civVitalityHistory: number[];
  lastEdictN: number | null;
  pendingIntercepts: number;
  lastIntercepted: number;
  prevShipProgress: number | null;
  prevCivStage: number | null;
  warned: string[];
  timeline: TimelineEvent[];
  currentYear: number;
  lastCivStage: number;
  lastCivFaith: number | null;
  lastCivFaithCap: number | null;
  lastDreamEater: boolean;
  lastPrayerIssuedYear: number | null;
  lastPrayerKind: PrayerKind | null;
  lastPrayersAnswered: number;
  lastPrayersIgnored: number;
  lastPrayersWithdrawn: number;
  currentPrayer: CivState['prayer'] | null;
  announced: Warning[];
};

/** 石板を始めるときの状態。値の意味は createScenarioRunner の中の同じ名前の変数のコメント */
function freshState(def: ScenarioDef, first: WorldSnapshot): RunnerState {
  return {
    version: RUNNER_STATE_VERSION,
    scenarioId: def.id,
    startTick: first.tick,
    start: startStats(first),
    fired: [],
    cancelled: [],
    lastYear: -1,
    interventions: 0,
    verdict: { status: 'running', reason: `${def.years} 年` },
    power: def.budget?.start ?? 0,
    incomeLastYear: 0,
    upkeepLastYear: 0,
    powerSpent: 0,
    warnings: [],
    history: [],
    civHistory: [],
    civVitalityHistory: [],
    lastEdictN: first.civ?.edict?.n ?? null,
    pendingIntercepts: 0,
    lastIntercepted: first.civ?.intercepted ?? 0,
    prevShipProgress: null,
    prevCivStage: null,
    warned: [],
    timeline: [],
    currentYear: 0,
    lastCivStage: first.civ?.stage ?? 0,
    lastCivFaith: first.civ?.faith ?? null,
    lastCivFaithCap: first.civ?.faithCap ?? null,
    lastDreamEater: first.dreamEater != null,
    lastPrayerIssuedYear: first.civ?.prayer?.issuedYear ?? null,
    lastPrayerKind: first.civ?.prayer?.kind ?? null,
    lastPrayersAnswered: first.civ?.prayersAnswered ?? 0,
    lastPrayersIgnored: first.civ?.prayersIgnored ?? 0,
    lastPrayersWithdrawn: first.civ?.prayersWithdrawn ?? 0,
    currentPrayer: first.civ?.prayer ?? null,
    announced: [],
  };
}

/** 保存した状態がこの版・この石板のものでなければ理由を返す (置き場から読んだ続きの確かめと、restored の門で同じものを使う) */
export function runnerStateMismatch(saved: Pick<RunnerState, 'version' | 'scenarioId'>, scenarioId: string): string | null {
  if (saved.version !== RUNNER_STATE_VERSION) return `unsupported runner state version ${String(saved.version)}`;
  if (saved.scenarioId !== scenarioId) return `runner state of ${saved.scenarioId} for ${scenarioId}`;
  return null;
}

/** 保存した状態を、この石板のものか確かめてから写す。違えば投げる (呼び手は石板の初めからにする) */
function restoredState(def: ScenarioDef, saved: RunnerState): RunnerState {
  const mismatch = runnerStateMismatch(saved, def.id);
  if (mismatch) throw new Error(mismatch);
  return structuredClone(saved);
}

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
  /** 途中で閉じた石板の続き (M19-14)。world はこの状態と同じ tick の SaveData から restore したもの */
  restored?: RunnerState,
): ScenarioRunner {
  const first = world.snapshot();
  const init = restored ? restoredState(def, restored) : freshState(def, first);
  const startTick = init.startTick;
  const ticksPerYear = opts.ticksPerYear ?? 360;
  let start: StartStats = init.start;
  const size = first.size;
  const baselineYear = def.baselineYear ?? 0;
  const scale = size / (def.referenceSize ?? 128);
  /** 総量 (セル密度の和) はセル数に比例するので、species_mean の min は面積比で合わせる */
  const areaScale = scale * scale;
  const fired = new Set<string>(init.fired);
  /** 迎撃で取り消した予定の index (M10-02)。fireDue は飛ばす */
  const cancelled = new Set<number>(init.cancelled);
  let lastYear = init.lastYear;
  let interventions = init.interventions;
  let verdict: Verdict = init.verdict;

  const budgetDef = def.budget;
  const budgetMax = budgetDef ? (budgetDef.max ?? budgetDef.start * 3) : 0;
  let power = init.power;
  let incomeLastYear = init.incomeLastYear;
  let upkeepLastYear = init.upkeepLastYear;
  let powerSpent = init.powerSpent;
  let warnings: Warning[] = init.warnings;
  /** 年ごとの総量の履歴 (species_mean の判定用)。年に 1 件 */
  const history: Record<string, number>[] = init.history;
  /** 年ごとの文明の段階の履歴 (civ_stage の years 判定用)。history と同じ並びで年に 1 件 */
  const civHistory: number[] = init.civHistory;
  /** 年ごとの集落の生気平均の履歴 (M9-03、civHistory と同じ並び)。civ_vitality の years 判定用 */
  const civVitalityHistory: number[] = init.civVitalityHistory;
  /** 最後に年表に積んだ勅令の通し番号 (M9-03)。新しい勅令が記録されていれば年表に積む (同じ年の 2 つ目も) */
  let lastEdictN: number | null = init.lastEdictN;
  /** 撃ったがまだ World に適用されていない迎撃の数 (M10 レビュー)。snapshot の intercepted が増えたぶん減らす */
  let pendingIntercepts = init.pendingIntercepts;
  let lastIntercepted = init.lastIntercepted;
  /** 前年の舟の進み (M10-04、ship_stalled の判定)。前年に建造中の舟が無ければ null */
  let prevShipProgress: number | null = init.prevShipProgress;
  /** 前年の文明の段階。civ_declining の判定に使う。最初の年はまだ「前年」が無いので null */
  let prevCivStage: number | null = init.prevCivStage;
  /** 一度ログに出した警告の key。同じ警告を毎年出さない */
  const warned = new Set<string>(init.warned);
  const timeline: TimelineEvent[] = init.timeline;
  let currentYear = init.currentYear;
  /** 直近に見た文明の段階。年をまたいで変わったら timeline に積む (M8-04) */
  let lastCivStage = init.lastCivStage;
  /** 直近に見た信仰の値。文明が無い・stage 0 のあいだは null (M9-01) */
  let lastCivFaith: number | null = init.lastCivFaith;
  /** 直近に見た信仰の上限。文明が無い・stage 0 のあいだは null (M10R-02) */
  let lastCivFaithCap: number | null = init.lastCivFaithCap;
  /** 直近に見た夢喰いの有無 (M10R-03)。snapshot.dreamEater は World が年に一度更新するだけなので、ここでは有無の flip を見るだけでよい */
  let lastDreamEater = init.lastDreamEater;
  /** 祈り (M9-02): 直近の年次評価で報告済みの issuedYear。同じ祈りを二重に issued 扱いしないための目印 */
  let lastPrayerIssuedYear: number | null = init.lastPrayerIssuedYear;
  /** 祈り (M9-02): 直近に見た祈りの種類。解決 (answered/ignored) された時点では civ.prayer が消えているので、
   * 「何が解決されたか」を answered/ignored の件数が増えた瞬間まで覚えておく */
  let lastPrayerKind: PrayerKind | null = init.lastPrayerKind;
  /** 祈り (M9-02): 直近に見た応えた・無視した回数。前年と比べて増えていれば TimelineEvent を積む */
  let lastPrayersAnswered = init.lastPrayersAnswered;
  let lastPrayersIgnored = init.lastPrayersIgnored;
  let lastPrayersWithdrawn = init.lastPrayersWithdrawn;
  /** 祈り (M9-02): 石板が毎フレーム読む現在の祈り。年次評価を待たず、最新の snapshot でそのまま更新する */
  let currentPrayer = init.currentPrayer;

  const yearOf = (s: WorldSnapshot) => Math.floor((s.tick - startTick) / ticksPerYear);

  const resolve = (cmd: Command): Command => {
    let c = cmd;
    // cell = -1 は島の中心
    if ('cell' in c && c.cell === -1) c = { ...c, cell: Math.floor(size / 2) * size + Math.floor(size / 2) };
    // 半径は referenceSize 基準なので size に比例させる
    if (c.type === 'disaster') c = { ...c, radius: Math.max(0, Math.round(c.radius * scale)) };
    return c;
  };

  /** 今年発火した text 付きの予定 (M10R-07)。年次評価の警告に足してから空にする */
  let announced: Warning[] = init.announced;
  const fireDue = (year: number) => {
    for (const [idx, sc] of def.schedule.entries()) {
      if (cancelled.has(idx)) continue;
      // M10R レビュー: everyYears があって untilYear が無ければ予言の年まで繰り返す (以前は 1 回しか撃たず、
      // 祈りに応えるなの「十二年ごとの狼」が 6 年目の 1 回だけになっていた)
      const last = sc.untilYear ?? (sc.everyYears ? def.years : sc.atYear);
      for (let y = sc.atYear; y <= Math.min(year, last); y += sc.everyYears ?? Number.POSITIVE_INFINITY) {
        const key = `${idx}@${y}`;
        if (fired.has(key)) continue;
        fired.add(key);
        // 予定コマンドは星の行為ではない (信仰の儀式・祈りの応えに数えない。M9 レビュー)
        world.dispatch(resolve(sc.command), { fromStar: false });
        // 毎年繰り返す進行 (沈降など) は年表に出さない。単発の予定イベントだけ。
        // ただし text のある予定 (M10R-07: 狼の波) は繰り返しでも年表と警告に出す (星が気づいて動くための台詞)
        if (!sc.everyYears) timeline.push({ year: y, kind: 'scheduled', command: sc.command });
        else if (sc.text) timeline.push({ year: y, kind: 'scheduled', command: sc.command, text: sc.text });
        // 警告から種レイヤーを開ける (M21-02 D5): spawn_species の予定なら id を種 id にする (species_low と同じ規約)
        if (sc.text) announced.push({ kind: 'event', key: `event:${idx}@${y}`, text: sc.text, ...(sc.command.type === 'spawn_species' ? { id: sc.command.speciesId } : {}) });
        if (!sc.everyYears) break;
      }
    }
  };

  /** World が適用した迎撃の数 (snapshot の intercepted の増え) だけ pendingIntercepts を減らす。何度呼んでも同じ (M19-04) */
  const syncIntercepts = (s: WorldSnapshot) => {
    const intercepted = s.civ?.intercepted ?? 0;
    if (intercepted !== lastIntercepted) {
      pendingIntercepts = Math.max(0, pendingIntercepts - (intercepted - lastIntercepted));
      lastIntercepted = intercepted;
    }
  };

  /** 迎撃で取り消せる次の予定隕石 (M10-02): 単発 (everyYears 無し) の隕石で、まだ発火も取り消しもされていない最も早いもの */
  const nextMeteor = (): { idx: number; atYear: number } | null => {
    let best: { idx: number; atYear: number } | null = null;
    for (const [idx, sc] of def.schedule.entries()) {
      if (cancelled.has(idx) || sc.everyYears || fired.has(`${idx}@${sc.atYear}`)) continue;
      if (sc.command.type !== 'disaster' || sc.command.kind !== 'meteor') continue;
      if (sc.atYear <= currentYear) continue;
      if (!best || sc.atYear < best.atYear) best = { idx, atYear: sc.atYear };
    }
    return best;
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
      // 気象塔 (M10-01) を建てる値段。省略時は TOWER_COST
      case 'build_tower':
        return budgetDef.costs.tower ?? TOWER_COST;
      // 維持費の自動切り替え (M10-01) は言葉ではなく力の増減そのものなので、ここでは値段を持たない (0)
      case 'tower_power':
        return 0;
      // 迎撃 (M10-02) は民の備蓄 (輝石) で払う。力は要らない
      case 'intercept':
        return 0;
      // 舟を作れ (M10-03) は civ_edict と同じく言葉なので力は要らない (信仰・材の門が代わり)
      case 'launch_ship':
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
      world.dispatch({ type: 'set_climate', rainScale: 1, tempOffset: 0 }, { fromStar: false });
      timeline.push({ year: currentYear, kind: 'power_exhausted' });
      opts.onPowerExhausted?.();
    } else {
      power = Math.min(power, budgetMax);
    }
    // 気象塔の維持費 (M10-01): 建てた塔があるあいだだけ、上の気候の維持費とは別に毎年 TOWER_UPKEEP × 塔の数を引く。
    // 払えなければ全ての塔を止め (tower_power active:false)、力が戻れば動かす (active:true)。塔は星の行為ではない
    // 自動処理 (fromStar: false) で切り替える。towers は最新の snapshot から読む (力切れの気候の戻しと同じ流儀)
    const towers = s.towers;
    if (towers.length > 0) {
      const towerUpkeep = (budgetDef.upkeepPerYear.tower ?? TOWER_UPKEEP) * towers.length;
      const towersActive = towers.some((t) => t.active);
      if (power >= towerUpkeep) {
        power -= towerUpkeep;
        // M10 レビュー: 石板の「維持」と upkeep_over_income に塔の分も入れる
        upkeepLastYear += towerUpkeep;
        if (!towersActive) {
          world.dispatch({ type: 'tower_power', active: true }, { fromStar: false });
          timeline.push({ year: currentYear, kind: 'tower_resumed' });
        }
      } else if (towersActive) {
        world.dispatch({ type: 'tower_power', active: false }, { fromStar: false });
        timeline.push({ year: currentYear, kind: 'tower_stopped' });
      }
    }
  };

  return {
    def,
    yearOf,
    ticksToNextYear: (s) => ticksPerYear - ((s.tick - startTick) % ticksPerYear),
    interventions: () => interventions,
    verdict: () => verdict,
    power: () => power,
    budget: () => (budgetDef ? { power, max: budgetMax, incomeLastYear, upkeepLastYear } : null),
    prayer: () => (currentPrayer ? { kind: currentPrayer.kind, yearsLeft: Math.max(0, currentPrayer.deadlineYear - currentYear) } : null),
    warnings: () => warnings,
    timeline: () => timeline,
    totalsByYear: () => history,
    milestones: () => {
      const gone = new Set([...cancelled].map((idx) => def.schedule[idx].atYear));
      return (def.milestones ?? []).filter((m) => !gone.has(m.atYear));
    },
    nextMeteorYear: () => nextMeteor()?.atYear ?? null,
    save: () =>
      structuredClone({
        version: RUNNER_STATE_VERSION,
        scenarioId: def.id,
        startTick,
        start,
        fired: [...fired],
        cancelled: [...cancelled],
        lastYear,
        interventions,
        verdict,
        power,
        incomeLastYear,
        upkeepLastYear,
        powerSpent,
        warnings,
        history,
        civHistory,
        civVitalityHistory,
        lastEdictN,
        pendingIntercepts,
        lastIntercepted,
        prevShipProgress,
        prevCivStage,
        warned: [...warned],
        timeline,
        currentYear,
        lastCivStage,
        lastCivFaith,
        lastCivFaithCap,
        lastDreamEater,
        lastPrayerIssuedYear,
        lastPrayerKind,
        lastPrayersAnswered,
        lastPrayersIgnored,
        lastPrayersWithdrawn,
        currentPrayer,
        announced,
      }),
    intervene(cmd) {
      if (verdict.status !== 'running') return { ok: false, reason: 'finished' };
      // 迎撃 (M10-02): 民の条件 (星・備蓄) と取り消せる予定隕石があるときだけ。dispatch は次の step で適用されるので、
      // 受理の判定は最新の snapshot で先に済ませ、予定の取り消しと年表はここで行う (World 側の validate も同じ条件を見る)
      if (cmd.type === 'intercept') {
        const target = nextMeteor();
        if (!target) return { ok: false, reason: 'no_target' };
        // M10 レビュー: 同じ step 内 (停止中の連打) に 2 回目を撃つと snapshot の備蓄はまだ減っていないので、
        // まだ適用されていない迎撃の分 (pendingIntercepts) を備蓄から引いて判定する
        const snap = world.snapshot();
        // M19-04: 年代記の再生は境目でしか update しないので、ここでも World が適用した分を pending から引く
        syncIntercepts(snap);
        const civ = snap.civ;
        const stock = (civ?.works?.stock ?? 0) - pendingIntercepts * INTERCEPT_NEED;
        if (!civ || !canIntercept({ ...civ, works: { stock, stopped: civ.works?.stopped ?? false } }).ok) return { ok: false, reason: 'rejected' };
        const res = world.dispatch(cmd);
        if (res && res.ok === false) return { ok: false, reason: 'rejected' };
        pendingIntercepts++;
        cancelled.add(target.idx);
        interventions++;
        timeline.push({ year: currentYear, kind: 'intercepted', atYear: target.atYear });
        return { ok: true };
      }
      const cost = costOf(cmd);
      if (budgetDef && power < cost) return { ok: false, reason: 'budget' };
      // 勅令 (M9-03) は言葉であって行為ではないので介入回数に数えない (no_intervention の条件や内訳を変えない。M9 レビュー)。
      // tower_power (M10-01) も星の行為ではなく力の増減の自動処理なので同じく数えない (通常は intervene() 経由で呼ばない)。
      // launch_ship (M10-03) も civ_edict と同じく言葉なので数えない
      // 予定コマンド (fireDue) と同じく cell = -1 (島の中心) と半径の縮尺を解決してから流す。
      // 以前は resolve を通さず生の cmd を dispatch していたため、プレイヤー操作由来の介入で
      // cell: -1 を使うと (-1, 0) 相当の意図しない位置に適用されていた (M8-05 で発覚)
      const resolved = resolve(cmd);
      // M10 レビュー: World の門 (気象塔の段階・信仰・輝石、舟の材、海への放流など) で弾かれたら、力を引かず年表にも積まない
      const res = world.dispatch(resolved);
      if (res && res.ok === false) return { ok: false, reason: 'rejected' };
      if (budgetDef) {
        power -= cost;
        powerSpent += cost;
      }
      if (cmd.type !== 'civ_edict' && cmd.type !== 'tower_power' && cmd.type !== 'launch_ship') interventions++;
      // 気象塔を建てた (M10-01) は専用の 'tower' kind で積む (他は汎用の 'intervene')。
      // describeEvent が「星が気象塔を建てた(雨 N×)」を組み立てやすいよう、既定値を補ってから積む
      if (resolved.type === 'build_tower') {
        timeline.push({
          year: currentYear,
          kind: 'tower',
          cell: resolved.cell,
          rainScale: resolved.rainScale ?? TOWER_RAIN_SCALE_DEFAULT,
          tempOffset: resolved.tempOffset ?? TOWER_TEMP_OFFSET_DEFAULT,
        });
      } else {
        timeline.push({ year: currentYear, kind: 'intervene', command: cmd });
      }
      return { ok: true };
    },
    update(s) {
      if (verdict.status !== 'running') return verdict;
      const year = yearOf(s);
      currentYear = year;
      // 祈り (M9-02): 石板が毎フレーム読めるように、年次評価を待たず最新の値に更新しておく
      currentPrayer = s.civ?.prayer ?? null;
      // 迎撃 (M10 レビュー): World が適用した分だけ pending を減らす
      syncIntercepts(s);
      fireDue(year);
      if (year !== lastYear) {
        // 最初の呼び出し (lastYear === -1) はまだ 1 年も経っていないので力は動かさない
        const isFirstCheck = lastYear === -1;
        lastYear = year;
        if (year === baselineYear) start = startStats(s);
        if (!isFirstCheck) applyBudgetYearChange(s);
        const civ: CivContext = prevCivStage === null ? null : { prevStage: prevCivStage };
        // 舟の警告 (M10-04): 前年の進みと比べる。前年に舟が無ければ null
        warnings = scenarioWarnings(def, s, start, budgetDef ? { power, max: budgetMax, incomeLastYear, upkeepLastYear } : null, civ, { year, prevProgress: prevShipProgress });
        // text 付きの予定 (M10R-07) はその年の警告の先頭に出す (年表には fireDue で積んである)
        if (announced.length) { warnings = [...announced, ...warnings]; announced = []; }
        prevShipProgress = s.ship && s.ship.launchedYear === undefined ? s.ship.progress : null;
        for (const w of warnings) {
          // text 付きの予定の台詞 (event) は fireDue が年表に scheduled として積んでいるので、警告としては重ねて積まない (手動受入で二重に出た)
          if (w.kind === 'event' || warned.has(w.key)) continue;
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
        // 信仰の上限 (民の記憶、M10R-02): civ_faith と同じ閾値・同じ扱い (発生前は積まない)
        const civFaithCap = s.civ?.faithCap;
        // M10R レビュー: 上限は無視 1 回でちょうど 0.1 動くが、二進小数では 0.0999… になり >= 0.1 を落とす。1e-9 の余裕を取る
        if (civFaithCap !== undefined && lastCivFaithCap !== null && Math.abs(civFaithCap - lastCivFaithCap) >= FAITH_TIMELINE_THRESHOLD - 1e-9) {
          timeline.push({ year, kind: 'civ_faith_cap', from: lastCivFaithCap, to: civFaithCap });
        }
        if (civFaithCap !== undefined) lastCivFaithCap = civFaithCap;
        // 夢喰い (M10R-03): snapshot.dreamEater の有無が前年と変わっていれば現れた/去ったを年表に積む
        const dreamEaterNow = s.dreamEater != null;
        if (dreamEaterNow !== lastDreamEater) {
          timeline.push({ year, kind: 'dream_eater', phase: dreamEaterNow ? 'appeared' : 'left', faithCap: s.civ?.faithCap ?? 0 });
          lastDreamEater = dreamEaterNow;
        }
        // 祈り (M9-02): 前年と比べて解決 (無視 → 応えた の順、World の内部順序に合わせる) → 発生の順で積む。
        // 解決の種類は civ.prayer が消えた後には残らないので、直近に見ていた種類 (lastPrayerKind) で補う
        const prayersIgnored = s.civ?.prayersIgnored ?? 0;
        if (prayersIgnored > lastPrayersIgnored && lastPrayerKind) {
          const e: TimelineEvent = { year, kind: 'prayer', phase: 'ignored', prayer: lastPrayerKind };
          timeline.push(e);
          opts.onPrayer?.(e);
        }
        lastPrayersIgnored = prayersIgnored;
        // 取り下げ (M9-03): 困りごとが消えて民が祈るのをやめた年
        const prayersWithdrawn = s.civ?.prayersWithdrawn ?? 0;
        if (prayersWithdrawn > lastPrayersWithdrawn && lastPrayerKind) {
          const e: TimelineEvent = { year, kind: 'prayer', phase: 'withdrawn', prayer: lastPrayerKind };
          timeline.push(e);
          opts.onPrayer?.(e);
        }
        lastPrayersWithdrawn = prayersWithdrawn;
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
        if (edict && edict.n !== lastEdictN) {
          timeline.push({ year, kind: 'civ_edict', edict: edict.kind, obeyed: edict.obeyed, faith: edict.faith });
          lastEdictN = edict.n;
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
