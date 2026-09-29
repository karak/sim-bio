import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import { SIM_VERSION } from '../../src/simulation/version';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { exportCargo } from '../../src/simulation/ship';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig } from '../../src/simulation/types';
import { cargoOfHold, landingCell, planLanding } from '../../src/harbor/cargo';
import { parseCargo, parsePublicChronicle, type CargoId } from '../../src/harbor/contract';
import { recordChronicle } from '../../src/chronicle/recorder';
import { digestOf } from '../../src/chronicle/digest';
import { replay } from '../../src/chronicle/replay';
import { receiveCargoClick, SPAWN_RADIUS } from '../../src/ui/clicks';
import { catalogFrom } from '../fixtures/fakeHarbor';
import { FIXTURE_YEARS, fixtureIsland } from '../fixtures/chronicle';

const json = <T>(name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as T;
const data = {
  base: json<Omit<WorldConfig, 'species'>>('world.default'),
  species: json<SpeciesDef[]>('species'),
  scenarios: json<ScenarioDef[]>('scenarios'),
};
const catalog = catalogFrom({ scenarios: data.scenarios, species: data.species, inscriptions: json<{ id: string }[]>('inscriptions') });
const hold = (species: { id: string; total: number }[]) => ({ species: species.map((s) => ({ ...s, density: [] })) });

describe('空の舟の積荷 cargoOfHold (M19-10、設計書 B5)', () => {
  it('持ち出しの種を総数の多い順に 5 件まで積む。量は総数の 1/100 を 3 桁に丸め、10 で頭打ち', () => {
    const cargo = cargoOfHold(
      hold([
        { id: 'grass', total: 812.345 },
        { id: 'forest', total: 2400 },
        { id: 'deer', total: 31.4159 },
        { id: 'wolf', total: 4.2 },
        { id: 'rabbit', total: 55 },
        { id: 'belltree', total: 1.5 },
      ]),
    );
    expect(cargo).toEqual({
      items: [
        { speciesId: 'forest', amount: 10 },
        { speciesId: 'grass', amount: 8.12 },
        { speciesId: 'rabbit', amount: 0.55 },
        { speciesId: 'deer', amount: 0.314 },
        { speciesId: 'wolf', amount: 0.042 },
      ],
    });
    expect(parseCargo(cargo, catalog).ok).toBe(true);
  });

  it('総数が同じなら種 id の順。量が 0.001 に満たない種は積まない。積むものが無ければ null (港へ流さない)', () => {
    expect(cargoOfHold(hold([{ id: 'wolf', total: 5 }, { id: 'deer', total: 5 }, { id: 'grass', total: 1e-12 }]))).toEqual({
      items: [
        { speciesId: 'deer', amount: 0.05 },
        { speciesId: 'wolf', amount: 0.05 },
      ],
    });
    expect(cargoOfHold(hold([{ id: 'grass', total: 1e-12 }]))).toBeNull();
    expect(cargoOfHold(hold([]))).toBeNull();
  });

  it('本物の島の持ち出し (exportCargo) からも、港の契約に通る積荷になる', () => {
    const world = World.create({ ...structuredClone(data.base), size: 32, species: data.species }, { log: createMemorySink() });
    world.step(40);
    const cargo = cargoOfHold(exportCargo(world.snapshot()));
    expect(cargo?.items.length).toBeGreaterThanOrEqual(1);
    expect(parseCargo(cargo, catalog)).toEqual({ ok: true, value: cargo });
  });
});

describe('漂着の場所 landingCell (M19-10)', () => {
  const size = 5;
  // 真ん中の 3×3 が陸、まわりが海
  const elevation = Float32Array.from({ length: size * size }, (_, i) => {
    const x = i % size;
    const y = Math.floor(i / size);
    return x >= 1 && x <= 3 && y >= 1 && y <= 3 ? SEA_LEVEL + 0.1 : 0;
  });
  const shore = [6, 7, 8, 11, 13, 16, 17, 18];

  it('海に接する陸のセル (浜) に着く。同じ積荷はいつも同じセル', () => {
    const ids = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9', 'j0'] as CargoId[];
    const cells = ids.map((id) => landingCell(id, { elevation, size }));
    for (const c of cells) expect(shore).toContain(c);
    expect(new Set(cells).size).toBeGreaterThan(1);
    expect(ids.map((id) => landingCell(id, { elevation, size }))).toEqual(cells);
  });

  it('陸が無い島には着かない (null)', () => {
    expect(landingCell('a1' as CargoId, { elevation: new Float32Array(size * size), size })).toBeNull();
  });
});

describe('受け取った積荷は外来種の放流として年代記に載り、回し直すと同じ結末 (M19-10)', () => {
  it('receiveCargoClick は積荷の種ごとに 1 つの放流 (量は積荷の量、半径は UI の放流と同じ)', () => {
    const cargo = { items: [{ speciesId: 'rabbit', amount: 2.5 }, { speciesId: 'wolf', amount: 0.3 }] };
    expect(receiveCargoClick(cargo, 77)).toEqual([
      { type: 'spawn_species', speciesId: 'rabbit', cell: 77, amount: 2.5, radius: SPAWN_RADIUS },
      { type: 'spawn_species', speciesId: 'wolf', cell: 77, amount: 0.3, radius: SPAWN_RADIUS },
    ]);
  });

  it('年の途中で受け取った島の Digest と、その年代記を replay した Digest が同じ', async () => {
    const island = fixtureIsland(data);
    const { ticksPerYear } = island.config;
    const world = World.create(island.config, { log: createMemorySink() });
    const runner = createScenarioRunner(island.def, world, { ticksPerYear });
    runner.update(world.snapshot());
    const recorder = recordChronicle({ dispatch: (c) => runner.intervene(c), snapshot: () => world.snapshot() }, { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed }, () => runner.totalsByYear());

    stepByYear(world, runner, 500);
    const drawn = { id: 'e3b0c44298fc1c14' as CargoId, cargo: { items: [{ speciesId: 'rabbit', amount: 3 }, { speciesId: 'wolf', amount: 0.4 }] } };
    const snap = world.snapshot();
    const cell = landingCell(drawn.id, { elevation: snap.layers.elevation, size: snap.size });
    if (cell === null) throw new Error('浜が無い');
    const results = receiveCargoClick(drawn.cargo, cell).map((c) => recorder.dispatch(c).ok);
    expect(results).toEqual([true, true]);
    stepByYear(world, runner, FIXTURE_YEARS * ticksPerYear);

    const chronicle = recorder.current();
    expect(chronicle.commands).toEqual([
      { tick: 500, command: { type: 'spawn_species', speciesId: 'rabbit', cell, amount: 3, radius: SPAWN_RADIUS } },
      { tick: 500, command: { type: 'spawn_species', speciesId: 'wolf', cell, amount: 0.4, radius: SPAWN_RADIUS } },
    ]);
    expect(parsePublicChronicle(chronicle, catalog).ok).toBe(true);
    const status = runner.verdict().status;
    if (status === 'running') throw new Error('判定が出ていない');
    const live = await digestOf(world.snapshot(), status);
    expect(await replay(chronicle, island)).toEqual({ kind: 'done', digest: live });
  });
});

describe('漂着を受け取るか planLanding (M21-07)', () => {
  // 5×5 の島: 真ん中の 3×3 が陸、周りが海。陸の縁の 8 セルが浜
  const size = 5;
  const elevation = new Float32Array(size * size).map((_, i) => (i % size >= 1 && i % size <= 3 && i >= size && i < size * 4 ? SEA_LEVEL + 0.1 : 0));
  const island = { elevation, size };
  const drawn = { id: 'c0ffee00c0ffee00' as CargoId, cargo: { items: [{ speciesId: 'rabbit', amount: 2.5 }, { speciesId: 'nomad', amount: 0.3 }] } };
  const names = { rabbit: 'ウサギ', wolf: '狼' };

  it('planLanding (M21-07): 判定の後は refused、力が積荷の種の数だけの放流に足りなければ budget で、どちらも命令を 1 つも出さない', () => {
    expect(planLanding(drawn, island, { finished: true, budget: { power: 30, spawnCost: 3 } }, names)).toEqual({ kind: 'refused' });
    expect(planLanding(drawn, island, { finished: true }, names)).toEqual({ kind: 'refused' });
    // 判定の後は力が足りなくても budget ではなく refused (石板を光らせない)
    expect(planLanding(drawn, island, { finished: true, budget: { power: 0, spawnCost: 3 } }, names)).toEqual({ kind: 'refused' });
    // 2 種 × 3 = 6。5 では 1 種分しか足りないが、1 種も放たない
    expect(planLanding(drawn, island, { finished: false, budget: { power: 5, spawnCost: 3 } }, names)).toEqual({ kind: 'budget' });
    expect(planLanding(drawn, island, { finished: false, budget: { power: 6, spawnCost: 3 } }, names).kind).toBe('land');
    const sea = { elevation: new Float32Array(size * size), size };
    expect(planLanding(drawn, sea, { finished: false }, names)).toEqual({ kind: 'no_shore' });
    expect(planLanding(drawn, sea, { finished: true, budget: { power: 0, spawnCost: 3 } }, names)).toEqual({ kind: 'no_shore' });
  });

  it('planLanding (M21-07): 受け取れるなら、着く浜のセル・種ごとの放流の命令・「漂着 (種の名)」の目印を返す', () => {
    const cell = landingCell(drawn.id, island);
    expect(cell).not.toBeNull();
    expect([6, 7, 8, 11, 13, 16, 17, 18]).toContain(cell);
    for (const gate of [{ finished: false }, { finished: false, budget: { power: 30, spawnCost: 3 } }]) {
      expect(planLanding(drawn, island, gate, names)).toEqual({
        kind: 'land',
        cell,
        commands: [
          { type: 'spawn_species', speciesId: 'rabbit', cell, amount: 2.5, radius: SPAWN_RADIUS },
          { type: 'spawn_species', speciesId: 'nomad', cell, amount: 0.3, radius: SPAWN_RADIUS },
        ],
        marker: '漂着 (ウサギ・nomad)',
      });
    }
  });
});
