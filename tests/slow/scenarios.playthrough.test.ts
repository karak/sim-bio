import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig, WorldSnapshot } from '../../src/simulation/types';

/**
 * 5 本のシナリオを「放置」と「台本どおりの介入」で回し、
 * 放置なら滅び、介入すれば回避できることを固定する (size 64、シードは各シナリオの start)。
 * 沈む欠片は星の力の制約下で、素朴な単独戦略が滅び、力を配分する 2 通りの想定解が回避できることも固定する。
 */
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
const SIZE = 64;

type Script = (r: ScenarioRunner, s: WorldSnapshot, year: number) => void;

const highest = (s: WorldSnapshot, k: number) =>
  [...s.layers.elevation.keys()].sort((a, b) => s.layers.elevation[b] - s.layers.elevation[a]).slice(0, k);

/** 島中に苔・草・森・獣を放ち直す (星が落ちた後、火山の後)。苔を戻さないと生気が尽きて草も獣も飢える */
const respawnAll: Script = (r, s) => {
  let k = 0;
  for (let i = 0; i < s.layers.elevation.length; i += 37) {
    if (s.layers.elevation[i] < 0.3) continue;
    k++;
    for (const id of ['moss', 'grass', 'forest']) r.intervene({ type: 'spawn_species', speciesId: id, cell: i, amount: 0.5 });
    if (k % 3 === 0) for (const id of ['deer', 'rabbit']) r.intervene({ type: 'spawn_species', speciesId: id, cell: i, amount: 0.3 });
    // 狼は薄く放つと餌を食い尽くす前に消える紙一重なので、6 セルに 1 つ・0.3 と厚めに放つ
    if (k % 6 === 0) r.intervene({ type: 'spawn_species', speciesId: 'wolf', cell: i, amount: 0.3 });
  }
};

/** 沈む欠片の介入 (星の力の制約下)。放流はプレイヤーのクリック 1 回 (半径 1) に合わせる */
const sinkingOps = (r: ScenarioRunner, s: WorldSnapshot) => ({
  spawnHigh: (ids: string[], k: number) => {
    for (const c of highest(s, k)) for (const id of ids) r.intervene({ type: 'spawn_species', speciesId: id, cell: c, amount: 0.3, radius: 1 });
  },
  plagueWolvesIfMany: () => {
    const t = s.totals;
    if (t.wolf <= 1.5 * Math.max(1, t.deer)) return;
    let bi = -1;
    let bv = -1;
    for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.populations.wolf[i] > bv) { bv = s.layers.populations.wolf[i]; bi = i; }
    r.intervene({ type: 'disaster', kind: 'plague', cell: bi, radius: 4 });
  },
});

/** 素朴な単独戦略。どれも滅びる (計画 §3.4 の判定行列) */
const sinkingNaive: Record<string, Script> = {
  // 雨 1.5 倍を入れっぱなし。維持費 10/年が収入を超え、力が尽きて雨が止まる
  'rain-only': (r, _s, y) => { if (y === 30) r.intervene({ type: 'set_climate', rainScale: 1.5 }); },
  // 5 年ごとに高地へ鹿を放つだけ。雨がないので高地に鹿は根付かない
  'spawn-only': (r, s, y) => { if (y % 5 === 0 && y >= 20) sinkingOps(r, s).spawnHigh(['deer'], 2); },
  // 狼を疫病で抑えるだけ
  'plague-only': (r, s, y) => { if (y % 5 === 0 && y >= 20) sinkingOps(r, s).plagueWolvesIfMany(); },
};

/** 力を配分する 2 通りの想定解。どちらも回避できる */
const sinkingSolutions: Record<string, Script> = {
  // 想定解 1: 控えめな雨 (1.25 倍、維持費 5/年) を 30 年目から。節約した力で 20 年ごとに鹿と兎を高地へ、狼が増えたら疫病
  'modest-rain': (r, s, y) => {
    const ops = sinkingOps(r, s);
    if (y === 30) r.intervene({ type: 'set_climate', rainScale: 1.25 });
    if (y % 20 === 0 && y >= 40) ops.spawnHigh(['deer', 'rabbit'], 1);
    if (y % 10 === 0 && y >= 40) ops.plagueWolvesIfMany();
  },
  // 想定解 2: 前半は力を貯め、60 年目に雨 1.4 倍と鹿の種まき。以後は狼が増えたら疫病 (1.5 倍だと力が尽きて滅びる)
  'save-then-rain': (r, s, y) => {
    const ops = sinkingOps(r, s);
    if (y === 60) {
      r.intervene({ type: 'set_climate', rainScale: 1.4 });
      ops.spawnHigh(['deer'], 2);
    }
    if (y > 60 && y % 10 === 0) ops.plagueWolvesIfMany();
  },
};

const scripts: Record<string, Script> = {
  sinking: sinkingSolutions['modest-rain'],
  'falling-star': (r, s, y) => { if (y === 62 || y === 70) respawnAll(r, s, y); },
  volcano: (r, s, y) => { if (y === 82 || y === 95) respawnAll(r, s, y); },
  // 十年目の基準を取ってから雨を 1.4 倍に。1.9 倍だと狼が谷で絶滅する (罠)
  enrichment: (r, _s, y) => { if (y === 12) r.intervene({ type: 'set_climate', rainScale: 1.4 }); },
  // 五年目に湿った地へ胞子苔を放つ。苔は自力で島中に広がる
  'vitality-famine': (r, s, y) => {
    if (y !== 5) return;
    let k = 0;
    for (let i = 0; i < s.layers.elevation.length; i += 23) {
      if (s.layers.elevation[i] < 0.3 || s.layers.moisture[i] < 0.6) continue;
      if (k++ % 2 === 0) r.intervene({ type: 'spawn_species', speciesId: 'moss', cell: i, amount: 0.4 });
    }
  },
};

function play(def: ScenarioDef, script: Script | null) {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
  };
  const w = World.create(cfg, { log: createMemorySink() });
  const r = createScenarioRunner(def, w, { ticksPerYear: cfg.ticksPerYear });
  for (let y = 0; y <= def.years; y++) {
    const s = w.snapshot();
    script?.(r, s, y);
    const v = r.update(s);
    if (v.status !== 'running') return v;
    w.step(cfg.ticksPerYear);
  }
  return r.verdict();
}

describe('scenario playthroughs (size 64)', { timeout: 600_000 }, () => {
  for (const id of ['sinking', 'falling-star', 'volcano', 'enrichment', 'vitality-famine']) {
    const def = defs.find((d) => d.id === id);
    if (!def) throw new Error(`scenario ${id} missing`);
    it(`${id}: idle → dead`, () => {
      expect(play(def, null).status).toBe('dead');
    });
    it(`${id}: scripted intervention → alive`, () => {
      const v = play(def, scripts[id]);
      expect(v.status, v.reason).toBe('alive');
    });
  }
  for (const [name, script] of Object.entries(sinkingNaive)) {
    it(`sinking: naive ${name} → dead`, () => {
      const def = defs.find((d) => d.id === 'sinking');
      if (!def) throw new Error('missing');
      const v = play(def, script);
      expect(v.status, v.reason).toBe('dead');
      expect(v.reason).toContain('鹿');
    });
  }
  it('sinking: save-then-rain (second solution) → alive', () => {
    const def = defs.find((d) => d.id === 'sinking');
    if (!def) throw new Error('missing');
    const v = play(def, sinkingSolutions['save-then-rain']);
    expect(v.status, v.reason).toBe('alive');
  });
  it('enrichment: too much rain kills the wolves (the trap)', () => {
    const def = defs.find((d) => d.id === 'enrichment');
    if (!def) throw new Error('missing');
    const v = play(def, (r, _s, y) => { if (y === 12) r.intervene({ type: 'set_climate', rainScale: 1.9 }); });
    expect(v.status).toBe('dead');
    expect(v.reason).toContain('wolf');
  });
});
