import { World } from './simulation/World';
import type { DisasterKind, SaveData, SpeciesDef, WorldConfig } from './simulation/types';
import { createConsoleSink } from './core/log/consoleSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';
import { createTablet } from './ui/Tablet';
import { createScenarioRunner, type ScenarioRunner } from './scenario/ScenarioRunner';
import type { ScenarioDef } from './scenario/types';
import type { Command } from './simulation/types';

/** 災害の半径 (セル)。山火事は 1 点着火で延焼に任せる */
const DISASTER_RADIUS: Record<DisasterKind, number> = { meteor: 4, volcano: 4, wildfire: 0, plague: 4 };
/** 種を放つときに各セルへ加える密度 */
const SPAWN_AMOUNT = 0.5;

/**
 * シナリオの start.civilization を WorldConfig.civilization に落とし込む。
 * home: -1 (省略時含む) は島の中心セルに解決する。M8-02 のブランチが同じ場所を実装する予定で、
 * 合流時はどちらか一方を残せばよいよう小さくまとめてある。
 */
export function resolveCivStart(
  start: { speciesId: string; stage?: number; home?: number } | undefined,
  size: number,
): WorldConfig['civilization'] {
  if (!start) return undefined;
  const home = start.home === undefined || start.home === -1 ? Math.floor(size / 2) * size + Math.floor(size / 2) : start.home;
  return { speciesId: start.speciesId, stage: start.stage ?? 1, home };
}

async function boot(): Promise<void> {
  const [base, species, scenarios] = await Promise.all([
    fetch('/data/world.default.json').then((r) => r.json() as Promise<Omit<WorldConfig, 'species'>>),
    fetch('/data/species.json').then((r) => r.json() as Promise<SpeciesDef[]>),
    fetch('/data/scenarios.json').then((r) => r.json() as Promise<ScenarioDef[]>),
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
    if (scenario.start.civilization) config.civilization = resolveCivStart(scenario.start.civilization, config.size);
  }
  const log = createConsoleSink();
  let world = World.create(config, { log });
  const selectScenario = (id: string | null) => {
    const q = new URLSearchParams(location.search);
    if (id) q.set('scenario', id);
    else q.delete('scenario');
    location.search = q.toString();
  };

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  let view: SceneView = createSceneView(canvas, { assets: buildAssetTable(species), size: config.size });
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;
  let selected: number | null = null;

  let runner: ScenarioRunner | null = null;
  /** プレイヤーの介入はここを通す (シナリオ中は回数を数え、力が足りなければ弾く) */
  const intervene = (c: Command): boolean => {
    if (!runner) {
      world.dispatch(c);
      return true;
    }
    const result = runner.intervene(c);
    if (!result.ok) {
      const snap = world.snapshot();
      log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'cmd.rejected', reason: result.reason, cmd: c });
      if (result.reason === 'budget') tablet.flash();
    }
    return result.ok;
  };

  const hud = createHud(app, {
    onCommand: intervene,
    onSpeed: (s) => loop.setSpeed(s),
    onLayer: (l) => view.setLayer(l),
    onSave: () => world.serialize(),
    onLoad: (save: SaveData) => {
      if (runner) return; // シナリオ中の読込は予言と矛盾するので無効
      world = World.restore(save, { log });
      if (save.config.size !== config.size) {
        view.dispose();
        view = createSceneView(canvas, { assets: buildAssetTable(save.config.species), size: save.config.size });
      }
      selected = null;
    },
    onDisasterArm: (k) => {
      armed = k;
    },
    onSpawnArm: (id) => {
      spawnArmed = id;
    },
  });

  const tablet = createTablet(app, scenarios, scenario, selectScenario, Object.fromEntries(species.map((d) => [d.id, d.name])));
  const loop = createRunner(
    { step: (n) => world.step(n), snapshot: () => world.snapshot() },
    {
      onFrame: (s) => {
        view.update(s);
        hud.update(s);
        if (selected !== null) hud.showCell(selected, s);
        if (runner) {
          const verdict = runner.update(s);
          const budgetInfo = runner.budget();
          tablet.update(runner.yearOf(s), verdict, budgetInfo, runner.warnings(), runner.timeline());
          const costs = scenario?.budget?.costs;
          hud.setAffordable(
            budgetInfo && costs
              ? { spawn: budgetInfo.power >= costs.spawn, disaster: budgetInfo.power >= costs.disaster, climate: budgetInfo.power >= costs.climate }
              : { spawn: true, disaster: true, climate: true },
          );
        } else {
          hud.setAffordable({ spawn: true, disaster: true, climate: true });
        }
      },
    },
  );
  if (scenario) {
    runner = createScenarioRunner(scenario, world, {
      ticksPerYear: config.ticksPerYear,
      onVerdict: (v) => {
        loop.setSpeed(0);
        tablet.showVerdict(v);
        log.write({ ts: new Date().toISOString(), tick: world.snapshot().tick, year: world.snapshot().year, level: 'info', event: `scenario.${v.status}`, scenario: scenario.id, reason: v.reason });
      },
      onWarning: (w) => {
        const snap = world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.warning', scenario: scenario.id, kind: w.kind, id: w.id, text: w.text });
      },
      onPowerExhausted: () => {
        tablet.flash();
        const snap = world.snapshot();
        log.write({ ts: new Date().toISOString(), tick: snap.tick, year: snap.year, level: 'warn', event: 'scenario.power.exhausted', scenario: scenario.id });
      },
    });
  }

  canvas.addEventListener('click', (e) => {
    const cell = view.pickCell(e.clientX, e.clientY);
    if (cell === null) return;
    if (spawnArmed) {
      const id = spawnArmed;
      const s = world.snapshot();
      // 1 セルだけだと見えにくいので半径 1 (3×3 相当) に放つ。1 コマンドなので値段も 1 回分。海セルは World 側で無視される
      const ok = intervene({ type: 'spawn_species', speciesId: id, cell, amount: SPAWN_AMOUNT, radius: 1 });
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
      const ok = intervene({ type: 'disaster', kind, cell, radius: DISASTER_RADIUS[kind] });
      if (ok) hud.addMarker(s.year, kind, '#E07A55');
      hud.setArmed(null);
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
