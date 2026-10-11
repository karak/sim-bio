import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { scenarioConfigOf } from '../../src/app/worldConfig';
import type { ScenarioDef } from '../../src/scenario/types';
import type { WorldConfig } from '../../src/simulation/types';
import { testConfig } from './helpers';

const { species, ...base } = testConfig({ civilization: { speciesId: 'grass', start: { stage: 1, home: 3 } } });
const def = (JSON.parse(readFileSync('assets/data/scenarios.json', 'utf8')) as ScenarioDef[])[0];
const withStart = (start: ScenarioDef['start']): ScenarioDef => ({ ...def, start });
const frozenBase = (): Omit<WorldConfig, 'species'> => structuredClone(base);

describe('舞台の島の設定 scenarioConfigOf (M27-03)', () => {
  it('石板が無ければ (自由モード・訪問) 既定と種の表のまま', () => {
    expect(scenarioConfigOf(base, species, null)).toEqual({ ...base, species });
  });

  it('start の無い石板も既定のまま (文明も消さない)', () => {
    expect(scenarioConfigOf(base, species, withStart(undefined))).toEqual({ ...base, species });
  });

  it('seed・size・気候・輝石の倍率を上書きし、書いていない項目は既定のまま', () => {
    const c = scenarioConfigOf(base, species, withStart({ seed: 7, size: 24, tempOffset: -3, rainScale: 0.5, crystalScale: 0.25 }));
    expect([c.seed, c.size, c.climate.tempOffset, c.climate.rainScale, c.crystalScale]).toEqual([7, 24, -3, 0.5, 0.25]);
    expect(c.climate.seasonAmplitudeTemp).toBe(base.climate.seasonAmplitudeTemp);
    expect(c.ticksPerYear).toBe(base.ticksPerYear);
    expect(scenarioConfigOf(base, species, withStart({ tempOffset: 2 })).climate.rainScale).toBe(base.climate.rainScale);
  });

  it('base を書き換えない (気候は写してから上書きする)', () => {
    const before = frozenBase();
    scenarioConfigOf(base, species, withStart({ tempOffset: 9, rainScale: 2, seed: 1 }));
    expect(base).toEqual(before);
  });

  it('種ごとの上書きは、その種の定義に重ねる (他の種はそのまま)', () => {
    const c = scenarioConfigOf(base, species, withStart({ species: { grass: { initialDensity: 0.9 } } }));
    expect(c.species.find((d) => d.id === 'grass')).toEqual({ ...species[0], initialDensity: 0.9 });
    expect(c.species.slice(1)).toEqual(species.slice(1));
  });

  it('文明 (M8-02): start があれば必ず置き換える。home -1 と省略は上書き後の size の中心、civilization の無い start は文明を消す', () => {
    const centre = scenarioConfigOf(base, species, withStart({ size: 21, civilization: { speciesId: 'forest', stage: 2 } }));
    expect(centre.civilization).toEqual({ speciesId: 'forest', start: { stage: 2, home: 10 * 21 + 10, fuelStock: undefined, prayer: undefined, faith: undefined, worksStock: undefined, shipProgress: undefined } });
    expect(scenarioConfigOf(base, species, withStart({ civilization: { speciesId: 'forest', home: -1 } })).civilization?.start?.home).toBe(16 * 32 + 16);
    expect(scenarioConfigOf(base, species, withStart({ civilization: { speciesId: 'forest', home: 5 } })).civilization?.start?.home).toBe(5);
    expect(scenarioConfigOf(base, species, withStart({ seed: 3 })).civilization).toBeUndefined();
  });

  it('火山セル (M8-08): -1 は上書き後の size の島の中心、ほかの値はそのまま、省略は World の既定に任せる (置かない)', () => {
    expect(scenarioConfigOf(base, species, withStart({ size: 21, volcanoCell: -1 })).volcanoCell).toBe(10 * 21 + 10);
    expect(scenarioConfigOf(base, species, withStart({ volcanoCell: 77 })).volcanoCell).toBe(77);
    expect('volcanoCell' in scenarioConfigOf(base, species, withStart({ seed: 3 }))).toBe(false);
  });
});
