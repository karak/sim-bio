import { World } from './simulation/World';
import type { DisasterKind, SpeciesDef, WorldConfig } from './simulation/types';
import { createAppLogSink } from './core/log/appSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
import { createTablet } from './ui/Tablet';
import { createScenarioRunner } from './scenario/ScenarioRunner';
import type { ScenarioDef } from './scenario/types';
import type { Command } from './simulation/types';
import { TOWER_COST } from './simulation/weatherTower';
import { exportCargo } from './simulation/ship';
import { disasterClick, spawnClick } from './ui/clicks';
import { IDLE, pressStep, type PressInput } from './ui/press';
import { cargoOfHold, planLanding, type LandResult } from './harbor/cargo';
import { afterVerdictOf } from './harbor/dock';
import type { DrawnCargo } from './harbor/contract';
import { createObserveEntry } from './observe/entry';
import { createViewedSpecies } from './ui/viewedSpecies';
import { openIslandStore } from './persist/islandStore';
import { createLocalSave } from './persist/localSave';
import { AUTOSAVE_TICKS } from './persist/autosave';
import { checkScenarioSave, createScenarioAutosave } from './persist/scenarioSave';
import { continueTargetOf, readLastStage, scenarioProgressOf, writeLastStage, type ScenarioProgress } from './persist/lastStage';
import { putPendingSlot, slotSaveOf, takePendingSlot, type SlotSave } from './persist/slotSave';
import { recordChronicle } from './chronicle/recorder';
import type { RunnerState } from './scenario/ScenarioRunner';
import { SIM_VERSION } from './simulation/version';
import { digestOf } from './chronicle/digest';
import { createPlayback } from './chronicle/playback';
import { mountHarbor } from './ui/Harbor';
import { createConfirm } from './ui/confirm';
import { showTitle } from './ui/Title';
import { markEntered, putOpenTitle, takeTabMarks } from './persist/tabMarks';
import { askOf, type Risky } from './app/confirmAsk';
import { scenarioConfigOf } from './app/worldConfig';
import { restoreIsland } from './app/restore';
import { sessionOf } from './app/session';
import { atOf, bootPlanOf, bootRouteOf, bootSeedOf, DEFAULT_SEED, newWorldSeed, planOp, runPlan, searchFor, seedSearchFor, titleHrefOf, type Effect, type Op } from './app/place';

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
    history.replaceState(null, '', `${location.pathname}${booted.unknown.search}${location.hash}`);
    log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level: 'warn', event: 'persist.url.unknown_scenario', scenario: booted.unknown.scenarioId });
  }
  // 自由モードの seed (M26-10): URL の seed= (石板・訪問は無視して URL から落とす)。無ければ既定 (world.default.json の 42)
  const seeded = bootSeedOf(location.search, scenario !== null);
  if (seeded.search !== null) history.replaceState(null, '', `${location.pathname}${seeded.search}${location.hash}`);
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
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;
  /** 気象塔チップを持っているか (M10-01)。次の島クリックで build_tower を送る */
  let towerArmed = false;
  /** 年代記は石板ごとに最後の 1 本を置き、島・runner の状態と同じ transaction で書く (persist/scenarioSave.ts)。読むのは続きからの復帰 (M19-14) と港への出港 (M19-09) */
  const saveChronicle = () => session.scenarioAutosave?.flush();
  /** プレイヤーの介入はここを通す (シナリオ中は回数を数え、力が足りなければ弾く) */
  const intervene = (c: Command): boolean => {
    if (visitId) return false;
    if (!session.recorder) {
      session.world.dispatch(c);
      return true;
    }
    const result = session.recorder.dispatch(c);
    if (result.ok) saveChronicle();
    else {
      const snap = session.world.snapshot();
      log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'cmd.rejected', reason: result.reason, cmd: c });
      if (result.reason === 'budget') tablet.flash();
    }
    return result.ok;
  };

  /** 今の島の seed を HUD に出し、自由モードなら URL の seed= も揃える (M26-10)。初めて開いた 42 の島だけは URL を変えない */
  const showSeed = (always: boolean) => {
    hud.setSeed(session.world.seed);
    if (scenario) return;
    if (always || seeded.seed !== null || session.world.seed !== DEFAULT_SEED) history.replaceState(null, '', `${location.pathname}${seedSearchFor(location.search, session.world.seed)}${location.hash}`);
  };
  const replaceWorld = (next: World) => {
    const shown = session.world.snapshot();
    session.world = next;
    const { size, species: nextSpecies } = session.world.snapshot();
    // 描き分けの表は種から作るので、大きさか種の並びが変われば作り直す
    if (size !== shown.size || nextSpecies.map((d) => d.id).join() !== shown.species.map((d) => d.id).join()) {
      view.dispose();
      view = createSceneView(canvas, { assets: buildAssetTable(nextSpecies), size, now: dev?.clock });
    }
    session.selected = null;
    localSave.replaced(session.world.serialize());
    showSeed(true);
  };
  /** 枠とファイルの包み (M19-17)。石板の中では島・runner の状態・年代記の 3 つ */
  const slotSave = (): SlotSave =>
    scenario && session.runner && session.recorder
      ? { stage: 'scenario', scenarioId: scenario.id, save: session.world.serialize(), runner: session.runner.save(), chronicle: session.recorder.current() }
      : { stage: 'free', save: session.world.serialize() };
  const titleOf = (id: string) => scenarios.find((d) => d.id === id)?.title ?? id;
  const at = () => atOf(!!visitId, head, session.runner?.verdict().status ?? null);
  /** 確かめを受けた後に 1 つ行う。false なら残りを行わない */
  const perform = async (e: Effect): Promise<boolean> => {
    switch (e.kind) {
      case 'new_world':
        replaceWorld(World.create({ ...config, seed: newWorldSeed(at(), config.seed, session.world.seed, drawSeed) }, { log }));
        return true;
      case 'restart':
        session.restartScenario(e.from);
        return true;
      case 'replace': {
        let restored: World;
        try {
          restored = World.restore(e.save, { log });
        } catch (err) {
          persistLog('warn', 'persist.load.failed', e.save.tick, { slot: e.slot ?? 'file', error: String(err) });
          return false;
        }
        replaceWorld(restored);
        return true;
      }
      case 'refuse':
        persistLog('warn', 'persist.load.failed', e.tick, { slot: e.slot ?? 'file', error: e.error });
        return false;
      case 'stash_import':
        await store?.stashImport(e.data).catch((err: unknown) => persistLog('warn', 'persist.save.failed', e.data.save.tick, { slot: 'import', error: String(err) }));
        return true;
      case 'put_pending':
        putPendingSlot(sessionStorage, e.slot);
        return true;
      case 'save_slot':
        void localSave.saveSlot(e.slot, slotSave());
        return true;
      case 'flush':
        // 移る前に、今の島と石板の続きを書き切る (M19-17)。訪問ではどちらも何も書かない
        await Promise.all([localSave.flush(() => session.world.serialize()), saveChronicle()]);
        return true;
      case 'go':
        location.search = searchFor(location.search, e.scenarioId, { keepVisit: e.keepVisit });
        return true;
      case 'assign':
        location.assign(e.href);
        return true;
      case 'to_title':
        // タイトルへ (M24-04): 移った先の起動 (bootRouteOf) がタイトルを選ぶよう、舞台に入った印を消して合図を置き、/ へ (見守り手と開発の板の検索語は残す、titleHrefOf)
        putOpenTitle(sessionStorage);
        location.assign(titleHrefOf(location.search));
        return true;
    }
  };
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
      armed = k;
      view.setVolcanoHint(k === 'volcano');
    },
    onSpawnArm: (id) => {
      spawnArmed = id;
    },
    onTowerArm: (v) => {
      towerArmed = v;
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
  /** 受け取った漂着 (M19-10) を浜のセルに放つ。石板では放流の値段を積荷の種の数だけ先に確かめ、足りなければ 1 つも放たない */
  const landCargo = (d: DrawnCargo): LandResult => {
    const s = session.world.snapshot();
    const place = at();
    const power = session.runner?.budget()?.power;
    const spawnCost = scenario?.budget?.costs.spawn;
    const gate = { finished: place.stage === 'scenario' && place.finished, budget: power !== undefined && spawnCost !== undefined ? { power, spawnCost } : undefined };
    const landing = planLanding(d, { elevation: s.layers.elevation, size: s.size }, gate, speciesNames);
    if (landing.kind === 'budget') tablet.flash();
    if (landing.kind !== 'land') return landing.kind;
    if (!landing.commands.every(intervene)) return 'refused';
    hud.addMarker(s.year, landing.marker, '#8FEADF');
    // 積荷は浜の 3×3 に着くので、島の総数ではほとんど動かない (M19-15)。着いた浜のセルを選び、周辺の密度の推移で見せる
    session.selected = landing.cell;
    hud.showCell(landing.cell, s);
    return 'ok';
  };
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
    const newRunner = (restored?: RunnerState) => createScenarioRunner(dev?.scenarioDef(scenario) ?? scenario, session.world, {
      ticksPerYear: config.ticksPerYear,
      onVerdict: (v) => {
        loop.setSpeed(0);
        saveChronicle();
        const chronicle = session.recorder?.current();
        const after = afterVerdictOf(v.status, { visiting: !!visitId, forced: !!dev?.shortcut, chronicle: !!chronicle });
        // 持ち出し (M10-03): escaped が確定した瞬間の snapshot から書き出す (石板のダウンロードボタンが使う)
        const hold = after.hold ? exportCargo(session.world.snapshot()) : undefined;
        tablet.showVerdict(v, hold);
        // 空の舟の積荷 (M19-10) は持ち出しと同じ瞬間の snapshot から作り、港に流す
        const cargo = after.harbor?.cargo && hold ? cargoOfHold(hold) : null;
        if (chronicle && after.harbor) {
          void digestOf(session.world.snapshot(), after.harbor.status).then((digest) => {
            harbor.offerPublish({ chronicle, digest });
            harbor.settle({ chronicle, digest }, cargo);
          });
        }
        log.write({ ts: new Date().toISOString(), tick: session.world.snapshot().tick, year: session.world.snapshot().year, level: 'info', event: `scenario.${v.status}`, scenario: scenario.id, reason: v.reason });
      },
      onWarning: (w) => {
        const snap = session.world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.warning', scenario: scenario.id, kind: w.kind, id: w.id, text: w.text });
      },
      onPrayer: (e) => {
        const snap = session.world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'info', event: 'scenario.prayer', scenario: scenario.id, phase: e.phase, kind: e.prayer });
      },
      onPowerExhausted: () => {
        tablet.flash();
        const snap = session.world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.power.exhausted', scenario: scenario.id });
      },
    }, restored);
    session.runner = newRunner(resumed?.runner);
    let scenarioRunner = session.runner;
    session.recorder = visitId ? null : recordChronicle(
      { dispatch: (c) => scenarioRunner.intervene(c), snapshot: () => session.world.snapshot() },
      { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed },
      () => scenarioRunner.totalsByYear(),
    );
    // 石板の途中の島の自動保存 (M19-14) は、記録する島 (自分の島) だけ。訪問している他人の島を自分の続きとして書かない
    const scenarioRecorder = session.recorder;
    if (scenarioRecorder) {
      if (resumed?.chronicle) scenarioRecorder.resume(resumed.chronicle);
      session.scenarioAutosave = createScenarioAutosave({
        store,
        scenarioId: scenario.id,
        every: AUTOSAVE_TICKS,
        log: persistLog,
        from: session.world.snapshot().tick,
        capture: () => ({ save: session.world.serialize(), runner: scenarioRunner.save(), chronicle: scenarioRecorder.current() }),
        onSaved: markStage,
      });
    }
    // 年代記の再生 (runChronicle) と同じく、クリックより前に tick 0 の評価を済ませる。最初のフレームを待つと、その前のクリックが年 0 の予定より先に入る
    scenarioRunner.update(session.world.snapshot());
    // 枠から開いた石板は、その場で石板の続きに書く (開き直してもその時点から)
    if (fromSlot) void saveChronicle();
    session.restartScenario = (from) => {
      session.runner = scenarioRunner = newRunner(from?.runner);
      // HUD のレイヤーは始め直しても変わらないので、見ている種を新しい runner にも知らせる。枠から戻した告知は読んでいないので既読にしない
      scenarioRunner.setViewedSpecies(session.viewing, { acknowledge: false });
      // 記録器は runner を scenarioRunner 越しに包むので、命令の列だけを枠の年代記 (初めからなら空) に差し替える
      scenarioRecorder?.resume(from?.chronicle ?? { ...scenarioRecorder.current(), commands: [] });
      scenarioRunner.update(session.world.snapshot());
      void saveChronicle();
      const verdict = scenarioRunner.verdict();
      if (verdict.status === 'running') tablet.hideVerdict();
      else {
        loop.setSpeed(0);
        tablet.showVerdict(verdict);
      }
    };
    if (visitId) {
      void harbor.visitChronicle().then((c) => {
        if (!c) return;
        session.scenarioStep = createPlayback(session.world, scenarioRunner, c.commands).step;
        document.getElementById('speed-10')?.click();
        requestAnimationFrame(() => void observe.enter());
      });
    }
  }

  // 舟の行 (M10-04): 逃がす条件のある石板と自由モードだけ出す
  hud.setShipEnabled(!scenario || !!scenario.escape);
  // カメラのドラッグの終わりにも click が来る。押しと判別し、ドラッグだったときは次の click を選びにしない (M26-03)
  let press = IDLE;
  let dragged = false;
  const feedPress = (input: PressInput) => {
    const step = pressStep(press, input);
    press = step.state;
    if (input.type === 'down') dragged = false;
    if (step.action === 'drag') dragged = true;
  };
  canvas.addEventListener('pointerdown', (e) => feedPress({ type: 'down', pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointermove', (e) => feedPress({ type: 'move', pointerId: e.pointerId, x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => feedPress({ type: 'up', pointerId: e.pointerId }));
  canvas.addEventListener('pointercancel', (e) => feedPress({ type: 'cancel', pointerId: e.pointerId }));
  canvas.addEventListener('click', (e) => {
    if (dragged) return;
    const cell = view.pickCell(e.clientX, e.clientY);
    if (cell === null) return;
    if (spawnArmed) {
      const id = spawnArmed;
      const s = session.world.snapshot();
      // 1 セルだけだと見えにくいので半径 1 (3×3 相当) に放つ。1 コマンドなので値段も 1 回分。海セルは World 側で無視される
      const ok = intervene(spawnClick(id, cell));
      if (ok) {
        const def = s.species.find((d) => d.id === id);
        hud.addMarker(s.year, def?.name ?? id, def?.color ?? '#6FBF7C');
      }
      hud.setSpawnArmed(null);
      return;
    }
    if (armed) {
      const kind = armed;
      const s = session.world.snapshot();
      const ok = intervene(disasterClick(kind, cell));
      if (ok) hud.addMarker(s.year, kind, '#E07A55');
      hud.setArmed(null);
      return;
    }
    if (towerArmed) {
      const s = session.world.snapshot();
      const ok = intervene({ type: 'build_tower', cell });
      if (ok) hud.addMarker(s.year, '気象塔', '#7FB3E0');
      hud.setTowerArmed(false);
      return;
    }
    session.selected = cell;
    hud.showCell(cell, session.world.snapshot());
  });

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
