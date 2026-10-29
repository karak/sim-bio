// M21-03 本体計測の証跡 (製品コードではない)。LD §6 の 8 行を 2 星 60・105 / 110 年で追う。
// 20261028-0857-m21-03-ld/trace.test.ts を写して足した。PROTO=1 なら試作 (globalThis.__k1Visible を works.ts が読む。コミットしない)、
// 無ければ本実装 (civ.starVisible を World が持つ) の上で回す
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { World } from '../../../src/simulation/World';
import { createMemorySink } from '../../../src/core/log/memorySink';
import { createScenarioRunner, type ScenarioRunner } from '../../../src/scenario/ScenarioRunner';
import type { ScenarioDef } from '../../../src/scenario/types';
import type { SpeciesDef, WorldConfig, WorldSnapshot } from '../../../src/simulation/types';
import { resolveCivilizationStart, MINE_RADIUS, MAX_STAGE } from '../../../src/simulation/civilization';
import { forEachInRadius } from '../../../src/simulation/disaster';
import { SEA_LEVEL } from '../../../src/simulation/terrain';
import { INTERCEPT_NEED } from '../../../src/simulation/works';
import { disasterClick, spawnClick } from '../../../src/simulation/commands';

const DIR = '.claude/verify/20261029-0922-m21-03-impl';
const PROTO = process.env.PROTO === '1';
const W = 12;
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
const SIZE = 64;
type Script = (r: ScenarioRunner, s: WorldSnapshot, year: number) => void;
const orig = defs.find((d) => d.id === 'intercept-tower')!;
const meteor = orig.schedule[0];
// 試作では 2 星 60・105 / 110 年と勝ちの条件 2 回をここで被せる。本実装では scenarios.json がそうなっている
const def: ScenarioDef = PROTO
  ? {
      ...orig,
      years: 110,
      schedule: [{ ...meteor, atYear: 60 }, { ...meteor, atYear: 105 }],
      alive: { type: 'all', of: [{ type: 'intercepted', min: 2 }, { type: 'civ_stage', min: 6, years: 5 }] },
    }
  : orig;
/** 星が見えているか (プレイヤーが石板で読めるもの)。試作は runner の次の星の年から、本実装は civ.starVisible */
const visible = (r: ScenarioRunner, s: WorldSnapshot, y: number) => {
  if (!PROTO) return (s.civ as { starVisible?: boolean } | null)?.starVisible === true;
  const n = r.nextMeteorYear();
  return n !== null && y >= n - W;
};
const ritualFrom = (y0: number): Script => (r, s, y) => { if (y >= y0 && y % 2 === 0) r.intervene(spawnClick('grass', s.civ!.home)); };
const fire: Script = (r, s) => { if ((s.civ?.works?.stock ?? 0) >= INTERCEPT_NEED) r.intervene({ type: 'intercept' }); };
const stop = (r: ScenarioRunner) => r.intervene({ type: 'civ_edict', edict: 'stop_mining' });
const resume = (r: ScenarioRunner) => r.intervene({ type: 'civ_edict', edict: 'resume_mining' });
const stopAtStock = (need: number): Script => (r, s) => {
  const c = s.civ!;
  if (c.stage === 7 && !c.miningStopped && (c.works?.stock ?? 0) >= need && (c.faith ?? 0) >= 0.6) stop(r);
};
const answerOnly: Script = (r, s) => {
  const p = s.civ?.prayer;
  if (!p || p.issuedYear !== s.year) return;
  if (p.kind === 'wolves') r.intervene(disasterClick('plague', s.civ!.home));
  if (p.kind === 'rain') r.intervene(spawnClick('grass', s.civ!.home));
};
/** 星に届いたら止めよ。以後は再開しない (止まるまで毎年言う。信仰が門を割っていれば民は聞かない) */
const stopAtStar: Script = (r, s) => { if (s.civ?.stage === 7 && !s.civ.miningStopped && (s.civ.intercepted ?? 0) === 0 && (s.civ.works?.stock ?? 0) < INTERCEPT_NEED) stop(r); };
/**
 * 窓のリズム: 星が見えていて止まっていれば再開せよ。星が見えず掘っていれば止めよ。
 * 想定解 1 は星に届いた時から止める。想定解 2 は一度目を砕いた後だけ止める (星に届いてから一度目までは掘りっぱなし)
 */
const windowRhythm = (o: { onlyAfterFirst: boolean }): Script => (r, s, y) => {
  const c = s.civ;
  if (!c || c.stage < 7) return;
  if (visible(r, s, y)) { if (c.miningStopped) resume(r); return; }
  if (c.miningStopped) return;
  if (!o.onlyAfterFirst || (c.intercepted ?? 0) === 1) stop(r);
};
const seq = (...fs: Script[]): Script => (r, s, y) => { for (const f of fs) f(r, s, y); };
const scripts: Record<string, Script | null> = {
  idle: null,
  'answer-only': seq(answerOnly, fire),
  'ritual-only': seq(ritualFrom(0), fire),
  'no-edict': seq(ritualFrom(0), answerOnly, fire),
  'old-solution-stop9': seq(ritualFrom(0), stopAtStock(9), fire),
  'stop-only': seq(ritualFrom(0), stopAtStar, fire),
  'solution-1': seq(ritualFrom(0), windowRhythm({ onlyAfterFirst: false }), fire),
  'solution-2': seq(ritualFrom(0), answerOnly, windowRhythm({ onlyAfterFirst: true }), fire),
};
const vein = (s: WorldSnapshot) => {
  const c = s.civ;
  if (!c || c.home < 0) return 0;
  let t = 0;
  forEachInRadius(c.home, MINE_RADIUS[MAX_STAGE], SIZE, (i) => { if (s.layers.elevation[i] >= SEA_LEVEL) t += s.layers.crystal[i]; });
  return t;
};

it('trace', () => {
  const only = process.env.TRACE_ONLY;
  const tag = PROTO ? 'proto' : 'impl';
  const verdicts: string[] = ['script\tstatus\tyear\treason'];
  for (const [name, script] of Object.entries(scripts)) {
    if (only && only !== name) continue;
    const out: string[] = ['script\tyear\tstage\tfaith\tcap\tstock\tvein\tvisible\tintercepted\tprayer\tanswered\tignored\tmining_stopped\tpopStar'];
    const g = globalThis as { __k1Visible?: boolean };
    const cfg: WorldConfig = {
      ...structuredClone(base), size: SIZE, species: species.map((d) => ({ ...d })), seed: def.start?.seed ?? base.seed,
      civilization: resolveCivilizationStart(def.start?.civilization, SIZE), crystalScale: def.start?.crystalScale,
    };
    const w = World.create(cfg, { log: createMemorySink() });
    const r = createScenarioRunner(def, w, { ticksPerYear: cfg.ticksPerYear });
    let v = r.verdict();
    let year = 0;
    for (let y = 0; y <= def.years; y++) {
      year = y;
      const s = w.snapshot();
      script?.(r, s, y);
      v = r.update(s);
      if (PROTO) { const n = r.nextMeteorYear(); g.__k1Visible = n !== null && y >= n - W; }
      const c = s.civ;
      const vis = PROTO ? g.__k1Visible : (c as { starVisible?: boolean } | null)?.starVisible;
      if (c) out.push([name, y, c.stage, (c.faith ?? 0).toFixed(2), (c.faithCap ?? 0).toFixed(2), (c.works?.stock ?? 0).toFixed(2), vein(s).toFixed(2),
        vis ? 1 : 0, c.intercepted ?? 0, c.prayer?.kind ?? '-', c.prayersAnswered ?? 0, c.prayersIgnored ?? 0, c.miningStopped ? 1 : 0,
        (c.populationStar ?? 0).toFixed(2)].join('\t'));
      if (v.status !== 'running') break;
      w.step(cfg.ticksPerYear);
    }
    delete g.__k1Visible;
    verdicts.push(`${name}\t${v.status}\t${year}\t${v.reason}`);
    writeFileSync(`${DIR}/trace-${tag}-${name}.tsv`, out.join('\n') + '\n');
    writeFileSync(`${DIR}/verdicts-${tag}-${only ?? 'all'}.tsv`, verdicts.join('\n') + '\n');
  }
});
