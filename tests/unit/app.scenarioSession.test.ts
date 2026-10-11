// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { Chronicle } from '../../src/chronicle/chronicle';
import type { ChronicleId } from '../../src/harbor/contract';
import type { IslandStore } from '../../src/persist/islandStore';
import { SIM_VERSION } from '../../src/simulation/version';
import { createScenarioSession, type ScenarioSessionDeps } from '../../src/app/scenarioSession';
import { sessionOf } from '../../src/app/session';
import { resumeIsland } from '../fixtures/resumeIsland';

const island = resumeIsland('test-quick', 5);

/** 石板の手を組む。置き場への書き込みと、港から届く訪問の年代記 (arrive で渡す) を残す */
function setup(o: { visit?: boolean; fromSlot?: boolean } = {}) {
  const saved: number[] = [];
  const speeds: number[] = [];
  const store = { saveScenario: async (_id: string, s: { save: { tick: number } }) => void saved.push(s.save.tick) } as unknown as IslandStore;
  let arrive: (c: Chronicle | null) => void = () => undefined;
  const session = sessionOf(World.create(island.config, { log: createMemorySink() }));
  const deps: ScenarioSessionDeps = {
    session,
    config: island.config,
    stage: o.visit ? { kind: 'visit', id: 'ab'.repeat(32) as ChronicleId, def: island.def } : { kind: 'scenario', def: island.def },
    def: island.def,
    forced: false,
    log: createMemorySink(),
    persistLog: () => undefined,
    store,
    markStage: () => undefined,
    resumed: null,
    fromSlot: o.fromSlot ?? false,
    loop: { setSpeed: (s) => void speeds.push(s) },
    tablet: { showVerdict: () => undefined, hideVerdict: () => undefined, flash: () => undefined },
    harbor: {
      offerPublish: () => undefined,
      settle: () => undefined,
      visitChronicle: () => new Promise((resolve) => (arrive = resolve)),
    },
    observe: { enter: async () => undefined },
  };
  const scenario = createScenarioSession(deps);
  return { session, scenario, saved, speeds, arrive: (c: Chronicle | null) => arrive(c) };
}

const head = { simVersion: SIM_VERSION, scenarioId: island.def.id, seed: island.config.seed };

describe('石板の手 createScenarioSession (M27-05)', () => {
  it('自分の石板は年代記と自動保存を持ち、step で島を進め、restart で runner を差し替える', () => {
    const { session, scenario } = setup();
    expect(scenario.recorder?.current()).toMatchObject({ ...head, commands: [] });
    expect(scenario.autosave).not.toBeNull();
    scenario.step(5);
    expect(session.world.snapshot().tick).toBe(5);
    const before = scenario.runner;
    scenario.restart(null);
    expect(scenario.runner).not.toBe(before);
  });

  it('枠から開いた石板は、組んだその場で石板の続きに書く (Session に置かれる前でも)', async () => {
    const { session, saved } = setup({ fromSlot: true });
    expect(session.scenario).toBeNull();
    await Promise.resolve();
    expect(saved).toEqual([0]);
  });

  it('restart(null) は石板の続きに書き (flush)、命令の列だけを空に戻して年代記の頭は残す', async () => {
    const { scenario, saved } = setup();
    scenario.step(3);
    expect(scenario.recorder?.dispatch({ type: 'set_climate', rainScale: 1.1 }).ok).toBe(true);
    expect(scenario.recorder?.current().commands).toHaveLength(1);
    expect(saved).toEqual([]);
    scenario.restart(null);
    await Promise.resolve();
    expect(saved).toEqual([3]);
    expect(scenario.recorder?.current()).toMatchObject({ ...head, commands: [] });
  });

  it('訪問は年代記も自動保存も持たず、港から年代記が届くまで島を進めず、届いたら再生で進める', async () => {
    const { session, scenario, arrive } = setup({ visit: true });
    expect(scenario.recorder).toBeNull();
    expect(scenario.autosave).toBeNull();
    scenario.step(5);
    expect(session.world.snapshot().tick).toBe(0);
    arrive({ ...head, v: 1, commands: [] } as unknown as Chronicle);
    await new Promise((r) => setTimeout(r, 0));
    scenario.step(5);
    expect(session.world.snapshot().tick).toBe(5);
  });

  it('訪問の年代記が届いたら、loop に 10x を言う (HUD の札は loop を追う)', async () => {
    const { speeds, arrive } = setup({ visit: true });
    expect(speeds).toEqual([]);
    arrive({ ...head, v: 1, commands: [] } as unknown as Chronicle);
    await new Promise((r) => setTimeout(r, 0));
    expect(speeds).toEqual([10]);
  });

  it('訪問で港が年代記を返さなければ、島は止まったまま', async () => {
    const { session, scenario, arrive } = setup({ visit: true });
    arrive(null);
    await new Promise((r) => setTimeout(r, 0));
    scenario.step(5);
    expect(session.world.snapshot().tick).toBe(0);
  });
});
