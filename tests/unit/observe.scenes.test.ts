import { describe, it, expect } from 'vitest';
import { extractArea } from '../../src/observe/area';
import { shipStage, detectScenes, sceneFrame, SHIP_STAGE_AT, type SceneFrame } from '../../src/observe/scenes';
import type { TimelineEvent } from '../../src/scenario/ScenarioRunner';
import { SHIP_NEED } from '../../src/simulation/ship';
import { fakeSnapshot, OBS_HOME, OBS_SIZE } from './observeFixtures';

const area = extractArea(fakeSnapshot(), OBS_HOME, 8);
const frame = (over: Partial<SceneFrame> = {}): SceneFrame => ({ ship: null, civStage: 5, landCount: 197, ...over });
const building = (progress: number) => frame({ ship: { startedYear: 20, progress } });

describe('観察画面 (M22-04): 舟の段階', () => {
  it('竜骨 0〜24、肋 24〜48、板 48〜72、帆柱 72〜96、帆 96〜120、120 で done (下限を含む)', () => {
    expect([0, 23.9, 24, 47.9, 48, 71.9, 72, 95.9, 96, 119.9, 120, 130].map(shipStage)).toEqual([
      'keel', 'keel', 'ribs', 'ribs', 'planks', 'planks', 'mast', 'mast', 'sails', 'sails', 'done', 'done',
    ]);
    expect(SHIP_STAGE_AT.done).toBe(SHIP_NEED);
  });

  it('段階が変わったフレームだけ shipStage を出す。着工は keel、初回は今の段階を一度出す', () => {
    expect(detectScenes(frame(), building(0), [], area)).toEqual([{ kind: 'shipStage', stage: 'keel', from: null }]);
    expect(detectScenes(building(6), building(12), [], area)).toEqual([]);
    expect(detectScenes(building(18), building(24), [], area)).toEqual([{ kind: 'shipStage', stage: 'ribs', from: 'keel' }]);
    expect(detectScenes(building(114), building(120), [], area)).toEqual([{ kind: 'shipStage', stage: 'done', from: 'sails' }]);
    expect(detectScenes(null, building(80), [], area)).toEqual([{ kind: 'shipStage', stage: 'mast', from: null }]);
  });
});

describe('観察画面 (M22-04): 飛び立ち・帆を失う・沈む・終わり', () => {
  it('launchedYear が付いたフレームで departure を一度だけ出す', () => {
    const done = building(120);
    const launched = frame({ ship: { startedYear: 20, progress: 120, launchedYear: 40 } });
    expect(detectScenes(done, launched, [], area)).toEqual([{ kind: 'departure', year: 40 }]);
    expect(detectScenes(launched, launched, [], area)).toEqual([]);
  });

  it('建造中に文明が帆 (5) を下回ったフレームで sailLost を一度だけ出す。舟が無い・飛び立った後は出さない', () => {
    expect(detectScenes(building(30), { ...building(30), civStage: 4 }, [], area)).toEqual([{ kind: 'sailLost' }]);
    expect(detectScenes({ ...building(30), civStage: 4 }, { ...building(30), civStage: 3 }, [], area)).toEqual([]);
    expect(detectScenes(building(30), { ...building(30), civStage: null }, [], area)).toEqual([{ kind: 'sailLost' }]);
    expect(detectScenes(frame(), frame({ civStage: 4 }), [], area)).toEqual([]);
    const launched = { startedYear: 20, progress: 120, launchedYear: 40 };
    expect(detectScenes(frame({ ship: launched }), frame({ ship: launched, civStage: 4 }), [], area)).toEqual([]);
  });

  it('区域の陸セルが減ったフレームで sinking を出す (増えた・同じなら出さない)', () => {
    expect(detectScenes(frame({ landCount: 185 }), frame({ landCount: 183 }), [], area)).toEqual([{ kind: 'sinking', from: 185, to: 183 }]);
    expect(detectScenes(frame({ landCount: 183 }), frame({ landCount: 183 }), [], area)).toEqual([]);
    expect(detectScenes(null, frame({ landCount: 100 }), [], area)).toEqual([]);
  });

  it('判定 dead / escaped で ending を出す。running・alive では出さない', () => {
    const v = (status: 'dead' | 'escaped' | 'alive' | 'running'): TimelineEvent => ({ year: 40, kind: 'verdict', verdict: { status, reason: '' } });
    expect(detectScenes(frame(), frame(), [v('escaped')], area)).toEqual([{ kind: 'ending', year: 40, status: 'escaped' }]);
    expect(detectScenes(frame(), frame(), [v('dead')], area)).toEqual([{ kind: 'ending', year: 40, status: 'dead' }]);
    expect(detectScenes(frame(), frame(), [v('alive'), v('running')], area)).toEqual([]);
  });

  it('sceneFrame は snapshot の舟・文明の段階と区域の陸の数を写す', () => {
    const s = fakeSnapshot({ ship: { startedYear: 20, progress: 50 }, civ: { stage: 6 } });
    expect(sceneFrame(s, area)).toEqual({ ship: { startedYear: 20, progress: 50 }, civStage: 6, landCount: 197 });
    expect(sceneFrame(fakeSnapshot({ civ: null }), area).civStage).toBeNull();
  });
});

describe('観察画面 (M22-04): 介入の演出は区域の中だけ', () => {
  const inside = OBS_HOME - 2 * OBS_SIZE + 3; // 集落から北へ 2、東へ 3
  const outside = 2 * OBS_SIZE + 2;
  const iv = (command: Extract<TimelineEvent, { kind: 'intervene' }>['command']): TimelineEvent => ({ year: 12, kind: 'intervene', command });

  it('区域の中の spawn_species は芽吹き、plague は霧。位置は区域の座標 (m)', () => {
    const got = detectScenes(frame(), frame(), [
      iv({ type: 'spawn_species', speciesId: 'belltree', cell: inside, amount: 0.3, radius: 2 }),
      iv({ type: 'disaster', kind: 'plague', cell: inside, radius: 3 }),
    ], area);
    expect(got).toEqual([
      { kind: 'sprout', year: 12, cell: inside, at: { x: 30, z: -20 }, speciesId: 'belltree', radius: 2 },
      { kind: 'mist', year: 12, cell: inside, at: { x: 30, z: -20 }, radius: 3 },
    ]);
  });

  it('区域の外の介入・疫病以外の災害・予定の出来事は引き金にしない', () => {
    const got = detectScenes(frame(), frame(), [
      iv({ type: 'spawn_species', speciesId: 'belltree', cell: outside, amount: 0.3 }),
      iv({ type: 'disaster', kind: 'plague', cell: outside, radius: 3 }),
      iv({ type: 'disaster', kind: 'meteor', cell: inside, radius: 3 }),
      { year: 12, kind: 'scheduled', command: { type: 'spawn_species', speciesId: 'deer', cell: inside, amount: 1 } },
    ], area);
    expect(got).toEqual([]);
  });

  it('雨を増やす set_climate は雨、減らす・気温だけなら出さない', () => {
    const got = detectScenes(frame(), frame(), [
      iv({ type: 'set_climate', rainScale: 1.5 }),
      iv({ type: 'set_climate', rainScale: 0.7 }),
      iv({ type: 'set_climate', tempOffset: 2 }),
    ], area);
    expect(got).toEqual([{ kind: 'rain', year: 12 }]);
  });
});
