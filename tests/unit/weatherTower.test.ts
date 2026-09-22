import { describe, it, expect } from 'vitest';
import {
  canBuildTower,
  takeCrystal,
  towerCrystalPool,
  towerFactors,
  TOWER_CRYSTAL,
  TOWER_FAITH,
  TOWER_STAGE,
  type WeatherTower,
} from '../../src/simulation/weatherTower';
import type { CivState } from '../../src/simulation/civilization';
import { formatFaith } from '../../src/simulation/faith';
import { SEA_LEVEL } from '../../src/simulation/terrain';

const civ = (over: Partial<CivState> = {}): CivState => ({ speciesId: 'deer', stage: TOWER_STAGE, progress: 0, home: 5, population: 1, faith: 0.7, ...over });

describe('canBuildTower (M10-01 気象塔の門)', () => {
  const size = 4;
  const elevation = new Float32Array(size * size).fill(0.5);
  elevation[3] = 0.1; // 海セル (SEA_LEVEL 未満)
  const noTowers: WeatherTower[] = [];

  it('文明が無ければ拒否', () => {
    const r = canBuildTower(null, 0, 10, { elevation, towers: noTowers });
    expect(r).toEqual({ ok: false, reason: '文明がない' });
  });

  it('段階が塔 (TOWER_STAGE) に満たなければ拒否', () => {
    const r = canBuildTower(civ({ stage: TOWER_STAGE - 1 }), 0, 10, { elevation, towers: noTowers });
    expect(r).toEqual({ ok: false, reason: '段階が塔に満たない' });
  });

  it('信仰が TOWER_FAITH 未満なら拒否。理由に信仰の値を含む。境界値: ちょうど TOWER_FAITH なら通る (crystal/cell が満たされていれば)', () => {
    const low = canBuildTower(civ({ faith: TOWER_FAITH - 0.01 }), 0, 10, { elevation, towers: noTowers });
    expect(low).toEqual({ ok: false, reason: `信仰が足りない(信仰 ${formatFaith(TOWER_FAITH - 0.01)} < ${TOWER_FAITH})` });
    const exact = canBuildTower(civ({ faith: TOWER_FAITH }), 0, 10, { elevation, towers: noTowers });
    expect(exact).toEqual({ ok: true });
  });

  it('信仰 (faith) が undefined なら 0 扱いで拒否', () => {
    const c = civ();
    delete c.faith;
    const r = canBuildTower(c, 0, 10, { elevation, towers: noTowers });
    expect(r).toEqual({ ok: false, reason: `信仰が足りない(信仰 ${formatFaith(0)} < ${TOWER_FAITH})` });
  });

  it('セルが海なら拒否', () => {
    expect(elevation[3]).toBeLessThan(SEA_LEVEL);
    const r = canBuildTower(civ(), 3, 10, { elevation, towers: noTowers });
    expect(r).toEqual({ ok: false, reason: 'セルは海' });
  });

  it('そのセルに既に塔があれば拒否', () => {
    const towers: WeatherTower[] = [{ cell: 0, radius: 6, rainScale: 1.5, tempOffset: 0, active: true, year: 0 }];
    const r = canBuildTower(civ(), 0, 10, { elevation, towers });
    expect(r).toEqual({ ok: false, reason: 'そのセルには既に塔がある' });
    // 別のセルなら通る
    expect(canBuildTower(civ(), 1, 10, { elevation, towers })).toEqual({ ok: true });
  });

  it('輝石 (crystalAvailable) が TOWER_CRYSTAL 未満なら拒否。境界値: ちょうど TOWER_CRYSTAL なら通る', () => {
    const short = canBuildTower(civ(), 0, TOWER_CRYSTAL - 0.001, { elevation, towers: noTowers });
    expect(short).toEqual({ ok: false, reason: '輝石が足りない' });
    const exact = canBuildTower(civ(), 0, TOWER_CRYSTAL, { elevation, towers: noTowers });
    expect(exact).toEqual({ ok: true });
  });

  it('全ての門を満たせば ok:true', () => {
    expect(canBuildTower(civ(), 0, 10, { elevation, towers: noTowers })).toEqual({ ok: true });
  });
});

describe('towerCrystalPool (M10-01)', () => {
  it('home の採掘半径内の陸セルを集める (脈が無ければ既存の stepMining と同じ範囲)', () => {
    const size = 8;
    const elevation = new Float32Array(size * size).fill(0.5);
    const home = 3 * size + 3; // (3,3)
    const pool = towerCrystalPool(home, TOWER_STAGE, elevation, size, { ids: new Int32Array(size * size).fill(-1), cells: [] });
    expect(pool).toContain(home);
    // MINE_RADIUS[6] = 4 (civilization.ts) なので、島の角 (7,7)、home (3,3) から距離 √32≈5.7 は含まれない
    expect(pool).not.toContain(7 * size + 7);
  });

  it('半径に掛かる脈があれば、脈全体 (半径の外も含む) をまとめて集める', () => {
    const size = 8;
    const elevation = new Float32Array(size * size).fill(0.5);
    const home = 0;
    // home を含む脈 0 が、半径よりずっと遠いセルまで伸びている想定
    const ids = new Int32Array(size * size).fill(-1);
    const veinCellsList = [0, 1, 60, 63];
    for (const i of veinCellsList) ids[i] = 0;
    const pool = towerCrystalPool(home, TOWER_STAGE, elevation, size, { ids, cells: [veinCellsList] });
    for (const i of veinCellsList) expect(pool).toContain(i);
  });
});

describe('takeCrystal (M10-01)', () => {
  it('pool の合計が amount 以上なら残量に比例して取り除く', () => {
    const crystal = new Float32Array(4);
    crystal[0] = 1;
    crystal[1] = 3;
    const r = takeCrystal([0, 1], crystal, 2);
    expect(r).toEqual({ ok: true });
    // 合計 4 のうち 2 を比例配分 (k=0.5) で取り除く → 0:0.5, 1:1.5
    expect(crystal[0]).toBeCloseTo(0.5, 6);
    expect(crystal[1]).toBeCloseTo(1.5, 6);
  });

  it('pool の合計が amount 未満なら何も変えず ok:false', () => {
    const crystal = new Float32Array(4);
    crystal[0] = 0.2;
    crystal[1] = 0.3;
    const before = Array.from(crystal);
    const r = takeCrystal([0, 1], crystal, 1);
    expect(r).toEqual({ ok: false });
    expect(Array.from(crystal)).toEqual(before);
  });

  it('pool が空なら amount > 0 で ok:false', () => {
    const crystal = new Float32Array(4).fill(1);
    expect(takeCrystal([], crystal, 0.1)).toEqual({ ok: false });
  });
});

describe('towerFactors (M10-01)', () => {
  const size = 8;
  const n = size * size;

  it('塔が無ければ全セル既定 (rain 1・temp 0)', () => {
    const out = { rain: new Float32Array(n), temp: new Float32Array(n) };
    towerFactors([], size, out);
    expect(Array.from(out.rain)).toEqual(new Array(n).fill(1));
    expect(Array.from(out.temp)).toEqual(new Array(n).fill(0));
  });

  it('半径内だけ塔の rainScale/tempOffset になり、外は既定のまま', () => {
    const cell = 3 * size + 3;
    const towers: WeatherTower[] = [{ cell, radius: 2, rainScale: 1.5, tempOffset: 1.2, active: true, year: 0 }];
    const out = { rain: new Float32Array(n), temp: new Float32Array(n) };
    towerFactors(towers, size, out);
    expect(out.rain[cell]).toBeCloseTo(1.5, 5);
    expect(out.temp[cell]).toBeCloseTo(1.2, 5);
    // 半径 2 より遠いセル (島の角、(0,0)) は既定のまま
    const far = 0;
    expect(out.rain[far]).toBe(1);
    expect(out.temp[far]).toBe(0);
  });

  it('active:false の塔は効果 0 (既定のまま)', () => {
    const cell = 10;
    const towers: WeatherTower[] = [{ cell, radius: 2, rainScale: 1.5, tempOffset: 1, active: false, year: 0 }];
    const out = { rain: new Float32Array(n), temp: new Float32Array(n) };
    towerFactors(towers, size, out);
    expect(out.rain[cell]).toBe(1);
    expect(out.temp[cell]).toBe(0);
  });

  it('塔が重なるセルは、後で建てた (towers 配列の後ろの) 塔が勝つ', () => {
    const cell = 20;
    const towers: WeatherTower[] = [
      { cell, radius: 3, rainScale: 1.2, tempOffset: 0.5, active: true, year: 0 },
      { cell, radius: 3, rainScale: 2.0, tempOffset: -0.5, active: true, year: 1 },
    ];
    const out = { rain: new Float32Array(n), temp: new Float32Array(n) };
    towerFactors(towers, size, out);
    expect(out.rain[cell]).toBe(2.0);
    expect(out.temp[cell]).toBe(-0.5);
  });
});
