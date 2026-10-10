import { describe, it, expect } from 'vitest';
import type { World } from '../../src/simulation/World';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import type { ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { CargoId } from '../../src/harbor/contract';
import { SPAWN_RADIUS } from '../../src/ui/clicks';
import { createIntervene, createLandCargo } from '../../src/app/intervene';
import { createMemorySink } from '../../src/core/log/memorySink';
import type { ChronicleRecorder } from '../../src/chronicle/recorder';
import type { InterveneResult } from '../../src/scenario/ScenarioRunner';
import { sessionOf } from '../../src/app/session';
import type { At } from '../../src/app/place';

// 5×5 の島: 真ん中の 3×3 が陸、周りが海 (harbor.cargo.test.ts と同じ)
const size = 5;
const elevation = new Float32Array(size * size).map((_, i) => (i % size >= 1 && i % size <= 3 && i >= size && i < size * 4 ? SEA_LEVEL + 0.1 : 0));
const snap = { layers: { elevation }, size, year: 4 } as unknown as WorldSnapshot;
const drawn = { id: 'c0ffee00c0ffee00' as CargoId, cargo: { items: [{ speciesId: 'rabbit', amount: 2.5 }, { speciesId: 'wolf', amount: 0.3 }] } };
const priced = { budget: { costs: { spawn: 3 } } } as unknown as ScenarioDef;

/** 島と石板の偽物。介入・石板の揺れ・HUD を順に残す */
function setup(o: { at: At; scenario?: ScenarioDef; power?: number; accept?: boolean }) {
  const calls: string[] = [];
  const sent: Command[] = [];
  const session = sessionOf({ snapshot: () => snap } as unknown as World, false);
  if (o.power !== undefined) session.runner = { budget: () => ({ power: o.power }) } as unknown as ScenarioRunner;
  const land = createLandCargo({
    session,
    scenario: o.scenario ?? null,
    at: () => o.at,
    speciesNames: { rabbit: 'ウサギ', wolf: '狼' },
    intervene: (c) => (sent.push(c), o.accept ?? true),
    tablet: { flash: () => calls.push('flash') },
    hud: { addMarker: (x, label, color) => calls.push(`marker ${x} ${label} ${color}`), showCell: (cell) => calls.push(`showCell ${cell}`) },
  });
  return { land, calls, sent, session };
}

describe('漂着を浜に放つ createLandCargo (M27-03)', () => {
  it('判定の出た石板の島は refused。命令を 1 つも出さず、石板も揺らさない', () => {
    const { land, calls, sent } = setup({ at: { stage: 'scenario', head: { simVersion: 'v', scenarioId: 's', seed: 1 }, finished: true }, scenario: priced, power: 0 });
    expect(land(drawn)).toBe('refused');
    expect(sent).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('石板の力が積荷の種の数だけの放流に足りなければ budget。石板を揺らし、命令を出さない', () => {
    const { land, calls, sent } = setup({ at: { stage: 'scenario', head: { simVersion: 'v', scenarioId: 's', seed: 1 }, finished: false }, scenario: priced, power: 5 });
    expect(land(drawn)).toBe('budget');
    expect(sent).toEqual([]);
    expect(calls).toEqual(['flash']);
  });

  it('受け取れるなら、種ごとの放流をすべて介入の入口に通し、目印を置いて着いた浜のセルを選ぶ', () => {
    const { land, calls, sent, session } = setup({ at: { stage: 'free' } });
    expect(land(drawn)).toBe('ok');
    const cell = sent[0].type === 'spawn_species' ? sent[0].cell : -1;
    expect(sent).toEqual([
      { type: 'spawn_species', speciesId: 'rabbit', cell, amount: 2.5, radius: SPAWN_RADIUS },
      { type: 'spawn_species', speciesId: 'wolf', cell, amount: 0.3, radius: SPAWN_RADIUS },
    ]);
    expect(calls).toEqual(['marker 4 漂着 (ウサギ・狼) #8FEADF', `showCell ${cell}`]);
    expect(session.selected).toBe(cell);
  });

  it('介入の入口が弾けば refused。目印も選びも置かない', () => {
    const { land, calls, session } = setup({ at: { stage: 'free' }, accept: false });
    expect(land(drawn)).toBe('refused');
    expect(calls).toEqual([]);
    expect(session.selected).toBeNull();
  });
});

describe('介入の入口 createIntervene (M27-03)', () => {
  const cmd: Command = { type: 'set_climate', rainScale: 1.1 };
  function world(dispatched: Command[]) {
    return { dispatch: (c: Command) => dispatched.push(c), snapshot: () => ({ tick: 30, year: 1 }) } as unknown as World;
  }

  it('訪問では受けない。自由モードは島へそのまま送る', () => {
    const dispatched: Command[] = [];
    const visiting = createIntervene({ session: sessionOf(world(dispatched), true), visiting: true, log: createMemorySink(), saveChronicle: () => undefined, flash: () => {} });
    expect(visiting(cmd)).toBe(false);
    const free = createIntervene({ session: sessionOf(world(dispatched), false), visiting: false, log: createMemorySink(), saveChronicle: () => undefined, flash: () => {} });
    expect(free(cmd)).toBe(true);
    expect(dispatched).toEqual([cmd]);
  });

  it('石板では記録器を通す。受けたら年代記を書き、力が足りずに弾かれたら cmd.rejected を残して石板を揺らす', () => {
    const calls: string[] = [];
    const log = createMemorySink();
    const session = sessionOf(world([]), false);
    let result: InterveneResult = { ok: true };
    session.recorder = { dispatch: () => result } as unknown as ChronicleRecorder<InterveneResult>;
    const intervene = createIntervene({ session, visiting: false, log, saveChronicle: () => void calls.push('save'), flash: () => calls.push('flash') });
    expect(intervene(cmd)).toBe(true);
    result = { ok: false, reason: 'budget' };
    expect(intervene(cmd)).toBe(false);
    result = { ok: false, reason: 'finished' };
    expect(intervene(cmd)).toBe(false);
    expect(calls).toEqual(['save', 'flash']);
    expect(log.records.map((r) => [r.event, r.reason])).toEqual([
      ['cmd.rejected', 'budget'],
      ['cmd.rejected', 'finished'],
    ]);
  });
});
