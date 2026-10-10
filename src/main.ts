import { World } from './simulation/World';
import type { SpeciesDef, WorldConfig } from './simulation/types';
import { createAppLogSink } from './core/log/appSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
import { createTablet } from './ui/Tablet';
import type { ScenarioDef } from './scenario/types';
import { TOWER_COST } from './simulation/weatherTower';
import { mountMapClick, type Chips } from './ui/mapClick';
import { createObserveEntry } from './observe/entry';
import { createViewedSpecies } from './ui/viewedSpecies';
import { openIslandStore } from './persist/islandStore';
import { createLocalSave } from './persist/localSave';
import { AUTOSAVE_TICKS } from './persist/autosave';
import { checkScenarioSave } from './persist/scenarioSave';
import { continueTargetOf, readLastStage, scenarioProgressOf, writeLastStage, type ScenarioProgress } from './persist/lastStage';
import { slotSaveOf, takePendingSlot } from './persist/slotSave';
import { SIM_VERSION } from './simulation/version';
import { mountHarbor } from './ui/Harbor';
import { createConfirm } from './ui/confirm';
import { showTitle } from './ui/Title';
import { markEntered, takeTabMarks } from './persist/tabMarks';
import { askOf, type Risky } from './app/confirmAsk';
import { scenarioConfigOf } from './app/worldConfig';
import { restoreIsland } from './app/restore';
import { sessionOf } from './app/session';
import { createEffects, type Nav } from './app/effects';
import { createIntervene, createLandCargo } from './app/intervene';
import { createScenarioSession } from './app/scenarioSession';
import { atOf, bootPlanOf, bootRouteOf, bootSeedOf, planOp, runPlan, searchFor, type Op } from './app/place';

/** 開発用の手段 (M19-16、src/dev) を入れるか。ビルドで定数に畳まれ、本番のビルドでは動的 import ごと消える */
const DEVTOOLS_BUILT = import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1';

/** タイトルの「続きから」を決めるために置き場の一覧を待つ上限 (ms) */
const TITLE_LIST_TIMEOUT_MS = 2000;

async function boot(): Promise<void> {
  const { log, flushViaBeacon } = createAppLogSink({
    url: import.meta.env.VITE_LOG_URL,
    sendBeacon: (url, data) => navigator.sendBeacon(url, data),
  });
  const devTools = DEVTOOLS_BUILT ? await import('./dev/session') : null;
  const dev = devTools ? devTools.devSessionOf(new URLSearchParams(location.search)) : null;
  const probe = DEVTOOLS_BUILT ? await import('./dev/probe') : null;
  const [base, species, scenarios, store] = await Promise.all([
    fetch('/data/world.default.json').then((r) => r.json() as Promise<Omit<WorldConfig, 'species'>>),
    fetch('/data/species.json').then((r) => r.json() as Promise<SpeciesDef[]>),
    fetch('/data/scenarios.json').then((r) => r.json() as Promise<ScenarioDef[]>),
    openIslandStore({ indexedDB, now: Date.now, dbName: dev?.dbName }).catch((e: unknown) => {
      log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level: 'warn', event: 'persist.unavailable', error: String(e) });
      return null;
    }),
  ]);
  const nav: Nav = {
    search: () => location.search,
    go: (search) => {
      location.search = search;
    },
    assign: (href) => location.assign(href),
    replace: (search) => history.replaceState(null, '', `${location.pathname}${search}${location.hash}`),
  };
  const pending = takePendingSlot(sessionStorage);
  // 起動の行き先 (M24-01): 素の / で、このタブでまだ舞台に入っていなければタイトル。選ばれてから舞台を組む
  const route = bootRouteOf(location.search, scenarios, pending, takeTabMarks(sessionStorage), devTools ? devTools.skipsTitle(localStorage) : false);
  const titleLog = (level: 'info' | 'warn', event: string, extra: Record<string, unknown>) => log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level, event, ...extra });
  /** 印の石板の続きの要約 (M24-05)。知らない石板・続きが無い・この版の石板の島でない (開くと初めからになる) なら null */
  const scenarioProgressFor = async (scenarioId: string): Promise<ScenarioProgress | null> => {
    const def = scenarios.find((d) => d.id === scenarioId);
    if (!store || !def) return null;
    const loaded = await store.loadScenario(scenarioId).catch((e: unknown) => (titleLog('warn', 'persist.scenario.load.failed', { error: String(e) }), null));
    if (!loaded) return null;
    // 読めない包み (runner の無い古い続きなど) は投げることがある。投げてもタイトルは出す (続きからに出さないだけ)
    try {
      const checked = checkScenarioSave(loaded, { simVersion: SIM_VERSION, scenarioId, seed: def.start?.seed ?? base.seed });
      return checked.ok ? scenarioProgressOf(scenarioId, checked.value) : null;
    } catch (e) {
      titleLog('warn', 'persist.scenario.load.failed', { error: String(e) });
      return null;
    }
  };
  const enterFromTitle = async () => {
    // 置き場が答えなくてもタイトルは出す (続きからを出さないだけ)
    const listed = store ? store.list().catch((e: unknown) => (titleLog('warn', 'persist.list.failed', { error: String(e) }), [])) : Promise.resolve([]);
    // (M24-05) 最後に遊んだ舞台の印が石板なら、その石板の続きも同じ打ち切りの内で読む
    const mark = readLastStage(localStorage, dev?.player?.name);
    const progressed = mark?.stage === 'scenario' ? scenarioProgressFor(mark.scenarioId) : Promise.resolve(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<[[], null]>(
      (resolve) => (timer = setTimeout(() => (titleLog('warn', 'persist.list.timeout', { ms: TITLE_LIST_TIMEOUT_MS }), resolve([[], null])), TITLE_LIST_TIMEOUT_MS)),
    );
    const [slots, progress] = await Promise.race([Promise.all([listed, progressed]), timeout]);
    clearTimeout(timer);
    const auto = slots.find((s) => s.slot === 'auto' && s.stage === 'free') ?? null;
    const continuation = continueTargetOf(mark, auto, progress, (id) => scenarios.find((d) => d.id === id)?.title ?? null);
    const root = document.getElementById('app');
    if (!root) throw new Error('#app missing');
    const choice = await showTitle(root, { continuation, freeSaved: auto !== null, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, log: (event, extra) => titleLog('info', event, extra) });
    // 石板の続きは ?scenario=<id> の道 (bootPlanOf の restore scenario → resumeScenario)。読み込み直さずに検索語だけ差し替える
    if (choice.kind === 'scenario') history.replaceState(null, '', `${location.pathname}?${searchFor(location.search, choice.scenarioId)}${location.hash}`);
    return bootPlanOf(location.search, scenarios, null);
  };
  const booted = route.kind === 'stage' ? route.plan : await enterFromTitle();
  markEntered(sessionStorage);
  const scenario = booted.scenario;
  if (booted.unknown) {
    nav.replace(booted.unknown.search);
    log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level: 'warn', event: 'persist.url.unknown_scenario', scenario: booted.unknown.scenarioId });
  }
  // 自由モードの seed (M26-10): URL の seed= (石板・訪問は無視して URL から落とす)。無ければ既定 (world.default.json の 42)
  const seeded = bootSeedOf(location.search, scenario !== null);
  if (seeded.search !== null) nav.replace(seeded.search);
  const config = scenarioConfigOf(base, species, scenario);
  // 他人の島を訪れている (M19-09)。介入を受けず、年代記を記録しない (recorder を作らない)。港から引いた命令を記録の tick で打ち直す
  const visitId = booted.visitId;
  /** 最後に遊んだ舞台の印 (M24-05)。舞台に入った時と自動保存の時に書く。訪問 (他人の島) では書かない */
  const markStage = () => {
    if (!visitId) writeLastStage(localStorage, scenario ? { stage: 'scenario', scenarioId: scenario.id } : { stage: 'free' }, Date.now(), dev?.player?.name);
  };
  markStage();
  const persistLog = (level: 'info' | 'warn', event: string, tick: number, extra: Record<string, unknown> = {}) =>
    log.write({ ts: new Date().toISOString(), tick, year: Math.floor(tick / config.ticksPerYear), level, event, ...extra });
  const localSave = createLocalSave({
    store,
    mode: scenario ? 'scenario' : 'free',
    every: AUTOSAVE_TICKS,
    log: persistLog,
    onSaved: (s) => {
      hud.setSlot(s);
      markStage();
    },
  });
  const drawSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const head = scenario ? { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed } : null;
  const { resumed, fromSlot } = await restoreIsland(booted.restore, { localSave, store, head, log, persistLog, seed: seeded.seed, pending });
  const session = sessionOf(resumed?.world ?? World.create(seeded.seed === null ? config : { ...config, seed: seeded.seed }, { log }), !!visitId);
  // 枠から開いた自由モードの島は、読込と同じくその場で自動の枠に書く
  if (fromSlot) localSave.replaced(session.world.serialize());

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  let view: SceneView = createSceneView(canvas, { assets: buildAssetTable(session.world.snapshot().species), size: session.world.snapshot().size, now: dev?.clock });
  /** やり直しの効かない操作の確かめ (M21-04)。何を確かめるかは askOf が決め、確かめの要らない操作はそのまま通す */
  const confirm = createConfirm(app);
  const confirmed = (r: Risky): Promise<boolean> => {
    const ask = askOf(r);
    return ask ? confirm(ask) : Promise.resolve(true);
  };
  const chips: Chips = { armed: null, spawnArmed: null, towerArmed: false };
  /** 年代記は石板ごとに最後の 1 本を置き、島・runner の状態と同じ transaction で書く (persist/scenarioSave.ts)。読むのは続きからの復帰 (M19-14) と港への出港 (M19-09) */
  const saveChronicle = () => session.scenarioAutosave?.flush();
  const intervene = createIntervene({ session, visiting: !!visitId, log, saveChronicle, flash: () => tablet.flash() });
  const titleOf = (id: string) => scenarios.find((d) => d.id === id)?.title ?? id;
  const at = () => atOf(!!visitId, head, session.runner?.verdict().status ?? null);
  const { perform, slotSave, showSeed } = createEffects({
    session, scenario, config, seed: seeded.seed, at, drawSeed, log, persistLog, store, localSave, saveChronicle, storage: sessionStorage, nav,
    remakeView: (size, species) => {
      view.dispose();
      view = createSceneView(canvas, { assets: buildAssetTable(species), size, now: dev?.clock });
    },
    setSeed: (seed) => hud.setSeed(seed),
  });
  /** やり直しの効かない操作 (M21-04)。確かめと行き先は planOp が決め、ここは確かめてから effects を順に行うだけ */
  const run = (op: Op) => runPlan(planOp(op, at(), titleOf), confirm, perform);

  // いま地図で見ている種 (M21-02 D5)。変わったら石板の告知に反映し、ログに残す (e2e が HUD からの通知を確かめる)
  const viewedSpecies = createViewedSpecies((id, opts) => {
    session.viewing = id;
    if (!session.runner) return;
    session.runner.setViewedSpecies(id, opts);
    const snap = session.world.snapshot();
    log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'info', event: 'scenario.viewed_species', scenario: session.runner.def.id, id, acknowledge: opts.acknowledge });
  });
  const hud = createHud(app, {
    onCommand: intervene,
    onSpeed: (s) => loop.setSpeed(s),
    onLayer: (l) => view.setLayer(l),
    // 種のレイヤーを見ている間はその種の告知を出さない (M21-02 D5: 警告のチップからでも HUD からでも開けば消える)
    onSpeciesLayer: (id) => viewedSpecies.select(id),
    onSave: slotSave,
    onLoad: (raw) => void run({ kind: 'load', data: slotSaveOf(raw), slot: null }),
    onSlotSave: (slot, overwrites) => void run({ kind: 'slot_save', slot, overwrites }),
    onSlotLoad: (slot) => {
      // (M19-17 で変更: 読めるかどうかは planOp (app/place.ts の planLoad) が舞台で決める)
      void localSave.loadSlot(slot, (data) => data).then((data) => {
        if (data) void run({ kind: 'load', data, slot });
      });
    },
    onNewIsland: () => void run({ kind: 'new_island' }),
    onTitle: () => void run({ kind: 'title' }),
    onDisasterArm: (k) => {
      chips.armed = k;
      view.setVolcanoHint(k === 'volcano');
    },
    onSpawnArm: (id) => {
      chips.spawnArmed = id;
    },
    onTowerArm: (v) => {
      chips.towerArmed = v;
    },
  }, { speeds: dev?.speeds, scenarioTitles: Object.fromEntries(scenarios.map((d) => [d.id, d.title])), inScenario: !!scenario && !visitId });

  const tablet = createTablet(
    app,
    scenarios,
    scenario,
    (id) => void run({ kind: 'select', scenarioId: id }),
    Object.fromEntries(species.map((d) => [d.id, d.name])),
    (id) => hud.showSpeciesLayer(id),
    undefined,
    () => {
      if (scenario) void run({ kind: 'retry', scenarioId: scenario.id });
    },
  );
  hud.setReplaceable(!visitId);
  showSeed(false);
  const speciesNames = Object.fromEntries(species.map((d) => [d.id, d.name]));
  const landCargo = createLandCargo({ session, scenario, at, speciesNames, intervene, tablet, hud });
  const harbor = mountHarbor(app, {
    scenarios,
    speciesIds: species.map((d) => d.id),
    simVersion: SIM_VERSION,
    baseUrl: import.meta.env.VITE_HARBOR_URL,
    sitekey: import.meta.env.VITE_TURNSTILE_SITEKEY,
    visit: visitId && scenario ? { id: visitId, island: { def: scenario, config } } : null,
    scenarioId: scenario && !visitId ? scenario.id : null,
    speciesNames,
    land: visitId ? null : landCargo,
    log: (level, event, extra) => persistLog(level, event, session.world.snapshot().tick, extra),
    player: dev?.player,
    guard: {
      ask: confirmed,
      leave: (href) => void run({ kind: 'visit', href }),
    },
  });
  void localSave.list().then((list) => list.forEach(hud.setSlot));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    localSave.flush(() => session.world.serialize());
    saveChronicle();
    flushViaBeacon();
  });
  // 観察画面 (M22-08): 入っている間は 2D の地図を描かず、snapshot を観察画面へ渡す。速さは操作画面の速さの列を押して揃える
  const observe = createObserveEntry(app, {
    names: Object.fromEntries(species.map((d) => [d.id, d.name])),
    getSpeed: () => loop.getSpeed(),
    now: dev?.clock,
    setSpeed: (s) => document.getElementById(`speed-${s}`)?.click(),
    // (M19-18) 入口は左上の時間の箱の速さの列の端 (上の真ん中の石板に覆われない)
    buttonHost: document.getElementById('speed-row') ?? undefined,
  });
  // 試験の口 (M25-09): 開発・受入のビルドだけ。SceneView は島を作り直すので、読むたびに今の view を引く
  probe?.installProbe(window, { scene: () => view.inspect(), observe: () => observe.inspect(), tick: () => session.world.snapshot().tick, advance: (n) => loop.advance(n) });
  const loop = createRunner(
    // シナリオの判定の後は、速度を戻せば今までどおり島を回す (判定の年の境目より先は年表・判定に効かない)
    { step: (n) => (session.runner?.verdict().status === 'running' ? session.scenarioStep(n) : session.world.step(n)), snapshot: () => session.world.snapshot() },
    {
      // グラフの点は年の境目ごとに積む (M25-02)。フレームで拾うと、境目から何 tick 過ぎた島を写すかが回ごとに違う
      ticksPerYear: config.ticksPerYear,
      onYear: (s) => hud.recordYear(s),
      onFrame: (s) => {
        localSave.onTick(s.tick, () => session.world.serialize());
        session.scenarioAutosave?.onTick(s.tick);
        // 観察画面の間は地図を描かないので、種を選んでいても見ていないとみなす
        viewedSpecies.setObserving(observe.active());
        observe.push(s, session.runner?.timeline());
        // 選んだセルを 3D の島の上でも示す (M22-10)。選びを解けば (selected = null) 消える
        view.setSelected(session.selected);
        if (!observe.active()) view.update(s);
        hud.update(s);
        // 迎撃の行を畳む判定 (M21-02 D4) に使う。自由モードでは runner が無いので常に null (行は常に隠れる)
        hud.setNextMeteor(session.runner ? session.runner.nextMeteorYear() : null);
        if (session.selected !== null) hud.showCell(session.selected, s);
        if (session.runner) {
          const verdict = session.runner.update(s);
          const budgetInfo = session.runner.budget();
          tablet.update(session.runner.yearOf(s), verdict, budgetInfo, session.runner.warnings(), session.runner.timeline(), session.runner.prayer(), session.runner.milestones());
          const costs = scenario?.budget?.costs;
          hud.setAffordable(
            budgetInfo && costs
              ? {
                  spawn: budgetInfo.power >= costs.spawn,
                  disaster: budgetInfo.power >= costs.disaster,
                  climate: budgetInfo.power >= costs.climate,
                  tower: budgetInfo.power >= (costs.tower ?? TOWER_COST),
                }
              : { spawn: true, disaster: true, climate: true, tower: true },
          );
        } else {
          hud.setAffordable({ spawn: true, disaster: true, climate: true, tower: true });
        }
      },
    },
  );
  if (scenario) {
    createScenarioSession(scenario, {
      session, config, visiting: !!visitId, defOf: () => dev?.scenarioDef(scenario) ?? scenario, forced: !!dev?.shortcut, log, persistLog, store, markStage, saveChronicle, resumed, fromSlot, loop, tablet, harbor, observe,
    });
  }

  // 舟の行 (M10-04): 逃がす条件のある石板と自由モードだけ出す
  hud.setShipEnabled(!scenario || !!scenario.escape);
  mountMapClick(canvas, { pickCell: (x, y) => view.pickCell(x, y), session, chips, intervene, hud });

  dev?.mount(app, {
    scenario: !!scenario,
    capture: () => {
      const save = session.world.serialize();
      localSave.flush(() => save);
      saveChronicle();
      return { save, chronicle: session.recorder?.current() ?? null };
    },
  });
  if (dev?.paused) document.getElementById('speed-0')?.click();
  loop.start();
}

boot().catch((e: unknown) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">${String(e)}</pre>`);
});
