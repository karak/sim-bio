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
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { tempOffset: 0, rainScale: 1 }, civ: null, volcanoCell: 0, towers: [], ship: null, dreamEater: null, totals,
    layers: { elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
  });
  return { dispatch: (c: Command) => { cmds.push(c); }, snapshot, step: (t: number) => { tick += t; }, cmds };
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
  it('everyYears があって untilYear が無い予定は予言の年まで繰り返す (M10R レビュー: 以前は 1 回しか撃たなかった)', () => {
    const w = fakeWorld({ deer: 1 });
    const d: ScenarioDef = { ...def, years: 7, schedule: [{ atYear: 2, everyYears: 2, command: { type: 'sink', amount: 0.01 } }] };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 7; y++) { r.update(w.snapshot()); w.step(360); }
    // 2, 4, 6 年目の 3 回 (8 年目は予言の年を越える)
    expect(w.cmds.filter((c) => c.type === 'sink')).toHaveLength(3);
  });
  it('atYear 0 の予定は最初の update で無料で発火し、timeline に scheduled として残る (M10R-08、空の舟の民の林)', () => {
    const w = fakeWorld({ deer: 1 });
    const cmd: Command = { type: 'spawn_species', speciesId: 'grass', cell: 5, amount: 0.6, radius: 4 };
    const d: ScenarioDef = { ...def, schedule: [{ atYear: 0, command: cmd }] };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot()); // まだ 1 tick も進めていない最初の update (year 0)
    expect(w.cmds).toEqual([cmd]);
    expect(r.timeline()).toEqual([{ year: 0, kind: 'scheduled', command: cmd }]);
  });
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

describe('launch_ship (M10-03、ScenarioRunner)', () => {
  it('civ_edict と同じく力を消費せず (cost 0)、介入回数にも数えない', () => {
    const w = fakeWorld({ deer: 1 });
    const withBudget: ScenarioDef = { ...def, budget: { start: 10, incomePerYear: 0, costs: { spawn: 3, disaster: 5, climate: 1 }, upkeepPerYear: { rainScale: 0, tempOffset: 0 } } };
    const r = createScenarioRunner(withBudget, w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'launch_ship' })).toEqual({ ok: true });
    expect(r.power()).toBe(10); // 値段 0 なので力は減らない
    expect(r.interventions()).toBe(0); // 言葉であって行為ではないので数えない
    expect(w.cmds).toEqual([{ type: 'launch_ship' }]);
  });
});

describe('species_mean (runner)', () => {
  it('年ごとの totals を履歴に積み、species_mean が直近の平均で判定する', () => {
    const totals = { deer: 10 };
    const w = fakeWorld(totals);
    const d: ScenarioDef = { ...def, years: 4, schedule: [], dead: undefined, alive: { type: 'species_mean', ids: ['deer'], years: 3, min: 5 } };
    const r = createScenarioRunner(d, w);
    r.update(w.snapshot()); // y0: 10
    w.step(360); r.update(w.snapshot()); // y1: 10
    totals.deer = 0;
    w.step(360); r.update(w.snapshot()); // y2: 0
    w.step(360); r.update(w.snapshot()); // y3: 0
    totals.deer = 30;
    w.step(360); r.update(w.snapshot()); // y4: 30 → 直近 3 年 (0, 0, 30) 平均 10 ≥ 5
    expect(r.verdict().status).toBe('alive');
    expect(r.verdict().reason).toBe('群れが残った(3 年平均): deer 10.0');
    // referenceSize 4 の def を size 4 で回しているので areaScale は 1
  });
  it('直近の平均が低ければ dead', () => {
    const totals = { deer: 10 };
    const w = fakeWorld(totals);
    const d: ScenarioDef = { ...def, years: 4, schedule: [], dead: undefined, alive: { type: 'species_mean', ids: ['deer'], years: 3, min: 5 } };
    const r = createScenarioRunner(d, w);
    for (let y = 0; y <= 4; y++) { if (y >= 2) totals.deer = y === 4 ? 12 : 0; r.update(w.snapshot()); w.step(360); }
    // 直近 3 年 (0, 0, 12) 平均 4 < 5
    expect(r.verdict().status).toBe('dead');
    expect(r.verdict().reason).toContain('群れが小さい(3 年平均): deer 4.0 (< 5.0)');
  });
});
