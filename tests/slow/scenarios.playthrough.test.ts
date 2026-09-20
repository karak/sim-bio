import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { World } from '../../src/simulation/World';
import { createMemorySink } from '../../src/core/log/memorySink';
import { createScenarioRunner, type ScenarioRunner } from '../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../src/scenario/types';
import type { SpeciesDef, WorldConfig, WorldSnapshot } from '../../src/simulation/types';
import { resolveCivilizationStart } from '../../src/simulation/civilization';
import { forEachInRadius } from '../../src/simulation/disaster';
import { suitability } from '../../src/simulation/vegetation';

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

/**
 * 「塔の重さ」v2 (M8-05)。レベルデザイン docs/design/2026-09-20-level-design-tower.md §5 の判定行列。
 * 塔は燃料で立つ。火 (火山の熱、炎蜥蜴の代償) と樹 (鐘樹の材、陰の代償) の配分だけが生き延びる。
 * 集落 2847、火口 3167 (島で最も暖かい低地。噴火で 31℃ を超え炎蜥蜴が湧く)、鐘樹は集落半径 8 内の適地に植える。
 * 校正の続き (2026-09-21): 火口を 3223 (同じ暖かさの低地、集落から 10 セル) に移した。5 セルでは噴火の焼け跡が集落の支え半径 8 と重なり、
 * 鹿の谷と重なった 1 回の噴火で民が 4 年続けて塔の必要量を割って衰退した (火が「時期を当てるゲーム」になる)。10 セルなら熱は徴収半径 12 に入り、炎蜥蜴だけが歩いてくる。
 */
const TOWER_HOME = 2847;
const TOWER_VOLCANO = 3223;
const ERUPT_COST = 24;

/** 集落半径 8 内で鐘樹の適合度が高いセルを、互いに 2.5 セル以上離して選ぶ (プレイヤーが植える場所の近似) */
function belltreeSites(s: WorldSnapshot, max: number): number[] {
  const bt = species.find((d) => d.id === 'belltree');
  if (!bt) throw new Error('belltree missing');
  const sites: number[] = [];
  forEachInRadius(TOWER_HOME, 8, SIZE, (i) => {
    if (sites.length >= max || s.layers.elevation[i] < 0.3) return;
    if (suitability(bt, s.layers.temperature[i], s.layers.moisture[i]) <= 0.75) return;
    const x = i % SIZE;
    const y = Math.floor(i / SIZE);
    if (sites.every((c) => Math.hypot(x - (c % SIZE), y - Math.floor(c / SIZE)) > 2.5)) sites.push(i);
  });
  return sites;
}

type TowerOps = { plant: (n: number) => void; erupt: () => void; short: (mult: number) => boolean };
const towerOps = (r: ScenarioRunner, s: WorldSnapshot, state: { planted: number; sites: number[] }): TowerOps => {
  if (state.sites.length === 0) state.sites = belltreeSites(s, 12);
  const f = s.civ?.fuel;
  return {
    plant: (n) => {
      for (let k = 0; k < n && state.planted < state.sites.length; k++, state.planted++) {
        r.intervene({ type: 'spawn_species', speciesId: 'belltree', cell: state.sites[state.planted], amount: 0.5, radius: 1 });
      }
    },
    erupt: () => {
      if (r.power() >= ERUPT_COST) r.intervene({ type: 'disaster', kind: 'volcano', cell: TOWER_VOLCANO, radius: 4 });
    },
    short: (mult) => (f ? f.stock < f.need * mult : false),
  };
};

const towerScripts: Record<string, Script> = {};
{
  // 火だけ: 蓄えが 2 年分を割るたびに噴火。力が続かず 30 年目前後に燃料切れで一段落ち、戻れない
  const st1 = { planted: 0, sites: [] as number[] };
  towerScripts['fire-only'] = (r, s, y) => { const o = towerOps(r, s, st1); if (y >= 1 && o.short(2)) o.erupt(); };
  // 樹だけ: 4 年ごとに 5 か所ずつ植える。材が間に合わず 22 年目までに歌まで落ちる
  const st2 = { planted: 0, sites: [] as number[] };
  towerScripts['tree-only'] = (r, s, y) => { const o = towerOps(r, s, st2); if (y >= 1 && y % 4 === 1) o.plant(5); };
  // 想定解 1: 40 年目まで 2 年ごとに 3 か所植えつつ、蓄えが 1 年分を割ったら噴火 (約 12 回)
  const st3 = { planted: 0, sites: [] as number[] };
  towerScripts['fire-and-trees'] = (r, s, y) => { const o = towerOps(r, s, st3); if (y >= 1 && y <= 40 && y % 2 === 1) o.plant(3); if (y >= 1 && o.short(1)) o.erupt(); };
  // 想定解 2: 最初の 20 年で毎年 2 か所植え、蓄えが 1 年分を割ったら噴火 (約 11 回)
  const st4 = { planted: 0, sites: [] as number[] };
  towerScripts['trees-first'] = (r, s, y) => { const o = towerOps(r, s, st4); if (y >= 1 && y <= 20) o.plant(2); if (y >= 1 && o.short(1)) o.erupt(); };
}

function playTower(def: ScenarioDef, script: Script | null) {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
    civilization: resolveCivilizationStart(def.start?.civilization, SIZE),
    volcanoCell: def.start?.volcanoCell,
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

describe('tower scenario v2 playthroughs (size 64)', { timeout: 600_000 }, () => {
  const def = defs.find((d) => d.id === 'tower');
  if (!def) throw new Error('scenario tower missing');
  it('idle → dead (燃料切れで段階が落ちる)', () => {
    const v = playTower(def, null);
    expect(v.status).toBe('dead');
    expect(v.reason).toContain('文明の段階');
  });
  it('naive fire-only → dead', () => {
    const v = playTower(def, towerScripts['fire-only']);
    expect(v.status, v.reason).toBe('dead');
  });
  it('naive tree-only → dead', () => {
    const v = playTower(def, towerScripts['tree-only']);
    expect(v.status, v.reason).toBe('dead');
  });
  it('fire + trees (想定解 1) → alive', () => {
    const v = playTower(def, towerScripts['fire-and-trees']);
    expect(v.status, v.reason).toBe('alive');
  });
  it('trees first + fire (想定解 2) → alive', () => {
    const v = playTower(def, towerScripts['trees-first']);
    expect(v.status, v.reason).toBe('alive');
  });
});
