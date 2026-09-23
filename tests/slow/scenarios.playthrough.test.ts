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
import { SEA_LEVEL } from '../../src/simulation/terrain';
import { INTERCEPT_NEED } from '../../src/simulation/works';
import { LOAD_RADIUS } from '../../src/simulation/civilizationLoad';
import { timberAround, SHIP_FOREST_MIN } from '../../src/simulation/ship';
import { disasterClick, spawnClick } from '../../src/ui/clicks';

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
    for (const id of ['moss', 'grass', 'forest']) r.intervene(spawnClick(id, i));
    if (k % 3 === 0) for (const id of ['deer', 'rabbit']) r.intervene(spawnClick(id, i));
    // 狼は薄く放つと餌を食い尽くす前に消える紙一重なので、6 セルに 1 つ・0.3 と厚めに放つ
    // (M21-01: 放流はすべて UI の 1 クリック = 環 1・0.5 に揃えた)
    if (k % 6 === 0) r.intervene(spawnClick('wolf', i));
  }
};

/** 沈む欠片の介入 (星の力の制約下)。放流はプレイヤーのクリック 1 回 (半径 1) に合わせる */
const sinkingOps = (r: ScenarioRunner, s: WorldSnapshot) => ({
  spawnHigh: (ids: string[], k: number) => {
    for (const c of highest(s, k)) for (const id of ids) r.intervene(spawnClick(id, c));
  },
  plagueWolvesIfMany: () => {
    const t = s.totals;
    if (t.wolf <= 1.5 * Math.max(1, t.deer)) return;
    let bi = -1;
    let bv = -1;
    for (let i = 0; i < s.layers.elevation.length; i++) if (s.layers.populations.wolf[i] > bv) { bv = s.layers.populations.wolf[i]; bi = i; }
    // UI の疫病の半径 (DISASTER_RADIUS.plague = 4) に合わせる (M10R-07 で一時 6 にしたが谷の波なら 4 で足りるので戻した)
    r.intervene(disasterClick('plague', bi));
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
      if (k++ % 2 === 0) r.intervene(spawnClick('moss', i));
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
        r.intervene(spawnClick('belltree', state.sites[state.planted]));
      }
    },
    erupt: () => {
      if (r.power() >= ERUPT_COST) r.intervene(disasterClick('volcano', TOWER_VOLCANO));
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

/** after は年次評価 (予定コマンドの発火) の後に呼ぶ台本。狼が下りた年にその場で動く「先回り」に使う (M9-04) */
function playTower(def: ScenarioDef, script: Script | null, after: Script | null = null) {
  const cfg: WorldConfig = {
    ...structuredClone(base),
    size: SIZE,
    species: species.map((d) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })),
    seed: def.start?.seed ?? base.seed,
    civilization: resolveCivilizationStart(def.start?.civilization, SIZE),
    volcanoCell: def.start?.volcanoCell,
    crystalScale: def.start?.crystalScale,
  };
  const w = World.create(cfg, { log: createMemorySink() });
  const r = createScenarioRunner(def, w, { ticksPerYear: cfg.ticksPerYear });
  for (let y = 0; y <= def.years; y++) {
    const s = w.snapshot();
    script?.(r, s, y);
    const v = r.update(s);
    if (v.status !== 'running') return v;
    after?.(r, w.snapshot(), y);
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

/**
 * 「祈りに応えるな」「霊脈枯れ」。
 * 祈りに応えるな (歌 (3)、集落 2063 = 振幅比 0.06 の安定な群れ、狼の波 1.0 / 環 3 を北の谷 1366 (集落から 13 セル) へ 6 年目から 8 年ごと): レベルデザイン
 * docs/design/2026-09-22-level-design-faith-economy.md §8.5〜8.6、§8.10(M10R-07 の作り直し、判定行列)。
 * 狼はひと冬かけて集落へ歩く。波の年のうち (計測では 3 か月以内) に谷へ疫病 環 4 を打てば祈りは出ない
 * (集落に落とす環 6 の波は波と同じ tick でしか追えず UI で打てなかったので、谷に落とす形にした)。見送れば 2 年後に祈りが出て、応えれば即 dead、無視すれば
 * 若い信仰 (歌以下) の記憶に −0.1 が刻まれる (取り下げでも)。年収は実効 3/年 (§8.10 の M12) で全部の波は先回りできず、
 * 儀式 (苔を 3 年ごと) で記憶の目減りを埋めつつ、どの波を先回りしどの波を見送るかが問い。先回り 6〜7 回は alive、5 回以下は夢喰い。
 * (M9-04 の旧設計: 集落 2787 = 輝石が無く段階が進まない、狼は 12 年ごとに一定の群れ。応えれば即 dead、儀式または全部先回りで信仰を保つ、
 * という単純な二択だった。判定行列の幅が無く、M10R-07 で安定な集落・着地する波・記憶の予算のジレンマに作り直した)
 * 霊脈枯れ (石 (4)、集落 1770 = 脈の上、薪の蓄え 600): 信仰 0.6 で「止めよ」。応えて速く上げるか、儀式で積むか。止めずに苔を放っても戻らない。
 * 12 年ごとに狼が下りて民は祈る (定義は変えていない)。
 */
const NO_ANSWER_HOME = 2063;
const VEIN_HOME = 1770;
/** 儀式: 集落に苔を放つ (4)。同じ種類の介入を 3 年ごとに続けると信仰が上がる (狼の祈りの応えにはならない) */
const ritual = (r: ScenarioRunner, home: number) => r.intervene(spawnClick('moss', home));
/** 集落の疫病 (24)。狼の祈りへの応え (祈りが出ていれば answered)。半径 4 は UI の DISASTER_RADIUS.plague と同じ (M10R-07 で 6 を試したが、谷の波なら 4 で足りるので戻した) */
const plagueHome = (r: ScenarioRunner, home: number) => { if (r.power() >= 24) r.intervene(disasterClick('plague', home)); };
/** 狼の波が落ちる北の谷 (schedule と同じセル、M10R-07)。集落 2063 から 13 セル */
const NO_ANSWER_VALLEY = 1366;
/** 先回り: 谷に疫病 (24、環 4 = UI と同じ)。波の年のうち (計測では 3 か月以内) に谷を病ませれば狼は集落へ着かず、民は祈らない */
const plagueValley = (r: ScenarioRunner) => { if (r.power() >= 24) r.intervene(disasterClick('plague', NO_ANSWER_VALLEY)); };
/** 狼の波が下りる年 (schedule と同じ: 6 年目から 8 年ごと、M10R-07) */
const waveYear = (y: number) => y >= 6 && (y - 6) % 8 === 0;

const noAnswerScripts: Record<string, Script> = {
  // 応える: 祈りが出たら疫病。一度でも応えれば民は考えるのをやめる → dead
  answer: (r, s) => { if (s.civ?.prayer?.kind === 'wolves') plagueHome(r, NO_ANSWER_HOME); },
  // 儀式。3 年ごとに苔を放つだけ。祈りは無視するが、儀式の分で記憶の目減りをいくらか埋める (先回りが無ければ夢喰いは避けられない)
  ritual: (r, _s, y) => { if (y >= 1 && y % 3 === 1) ritual(r, NO_ANSWER_HOME); },
};

/**
 * 先回り (playTower の after で使う)。波は r.update 内の runner の schedule で発火するので、年次評価の後でなければ
 * その年に祈りが出たかどうかを確かめられない (M9-04 由来の制約、M10R-07 でも変わらない)
 */
const preemptScripts: Record<string, Script> = {
  // 想定解 1: 欲張り。波の年のうち、まだ祈りが出ていなければ谷に疫病 (plagueValley が力 24 未満なら何もしない)
  greedy: (r, s, y) => { if (waveYear(y) && !s.civ?.prayer) plagueValley(r); },
  // 想定解 2: 一つおき (2 波に 1 回) に先回り
  alt1in2: (r, s, y) => { if (waveYear(y) && ((y - 6) / 8) % 2 === 0 && !s.civ?.prayer) plagueValley(r); },
  // naive: 3 波に 1 回だけ先回り。記憶の予算が足りず夢喰い
  alt1in3: (r, s, y) => { if (waveYear(y) && ((y - 6) / 8) % 3 === 0 && !s.civ?.prayer) plagueValley(r); },
  // naive: 波の翌年に打つ。窓 (波の年) を外しているので群れはもう崩れて祈りになっている
  late: (r, s, y) => { if (waveYear(y - 1) && !s.civ?.prayer) plagueValley(r); },
};

const veinScripts: Record<string, Script> = {
  // 苔だけ: 信仰も勅令も無し。脈が尽きて生気が戻らない → dead
  'moss-only': (r, _s, y) => { if (y >= 1 && y % 3 === 1) ritual(r, VEIN_HOME); if (y >= 20 && y % 5 === 0) for (const c of [VEIN_HOME - 2, VEIN_HOME + 2, VEIN_HOME - 2 * SIZE, VEIN_HOME + 2 * SIZE]) r.intervene(spawnClick('moss', c)); },
  // 信仰を上げずに止めよ: 民は聞かない → dead (放置と同じ)
  'edict-without-faith': (r, s, y) => { if (y >= 1 && y % 5 === 0 && !s.civ?.miningStopped) r.intervene({ type: 'civ_edict', edict: 'stop_mining' }); },
  // 想定解 1: 祈りに応えて速く上げ、0.6 になったら止めよ
  'answer-then-stop': (r, s) => {
    if (s.civ?.prayer?.kind === 'wolves') plagueHome(r, VEIN_HOME);
    if ((s.civ?.faith ?? 0) >= 0.6 && !s.civ?.miningStopped) r.intervene({ type: 'civ_edict', edict: 'stop_mining' });
  },
  // 想定解 2: 儀式で積み、0.6 になったら止めよ
  'ritual-then-stop': (r, s, y) => {
    if (y >= 1 && y % 3 === 1) ritual(r, VEIN_HOME);
    if ((s.civ?.faith ?? 0) >= 0.6 && !s.civ?.miningStopped) r.intervene({ type: 'civ_edict', edict: 'stop_mining' });
  },
};

describe('faith scenarios (M9-04, size 64)', { timeout: 600_000 }, () => {
  const noAnswer = defs.find((d) => d.id === 'no-answer');
  const vein = defs.find((d) => d.id === 'vein-drain');
  if (!noAnswer || !vein) throw new Error('faith scenarios missing');
  it('no-answer: idle → dead (放置。信仰が減衰して内乱、崩壊)', () => {
    const v = playTower(noAnswer, null);
    expect(v.status, v.reason).toBe('dead');
  });
  it('no-answer: naive ritual only (儀式だけ、先回りなし) → dead (記憶の予算が尽きて夢喰い)', () => {
    const v = playTower(noAnswer, noAnswerScripts.ritual);
    expect(v.status, v.reason).toBe('dead');
    expect(v.reason).toContain('夢喰い');
  });
  it('no-answer: naive answer (祈りが出たら疫病) → dead (民は考えるのをやめた)', () => {
    const v = playTower(noAnswer, noAnswerScripts.answer);
    expect(v.status, v.reason).toBe('dead');
    expect(v.reason).toContain('応え');
  });
  it('no-answer: naive greedy the year after the wave (波の翌年に疫病) → dead (窓は波の年だけ)', () => {
    const v = playTower(noAnswer, noAnswerScripts.ritual, preemptScripts.late);
    expect(v.status, v.reason).toBe('dead');
  });
  it('no-answer: naive alt 1:2 (3 波に 1 回だけ先回り) → dead (夢喰い)', () => {
    const v = playTower(noAnswer, noAnswerScripts.ritual, preemptScripts.alt1in3);
    expect(v.status, v.reason).toBe('dead');
    expect(v.reason).toContain('夢喰い');
  });
  it('no-answer: naive greedy without ritual → dead (信仰の減衰で内乱)', () => {
    const v = playTower(noAnswer, null, preemptScripts.greedy);
    expect(v.status, v.reason).toBe('dead');
  });
  it('no-answer: solution 1: greedy (波の年に力 24 があれば集落へ疫病) + ritual → alive (7 回買えて 5 回見送り、上限 0.5)', () => {
    const v = playTower(noAnswer, noAnswerScripts.ritual, preemptScripts.greedy);
    expect(v.status, v.reason).toBe('alive');
  });
  it('no-answer: solution 2: alt 1:1 (一つおきに先回り) + ritual → alive', () => {
    const v = playTower(noAnswer, noAnswerScripts.ritual, preemptScripts.alt1in2);
    expect(v.status, v.reason).toBe('alive');
  });
  it('vein-drain: idle → dead', () => {
    const v = playTower(vein, null);
    expect(v.status, v.reason).toBe('dead');
  });
  it('vein-drain: moss-only → dead', () => {
    const v = playTower(vein, veinScripts['moss-only']);
    expect(v.status, v.reason).toBe('dead');
  });
  it('vein-drain: edict without faith → dead', () => {
    const v = playTower(vein, veinScripts['edict-without-faith']);
    expect(v.status, v.reason).toBe('dead');
  });
  it('vein-drain: answer then stop (想定解 1) → alive', () => {
    const v = playTower(vein, veinScripts['answer-then-stop']);
    expect(v.status, v.reason).toBe('alive');
  });
  it('vein-drain: ritual then stop (想定解 2) → alive', () => {
    const v = playTower(vein, veinScripts['ritual-then-stop']);
    expect(v.status, v.reason).toBe('alive');
  });
});

/**
 * 迎撃の塔 (M10-02、size 64、150 年)。LD: docs/design/2026-09-22-level-design-devices.md §4.1・§5・§8.2。
 * 星は三度落ちる (60/100/140)。星の門 (半径 12 の民 4.0 + 信仰 0.8) と工事 (備蓄 3.0、信仰 0.6) と薄い脈 (crystalScale 0.62)。
 * 儀式を最初から続ければ塔で待たずに星に上がり、三度撃てる。儀式を後回しにすると、信仰が 0.8 に届くまで塔で掘り続けて脈を
 * 無駄にし、三度目の備蓄が足りない。そのとき「止めよ」で脈を守れば間に合う。儀式をせず祈りに応えるだけでは 0.8 に届かず、一つ目が落ちる
 * (M21-01: 応えを UI と同じ手にすると応えだけで 0.8 に届き alive。下の answer-only と M21-03 を見よ)
 */
describe('intercept-tower scenario playthroughs (size 64)', { timeout: 900_000 }, () => {
  const def = defs.find((d) => d.id === 'intercept-tower');
  if (!def) throw new Error('scenario intercept-tower missing');
  /** 草の儀式: 集落へ同じ放流を 2 年ごと (信仰 +0.05/年、草は群れの餌にもなる) */
  const ritualFrom = (y0: number): Script => (r, s, y) => { if (y >= y0 && y % 2 === 0) r.intervene(spawnClick('grass', s.civ!.home)); };
  /** 備蓄が満ちたら撃つ */
  const fire: Script = (r, s) => { if ((s.civ?.works?.stock ?? 0) >= INTERCEPT_NEED) r.intervene({ type: 'intercept' }); };
  /**
   * 三度分の蓄えが成ったら「止めよ」(M10R-05)。星の工事も勅令で止まる。止めなければ脈が 10% を切って「星の砂を」が絶え間なく出て、
   * 無視のたびに信仰の上限が削れ (5 年に −0.1)、工事の門 0.6 を切って止まる (LD §8.1)
   */
  const stopAtStock = (need: number): Script => (r, s) => {
    const c = s.civ!;
    if (c.stage === 7 && !c.miningStopped && (c.works?.stock ?? 0) >= need && (c.faith ?? 0) >= 0.6) r.intervene({ type: 'civ_edict', edict: 'stop_mining' });
  };
  /** 塔で星の門 (群れ・信仰) が閉じている間は「止めよ」、開いたら「再開せよ」 */
  const edictLoop = (): Script => { let stopped = false; return (r, s) => {
    const c = s.civ!;
    if (c.stage === 6 && !stopped && (c.faith ?? 0) >= 0.6 && ((c.populationStar ?? 0) < 4.5 || (c.faith ?? 0) < 0.8)) { r.intervene({ type: 'civ_edict', edict: 'stop_mining' }); stopped = true; }
    if (stopped && (c.populationStar ?? 0) >= 4.5 && (c.faith ?? 0) >= 0.8) { r.intervene({ type: 'civ_edict', edict: 'resume_mining' }); stopped = false; }
  }; };
  /** 祈りにだけ応える (儀式はしない): 狼には疫病、雨には草 */
  const answerOnly: Script = (r, s) => {
    const p = s.civ?.prayer;
    if (!p || p.issuedYear !== s.year) return;
    if (p.kind === 'wolves') r.intervene(disasterClick('plague', s.civ!.home));
    if (p.kind === 'rain') r.intervene(spawnClick('grass', s.civ!.home));
  };
  const seq = (...fs: Script[]): Script => (r, s, y) => { for (const f of fs) f(r, s, y); };
  it('idle → dead (信仰が減衰して塔で止まり、一つ目の星が落ちる)', () => {
    const v = playTower(def, null);
    expect(v.status).toBe('dead');
  });
  // M21-01: 応えを UI と同じ手 (疫病 環 4・草 環 1) にすると、応えだけで信仰 0.88 に届いて 30 年目に星、50 年目までに三度砕き alive。
  // 以前の dead は環 6 の疫病で 50 年目の祈りが 1 回多く、信仰が工事の門 0.6 を割らずに脈を掘り尽くした偶然だった。応えだけで勝てる問題と、
  // 50 年で撃ち終わる後半の空白は M21-03 の LD で扱う (docs/specs/plans/2026-09-23-m21-01-ui-parity-audit.md §3)
  it('answer-only (儀式なし、祈りにだけ応える) → alive (応えで信仰 0.88、30 年目に星、50 年目までに三度砕く。M21-03 で作り直す)', () => {
    const v = playTower(def, seq(answerOnly, fire));
    expect(v.status, v.reason).toBe('alive');
    expect(v.reason).toContain('星を 3 回砕いた');
  });
  it('naive ritual without edict (儀式を最初から、止めよ無し) → dead (脈を掘り尽くし「星の砂を」の無視で上限が削れ、工事が止まり内乱で崩れる)', () => {
    const v = playTower(def, seq(ritualFrom(0), fire));
    expect(v.status).toBe('dead');
    expect(v.reason).toContain('文明の段階 0');
  });
  it('solution 1: ritual + stop at three loads (儀式を最初から、備蓄 9 で止めよ) → alive (三度砕く)', () => {
    const v = playTower(def, seq(ritualFrom(0), stopAtStock(9), fire));
    expect(v.status).toBe('alive');
    expect(v.reason).toContain('星を 3 回砕いた');
  });
  it('solution 2: ritual + stop at two loads (備蓄 6 で止めよ、残りは止める前の余りで) → alive', () => {
    const v = playTower(def, seq(ritualFrom(0), stopAtStock(6), fire));
    expect(v.status).toBe('alive');
    expect(v.reason).toContain('星を 3 回砕いた');
  });
  it('naive late ritual + edict loop (儀式を 20 年目から、門の間は止めよ、蓄えたら止めよ) → dead (儀式が遅いと三度分を蓄える前に脈が 10% を切り、失望で工事が止まる)', () => {
    // 計測 (M10R-05): 星に届くのが 36 年目、備蓄 9 は 84 年目。脈は 85 年目に 10% を切って「星の砂を」が絶え間なく出て、上限が 114 年目に 0.6 を割る
    const v = playTower(def, seq(ritualFrom(20), edictLoop(), stopAtStock(9), fire));
    expect(v.status, v.reason).toBe('dead');
    expect(v.reason).toContain('文明の段階');
  });
});

/**
 * 空の舟 (M10R-08 作り直し、size 64、200 年)。LD §8.9(仮説 → 部品 → 縮約モデル → 本体計測 A〜C)。
 * (M10-03 の旧校正: LD docs/design/2026-09-22-level-design-devices.md §4.2・§5・§8.3。帆@2787、沈没 0.0006/年。舟は材 (森+鐘樹) を伐って 120 まで進む。
 * 森は鹿に食われ、放ち続けても年 0.8 しか進まず 200 年に間に合わない。鐘樹は食われないので、植えながら着工 (25 年) でも、30 年育ててから着工 (43 年) でも飛べた。
 * ただし台本の放流が環 3 で UI の 10 倍だったため手では勝てず、M10R-08 で作り直した)
 * 薪の蓄えは 0、鐘樹は成長 0.0025・枯死 0.0005・拡散 0(植えた所にだけ立ち、伐っても戻るのは遅い)、
 * 舟は毎年一定量 6 を伐り成るまで 20 年(塔 4 + 舟 6 = 10/年 が林の持続収量を超え、着工した瞬間から林が痩せ始める)。
 * 0 年目に予定放流で「民の林」(鐘樹 環 4・0.6) が立ち、台本の放流は UI と同じ環 1・0.5 に揃える。
 * 問いは「いつ着工するか」: 早すぎれば帆が落ちて止まり(dead)、遅すぎれば陸と群れ・信仰の上限が削れて間に合わない(dead)。
 * 計測 C(民の林 環 4)の行列: 林だけ dead 175、薄い植え足し(c 0.5、L 20) dead 107〜111、早い着工(c 1、L 5) dead 77〜119、
 * L 20 escaped 40、L 45 escaped 65、遅い着工(c 1、L 100) dead(沈没と信仰の上限)
 */
describe('sky-ship scenario playthroughs (size 64)', { timeout: 900_000 }, () => {
  const def = defs.find((d) => d.id === 'sky-ship');
  if (!def) throw new Error('scenario sky-ship missing');
  const timber = (s: WorldSnapshot) => timberAround({ forest: s.layers.populations.forest, belltree: s.layers.populations.belltree }, s.civ!.home, LOAD_RADIUS[Math.max(1, s.civ!.stage)], s.layers.elevation, SIZE);
  /** 材と信仰が門を越えたら着工 */
  const launchWhenReady: Script = (r, s) => { if (!s.ship && timber(s) >= SHIP_FOREST_MIN && (s.civ?.faith ?? 0) >= 0.5) r.intervene({ type: 'launch_ship' }); };
  /** 集落の周りに同じ種を every 年ごとに放つ (儀式を兼ねる)。M10R-08 では鐘樹の放流に plantBelltree を使うが、forest-only の比較用に残す */
  const ring = (id: string, every: number): Script => (r, s, y) => { if (y % every === 0) r.intervene(spawnClick(id, s.civ!.home)); };
  const seq = (...fs: Script[]): Script => (r, s, y) => { for (const f of fs) f(r, s, y); };
  /** 集落半径 6 内で鐘樹の適地 (suitability > 0.6) を 2 セル以上離して集落に近い順に選ぶ。環 1 の放流 (5 セル) が敷き詰まる間隔 */
  function belltreeSitesAround(s: WorldSnapshot, home: number, radius: number): number[] {
    const bt = species.find((d) => d.id === 'belltree')!;
    const out: number[] = [];
    forEachInRadius(home, radius, SIZE, (i) => {
      if (s.layers.elevation[i] < SEA_LEVEL) return;
      if (suitability(bt, s.layers.temperature[i], s.layers.moisture[i]) <= 0.6) return;
      const x = i % SIZE, y = Math.floor(i / SIZE);
      if (out.every((c) => Math.hypot(x - (c % SIZE), y - Math.floor(c / SIZE)) >= 2)) out.push(i);
    });
    return out;
  }
  /** 毎年 clicksPerYear 回 (端数は繰り越し) 鐘樹を環 1・0.5 で植える。適地を近い順に一巡したら、鐘樹の最も薄い適地に植え直す */
  const plantBelltree = (clicksPerYear: number): Script => {
    let sites: number[] = []; let next = 0; let acc = 0;
    return (r, s, y) => {
      if (y < 1) return;
      if (sites.length === 0) sites = belltreeSitesAround(s, s.civ!.home, 6);
      acc += clicksPerYear;
      while (acc >= 1) {
        acc -= 1;
        const bt = s.layers.populations.belltree;
        const cell = next < sites.length ? sites[next++] : sites.reduce((a, b) => ((bt?.[a] ?? 0) <= (bt?.[b] ?? 0) ? a : b));
        r.intervene(spawnClick('belltree', cell));
      }
    };
  };
  /** L 年目以降、門 (材・信仰) を越えたら着工 */
  const launchAt = (L: number): Script => (r, s, y) => { if (y >= L) launchWhenReady(r, s, y); };
  it('idle → dead (林だけでは塔は立つが舟が無く、沈む)', () => {
    const v = playTower(def, null);
    expect(v.status).toBe('dead');
  });
  it('林だけ (植えずに 10 年目に着工) → dead (0 年目の民の林だけでは持続収量が足りず、着工しても帆が落ちる)', () => {
    const v = playTower(def, launchAt(10));
    expect(v.status).toBe('dead');
  });
  it('naive 薄い植え足し (2 年に 1 本、20 年目に着工) → dead (進み 111 で林が尽きて帆が落ちる)', () => {
    const v = playTower(def, seq(plantBelltree(0.5), launchAt(20)));
    expect(v.status).toBe('dead');
  });
  it('naive 早い着工 (毎年 1 本、5 年目に着工) → dead (進み 119 で林が尽きて止まる)', () => {
    const v = playTower(def, seq(plantBelltree(1), launchAt(5)));
    expect(v.status).toBe('dead');
  });
  it('naive 遅い着工 (毎年 1 本、100 年目に着工) → dead (沈没で林が痩せ、民の記憶=信仰の上限も削れている)', () => {
    const v = playTower(def, seq(plantBelltree(1), launchAt(100)));
    expect(v.status).toBe('dead');
  });
  it('solution 1: 毎年 1 本植えて 20 年目に着工 → escaped (40 年目)', () => {
    const v = playTower(def, seq(plantBelltree(1), launchAt(20)));
    expect(v.status).toBe('escaped');
    expect(v.reason).toContain('次の島へ');
  });
  it('solution 2: 毎年 1 本植えて 45 年目に着工 → escaped (65 年目)', () => {
    const v = playTower(def, seq(plantBelltree(1), launchAt(45)));
    expect(v.status).toBe('escaped');
    expect(v.reason).toContain('次の島へ');
  });
  it('naive forest-only (森を UI 並みの環 1・0.5 で 2 年ごとに放ち続ける) → dead (鹿に食われ、材が育たない)', () => {
    const v = playTower(def, seq(ring('forest', 2), launchWhenReady));
    expect(v.status).toBe('dead');
  });
});
