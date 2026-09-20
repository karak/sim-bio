import { describe, it, expect } from 'vitest';
import {
  checkEmergence,
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

describe('checkEmergence', () => {
  it('履歴が 10 年未満なら発生しない', () => {
    expect(checkEmergence(stableHistory(5, 9), 0.9)).toBe(false);
  });
  it('振動している種 (振幅比 >= 0.15) では植生が十分でも発生しない', () => {
    const history = oscillatingHistory();
    expect(history.length).toBe(10);
    expect(checkEmergence(history, 0.9)).toBe(false);
  });
  it('安定していても植生が EMERGE_VEGETATION 以下なら発生しない', () => {
    expect(checkEmergence(stableHistory(5), EMERGE_VEGETATION)).toBe(false);
    expect(checkEmergence(stableHistory(5), 0.1)).toBe(false);
  });
  it('10 年以上安定 (振幅比 < 0.15) かつ植生 > 0.4 なら発生する', () => {
    expect(checkEmergence(stableHistory(5), 0.5)).toBe(true);
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
