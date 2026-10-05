import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import { stepByYear } from '../../src/scenario/stepByYear';
import type { ScenarioDef } from '../../src/scenario/types';
import { devSessionOf } from '../../src/dev/session';
import { resumeIsland } from '../fixtures/resumeIsland';

const session = (q: string) => devSessionOf(new URLSearchParams(q));

/** 石板を years 年まで回した判定。近道の def は scenarioDef で差し替える */
function verdictAfter(def: ScenarioDef, config: ReturnType<typeof resumeIsland>['config'], years: number) {
  const world = World.create(config, { log: createMemorySink() });
  const runner = createScenarioRunner(def, world, { ticksPerYear: config.ticksPerYear });
  runner.update(world.snapshot());
  stepByYear(world, runner, years * config.ticksPerYear);
  return { status: runner.verdict().status, year: runner.yearOf(world.snapshot()) };
}

describe('開発用の指定 (M19-16)', () => {
  it('?player=<名前> で、置き場の DB の名前と港への名乗りを見守り手ごとに分ける', () => {
    expect(session('player=alice').player).toEqual({ name: 'alice', dbName: 'biotope-island@alice', headers: { 'x-dev-sender': 'alice' } });
    expect(session('player=Bob_2-x').player?.dbName).toBe('biotope-island@Bob_2-x');
  });

  it.each(['', 'player=', 'player=../x', 'player=a%20b', `player=${'a'.repeat(25)}`])('名前として読めない指定 (%s) は、既定の見守り手のまま', (q) => {
    expect(session(q).player).toBeUndefined();
  });

  it('状態を送る先は既定で受入の画面 (5392)。?acceptance= は手元の http の URL だけ受ける', () => {
    expect(session('dev=1').acceptanceUrl).toBe('http://localhost:5392');
    expect(session('acceptance=http://127.0.0.1:5999/x').acceptanceUrl).toBe('http://127.0.0.1:5999');
    expect(session('acceptance=https://evil.example').acceptanceUrl).toBe('http://localhost:5392');
    expect(session('acceptance=not a url').acceptanceUrl).toBe('http://localhost:5392');
  });

  it('?clock=<ms> で描きの時計を固定する (M25-02: ピンの上下と観察画面の t が画を撮るたびに違わないように)。指定が無い・数でなければ実時間のまま (undefined)', () => {
    expect(session('clock=400').clock?.()).toBe(400);
    expect(session('clock=400').clock?.()).toBe(400);
    expect(session('clock=0').clock?.()).toBe(0);
    expect(session('').clock).toBeUndefined();
    expect(session('clock=abc').clock).toBeUndefined();
    expect(session('clock=-5').clock).toBeUndefined();
  });

  it('?paused=1 で止めた島から始める (M25-02: 撮るとき、読み込みの間に進んだ tick が回ごとに違わないように)', () => {
    expect(session('paused=1').paused).toBe(true);
    expect(session('paused=0').paused).toBe(false);
    expect(session('').paused).toBe(false);
  });

  it('?dev=1 のときだけ速さの札に 1000x を足す', () => {
    expect(session('dev=1').speeds).toEqual([0, 1, 10, 100, 1000]);
    expect(session('scenario=sinking').speeds).toBeUndefined();
  });

  it('?shortcut=alive の近道は、沈む欠片でも次の年の境目で alive にする。近道でなければ石板のまま', () => {
    const { def, config } = resumeIsland('sinking', 12);
    const shortcut = session('scenario=sinking&shortcut=alive');

    expect(shortcut.shortcut).toBe(true);
    expect(verdictAfter(shortcut.scenarioDef(def), config, 3)).toEqual({ status: 'alive', year: 1 });
    expect(session('scenario=sinking').shortcut).toBe(false);
    expect(session('scenario=sinking').scenarioDef(def)).toBe(def);
    expect(verdictAfter(def, config, 1)).toEqual({ status: 'running', year: 1 });
  });
});
