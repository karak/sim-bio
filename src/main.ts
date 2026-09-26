import { World } from './simulation/World';
import type { DisasterKind, SaveData, SpeciesDef, WorldConfig } from './simulation/types';
import { createAppLogSink } from './core/log/appSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
import { createTablet } from './ui/Tablet';
import { createScenarioRunner, type ScenarioRunner } from './scenario/ScenarioRunner';
import { stepByYear } from './scenario/stepByYear';
import type { ScenarioDef } from './scenario/types';
import type { Command } from './simulation/types';
import { resolveCivilizationStart } from './simulation/civilization';
import { TOWER_COST } from './simulation/weatherTower';
import { exportCargo } from './simulation/ship';
import { disasterClick, spawnClick } from './ui/clicks';
import { createObserveEntry } from './observe/entry';
import { openIslandStore } from './persist/islandStore';
import { createLocalSave } from './persist/localSave';
import { createScenarioAutosave, resumeScenario, type ScenarioAutosave } from './persist/scenarioSave';
import { recordChronicle, type ChronicleRecorder } from './chronicle/recorder';
import type { InterveneResult } from './scenario/ScenarioRunner';
import { SIM_VERSION } from './simulation/version';

/** 自動保存の周期 (M19-05)。1 季節。1 倍速で 90 秒、100 倍速で 1 秒ほど。serialize と書き込みは 90 tick の計算の 2% に満たない */
const AUTOSAVE_TICKS = 90;

async function boot(): Promise<void> {
  const { log, flushViaBeacon } = createAppLogSink({
    url: import.meta.env.VITE_LOG_URL,
    sendBeacon: (url, data) => navigator.sendBeacon(url, data),
  });
  const [base, species, scenarios, store] = await Promise.all([
    fetch('/data/world.default.json').then((r) => r.json() as Promise<Omit<WorldConfig, 'species'>>),
    fetch('/data/species.json').then((r) => r.json() as Promise<SpeciesDef[]>),
    fetch('/data/scenarios.json').then((r) => r.json() as Promise<ScenarioDef[]>),
    openIslandStore({ indexedDB, now: Date.now }).catch((e: unknown) => {
      log.write({ ts: new Date().toISOString(), tick: 0, year: 0, level: 'warn', event: 'persist.unavailable', error: String(e) });
      return null;
    }),
  ]);
  // ?scenario=<id> で石板を選ぶ。無ければ自由モード
  const params = new URLSearchParams(location.search);
  const scenario = scenarios.find((d) => d.id === params.get('scenario')) ?? null;
  const config: WorldConfig = { ...base, species: species.map((d) => ({ ...d, ...(scenario?.start?.species?.[d.id] ?? {}) })) };
  if (scenario?.start) {
    if (scenario.start.seed !== undefined) config.seed = scenario.start.seed;
    if (scenario.start.size !== undefined) config.size = scenario.start.size;
    if (scenario.start.tempOffset !== undefined) config.climate.tempOffset = scenario.start.tempOffset;
    if (scenario.start.rainScale !== undefined) config.climate.rainScale = scenario.start.rainScale;
    // 文明の初期段階・集落の上書き (M8-02)。home は他のコマンドと同じ規約で -1 なら島の中心
    config.civilization = resolveCivilizationStart(scenario.start.civilization, config.size);
    // 輝石の倍率 (M10-02): 脈を薄くする舞台装置
    if (scenario.start.crystalScale !== undefined) config.crystalScale = scenario.start.crystalScale;
    // 火山セルの上書き (M8-08)。他のセル指定と同じ規約で -1 なら島の中心。省略時は World の既定 (標高最大の陸セル) のまま
    if (scenario.start.volcanoCell !== undefined) {
      const { size } = config;
      config.volcanoCell = scenario.start.volcanoCell === -1 ? Math.floor(size / 2) * size + Math.floor(size / 2) : scenario.start.volcanoCell;
    }
  }
  const persistLog = (level: 'info' | 'warn', event: string, tick: number, extra: Record<string, unknown> = {}) =>
    log.write({ ts: new Date().toISOString(), tick, year: Math.floor(tick / config.ticksPerYear), level, event, ...extra });
  const localSave = createLocalSave({
    store,
    mode: scenario ? 'scenario' : 'free',
    every: AUTOSAVE_TICKS,
    log: persistLog,
    onSaved: (s) => hud.setSlot(s),
  });
  // 石板の途中で閉じた島の続き (M19-14): 島・runner の状態・年代記を戻す。無い・判定の出た石板・読めない続きなら石板の初めから
  const resumed = scenario
    ? await resumeScenario({ store, head: { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed }, log: persistLog }, (s) => ({
        world: World.restore(s.save, { log }),
        runner: s.runner,
        chronicle: s.chronicle,
      }))
    : null;
  // 閉じる前の続きから (M19-05)
  let world = resumed?.world ?? (await localSave.resume((save) => World.restore(save, { log }))) ?? World.create(config, { log });
  const selectScenario = (id: string | null) => {
    const q = new URLSearchParams(location.search);
    if (id) q.set('scenario', id);
    else q.delete('scenario');
    location.search = q.toString();
  };

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  let view: SceneView = createSceneView(canvas, { assets: buildAssetTable(world.snapshot().species), size: world.snapshot().size });
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;
  /** 気象塔チップを持っているか (M10-01)。次の島クリックで build_tower を送る */
  let towerArmed = false;
  let selected: number | null = null;

  let runner: ScenarioRunner | null = null;
  /** シナリオ中の介入の年代記 (M19-06)。runner と一緒に作り、runner.intervene を包む */
  let recorder: ChronicleRecorder<InterveneResult> | null = null;
  /** 石板の途中の島の自動保存 (M19-14)。runner と一緒に作る */
  let scenarioAutosave: ScenarioAutosave | null = null;
  /** 年代記は石板ごとに最後の 1 本を置く。続きからの復帰 (島と runner を戻す) はまだ無いので、読むのは港への出港 (M19-09) */
  // (M19-14 で変更: 続きからの復帰ができた。年代記は島・runner の状態と同じ transaction で書く。persist/scenarioSave.ts)
  const saveChronicle = () => scenarioAutosave?.flush();
  /** プレイヤーの介入はここを通す (シナリオ中は回数を数え、力が足りなければ弾く) */
  const intervene = (c: Command): boolean => {
    if (!recorder) {
      world.dispatch(c);
      return true;
    }
    const result = recorder.dispatch(c);
    if (result.ok) saveChronicle();
    else {
      const snap = world.snapshot();
      log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'cmd.rejected', reason: result.reason, cmd: c });
      if (result.reason === 'budget') tablet.flash();
    }
    return result.ok;
  };

  const replaceWorld = (next: World) => {
    const shown = world.snapshot();
    world = next;
    const { size, species: nextSpecies } = world.snapshot();
    // 描き分けの表は種から作るので、大きさか種の並びが変われば作り直す
    if (size !== shown.size || nextSpecies.map((d) => d.id).join() !== shown.species.map((d) => d.id).join()) {
      view.dispose();
      view = createSceneView(canvas, { assets: buildAssetTable(nextSpecies), size });
    }
    selected = null;
    localSave.replaced(world.serialize());
  };
  const load = (save: SaveData) => {
    if (runner) return; // シナリオ中の読込は予言と矛盾するので無効
    replaceWorld(World.restore(save, { log }));
  };

  const hud = createHud(app, {
    onCommand: intervene,
    onSpeed: (s) => loop.setSpeed(s),
    onLayer: (l) => view.setLayer(l),
    onSave: () => world.serialize(),
    onLoad: load,
    onSlotSave: (slot) => void localSave.saveSlot(slot, world.serialize()),
    onSlotLoad: (slot) => {
      if (runner) return; // シナリオ中の読込は予言と矛盾するので無効
      void localSave.loadSlot(slot, (save) => World.restore(save, { log })).then((w) => {
        if (w) replaceWorld(w);
      });
    },
    onNewIsland: () => {
      if (runner) return;
      replaceWorld(World.create(config, { log }));
    },
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
  });

  const tablet = createTablet(
    app,
    scenarios,
    scenario,
    selectScenario,
    Object.fromEntries(species.map((d) => [d.id, d.name])),
    (id) => hud.showSpeciesLayer(id),
  );
  hud.setReplaceable(!scenario);
  void localSave.list().then((list) => list.forEach(hud.setSlot));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    localSave.flush(() => world.serialize());
    saveChronicle();
    flushViaBeacon();
  });
  // 観察画面 (M22-08): 入っている間は 2D の地図を描かず、snapshot を観察画面へ渡す。速さは操作画面の速さの列を押して揃える
  const observe = createObserveEntry(app, {
    names: Object.fromEntries(species.map((d) => [d.id, d.name])),
    getSpeed: () => loop.getSpeed(),
    setSpeed: (s) => document.getElementById(`speed-${s}`)?.click(),
  });
  const loop = createRunner(
    // シナリオの判定の後は、速度を戻せば今までどおり島を回す (判定の年の境目より先は年表・判定に効かない)
    { step: (n) => (runner?.verdict().status === 'running' ? stepByYear(world, runner, n) : world.step(n)), snapshot: () => world.snapshot() },
    {
      onFrame: (s) => {
        localSave.onTick(s.tick, () => world.serialize());
        scenarioAutosave?.onTick(s.tick);
        observe.push(s, runner?.timeline());
        if (!observe.active()) view.update(s);
        hud.update(s);
        // 迎撃の行を畳む判定 (M21-02 D4) に使う。自由モードでは runner が無いので常に null (行は常に隠れる)
        hud.setNextMeteor(runner ? runner.nextMeteorYear() : null);
        if (selected !== null) hud.showCell(selected, s);
        if (runner) {
          const verdict = runner.update(s);
          const budgetInfo = runner.budget();
          tablet.update(runner.yearOf(s), verdict, budgetInfo, runner.warnings(), runner.timeline(), runner.prayer(), runner.milestones());
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
    runner = createScenarioRunner(scenario, world, {
      ticksPerYear: config.ticksPerYear,
      onVerdict: (v) => {
        loop.setSpeed(0);
        saveChronicle();
        // 持ち出し (M10-03): escaped が確定した瞬間の snapshot から書き出す (石板のダウンロードボタンが使う)
        tablet.showVerdict(v, v.status === 'escaped' ? exportCargo(world.snapshot()) : undefined);
        log.write({ ts: new Date().toISOString(), tick: world.snapshot().tick, year: world.snapshot().year, level: 'info', event: `scenario.${v.status}`, scenario: scenario.id, reason: v.reason });
      },
      onWarning: (w) => {
        const snap = world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.warning', scenario: scenario.id, kind: w.kind, id: w.id, text: w.text });
      },
      onPrayer: (e) => {
        const snap = world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'info', event: 'scenario.prayer', scenario: scenario.id, phase: e.phase, kind: e.prayer });
      },
      onPowerExhausted: () => {
        tablet.flash();
        const snap = world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.power.exhausted', scenario: scenario.id });
      },
    }, resumed?.runner);
    const scenarioRunner = runner;
    const scenarioRecorder = recordChronicle(
      { dispatch: (c) => scenarioRunner.intervene(c), snapshot: () => world.snapshot() },
      { simVersion: SIM_VERSION, scenarioId: scenario.id, seed: config.seed },
      () => scenarioRunner.totalsByYear(),
    );
    if (resumed) scenarioRecorder.resume(resumed.chronicle);
    recorder = scenarioRecorder;
    scenarioAutosave = createScenarioAutosave({
      store,
      scenarioId: scenario.id,
      every: AUTOSAVE_TICKS,
      log: persistLog,
      from: world.snapshot().tick,
      capture: () => ({ save: world.serialize(), runner: scenarioRunner.save(), chronicle: scenarioRecorder.current() }),
    });
    // 年代記の再生 (runChronicle) と同じく、クリックより前に tick 0 の評価を済ませる。最初のフレームを待つと、その前のクリックが年 0 の予定より先に入る
    scenarioRunner.update(world.snapshot());
  }

  // 舟の行 (M10-04): 逃がす条件のある石板と自由モードだけ出す
  hud.setShipEnabled(!scenario || !!scenario.escape);
  canvas.addEventListener('click', (e) => {
    const cell = view.pickCell(e.clientX, e.clientY);
    if (cell === null) return;
    if (spawnArmed) {
      const id = spawnArmed;
      const s = world.snapshot();
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
      const s = world.snapshot();
      const ok = intervene(disasterClick(kind, cell));
      if (ok) hud.addMarker(s.year, kind, '#E07A55');
      hud.setArmed(null);
      return;
    }
    if (towerArmed) {
      const s = world.snapshot();
      const ok = intervene({ type: 'build_tower', cell });
      if (ok) hud.addMarker(s.year, '気象塔', '#7FB3E0');
      hud.setTowerArmed(false);
      return;
    }
    selected = cell;
    hud.showCell(cell, world.snapshot());
  });

  loop.start();
}

boot().catch((e: unknown) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">${String(e)}</pre>`);
});
