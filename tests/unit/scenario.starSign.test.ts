import { describe, it, expect } from 'vitest';
import { createScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { Command, WorldSnapshot } from '../../src/simulation/types';
import type { CivState } from '../../src/simulation/civilization';
import { grass, testConfig } from './helpers';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';

/**
 * 見える星 (M21-03 K1) の ScenarioRunner 側: 次の星の着弾 starSignYears 年前から着弾までを窓とし、
 * 窓の開閉を star_sign で World に渡す。偽の world (scenario.intercept.test と同じ流儀) は star_sign だけ civ に写す。
 */
const fakeWorld = (civ: Partial<CivState> | null) => {
  let tick = 0;
  const cmds: Command[] = [];
  const size = 4;
  const n = size * size;
  let c: CivState | null = civ ? { speciesId: 'deer', stage: 7, progress: 0, home: 0, population: 0, faith: 1, ...civ } : null;
  const snapshot = (): WorldSnapshot => ({
    tick, year: Math.floor(tick / 360), dayOfYear: tick % 360, size, species: [grass], meanTemperature: 10, co2: 280, climate: { rainScale: 1, tempOffset: 0 }, totals: { grass: 1 },
    layers: { elevation: new Float32Array(n).fill(0.5), temperature: new Float32Array(n), moisture: new Float32Array(n), vegetation: new Float32Array(n), vitality: new Float32Array(n).fill(1), litter: new Float32Array(n), crystal: new Float32Array(n), populations: { grass: new Float32Array(n) } },
    civ: c ? { ...c } : null,
    volcanoCell: 0,
    towers: [],
    ship: null,
    dreamEater: null,
  });
  return {
    dispatch: (cmd: Command) => {
      cmds.push(cmd);
      if (cmd.type === 'star_sign' && c) c = { ...c, starVisible: cmd.visible };
    },
    snapshot,
    step: (t: number) => { tick += t; },
    cmds,
    setCiv: (v: Partial<CivState>) => { c = { ...c!, ...v }; },
  };
};
const meteor = (atYear: number) => ({ atYear, command: { type: 'disaster', kind: 'meteor', cell: -1, radius: 2 } as Command });
const def: ScenarioDef = {
  id: 't', title: 't', prophecy: 'p', kind: 'prevent', start: { seed: 1, size: 4 }, years: 12, referenceSize: 4,
  schedule: [meteor(6), meteor(10)],
  starSignYears: 3,
  alive: { type: 'year_reached', year: 12 },
};
const signs = (cmds: Command[]) => cmds.flatMap((c) => (c.type === 'star_sign' ? [c.visible] : []));
/** 年 y まで、年ごとに update を 2 回 (同じ年に何度呼んでも 1 回だけ流す) */
const runTo = (w: ReturnType<typeof fakeWorld>, r: ReturnType<typeof createScenarioRunner>, y0: number, y1: number, each?: (y: number) => void) => {
  for (let y = y0; y <= y1; y++) {
    each?.(y);
    r.update(w.snapshot());
    r.update(w.snapshot());
    w.step(360);
  }
};

describe('見える星 (M21-03 K1、ScenarioRunner)', () => {
  it('窓は着弾の starSignYears 年前から着弾の前の年まで。開閉が変わる年にだけ star_sign を流す (星の行為ではない)', () => {
    const w = fakeWorld({ works: { stock: 0, stopped: false } });
    const r = createScenarioRunner(def, w);
    const seen: (boolean | undefined)[] = [];
    runTo(w, r, 0, 11, () => seen.push(w.snapshot().civ!.starVisible));
    // 0〜2 暗い → 3〜5 見える (星 6) → 6 は落ちた年で次の星 10 の窓 (7〜9) の外 → 7〜9 見える → 10 以降は星が無く暗い
    expect(signs(w.cmds)).toEqual([false, true, false, true, false]);
    expect(seen.slice(1)).toEqual([false, false, false, true, true, true, false, true, true, true, false]);
  });
  it('撃てば次の星が見えるまで空は暗い (取り消した星の窓は閉じる)', () => {
    const w = fakeWorld({ works: { stock: 10, stopped: false } });
    const r = createScenarioRunner({ ...def, years: 20, schedule: [meteor(6), meteor(15)] }, w);
    runTo(w, r, 0, 4, (y) => { if (y === 4) expect(r.intervene({ type: 'intercept' })).toEqual({ ok: true }); });
    // 3 で開き、4 で撃って閉じる (次の星 15 の窓は 12 から)
    expect(signs(w.cmds)).toEqual([false, true, false]);
    runTo(w, r, 5, 12);
    expect(signs(w.cmds)).toEqual([false, true, false, true]);
  });
  it('starSignYears の無い石板は star_sign を流さない (今までどおり)', () => {
    const w = fakeWorld({ works: { stock: 0, stopped: false } });
    const plain: ScenarioDef = { ...def, starSignYears: undefined };
    const r = createScenarioRunner(plain, w);
    runTo(w, r, 0, 11);
    expect(signs(w.cmds)).toEqual([]);
  });
  it('続き (restored) から始めても、World の starVisible と揃っていれば流さず、違っていれば流し直す', () => {
    const w = fakeWorld({ works: { stock: 0, stopped: false } });
    const r = createScenarioRunner(def, w);
    runTo(w, r, 0, 3);
    const saved = r.save();
    const before = w.cmds.length;
    const r2 = createScenarioRunner(def, w, {}, saved);
    r2.update(w.snapshot());
    expect(w.cmds.length).toBe(before);
    // 古いセーブ (starVisible が無い) なら流し直す
    w.setCiv({ starVisible: undefined });
    const r3 = createScenarioRunner(def, w, {}, saved);
    r3.update(w.snapshot());
    expect(signs(w.cmds.slice(before))).toEqual([true]);
  });
  it('窓の間は警告「星が見えている」(着弾までの年)、窓の外で星の民が掘っていれば「灯に焚く」を出し、年表には窓ごとに 1 回積む', () => {
    const w = fakeWorld({ works: { stock: 0, stopped: false } });
    const r = createScenarioRunner(def, w);
    const texts: string[][] = [];
    for (let y = 0; y <= 5; y++) {
      r.update(w.snapshot());
      texts.push(r.warnings().map((x) => x.text));
      w.step(360);
    }
    expect(texts[1].join('|')).toContain('灯に焚かれ');
    expect(texts[3].join('|')).toContain('星が見えている(着弾まで 3 年)');
    expect(texts[4].join('|')).toContain('星が見えている(着弾まで 2 年)');
    expect(texts[4].join('|')).not.toContain('灯に焚かれ');
    const logged = r.timeline().flatMap((e) => (e.kind === 'warning' && e.warning.kind === 'star_visible' ? [e.year] : []));
    expect(logged).toEqual([3]);
  });
  it('止めよで掘っていない・信仰が工事の門を割っている・星でない間は「灯に焚く」を出さない', () => {
    for (const civ of [{ miningStopped: true }, { faith: 0.5 }, { stage: 6 }]) {
      const w = fakeWorld({ works: { stock: 0, stopped: false }, ...civ });
      const r = createScenarioRunner(def, w);
      r.update(w.snapshot());
      w.step(360);
      r.update(w.snapshot());
      expect(r.warnings().map((x) => x.kind)).not.toContain('star_dark');
    }
  });
});

describe('見える星 (M21-03 K1): 年の途中で撃っても、update の刻みに依らず同じ結末 (M19-04 の決定論)', () => {
  // レビューの指摘: 窓を閉じる star_sign を update だけが流すと、毎フレーム update するアプリと境目でしか update しない年代記の再生で
  // 撃った年の残りに備蓄が積まれるかが分かれた。撃った時に流せば、どちらも撃った tick の次の step で閉じる
  const def: ScenarioDef = {
    id: 't', title: 't', prophecy: 'p', kind: 'prevent', start: { seed: 1, size: 32 }, years: 31, referenceSize: 32,
    schedule: [meteor(14), meteor(30)], starSignYears: 12, alive: { type: 'year_reached', year: 31 },
  };
  const run = (midUpdate: boolean) => {
    const home = 16 * 32 + 16;
    const w = World.create(testConfig({ civilization: { speciesId: 'grass', start: { stage: 7, home, fuelStock: 900, faith: 1 } } }), { log: createMemorySink() });
    const r = createScenarioRunner(def, w, { ticksPerYear: 360 });
    for (let y = 0; y < 11; y++) {
      r.update(w.snapshot());
      w.step(360);
    }
    r.update(w.snapshot());
    w.step(100);
    expect(r.intervene({ type: 'intercept' })).toEqual({ ok: true });
    if (midUpdate) {
      w.step(1);
      r.update(w.snapshot());
      w.step(259);
    } else w.step(260);
    r.update(w.snapshot());
    return w.snapshot().civ!;
  };
  it('撃った年の残りは窓が閉じていて、境目だけ update しても途中で update しても備蓄は同じ (撃った 3 を引いた残り)', { timeout: 60_000 }, () => {
    const replay = run(false);
    const live = run(true);
    expect(replay.starVisible).toBe(false);
    expect(live.works!.stock).toBeCloseTo(replay.works!.stock, 9);
    expect(replay.works!.stock).toBeCloseTo(0.24, 5);
  });
});
