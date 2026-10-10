import type { LogSink } from '../core/log/types';
import type { IslandStore } from '../persist/islandStore';
import { continueTargetOf, readLastStage, scenarioProgressOf, type Continuation, type ScenarioProgress } from '../persist/lastStage';
import { checkScenarioSave } from '../persist/scenarioSave';
import type { ScenarioDef } from '../scenario/types';
import { SIM_VERSION } from '../simulation/version';
import type { Nav } from './effects';
import { bootPlanOf, searchFor, type BootPlan } from './place';

/**
 * タイトルからの入り (M27-03)。置き場の一覧と最後に遊んだ石板の続きを打ち切りの内で読んで「続きから」を決め、タイトルで選ばれた舞台の起動の計画を返す。
 * 画面 (ui/Title.ts) は showTitle の向こうに置く
 */

/** タイトルの「続きから」を決めるために置き場の一覧を待つ上限 (ms) */
const TITLE_LIST_TIMEOUT_MS = 2000;

/** タイトルで選ばれた舞台 (ui/titleMenu.ts の TitleChoice と同じ形) */
export type TitleChoice = { kind: 'free' } | { kind: 'scenario'; scenarioId: string };

export type TitleDeps = {
  store: IslandStore | null;
  scenarios: ScenarioDef[];
  /** world.default.json の seed。start に seed の無い石板の続きを確かめるのに使う */
  baseSeed: number;
  /** 開発用の見守り手の名 (M19-16)。最後に遊んだ舞台の印は見守り手ごと */
  player: string | undefined;
  log: LogSink;
  /** 最後に遊んだ舞台の印を読む置き場 (localStorage) */
  storage: Pick<Storage, 'getItem'>;
  nav: Pick<Nav, 'search' | 'replace'>;
  showTitle: (deps: { continuation: Continuation | null; freeSaved: boolean; log: (event: string, extra: Record<string, unknown>) => void }) => Promise<TitleChoice>;
};

export function createTitle(deps: TitleDeps) {
  const { store, scenarios, log, nav } = deps;
  const titleLog = (level: 'info' | 'warn', event: string, extra: Record<string, unknown>) => log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level, event, ...extra });
  /** 印の石板の続きの要約 (M24-05)。知らない石板・続きが無い・この版の石板の島でない (開くと初めからになる) なら null */
  const scenarioProgressFor = async (scenarioId: string): Promise<ScenarioProgress | null> => {
    const def = scenarios.find((d) => d.id === scenarioId);
    if (!store || !def) return null;
    const loaded = await store.loadScenario(scenarioId).catch((e: unknown) => (titleLog('warn', 'persist.scenario.load.failed', { error: String(e) }), null));
    if (!loaded) return null;
    // 読めない包み (runner の無い古い続きなど) は投げることがある。投げてもタイトルは出す (続きからに出さないだけ)
    try {
      const checked = checkScenarioSave(loaded, { simVersion: SIM_VERSION, scenarioId, seed: def.start?.seed ?? deps.baseSeed });
      return checked.ok ? scenarioProgressOf(scenarioId, checked.value) : null;
    } catch (e) {
      titleLog('warn', 'persist.scenario.load.failed', { error: String(e) });
      return null;
    }
  };
  const enterFromTitle = async (): Promise<BootPlan<ScenarioDef>> => {
    // 置き場が答えなくてもタイトルは出す (続きからを出さないだけ)
    const listed = store ? store.list().catch((e: unknown) => (titleLog('warn', 'persist.list.failed', { error: String(e) }), [])) : Promise.resolve([]);
    // (M24-05) 最後に遊んだ舞台の印が石板なら、その石板の続きも同じ打ち切りの内で読む
    const mark = readLastStage(deps.storage, deps.player);
    const progressed = mark?.stage === 'scenario' ? scenarioProgressFor(mark.scenarioId) : Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<[[], null]>(
      (resolve) => (timer = setTimeout(() => (titleLog('warn', 'persist.list.timeout', { ms: TITLE_LIST_TIMEOUT_MS }), resolve([[], null])), TITLE_LIST_TIMEOUT_MS)),
    );
    const [slots, progress] = await Promise.race([Promise.all([listed, progressed]), timeout]);
    clearTimeout(timer);
    const auto = slots.find((s) => s.slot === 'auto' && s.stage === 'free') ?? null;
    const continuation = continueTargetOf(mark, auto, progress, (id) => scenarios.find((d) => d.id === id)?.title ?? null);
    const choice = await deps.showTitle({ continuation, freeSaved: auto !== null, log: (event, extra) => titleLog('info', event, extra) });
    // 石板の続きは ?scenario=<id> の道 (bootPlanOf の restore scenario → resumeScenario)。読み込み直さずに検索語だけ差し替える
    if (choice.kind === 'scenario') nav.replace(`?${searchFor(nav.search(), choice.scenarioId)}`);
    return bootPlanOf(nav.search(), scenarios, null);
  };
  return { enterFromTitle, scenarioProgressFor };
}
