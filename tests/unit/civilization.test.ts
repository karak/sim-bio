import { describe, it, expect } from 'vitest';
import {
  checkEmergence,
  cellDistance,
  pickHomeCandidate,
  trackHomeCandidate,
  type EmergenceInput,
  populationAround,
  resolveCivilizationStart,
  stepMining,
  MINE_RADIUS,
  MINE_RATE,
  NEED,
  MAX_STAGE,
  SUPPORT_RADIUS,
  EMERGE_VEGETATION,
  type CivState,
} from '../../src/simulation/civilization';
import { SEA_LEVEL } from '../../src/simulation/terrain';

/** 10 年分、同じ値の履歴 (振動なし) */
const stableHistory = (v: number, years = 10): number[] => Array.from({ length: years }, () => v);
/** 振幅比が EMERGE_AMPLITUDE (0.15) を超える履歴 (山と谷を繰り返す) */
const oscillatingHistory = (): number[] => Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 10 : 100));

/** 発生判定の入力の既定 (島の平均 0.5 の島で、候補の植生 0.9、近くに輝石あり) */
const emergeInput = (over: Partial<EmergenceInput> = {}): EmergenceInput => ({ candidateVegetation: 0.9, islandVegetation: 0.5, hasCrystal: true, ...over });

describe('checkEmergence', () => {
  it('履歴が 10 年未満なら発生しない', () => {
    expect(checkEmergence(stableHistory(5, 9), emergeInput())).toBe(false);
  });
  it('振動している種 (振幅比 >= 0.15) では植生が十分でも発生しない', () => {
    const history = oscillatingHistory();
    expect(history.length).toBe(10);
    expect(checkEmergence(history, emergeInput())).toBe(false);
  });
  it('安定していても候補の植生が島の平均 × EMERGE_VEGETATION 以下なら発生しない (M9-00: 相対値)', () => {
    expect(checkEmergence(stableHistory(5), emergeInput({ candidateVegetation: EMERGE_VEGETATION * 0.5, islandVegetation: 0.5 }))).toBe(false);
    expect(checkEmergence(stableHistory(5), emergeInput({ candidateVegetation: 0.1, islandVegetation: 0.5 }))).toBe(false);
  });
  it('候補の植生が島の平均 × EMERGE_VEGETATION をわずかでも超えれば発生する (境界値)', () => {
    expect(checkEmergence(stableHistory(5), emergeInput({ candidateVegetation: EMERGE_VEGETATION * 0.5 + 1e-6, islandVegetation: 0.5 }))).toBe(true);
    // 島全体が痩せていれば絶対値が低くても発生する (実測の 0.18 は島の平均 0.2 前後の 0.4 倍を超える)
    expect(checkEmergence(stableHistory(5), emergeInput({ candidateVegetation: 0.18, islandVegetation: 0.2 }))).toBe(true);
  });
  it('近くに輝石が無ければ安定して植生があっても発生しない (M9-00)', () => {
    expect(checkEmergence(stableHistory(5), emergeInput({ hasCrystal: false }))).toBe(false);
  });
  it('10 年以上安定 (振幅比 < 0.15) かつ植生 > 島の平均 × 0.4 かつ輝石ありなら発生する', () => {
    expect(checkEmergence(stableHistory(5), emergeInput({ candidateVegetation: 0.5 }))).toBe(true);
  });
});

describe('pickHomeCandidate / cellDistance (M9-00)', () => {
  const size = 9;
  const mkLand = () => new Float32Array(size * size).fill(0.5);
  it('密度最大の陸セルでも採掘半径 MINE_RADIUS[1] 以内に輝石が無ければ候補にならず、輝石の近い次点が候補になる', () => {
    const elevation = mkLand();
    const pops = new Float32Array(size * size);
    const crystal = new Float32Array(size * size);
    pops[0] = 1.0; // 左上: 最大だが輝石が遠い
    pops[4 * size + 4] = 0.5; // 中心: 次点、輝石が隣にある
    crystal[4 * size + 5] = 0.3;
    expect(pickHomeCandidate(pops, crystal, elevation, size)).toBe(4 * size + 4);
  });
  it('海セルは候補にならない。輝石がどこにも無ければ -1', () => {
    const elevation = mkLand();
    const pops = new Float32Array(size * size).fill(0.2);
    const crystal = new Float32Array(size * size);
    expect(pickHomeCandidate(pops, crystal, elevation, size)).toBe(-1);
    crystal[8 * size + 8] = 0.1;
    elevation[8 * size + 8] = 0; // 輝石のあるセルが海なら数えない
    expect(pickHomeCandidate(pops, crystal, elevation, size)).toBe(-1);
  });
  it('trackHomeCandidate: 前年の群れの候補が最大の群れの EMERGE_STICKY 倍以上なら群れに留まり、下回れば最大へ移る', () => {
    const size = 32;
    const elevation = new Float32Array(size * size).fill(0.5);
    const crystal = new Float32Array(size * size).fill(0.1); // どこでも輝石あり
    const pops = new Float32Array(size * size);
    const a = 5 * size + 5; // 群れ A (前年の候補)
    const b = 25 * size + 25; // 群れ B (遠い、より大きい)
    pops[a] = 0.6;
    pops[b] = 1.0;
    // A の地域人口 0.6 ≥ 0.5 × 1.0 → 留まる
    expect(trackHomeCandidate(pops, crystal, elevation, size, a)).toBe(a);
    // 前年が無ければ最大の B
    expect(trackHomeCandidate(pops, crystal, elevation, size, -1)).toBe(b);
    // A が痩せて 0.4 (< 0.5 × 1.0) になれば B へ飛ぶ
    pops[a] = 0.4;
    expect(trackHomeCandidate(pops, crystal, elevation, size, a)).toBe(b);
    // 群れの中で密度最大点が数セル動いたときは、その点を追う (履歴は続く)
    pops[a] = 0.6;
    pops[a + 2] = 0.7;
    expect(trackHomeCandidate(pops, crystal, elevation, size, a)).toBe(a + 2);
  });
  it('cellDistance はセル単位のユークリッド距離', () => {
    expect(cellDistance(0, 3, size)).toBe(3);
    expect(cellDistance(0, 4 * size + 3, size)).toBe(5);
    expect(cellDistance(7, 7, size)).toBe(0);
  });
});

describe('stepMining', () => {
  const size = 9;
  const home = 4 * size + 4; // 中心
  const mkLand = () => new Float32Array(size * size).fill(0.5); // SEA_LEVEL より高い一様な陸

  it('半径内の輝石だけを減らし、掘った分だけ progress が増える', () => {
    const elevation = mkLand();
    const crystal = new Float32Array(size * size).fill(0.5); // 陸全体に一様に輝石がある
    const state: CivState = { speciesId: 'deer', stage: 1, progress: 0, home, population: 0 };
    const before = Array.from(crystal);
    const { state: next, mined } = stepMining(state, crystal, elevation, size);
    expect(mined).toBeCloseTo(MINE_RATE[1], 6);
    expect(next.progress).toBeCloseTo(mined, 6);
    // 半径外 (例えば角) は変化しない
    expect(crystal[0]).toBeCloseTo(before[0], 6);
    // 半径内 (中心) は減っている
    expect(crystal[home]).toBeLessThan(before[home]);
  });

  it('輝石が無ければ何も変わらず、段階も進まない', () => {
    const elevation = mkLand();
    const crystal = new Float32Array(size * size); // 全部 0
    const state: CivState = { speciesId: 'deer', stage: 1, progress: 0.1, home, population: 0 };
    const { state: next, mined } = stepMining(state, crystal, elevation, size);
    expect(mined).toBe(0);
    expect(next).toEqual(state);
  });

  it('progress が NEED を超えると stage が 1 つ上がり、progress は 0 に戻る', () => {
    const elevation = mkLand();
    const crystal = new Float32Array(size * size).fill(1); // 豊富にある
    let state: CivState = { speciesId: 'deer', stage: 1, progress: 0, home, population: 0 };
    let ticks = 0;
    while (state.stage === 1 && ticks < 10000) {
      state = stepMining(state, crystal, elevation, size).state;
      ticks++;
    }
    expect(state.stage).toBe(2);
    expect(state.progress).toBe(0);
    // NEED[1] を掘るのに必要な最低 tick 数より少なくはならない
    expect(ticks).toBeGreaterThanOrEqual(Math.ceil(NEED[1] / MINE_RATE[1]));
  });

  it('最大段階 (7, 星) は掘っても進まない', () => {
    const elevation = mkLand();
    const crystal = new Float32Array(size * size).fill(1);
    const state: CivState = { speciesId: 'deer', stage: MAX_STAGE, progress: 0, home, population: 0 };
    const { state: next, mined } = stepMining(state, crystal, elevation, size);
    expect(next.stage).toBe(MAX_STAGE);
    expect(mined).toBe(0);
  });

  it('home が -1 (未発生) なら何もしない', () => {
    const elevation = mkLand();
    const crystal = new Float32Array(size * size).fill(1);
    const state: CivState = { speciesId: 'deer', stage: 1, progress: 0, home: -1, population: 0 };
    const { mined } = stepMining(state, crystal, elevation, size);
    expect(mined).toBe(0);
  });
});

describe('populationAround', () => {
  const size = 9;
  it('home 半径内の陸セルの密度を合計する', () => {
    const elevation = new Float32Array(size * size).fill(0.5);
    // 1 セルだけ海にしておき、その分は数えない
    elevation[0] = 0;
    const pops = new Float32Array(size * size).fill(0.1);
    const home = 4 * size + 4;
    const sum = populationAround(pops, home, elevation, size);
    let expected = 0;
    for (let y = Math.max(0, 4 - SUPPORT_RADIUS); y <= Math.min(size - 1, 4 + SUPPORT_RADIUS); y++) {
      for (let x = Math.max(0, 4 - SUPPORT_RADIUS); x <= Math.min(size - 1, 4 + SUPPORT_RADIUS); x++) {
        const dx = x - 4;
        const dy = y - 4;
        if (dx * dx + dy * dy > SUPPORT_RADIUS * SUPPORT_RADIUS) continue;
        if (elevation[y * size + x] <= 0) continue; // populationAround と同じく海は数えない
        expected += 0.1;
      }
    }
    expect(sum).toBeCloseTo(expected, 6);
  });
  it('home が -1 なら 0', () => {
    const elevation = new Float32Array(size * size).fill(0.5);
    const pops = new Float32Array(size * size).fill(1);
    expect(populationAround(pops, -1, elevation, size)).toBe(0);
  });
});

describe('resolveCivilizationStart', () => {
  it('start が無ければ undefined', () => {
    expect(resolveCivilizationStart(undefined, 64)).toBeUndefined();
  });
  it('home 省略または -1 は島の中心に解決される (他のコマンドと同じ規約)', () => {
    const size = 64;
    const centre = Math.floor(size / 2) * size + Math.floor(size / 2);
    expect(resolveCivilizationStart({ speciesId: 'deer' }, size)).toEqual({ speciesId: 'deer', start: { stage: 0, home: centre } });
    expect(resolveCivilizationStart({ speciesId: 'deer', home: -1 }, size)).toEqual({ speciesId: 'deer', start: { stage: 0, home: centre } });
  });
  it('stage/home を指定すればそのまま使われる', () => {
    expect(resolveCivilizationStart({ speciesId: 'deer', stage: 4, home: 123 }, 64)).toEqual({ speciesId: 'deer', start: { stage: 4, home: 123 } });
  });
  it('prayer を指定すればそのまま使われる (M9-02)', () => {
    expect(resolveCivilizationStart({ speciesId: 'deer', stage: 4, home: 123, prayer: 'rain' }, 64)).toEqual({
      speciesId: 'deer',
      start: { stage: 4, home: 123, prayer: 'rain' },
    });
  });
});

// 定数が壊れていないことの最低限の確認 (SEA_LEVEL を使う他のテストと足並みを揃える意図で import している)
describe('sanity', () => {
  it('MINE_RADIUS/MINE_RATE/NEED は 8 段階分 (0..7) ある', () => {
    expect(MINE_RADIUS.length).toBe(8);
    expect(MINE_RATE.length).toBe(8);
    expect(NEED.length).toBe(8);
    expect(SEA_LEVEL).toBeGreaterThan(0);
  });
});
