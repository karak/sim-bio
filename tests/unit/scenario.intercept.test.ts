import { describe, it, expect } from 'vitest';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import type { CivState } from '../../src/simulation/civilization';
import { INTERCEPT_NEED } from '../../src/simulation/works';
import { grass } from './helpers';

/**
 * 迎撃 (M10-02) の ScenarioRunner 側: 予定隕石の取り消し、年表、節目、intervene の弾き方。
 * 偽の world (scenario.budget.test と同じ流儀) で civ の状態を直接与える。
 */
const fakeWorld = (civ: Partial<CivState> | null) => {
  let tick = 0;
  const cmds: Command[] = [];
  const size = 4;
  const n = size * size;
  let c: CivState | null = civ ? { speciesId: 'deer', stage: 7, progress: 0, home: 0, population: 0, ...civ } : null;
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { rainScale: 1, tempOffset: 0 }, totals: { grass: 1 },
    layers: { elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n).fill(1), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
    civ: c ? { ...c } : null,
    volcanoCell: 0,
    towers: [],
    ship: null,
    dreamEater: null,
  });
  return { dispatch: (cmd: Command) => { cmds.push(cmd); }, snapshot, step: (t: number) => { tick += t; }, cmds, setCiv: (v: Partial<CivState>) => { c = { ...c!, ...v }; } };
};
const def: ScenarioDef = {
  id: 't', title: 't', prophecy: 'p', kind: 'prevent', start: { seed: 1, size: 4 }, years: 10, referenceSize: 4,
  schedule: [
    { atYear: 1, everyYears: 1, untilYear: 10, command: { type: 'sink', amount: 0.001 } },
    { atYear: 6, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 2 } },
    { atYear: 8, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 2 } },
  ],
  milestones: [{ atYear: 6, text: '星が落ちる' }, { atYear: 8, text: '二つ目の星' }, { atYear: 10, text: '判定' }],
  alive: { type: 'year_reached', year: 10 },
};
const stock = (v: number) => ({ works: { stock: v, stopped: false } });

describe('迎撃 (M10-02、ScenarioRunner)', () => {
  it('取り消せる予定隕石が無ければ no_target。星でない・備蓄不足なら rejected (どちらも world に流さず、介入にも数えない)', () => {
    const w0 = fakeWorld(stock(10));
    const r0 = createScenarioRunner({ ...def, schedule: [def.schedule[0]] }, w0);
    r0.update(w0.snapshot());
    expect(r0.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'no_target' });
    const w1 = fakeWorld({ stage: 6, ...stock(10) });
    const r1 = createScenarioRunner(def, w1);
    r1.update(w1.snapshot());
    expect(r1.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    const w2 = fakeWorld(stock(INTERCEPT_NEED - 0.1));
    const r2 = createScenarioRunner(def, w2);
    r2.update(w2.snapshot());
    expect(r2.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    expect(w2.cmds.filter((c) => c.type === 'intercept')).toHaveLength(0);
    expect(r2.interventions()).toBe(0);
    expect(r2.nextMeteorYear()).toBe(6);
  });
  it('条件を満たせば次の隕石 (最も早い単発) を取り消す: world に intercept が流れ、その年の隕石は発火せず、年表に intercepted、節目から消える', () => {
    const w = fakeWorld(stock(INTERCEPT_NEED));
    const r = createScenarioRunner(def, w);
    r.update(w.snapshot());
    expect(r.milestones().map((m) => m.atYear)).toEqual([6, 8, 10]);
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: true });
    expect(w.cmds.filter((c) => c.type === 'intercept')).toHaveLength(1);
    expect(r.interventions()).toBe(1);
    expect(r.timeline().filter((e) => e.kind === 'intercepted')).toEqual([{ year: 0, kind: 'intercepted', atYear: 6 }]);
    expect(r.milestones().map((m) => m.atYear)).toEqual([8, 10]);
    expect(r.nextMeteorYear()).toBe(8);
    // 世界側で備蓄が消費された (偽の world では手で減らす) あとは、二つ目は撃てない
    w.setCiv(stock(0));
    for (let y = 1; y <= 7; y++) { w.step(360); r.update(w.snapshot()); }
    const meteors = w.cmds.filter((c) => c.type === 'disaster' && c.kind === 'meteor');
    expect(meteors).toHaveLength(0);
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    w.step(360); r.update(w.snapshot());
    // 8 年目の二つ目は予定どおり落ちる
    expect(w.cmds.filter((c) => c.type === 'disaster' && c.kind === 'meteor')).toHaveLength(1);
    expect(r.timeline().filter((e) => e.kind === 'scheduled')).toHaveLength(1);
  });
  it('既に落ちた隕石や毎年の進行は対象にならない。判定が確定していれば finished', () => {
    const w = fakeWorld(stock(10));
    const r = createScenarioRunner(def, w);
    for (let y = 0; y <= 6; y++) { r.update(w.snapshot()); w.step(360); }
    // 6 年目の隕石は発火済み → 次は 8 年目
    expect(r.nextMeteorYear()).toBe(8);
    for (let y = 7; y <= 11; y++) { r.update(w.snapshot()); w.step(360); }
    expect(r.verdict().status).not.toBe('running');
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'finished' });
  });
});

describe('迎撃 (M10 レビュー): 同じ step 内の連打', () => {
  it('備蓄 3.0 で停止中に 2 回撃っても、2 回目は rejected (まだ適用されていない 1 回目の分を備蓄から引いて判定)。World が適用して備蓄が戻れば撃てる', () => {
    const w = fakeWorld({ works: { stock: INTERCEPT_NEED * 2 - 0.5, stopped: false } });
    const r = createScenarioRunner(def, w);
    r.update(w.snapshot());
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: true });
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    expect(r.milestones().map((m) => m.atYear)).toEqual([8, 10]);
    expect(w.cmds.filter((c) => c.type === 'intercept')).toHaveLength(1);
    // World が 1 回目を適用 (intercepted 1、備蓄 2.5 → 2.5) → pending が消え、備蓄が足りないので撃てない。積み増して 3.0 になれば撃てる
    w.setCiv({ intercepted: 1, works: { stock: INTERCEPT_NEED - 0.5, stopped: false } });
    r.update(w.snapshot());
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    w.setCiv({ intercepted: 1, works: { stock: INTERCEPT_NEED, stopped: false } });
    r.update(w.snapshot());
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: true });
    expect(r.milestones().map((m) => m.atYear)).toEqual([10]);
  });
  it('World の dispatch が拒否 (ok:false) を返せば、予定は取り消さず年表にも積まない', () => {
    const w = fakeWorld({ works: { stock: INTERCEPT_NEED, stopped: false } });
    const w2 = { ...w, dispatch: (cmd: Command) => { w.cmds.push(cmd); return { ok: false as const, reason: '段階が星に満たない' }; } };
    const r = createScenarioRunner(def, w2);
    r.update(w2.snapshot());
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: false, reason: 'rejected' });
    expect(r.milestones().map((m) => m.atYear)).toEqual([6, 8, 10]);
    expect(r.timeline().filter((e) => e.kind === 'intercepted')).toHaveLength(0);
    expect(r.interventions()).toBe(0);
  });
});
