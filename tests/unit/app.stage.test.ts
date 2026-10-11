import { describe, it, expect } from 'vitest';
import type { ChronicleId } from '../../src/harbor/contract';
import type { ScenarioDef } from '../../src/scenario/types';
import { bootPlanOf } from '../../src/app/place';
import { stageOf } from '../../src/app/stage';

const quick = { id: 'test-quick' } as ScenarioDef;
const sinking = { id: 'sinking' } as ScenarioDef;
const scenarios = [quick, sinking];
const visitId = 'ab'.repeat(32) as ChronicleId;

describe('起動の舞台 stageOf (M27-05)', () => {
  it('石板の無い道は自由モード、石板だけなら石板、石板と訪問の道なら訪問 (その石板の島を組む)', () => {
    expect(stageOf(bootPlanOf('', scenarios, null))).toEqual({ kind: 'free' });
    expect(stageOf(bootPlanOf('?scenario=sinking', scenarios, null))).toEqual({ kind: 'scenario', def: sinking });
    expect(stageOf(bootPlanOf(`?scenario=sinking&visit=${visitId}`, scenarios, null))).toEqual({ kind: 'visit', id: visitId, def: sinking });
  });

  it('石板の無い訪問の道と知らない石板は自由モード (訪問の島を組めない)', () => {
    expect(stageOf(bootPlanOf(`?visit=${visitId}`, scenarios, null))).toEqual({ kind: 'free' });
    expect(stageOf(bootPlanOf(`?scenario=nope&visit=${visitId}`, scenarios, null))).toEqual({ kind: 'free' });
    expect(stageOf({ scenario: null, visitId })).toEqual({ kind: 'free' });
  });

  it('壊れた訪問の id は訪問にせず、石板で開く', () => {
    expect(stageOf(bootPlanOf('?scenario=test-quick&visit=zz', scenarios, null))).toEqual({ kind: 'scenario', def: quick });
  });
});
