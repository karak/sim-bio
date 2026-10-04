import type { SlotSummary, Stage } from './slots';

/**
 * 最後に遊んだ舞台の印 (M24-05、docs/uiux/2026-10-04-title-flow.md の決めること 3 の案 A)。タイトルの「続きから」が、自由モードの自動の枠と
 * 石板の続き (M19-14、一覧も時刻も無い) のどちらを開くかを決める。中身は舞台の名と時刻だけで、島の中身は今の置き場から読む。
 * 舞台に入った時と自動保存の時に書く。localStorage に置くのでタブを閉じても残る。壊れた値は無いものとして扱う
 */
export type LastStage = Stage & { at: number };

const KEY = 'biotope.last-stage';

export function readLastStage(storage: Pick<Storage, 'getItem'>): LastStage | null {
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? null : lastStageOf(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 書けない置き場 (使えない localStorage) では何もしない。印が無ければ「続きから」は自動の枠だけを見る */
export function writeLastStage(storage: Pick<Storage, 'setItem'>, stage: Stage, at: number): void {
  const mark: LastStage = stage.stage === 'scenario' ? { stage: 'scenario', scenarioId: stage.scenarioId, at } : { stage: 'free', at };
  try {
    storage.setItem(KEY, JSON.stringify(mark));
  } catch {
    // 印は無くても遊べる (続きからが自動の枠だけになる)
  }
}

function lastStageOf(v: unknown): LastStage | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  if (o.stage === 'free') return { stage: 'free', at: o.at };
  if (o.stage === 'scenario' && typeof o.scenarioId === 'string' && o.scenarioId !== '') return { stage: 'scenario', scenarioId: o.scenarioId, at: o.at };
  return null;
}

/** 石板の続きの要約。year は石板の初めの tick から数える (石板の板の年と同じ)、finished は判定が出ているか */
export type ScenarioProgress = { scenarioId: string; year: number; finished: boolean };

export function scenarioProgressOf(
  scenarioId: string,
  loaded: { save: { tick: number; config: { ticksPerYear: number } }; runner: { startTick: number; verdict: { status: string } } },
): ScenarioProgress {
  const { save, runner } = loaded;
  return { scenarioId, year: Math.floor((save.tick - runner.startTick) / save.config.ticksPerYear), finished: runner.verdict.status !== 'running' };
}

/** タイトルの「続きから」が開くもの。savedAt は自由モードなら自動の枠の保存の時刻、石板なら印の時刻。title は石板の題 (無ければ id を出す) */
export type Continuation = { stage: 'free'; year: number; savedAt: number } | { stage: 'scenario'; scenarioId: string; title?: string; year: number; savedAt: number };

/**
 * 「続きから」の行き先。候補は自動の枠 (自由モード) と、印の指す石板の続き (同じ石板・判定がまだ・題の分かる石板だけ)。両方あれば新しい方 (同じ時刻なら石板)。
 * 判定の出た石板は開き直すと初めからになる (M19-14) ので続きにしない。auto は自動の枠の要約 (無ければ null)、progress は印の石板の続き (無ければ null)
 */
export function continueTargetOf(mark: LastStage | null, auto: SlotSummary | null, progress: ScenarioProgress | null, titleOf: (scenarioId: string) => string | null): Continuation | null {
  const free: Continuation | null = auto && auto.slot === 'auto' && auto.stage === 'free' ? { stage: 'free', year: auto.year, savedAt: auto.savedAt } : null;
  const title = mark?.stage === 'scenario' ? titleOf(mark.scenarioId) : null;
  const scenario: Continuation | null =
    mark?.stage === 'scenario' && progress && progress.scenarioId === mark.scenarioId && !progress.finished && title !== null
      ? { stage: 'scenario', scenarioId: mark.scenarioId, title, year: progress.year, savedAt: mark.at }
      : null;
  if (free && scenario) return scenario.savedAt >= free.savedAt ? scenario : free;
  return scenario ?? free;
}
