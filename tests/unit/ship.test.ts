import { describe, it, expect } from 'vitest';
import {
  timberAround,
  canLaunchShip,
  stepShip,
  shipCrew,
  shipDone,
  aliveSpeciesCount,
  exportCargo,
  SHIP_STAGE,
  SHIP_CREW,
  SHIP_FAITH,
  SHIP_FOREST_MIN,
  SHIP_CUT,
  SHIP_NEED,
  type ShipState,
} from '../../src/simulation/ship';
import { POP_NEED } from '../../src/simulation/civilizationLoad';
import { populationAround } from '../../src/simulation/civilization';
import type { CivState } from '../../src/simulation/civilization';
import type { WorldSnapshot } from '../../src/simulation/types';
import { grass, forest } from './helpers';

const SIZE = 16;
const N = SIZE * SIZE;
const HOME = 8 * SIZE + 8;
const RADIUS = 5;
const land = new Float32Array(N).fill(0.5);
const mkCiv = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'deer', stage: SHIP_STAGE, progress: 0, home: HOME, population: 5, faith: 1, ...over });
const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

describe('空の舟 (M10-03): timberAround', () => {
  it('徴収半径内 (陸だけ) の森+鐘樹の密度を合計する。home が未設定 (-1) なら 0', () => {
    const forestPop = new Float32Array(N).fill(0.2);
    const belltreePop = new Float32Array(N).fill(0.1);
    const t = timberAround({ forest: forestPop, belltree: belltreePop }, HOME, RADIUS, land, SIZE);
    // 半径 5 の円内のセル数 × (0.2 + 0.1) と一致する (forEachInRadius と同じ円判定)
    let cells = 0;
    for (let y = -RADIUS; y <= RADIUS; y++) {
      for (let x = -RADIUS; x <= RADIUS; x++) {
        if (x * x + y * y <= RADIUS * RADIUS) cells++;
      }
    }
    expect(t).toBeCloseTo(cells * 0.3, 5);
    expect(timberAround({ forest: forestPop }, -1, RADIUS, land, SIZE)).toBe(0);
  });
  it('belltree レイヤーが無い世界では森だけを数える', () => {
    const forestPop = new Float32Array(N).fill(0.4);
    const t = timberAround({ forest: forestPop }, HOME, RADIUS, land, SIZE);
    expect(t).toBeGreaterThan(0);
    expect(timberAround({}, HOME, RADIUS, land, SIZE)).toBe(0);
  });
});

describe('空の舟 (M10-03): canLaunchShip', () => {
  it('文明が無い・段階が帆に満たない・信仰不足・材不足・二重着工/既発進をそれぞれの理由で拒否する', () => {
    expect(canLaunchShip(null, 100, null)).toEqual({ ok: false, reason: '文明がない' });
    expect(canLaunchShip(mkCiv({ stage: SHIP_STAGE - 1 }), 100, null)).toEqual({ ok: false, reason: '段階が帆に満たない' });
    const lowFaith = canLaunchShip(mkCiv({ faith: SHIP_FAITH - 0.01 }), 100, null);
    expect(lowFaith.ok).toBe(false);
    if (!lowFaith.ok) expect(lowFaith.reason).toContain('信仰が足りない');
    const lowTimber = canLaunchShip(mkCiv(), SHIP_FOREST_MIN - 0.1, null);
    expect(lowTimber.ok).toBe(false);
    if (!lowTimber.ok) expect(lowTimber.reason).toContain('材が足りない');
    expect(canLaunchShip(mkCiv(), 100, { startedYear: 0, progress: 3 })).toEqual({ ok: false, reason: '舟は既に建造中' });
    expect(canLaunchShip(mkCiv(), 100, { startedYear: 0, progress: SHIP_NEED, launchedYear: 5 })).toEqual({ ok: false, reason: '舟は既に飛び立った' });
  });
  it('全ての門を満たせば ok', () => {
    expect(canLaunchShip(mkCiv(), SHIP_FOREST_MIN, null)).toEqual({ ok: true });
  });
});

describe('空の舟 (M10-03): stepShip', () => {
  it('材 × SHIP_CUT を伐って進みに積み、伐った分だけ森・鐘樹の密度が減る', () => {
    const forestPop = new Float32Array(N).fill(0.2);
    const before = sum(forestPop);
    const ship: ShipState = { startedYear: 0, progress: 0 };
    const r = stepShip(ship, { forest: forestPop }, HOME, RADIUS, land, SIZE);
    const timber = timberAround({ forest: new Float32Array(N).fill(0.2) }, HOME, RADIUS, land, SIZE);
    expect(r.cut).toBeCloseTo(timber * SHIP_CUT, 5);
    expect(r.ship.progress).toBeCloseTo(r.cut, 5);
    expect(before - sum(forestPop)).toBeCloseTo(r.cut, 4);
  });
  it('合計の伐採量が残りの必要量 (SHIP_NEED − progress) を超えるなら、そこで頭打ちにする', () => {
    const forestPop = new Float32Array(N).fill(1); // 潤沢な材
    const ship: ShipState = { startedYear: 0, progress: SHIP_NEED - 0.05 };
    const r = stepShip(ship, { forest: forestPop }, HOME, RADIUS, land, SIZE);
    expect(r.cut).toBeCloseTo(0.05, 6);
    expect(r.ship.progress).toBeCloseTo(SHIP_NEED, 6);
  });
  it('材が 0 の年は何も変わらない (進みは頭打ちのまま)', () => {
    const forestPop = new Float32Array(N).fill(0);
    const ship: ShipState = { startedYear: 0, progress: 1 };
    const r = stepShip(ship, { forest: forestPop }, HOME, RADIUS, land, SIZE);
    expect(r.cut).toBe(0);
    expect(r.ship.progress).toBe(1);
  });
  it('既に飛び立っていれば何もしない (unchanged)', () => {
    const forestPop = new Float32Array(N).fill(1);
    const ship: ShipState = { startedYear: 0, progress: SHIP_NEED, launchedYear: 3 };
    const r = stepShip(ship, { forest: forestPop }, HOME, RADIUS, land, SIZE);
    expect(r.cut).toBe(0);
    expect(r.ship).toEqual(ship);
    expect(sum(forestPop)).toBeCloseTo(N, 4);
  });
});

describe('乗せる民 (M10R-04): SHIP_CREW / shipCrew', () => {
  it('SHIP_CREW は POP_NEED[SHIP_STAGE] (帆) と同値', () => {
    expect(SHIP_CREW).toBe(POP_NEED[SHIP_STAGE]);
  });
  it('shipCrew は populationAround (SUPPORT_RADIUS) と同じ値を返す (populationFor が段階 帆 では populationAround に委ねるため)', () => {
    const pops = new Float32Array(N).fill(0.2);
    expect(shipCrew(pops, HOME, land, SIZE)).toBeCloseTo(populationAround(pops, HOME, land, SIZE), 6);
    expect(shipCrew(pops, HOME, land, SIZE)).toBeGreaterThan(0);
  });
  it('home が未設定 (-1) なら 0', () => {
    expect(shipCrew(new Float32Array(N).fill(0.2), -1, land, SIZE)).toBe(0);
  });
});

describe('空の舟 (M10-03): shipDone', () => {
  it('進みが SHIP_NEED に達したかどうかを返す', () => {
    expect(shipDone({ startedYear: 0, progress: SHIP_NEED - 0.01 })).toBe(false);
    expect(shipDone({ startedYear: 0, progress: SHIP_NEED })).toBe(true);
    expect(shipDone({ startedYear: 0, progress: SHIP_NEED + 1 })).toBe(true);
  });
});

const mkSnapshot = (totals: Record<string, number>): WorldSnapshot => {
  const n = 4;
  const elevation = new Float32Array(n).fill(0.5);
  const pop = (t: number) => new Float32Array(n).fill(t / n);
  return {
    tick: 0, year: 3, dayOfYear: 0, size: 2, species: [grass, forest], meanTemperature: 10, co2: 280,
    climate: { tempOffset: 0, rainScale: 1 }, civ: null, volcanoCell: 0, towers: [], ship: null, dreamEater: null,
    totals,
    layers: {
      elevation, temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n),
      vitality: new Float32Array(n), litter: new Float32Array(n), crystal: new Float32Array(n),
      populations: { grass: pop(totals.grass ?? 0), forest: pop(totals.forest ?? 0) },
    },
  };
};

describe('空の舟 (M10-03): aliveSpeciesCount / exportCargo', () => {
  it('aliveSpeciesCount は総量 > 0 の種だけを数える', () => {
    expect(aliveSpeciesCount(mkSnapshot({ grass: 10, forest: 0 }))).toBe(1);
    expect(aliveSpeciesCount(mkSnapshot({ grass: 10, forest: 5 }))).toBe(2);
    expect(aliveSpeciesCount(mkSnapshot({ grass: 0, forest: 0 }))).toBe(0);
  });
  it('exportCargo の JSON の形を固定する: version・year・size・species (生きている種だけ、id/total/density の密な配列)・civ', () => {
    const s = mkSnapshot({ grass: 10, forest: 0 });
    const cargo = exportCargo(s);
    expect(cargo).toEqual({
      version: 1,
      year: 3,
      size: 2,
      species: [{ id: 'grass', total: 10, density: [2.5, 2.5, 2.5, 2.5] }],
      civ: null,
    });
    // civ があればそのままコピーされる (生きた種の数え上げには使わない)
    const civ: CivState = { speciesId: 'deer', stage: 5, progress: 0, home: 0, population: 1 };
    const withCiv = exportCargo({ ...s, civ });
    expect(withCiv.civ).toEqual(civ);
    expect(withCiv.civ).not.toBe(civ); // コピーであって参照そのものではない
  });
});
