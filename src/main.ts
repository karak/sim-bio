import { World } from './simulation/World';
import type { SpeciesDef, WorldConfig } from './simulation/types';
import { createAppLogSink } from './core/log/appSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
import { createTablet } from './ui/Tablet';
import type { ScenarioDef } from './scenario/types';
import { mountMapClick, type Chips } from './ui/mapClick';
import { createObserveEntry } from './observe/entry';
import { createViewedSpecies } from './ui/viewedSpecies';
import { openIslandStore } from './persist/islandStore';
import { createLocalSave } from './persist/localSave';
import { AUTOSAVE_TICKS } from './persist/autosave';
import { writeLastStage } from './persist/lastStage';
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
import { createTitle } from './app/title';
import { createOnFrame } from './app/frame';
import { stageOf } from './app/stage';
import { atOf, bootRouteOf, bootSeedOf, planOp, runPlan, type Op } from './app/place';

/** 開発用の手段 (M19-16、src/dev) を入れるか。ビルドで定数に畳まれ、本番のビルドでは動的 import ごと消える */
const DEVTOOLS_BUILT = import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1';

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
  const { enterFromTitle } = createTitle({
    store, scenarios, baseSeed: base.seed, player: dev?.player?.name, log, storage: localStorage, nav,
    showTitle: (deps) => {
      const root = document.getElementById('app');
      if (!root) throw new Error('#app missing');
      return showTitle(root, { ...deps, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches });
    },
  });
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
  const stage = stageOf(booted);
  /** 最後に遊んだ舞台の印 (M24-05)。舞台に入った時と自動保存の時に書く。訪問 (他人の島) では書かない */
  const markStage = () => {
    if (stage.kind !== 'visit') writeLastStage(localStorage, scenario ? { stage: 'scenario', scenarioId: scenario.id } : { stage: 'free' }, Date.now(), dev?.player?.name);
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
  const session = sessionOf(resumed?.world ?? World.create(seeded.seed === null ? config : { ...config, seed: seeded.seed }, { log }));
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
  const intervene = createIntervene({ session, stage, log, saveChronicle, flash: () => tablet.flash() });
  const titleOf = (id: string) => scenarios.find((d) => d.id === id)?.title ?? id;
  const at = () => atOf(stage, head, session.runner?.verdict().status ?? null);
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
  }, { speeds: dev?.speeds, scenarioTitles: Object.fromEntries(scenarios.map((d) => [d.id, d.title])), inScenario: stage.kind === 'scenario' });

  const speciesNames = Object.fromEntries(species.map((d) => [d.id, d.name]));
  const tablet = createTablet(
    app,
    scenarios,
    scenario,
    (id) => void run({ kind: 'select', scenarioId: id }),
    speciesNames,
    (id) => hud.showSpeciesLayer(id),
    undefined,
    () => {
      if (scenario) void run({ kind: 'retry', scenarioId: scenario.id });
    },
  );
  hud.setReplaceable(stage.kind !== 'visit');
  showSeed(false);
  const landCargo = createLandCargo({ session, scenario, at, speciesNames, intervene, flash: () => tablet.flash(), hud });
  const harbor = mountHarbor(app, {
    scenarios,
    speciesIds: species.map((d) => d.id),
    simVersion: SIM_VERSION,
    baseUrl: import.meta.env.VITE_HARBOR_URL,
    sitekey: import.meta.env.VITE_TURNSTILE_SITEKEY,
    stage,
    config,
    speciesNames,
    land: landCargo,
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
    names: speciesNames,
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
      onFrame: createOnFrame({ session, scenario, localSave, viewedSpecies, observe, view: () => view, hud, tablet }),
    },
  );
  if (stage.kind !== 'free') {
    createScenarioSession({
      session, config, stage, def: dev?.scenarioDef(stage.def) ?? stage.def, forced: !!dev?.shortcut, log, persistLog, store, markStage, saveChronicle, resumed, fromSlot, loop, tablet, harbor, observe,
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
