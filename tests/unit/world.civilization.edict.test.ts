import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { applyEdict, EDICT_FAITH } from '../../src/simulation/edict';
import { UNREST_FAITH, UNREST_FAITH_AFTER, UNREST_YEARS } from '../../src/simulation/unrest';
import { SUPPORT_RADIUS, type CivState } from '../../src/simulation/civilization';
import { forEachInRadius } from '../../src/simulation/disaster';
import { testConfig, grass, moss } from './helpers';

/** testConfig() の地形 (seed 42, size 32) の陸で最も輝石が多いセル */
function bestCrystalCell(): number {
  const s = World.create(testConfig(), { log: createMemorySink() }).snapshot();
  let home = -1;
  let best = 0;
  for (let i = 0; i < s.layers.crystal.length; i++) {
    if (s.layers.elevation[i] >= SEA_LEVEL && s.layers.crystal[i] > best) {
      best = s.layers.crystal[i];
      home = i;
    }
  }
  expect(home).toBeGreaterThanOrEqual(0);
  return home;
}

const civ = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'grass', stage: 3, progress: 0, home: 5, population: 1, ...over });

describe('applyEdict (M9-03 勅令、純粋関数)', () => {
  it('信仰 >= EDICT_FAITH なら従い miningStopped を切り替える。境界値: ちょうど EDICT_FAITH で従う', () => {
    const r = applyEdict(civ({ faith: EDICT_FAITH }), 'stop_mining', 3);
    expect(r.obeyed).toBe(true);
    expect(r.civ.miningStopped).toBe(true);
    expect(r.civ.edict).toEqual({ kind: 'stop_mining', year: 3, obeyed: true, faith: EDICT_FAITH });
    const back = applyEdict(r.civ, 'resume_mining', 4);
    expect(back.obeyed).toBe(true);
    expect(back.civ.miningStopped).toBe(false);
  });
  it('信仰が足りなければ従わず、状態は変えないが edict に記録が残る。信仰が無ければ 0 扱い', () => {
    const r = applyEdict(civ({ faith: EDICT_FAITH - 0.01 }), 'stop_mining', 3);
    expect(r.obeyed).toBe(false);
    expect(r.civ.miningStopped).toBeUndefined();
    expect(r.civ.edict?.obeyed).toBe(false);
    expect(applyEdict(civ(), 'stop_mining', 1).obeyed).toBe(false);
  });
  it('文明が無い (stage 0) なら何も起きない', () => {
    const c = civ({ stage: 0, faith: 1 });
    const r = applyEdict(c, 'stop_mining', 1);
    expect(r.obeyed).toBe(false);
    expect(r.civ).toBe(c);
  });
});

describe('World の勅令の配線 (M9-03)', () => {
  it('信仰 >= 0.6 なら「採掘を止めよ」で効いた年から採掘が 0 になり、輝石が減らない。「再開せよ」で再び減る', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 3, home, faith: 0.7 } } }), { log });
    w.step(360);
    const before = w.snapshot().layers.crystal[home];
    w.step(360);
    expect(w.snapshot().layers.crystal[home]).toBeLessThan(before);
    w.dispatch({ type: 'civ_edict', edict: 'stop_mining' });
    w.step(1);
    expect(w.snapshot().civ?.miningStopped).toBe(true);
    const stopped = w.snapshot().layers.crystal[home];
    const progress = w.snapshot().civ?.progress;
    w.step(360);
    expect(w.snapshot().layers.crystal[home]).toBe(stopped);
    // 進みも止まる (掘った分は残るが増えない)
    expect(w.snapshot().civ?.progress).toBe(progress);
    const edicts = log.find('sim.civ.edict');
    expect(edicts).toHaveLength(1);
    expect(edicts[0]).toMatchObject({ edict: 'stop_mining', obeyed: true, miningStopped: true });
    w.dispatch({ type: 'civ_edict', edict: 'resume_mining' });
    w.step(360);
    expect(w.snapshot().civ?.miningStopped).toBe(false);
    expect(w.snapshot().layers.crystal[home]).toBeLessThan(stopped);
  });
  it('信仰が 0.6 未満なら民は聞かず、採掘は続く。ログに obeyed false', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 3, home, faith: 0.5 } } }), { log });
    w.step(360);
    w.dispatch({ type: 'civ_edict', edict: 'stop_mining' });
    w.step(1);
    const s = w.snapshot();
    expect(s.civ?.miningStopped).toBeUndefined();
    expect(s.civ?.edict).toMatchObject({ kind: 'stop_mining', obeyed: false });
    const c = s.layers.crystal[home];
    w.step(360);
    expect(w.snapshot().layers.crystal[home]).toBeLessThan(c);
    expect(log.find('sim.civ.edict')[0]).toMatchObject({ obeyed: false });
  });
  it('文明のない世界では勅令は何も起こさない', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.dispatch({ type: 'civ_edict', edict: 'stop_mining' });
    w.step(1);
    expect(w.snapshot().civ).toBeNull();
    expect(log.find('sim.civ.edict')).toHaveLength(0);
  });
  it('miningStopped と edict は serialize → restore で一致する', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 3, home, faith: 0.8 } } }), { log: createMemorySink() });
    w.step(360);
    w.dispatch({ type: 'civ_edict', edict: 'stop_mining' });
    w.step(1);
    const r = World.restore(w.serialize(), { log: createMemorySink() });
    expect(r.snapshot().civ).toEqual(w.snapshot().civ);
    expect(r.snapshot().civ?.miningStopped).toBe(true);
  });
  it('start.faith の指定があれば FAITH_INITIAL の代わりにその値で始まる', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 3, home, faith: 0.9 } } }), { log: createMemorySink() });
    expect(w.snapshot().civ?.faith).toBe(0.9);
  });
});

describe('World の内乱の配線 (M9-03)', () => {
  it('信仰 < 0.3 が 3 年続くと集落の民が半減し段階 −1、信仰は 0.4 に戻る。ログ sim.civ.unrest', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    // 介入が無ければ減衰だけで 0.3 を割るのに年数がかかるので、開始の信仰を閾値のすぐ下に置く
    const w = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass', start: { stage: 3, home, faith: UNREST_FAITH - 0.05 } } }), { log });
    const size = 32;
    const popBefore = (): number => {
      const s = w.snapshot();
      let sum = 0;
      forEachInRadius(home, SUPPORT_RADIUS, size, (i) => { if (s.layers.elevation[i] >= SEA_LEVEL) sum += s.layers.populations.grass[i]; });
      return sum;
    };
    w.step(360 * (UNREST_YEARS - 1));
    expect(log.find('sim.civ.unrest')).toHaveLength(0);
    expect(w.snapshot().civ?.stage).toBe(3);
    const pop = popBefore();
    w.step(360);
    const s = w.snapshot();
    expect(log.find('sim.civ.unrest')).toHaveLength(1);
    expect(log.find('sim.civ.unrest')[0]).toMatchObject({ from: 3, to: 2 });
    expect(log.find('sim.civ.stage').some((e) => e.reason === 'unrest')).toBe(true);
    expect(s.civ?.stage).toBe(2);
    expect(s.civ?.faith).toBe(UNREST_FAITH_AFTER);
    // 半減の直後 1 tick 分の成長は入るが、半分に近い
    expect(popBefore()).toBeLessThan(pop * 0.6);
  });
  it('信仰が戻れば連続が切れて内乱は起きない', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass', start: { stage: 3, home, faith: UNREST_FAITH - 0.05 } } }), { log });
    w.step(360 * (UNREST_YEARS - 1));
    // 2 年低い → 祈りに応える形で信仰を戻す (儀式では間に合わないので直接 restore で書き換える)
    const save = w.serialize();
    save.civ!.faith = 0.5;
    const r = World.restore(save, { log });
    r.step(360 * 2);
    expect(log.find('sim.civ.unrest')).toHaveLength(0);
    expect(r.snapshot().civ?.stage).toBe(3);
  });
});
