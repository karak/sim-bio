import { World } from './simulation/World';
import type { DisasterKind, SaveData, SpeciesDef, WorldConfig } from './simulation/types';
import { createConsoleSink } from './core/log/consoleSink';
import { createRunner } from './core/runner';
import { createSceneView, type SceneView } from './render/SceneView';
import { buildAssetTable } from './render/assetTable';
import { createHud } from './ui/Hud';

/** 災害の半径 (セル)。山火事は 1 点着火で延焼に任せる */
const DISASTER_RADIUS: Record<DisasterKind, number> = { meteor: 4, volcano: 4, wildfire: 0, plague: 4 };
/** 種を放つときに各セルへ加える密度 */
const SPAWN_AMOUNT = 0.5;

async function boot(): Promise<void> {
  const [base, species] = await Promise.all([
    fetch('/data/world.default.json').then((r) => r.json() as Promise<Omit<WorldConfig, 'species'>>),
    fetch('/data/species.json').then((r) => r.json() as Promise<SpeciesDef[]>),
  ]);
  const config: WorldConfig = { ...base, species };
  const log = createConsoleSink();
  let world = World.create(config, { log });

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');
  let view: SceneView = createSceneView(canvas, { assets: buildAssetTable(species), size: config.size });
  let armed: DisasterKind | null = null;
  let spawnArmed: string | null = null;
  let selected: number | null = null;

  const hud = createHud(app, {
    onCommand: (c) => world.dispatch(c),
    onSpeed: (s) => runner.setSpeed(s),
    onLayer: (l) => view.setLayer(l),
    onSave: () => world.serialize(),
    onLoad: (save: SaveData) => {
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

  const runner = createRunner(
    { step: (n) => world.step(n), snapshot: () => world.snapshot() },
    {
      onFrame: (s) => {
        view.update(s);
        hud.update(s);
        if (selected !== null) hud.showCell(selected, s);
      },
    },
  );

  canvas.addEventListener('click', (e) => {
    const cell = view.pickCell(e.clientX, e.clientY);
    if (cell === null) return;
    if (spawnArmed) {
      const id = spawnArmed;
      const s = world.snapshot();
      // 1 セルだけだと見えにくいので 3×3 に放つ。海セルは World 側で reject される
      const x = cell % s.size;
      const y = (cell - x) / s.size;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          if (cx < 0 || cy < 0 || cx >= s.size || cy >= s.size) continue;
          world.dispatch({ type: 'spawn_species', speciesId: id, cell: cy * s.size + cx, amount: SPAWN_AMOUNT });
        }
      }
      const def = s.species.find((d) => d.id === id);
      hud.addMarker(s.year, def?.name ?? id, def?.color ?? '#6FBF7C');
      hud.setSpawnArmed(null);
      return;
    }
    if (armed) {
      const kind = armed;
      const s = world.snapshot();
      world.dispatch({ type: 'disaster', kind, cell, radius: DISASTER_RADIUS[kind] });
      hud.addMarker(s.year, kind, '#E07A55');
      hud.setArmed(null);
      return;
    }
    selected = cell;
    hud.showCell(cell, world.snapshot());
  });

  runner.start();
}

boot().catch((e: unknown) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:16px">${String(e)}</pre>`);
});
