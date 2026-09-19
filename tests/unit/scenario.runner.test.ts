import { describe, it, expect } from 'vitest';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import { grass } from './helpers';

const fakeWorld = (totals: Record<string, number>) => {
  let tick = 0;
  const cmds: Command[] = [];
  const size = 4;
  const n = size * size;
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, totals,
    layers: { elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), populations: { grass: new Float32Array(n) } },
  });
  return { dispatch: (c: Command) => cmds.push(c), snapshot, step: (t: number) => { tick += t; }, cmds };
};
const def: ScenarioDef = {
  id: 't', title: 't', prophecy: 'p', kind: 'endure', years: 5, referenceSize: 4,
  schedule: [
    { atYear: 2, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 1 } },
    { atYear: 1, everyYears: 1, untilYear: 3, command: { type: 'sink', amount: 0.01 } },
  ],
  alive: { type: 'species_alive', ids: ['deer'] },
  dead: { type: 'species_extinct', ids: ['deer'] },
};

describe('createScenarioRunner', () => {
  it('fires scheduled commands once at their year, resolves cell -1 to the center, and counts interventions', () => {
    const w = fakeWorld({ deer: 1 });
    const r = createScenarioRunner(def, w);
    r.update(w.snapshot());
    expect(w.cmds).toHaveLength(0);
    w.step(360);
    r.update(w.snapshot());
    r.update(w.snapshot());
    expect(w.cmds).toEqual([{ type: 'sink', amount: 0.01 }]);
    w.step(360);
    r.update(w.snapshot());
    // schedule の並び順に発火する: 隕石 (idx 0) → 沈降 (idx 1)
    expect(w.cmds).toHaveLength(3);
    expect(w.cmds[1]).toEqual({ type: 'disaster', kind: 'meteor', cell: 2 * 4 + 2, radius: 1 });
    expect(w.cmds[2]).toEqual({ type: 'sink', amount: 0.01 });
    w.step(360);
    r.update(w.snapshot());
    expect(w.cmds).toHaveLength(4);
    // 判定が確定する前の介入は数えられる
    r.intervene({ type: 'set_climate', tempOffset: 1 });
    expect(r.interventions()).toBe(1);
    expect(w.cmds).toHaveLength(5);
  });
  it('judges yearly: alive at the target year, dead when the condition hits, then stops', () => {
    const totals = { deer: 1 };
    const w = fakeWorld(totals);
    const verdicts: string[] = [];
    const r = createScenarioRunner(def, w, { onVerdict: (v) => verdicts.push(v.status) });
    for (let y = 0; y < 5; y++) { w.step(360); expect(r.update(w.snapshot()).status).toBe(y < 4 ? 'running' : 'alive'); }
    expect(verdicts).toEqual(['alive']);
    const w2 = fakeWorld({ deer: 0 });
    const r2 = createScenarioRunner(def, w2);
    w2.step(360);
    expect(r2.update(w2.snapshot()).status).toBe('dead');
    r2.intervene({ type: 'set_climate', tempOffset: 1 });
    expect(r2.interventions()).toBe(0);
  });
});
