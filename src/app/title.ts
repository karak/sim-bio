import type { LogSink } from '../core/log/types';
import type { IslandStore } from '../persist/islandStore';
import { continueTargetOf, readLastStage, scenarioProgressOf, type Continuation, type ScenarioProgress } from '../persist/lastStage';
import { checkScenarioSave } from '../persist/scenarioSave';
import { putPendingSlot, takePendingSlot, type SlotSave } from '../persist/slotSave';
import { readConfig, reducedMotionOf, writeConfig, type Config } from '../persist/config';
import type { SlotId, SlotSummary } from '../persist/slots';
import type { ScenarioDef } from '../scenario/types';
import { SIM_VERSION } from '../simulation/version';
import type { Ask } from './confirmAsk';
import type { Nav } from './effects';
import { bootPlanOf, DEFAULT_SEED, freshSeed, runPlan, searchFor, seedSearchFor, type BootPlan, type Plan } from './place';

/**
 * タイトルからの入り (M27-03)。置き場の一覧と最後に遊んだ石板の続きを打ち切りの内で読んで「続きから」を決め、タイトルで選ばれた舞台の起動の計画を返す。
 * 画面 (ui/Title.ts) は showTitle の向こうに置く
 */

/** タイトルの「続きから」を決めるために置き場の一覧を待つ上限 (ms) */
const TITLE_LIST_TIMEOUT_MS = 2000;

/** タイトルで選んだもの (M24-01)。scenario は石板の続き (M24-05、?scenario=<id> の道で resumeScenario が戻す) */
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
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  /** (M24-02) OS の「視差効果を減らす」(prefers-reduced-motion: reduce)。コンフィグの動きを減らすが OS に従うときに効く */
  osReducedMotion: boolean;
  nav: Pick<Nav, 'search' | 'replace'>;
  /** (M24-02) このタブの sessionStorage (移って読む枠の名) */
  tab: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** (M24-02) やり直しの効かない操作の確かめ (ui/confirm.ts) */
  confirm: (ask: Ask) => Promise<boolean>;
  /** (M24-02) 新しい島の seed を引く (0 以上 2^32-1 の整数) */
  drawSeed: () => number;
  showTitle: (deps: TitleScreenDeps) => Promise<TitleChoice>;
};

/** タイトルの画面 (ui/Title.ts) へ渡すもの */
export type TitleScreenDeps = {
  continuation: Continuation | null;
  freeSaved: boolean;
  log: (event: string, extra: Record<string, unknown>) => void;
  /** (M24-02) ロードの板に並べる枠 (保存のある枠だけ、SLOTS の順) */
  slots: readonly SlotSummary[];
  titleOf: (scenarioId: string) => string;
  /** (M24-02) 枠の包みを置き場から読む。無い・読めなければ null */
  loadSlot: (slot: SlotId) => Promise<SlotSave | null>;
  /** (M24-02) planOp の確かめと効果をタイトルで行い、移る先の舞台を返す。断った・行えなかったなら null (タイトルに留まる) */
  run: (plan: Plan) => Promise<TitleChoice | null>;
  /** (M24-02) 背景のデモを止めた 1 枚にするか (コンフィグの動きを減らす、既定は OS に従う) */
  reducedMotion: boolean;
  /** (M24-02) コンフィグの今の値と、変えたときに置き場 (localStorage) へ書く口 */
  config: Config;
  saveConfig: (config: Config) => void;
};

/** タイトルでの効果 (runAtTitle) が使うもの */
export type TitleEffectsDeps = {
  store: Pick<IslandStore, 'stashImport'> | null;
  tab: Pick<Storage, 'setItem'>;
  nav: Pick<Nav, 'search' | 'replace'>;
  drawSeed: () => number;
  log: (level: 'info' | 'warn', event: string, extra: Record<string, unknown>) => void;
};

/**
 * タイトルで planOp の効果を行う (M24-02)。タイトルには島が無いので、行えるのは「次に開く島の seed を引く」(new_world)・ファイルの置き場・読む枠の名・移る先だけ。
 * 移る先 (go) は読み込み直さずに検索語だけ差し替え、その舞台を返す (起動は bootPlanOf が移って読む枠ごと決める)。ほかの効果は記録に残して止める
 */
export async function runAtTitle(plan: Plan, confirm: (ask: Ask) => Promise<boolean>, deps: TitleEffectsDeps): Promise<TitleChoice | null> {
  const { nav, log } = deps;
  let went: TitleChoice | null = null;
  await runPlan(plan, confirm, async (e) => {
    switch (e.kind) {
      case 'new_world':
        // 自動の枠の島と違う seed (M26-10)。URL の seed= の島は、自動の枠の続きと seed が違えば新しい島で開く (seedMatches)
        nav.replace(seedSearchFor(nav.search(), freshSeed(DEFAULT_SEED, deps.drawSeed)));
        return true;
      case 'stash_import':
        await deps.store?.stashImport(e.data).catch((err: unknown) => log('warn', 'persist.save.failed', { slot: 'import', error: String(err) }));
        return true;
      case 'put_pending':
        putPendingSlot(deps.tab, e.slot);
        return true;
      case 'flush':
        // タイトルには書き切る島が無い
        return true;
      case 'go': {
        const q = searchFor(nav.search(), e.scenarioId, { keepVisit: e.keepVisit });
        nav.replace(q ? `?${q}` : '');
        went = e.scenarioId ? { kind: 'scenario', scenarioId: e.scenarioId } : { kind: 'free' };
        return true;
      }
      default:
        log('warn', 'title.effect.unexpected', { effect: e.kind });
        return false;
    }
  });
  return went;
}

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
    const titleOf = (id: string) => scenarios.find((d) => d.id === id)?.title ?? id;
    const prefs = readConfig(deps.storage);
    const choice = await deps.showTitle({
      continuation,
      freeSaved: auto !== null,
      log: (event, extra) => titleLog('info', event, extra),
      slots,
      titleOf,
      // (M24-02) 操作画面の枠の読込 (localSave.loadSlot) と同じく、読めなければ記録に残して null
      loadSlot: (slot) => (store ? store.load(slot).catch((e: unknown) => (titleLog('warn', 'persist.load.failed', { slot, error: String(e) }), null)) : Promise.resolve(null)),
      run: (plan) => runAtTitle(plan, deps.confirm, { store, tab: deps.tab, nav, drawSeed: deps.drawSeed, log: titleLog }),
      // (M24-02) コンフィグ (persist/config.ts): 動きを減らすは OS の設定より先に効く。変えた値はその場で置き場へ
      reducedMotion: reducedMotionOf(prefs.motion, deps.osReducedMotion),
      config: prefs,
      saveConfig: (c) => void writeConfig(deps.storage, c),
    });
    // 石板の続きは ?scenario=<id> の道 (bootPlanOf の restore scenario → resumeScenario)。読み込み直さずに検索語だけ差し替える
    if (choice.kind === 'scenario') nav.replace(`?${searchFor(nav.search(), choice.scenarioId)}`);
    // (M24-02) ロードの板から移るときは、読む枠の名 (runAtTitle の put_pending) を起動の戻し方の先頭に置く (操作画面から移って読むのと同じ道)
    return bootPlanOf(nav.search(), scenarios, takePendingSlot(deps.tab));
  };
  /** (M24-02) 島を開いたときの速さ (コンフィグの最初の速さ)。タイトルで変えた値も、舞台を組むときに読み直して効かせる */
  const startSpeed = () => readConfig(deps.storage).speed;
  return { enterFromTitle, startSpeed };
}
