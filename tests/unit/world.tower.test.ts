import { describe, it, expect } from 'vitest';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { TOWER_CRYSTAL, TOWER_FAITH, TOWER_RADIUS, TOWER_STAGE, TOWER_RAIN_SCALE_DEFAULT, towerCrystalPool } from '../../src/simulation/weatherTower';
import { formatFaith } from '../../src/simulation/faith';
import { testConfig, grass, moss } from './helpers';

/** testConfig() (seed 42, size 32) の陸で最も輝石が多いセル。塔の home に使う (M9-03 の edict テストと同じ流儀) */
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

/** testConfig() の陸で最も遠い (=輝石が無い可能性が高い) セル。輝石不足の門のテストに使う */
function someSeaCell(): number {
  const s = World.create(testConfig(), { log: createMemorySink() }).snapshot();
  const i = Array.from(s.layers.elevation).findIndex((e) => e < SEA_LEVEL);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe('World.dispatch(build_tower) の門 (M10-01)', () => {
  it('段階 < TOWER_STAGE なら拒否し、状態は変わらない (通常の採掘以上に輝石は減らない)', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const cfg = testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE - 1, home, faith: 0.9 } } });
    const w = World.create(cfg, { log });
    // 拒否されても通常の採掘 (stepMining) は進む。build_tower を送らない基準世界と比べて余分に減らないことを確かめる
    const baseline = World.create(cfg, { log: createMemorySink() });
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    baseline.step(1);
    const s = w.snapshot();
    expect(s.towers).toEqual([]);
    expect(s.layers.crystal[home]).toBeCloseTo(baseline.snapshot().layers.crystal[home], 6);
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: '段階が塔に満たない' });
  });

  it('信仰 < TOWER_FAITH なら拒否し、理由に信仰の値を含む。状態は変わらない', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: TOWER_FAITH - 0.1 } } }), { log });
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    const s = w.snapshot();
    expect(s.towers).toEqual([]);
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: `信仰が足りない(信仰 ${formatFaith(TOWER_FAITH - 0.1)} < ${TOWER_FAITH})` });
  });

  it('輝石が足りなければ拒否し、状態は変わらない (home 周りの採掘プールの合計が TOWER_CRYSTAL 未満の集落)', () => {
    const log = createMemorySink();
    // towerCrystalPool + World.veins/veinCells で実際のプールの合計を測り、TOWER_CRYSTAL 未満の陸セルを探す
    const probe = World.create(testConfig(), { log: createMemorySink() });
    const elevation = probe.snapshot().layers.elevation;
    let home = -1;
    for (let i = 0; i < elevation.length; i++) {
      if (elevation[i] < SEA_LEVEL) continue;
      const pool = towerCrystalPool(i, TOWER_STAGE, elevation, 32, { ids: probe.veins, cells: probe.veinCells });
      let total = 0;
      for (const j of pool) total += probe.crystal[j];
      if (total < TOWER_CRYSTAL) {
        home = i;
        break;
      }
    }
    expect(home).toBeGreaterThanOrEqual(0);
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log });
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    const s = w.snapshot();
    expect(s.towers).toEqual([]);
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: '輝石が足りない' });
  });

  it('セルが海なら拒否し、状態は変わらない', () => {
    const home = bestCrystalCell();
    const sea = someSeaCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log });
    w.dispatch({ type: 'build_tower', cell: sea });
    w.step(1);
    const s = w.snapshot();
    expect(s.towers).toEqual([]);
    const rejected = log.find('cmd.rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'セルは海' });
  });

  it('文明のない世界では拒否 (文明がない)', () => {
    const log = createMemorySink();
    const w = World.create(testConfig(), { log });
    w.dispatch({ type: 'build_tower', cell: 0 });
    w.step(1);
    expect(w.snapshot().towers).toEqual([]);
    expect(log.find('cmd.rejected')[0]).toMatchObject({ reason: '文明がない' });
  });
});

describe('World.dispatch(build_tower) の受理 (M10-01)', () => {
  it('全ての門を満たせば塔が建ち、脈から TOWER_CRYSTAL 分の輝石が (通常の採掘に加えて) 余分に減り、既定値 (半径・雨・気温) で塔が積まれ、ログが出る', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const cfg = testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } });
    const w = World.create(cfg, { log });
    // 通常の採掘 (stepMining) も同じ 1 tick で進むので、build_tower を送らない基準世界との差分で
    // TOWER_CRYSTAL 分だけが余分に減ったことを確かめる
    const baseline = World.create(cfg, { log: createMemorySink() });
    let crystalTotal = 0;
    let baselineTotal = 0;
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    baseline.step(1);
    const s = w.snapshot();
    const b = baseline.snapshot();
    expect(s.towers).toHaveLength(1);
    expect(s.towers[0]).toMatchObject({ cell: home, radius: TOWER_RADIUS, rainScale: TOWER_RAIN_SCALE_DEFAULT, tempOffset: 0, active: true });
    for (let i = 0; i < s.layers.crystal.length; i++) crystalTotal += s.layers.crystal[i];
    for (let i = 0; i < b.layers.crystal.length; i++) baselineTotal += b.layers.crystal[i];
    expect(baselineTotal - crystalTotal).toBeCloseTo(TOWER_CRYSTAL, 4);
    expect(log.find('cmd.rejected')).toHaveLength(0);
    const built = log.find('sim.tower.built');
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ cell: home, radius: TOWER_RADIUS, rainScale: TOWER_RAIN_SCALE_DEFAULT, tempOffset: 0 });
  });

  it('rainScale/tempOffset を指定すればその値で建つ', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    w.dispatch({ type: 'build_tower', cell: home, rainScale: 2, tempOffset: -1.5 });
    w.step(1);
    expect(w.snapshot().towers[0]).toMatchObject({ rainScale: 2, tempOffset: -1.5 });
  });

  it('同じセルに 2 つ目は建たない (そのセルには既に塔がある)', () => {
    const home = bestCrystalCell();
    const log = createMemorySink();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log });
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    expect(w.snapshot().towers).toHaveLength(1);
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    expect(w.snapshot().towers).toHaveLength(1);
    expect(log.find('cmd.rejected')[0]).toMatchObject({ reason: 'そのセルには既に塔がある' });
  });
});

describe('気象塔の局所気候 (M10-01)', () => {
  it('半径内は雨 (moisture) が増え、外は塔の無い世界と変わらない', () => {
    const home = bestCrystalCell();
    const withTower = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    const baseline = World.create(testConfig({ species: [grass, moss], civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    withTower.dispatch({ type: 'build_tower', cell: home, rainScale: 2, tempOffset: 3 });
    withTower.step(1);
    baseline.step(1);
    const s = withTower.snapshot();
    const b = baseline.snapshot();
    // 半径内 (home そのもの): 雨 (moisture) が上がり、気温も上がる
    expect(s.layers.moisture[home]).toBeGreaterThan(b.layers.moisture[home]);
    expect(s.layers.temperature[home]).toBeGreaterThan(b.layers.temperature[home]);
    // 半径のずっと外 (島の遠いセル) は塔の無い世界と変わらない
    let far = -1;
    for (let i = 0; i < s.layers.elevation.length; i++) {
      if (s.layers.elevation[i] >= SEA_LEVEL) {
        const x = i % 32;
        const y = (i - x) / 32;
        const hx = home % 32;
        const hy = (home - hx) / 32;
        if (Math.hypot(x - hx, y - hy) > TOWER_RADIUS + 4) {
          far = i;
          break;
        }
      }
    }
    expect(far).toBeGreaterThanOrEqual(0);
    expect(s.layers.moisture[far]).toBeCloseTo(b.layers.moisture[far], 6);
    expect(s.layers.temperature[far]).toBeCloseTo(b.layers.temperature[far], 6);
  });
});

describe('snapshot・保存 (M10-01)', () => {
  it('snapshot().towers に建てた塔が入る', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    expect(w.snapshot().towers).toEqual([]);
    w.dispatch({ type: 'build_tower', cell: home });
    w.step(1);
    expect(w.snapshot().towers).toHaveLength(1);
  });

  it('serialize → restore で towers と局所気候が保たれる', () => {
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    w.dispatch({ type: 'build_tower', cell: home, rainScale: 1.8 });
    w.step(1);
    const beforeTowers = w.snapshot().towers;
    const save = w.serialize();
    expect(save.towers).toEqual(beforeTowers);
    const r = World.restore(JSON.parse(JSON.stringify(save)), { log: createMemorySink() });
    const after = r.snapshot();
    expect(after.towers).toEqual(beforeTowers);
    // 局所気候も復元される: 同じ save から towers を抜いた「塔の無い世界」を同じやり方で restore し、
    // 塔ありの復元世界の方が home の雨 (moisture) が多いことで、rainFactor が復元後も効いていることを確かめる
    // (restore は保存した年の途中から気候を計算し直すので、保存直前の値そのものとは日にちの位相がわずかに違う)
    const saveNoTower = JSON.parse(JSON.stringify(save));
    delete saveNoTower.towers;
    const rNoTower = World.restore(saveNoTower, { log: createMemorySink() });
    expect(after.layers.moisture[home]).toBeGreaterThan(rNoTower.snapshot().layers.moisture[home]);
  });

  it('古いセーブ (towers 無し) は空配列として復元できる', () => {
    const w = World.create(testConfig(), { log: createMemorySink() });
    const save = w.serialize();
    delete save.towers;
    const r = World.restore(save, { log: createMemorySink() });
    expect(r.snapshot().towers).toEqual([]);
  });
});

describe('気象塔の維持費の切り替え tower_power (M10-01)', () => {
  it('active:false で全ての塔が止まり、局所気候が既定に戻る。active:true で再び効く', () => {
    // snapshot().layers は World の内部バッファをそのまま返す (コピーしない) ので、さらに step する前に
    // 比べたい値をスカラーとして取り出しておく (配列参照のまま後で比べると、後の step で書き換わってしまう)
    const home = bestCrystalCell();
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: TOWER_STAGE, home, faith: 0.9 } } }), { log: createMemorySink() });
    w.dispatch({ type: 'build_tower', cell: home, rainScale: 2 });
    w.step(1);
    expect(w.snapshot().towers[0].active).toBe(true);
    const activeMoisture = w.snapshot().layers.moisture[home];
    w.dispatch({ type: 'tower_power', active: false }, { fromStar: false });
    w.step(1);
    expect(w.snapshot().towers[0].active).toBe(false);
    const stoppedMoisture = w.snapshot().layers.moisture[home];
    expect(stoppedMoisture).toBeLessThan(activeMoisture);
    w.dispatch({ type: 'tower_power', active: true }, { fromStar: false });
    w.step(1);
    expect(w.snapshot().towers[0].active).toBe(true);
    const resumedMoisture = w.snapshot().layers.moisture[home];
    expect(resumedMoisture).toBeGreaterThan(stoppedMoisture);
  });
});
