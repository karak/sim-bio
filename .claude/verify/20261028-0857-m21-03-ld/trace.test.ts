// M21-03 LD の証跡 (製品コードではない)。迎撃の塔の手を年ごとに追う。tests/slow の playTower と台本を写した
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

const DIR = '.claude/verify/20261028-0857-m21-03-ld';
const species = JSON.parse(readFileSync('assets/data/species.json', 'utf8')) as SpeciesDef[];
const base = JSON.parse(readFileSync('assets/data/world.default.json', 'utf8')) as Omit<WorldConfig, 'species'>;
const defs = JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[];
const SIZE = 64;
type Script = (r: ScenarioRunner, s: WorldSnapshot, year: number) => void;
const def = defs.find((d) => d.id === 'intercept-tower')!;
const ritualFrom = (y0: number): Script => (r, s, y) => { if (y >= y0 && y % 2 === 0) r.intervene(spawnClick('grass', s.civ!.home)); };
const fire: Script = (r, s) => { if ((s.civ?.works?.stock ?? 0) >= INTERCEPT_NEED) r.intervene({ type: 'intercept' }); };
const stopAtStock = (need: number): Script => (r, s) => {
  const c = s.civ!;
  if (c.stage === 7 && !c.miningStopped && (c.works?.stock ?? 0) >= need && (c.faith ?? 0) >= 0.6) r.intervene({ type: 'civ_edict', edict: 'stop_mining' });
};
const answerOnly: Script = (r, s) => {
  const p = s.civ?.prayer;
  if (!p || p.issuedYear !== s.year) return;
  if (p.kind === 'wolves') r.intervene(disasterClick('plague', s.civ!.home));
  if (p.kind === 'rain') r.intervene(spawnClick('grass', s.civ!.home));
};
const seq = (...fs: Script[]): Script => (r, s, y) => { for (const f of fs) f(r, s, y); };
const scripts: Record<string, Script | null> = {
  idle: null,
  'answer-only': seq(answerOnly, fire),
  'ritual-only': seq(ritualFrom(0), fire),
  'ritual+stop9': seq(ritualFrom(0), stopAtStock(9), fire),
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
  const out: string[] = ['script\tyear\tstage\tfaith\tcap\tstock\tvein\tintercepted\tprayer\tanswered\tignored\twithdrawn\tmining_stopped\tpopStar'];
  const verdicts: string[] = [];
  for (const [name, script] of Object.entries(scripts)) {
    if (only && only !== name) continue;
    const cfg: WorldConfig = {
      ...structuredClone(base), size: SIZE, species: species.map((d) => ({ ...d })), seed: def.start?.seed ?? base.seed,
      civilization: resolveCivilizationStart(def.start?.civilization, SIZE), crystalScale: def.start?.crystalScale,
    };
    const w = World.create(cfg, { log: createMemorySink() });
    const r = createScenarioRunner(def, w, { ticksPerYear: cfg.ticksPerYear });
    let v = r.verdict();
    for (let y = 0; y <= def.years; y++) {
      const s = w.snapshot();
      script?.(r, s, y);
      v = r.update(s);
      const c = s.civ;
      if (c) out.push([name, y, c.stage, (c.faith ?? 0).toFixed(2), (c.faithCap ?? 0).toFixed(2), (c.works?.stock ?? 0).toFixed(2), vein(s).toFixed(2),
        c.intercepted ?? 0, c.prayer?.kind ?? '-', c.prayersAnswered ?? 0, c.prayersIgnored ?? 0, c.prayersWithdrawn ?? 0, c.miningStopped ? 1 : 0,
        (c.populationStar ?? 0).toFixed(2)].join('\t'));
      if (v.status !== 'running') break;
      w.step(cfg.ticksPerYear);
    }
    verdicts.push(`${name}\t${v.status}\t${v.reason}`);
    writeFileSync(`${DIR}/trace-${name}.tsv`, out.join('\n') + '\n');
    writeFileSync(`${DIR}/verdicts-${only ?? 'all'}.tsv`, verdicts.join('\n') + '\n');
  }
});
