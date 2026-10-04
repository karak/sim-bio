import { describe, it, expect } from 'vitest';
import { continueTargetOf, readLastStage, scenarioProgressOf, writeLastStage, type Continuation, type LastStage, type ScenarioProgress } from '../../src/persist/lastStage';
import type { SlotSummary } from '../../src/persist/slots';

const fakeStorage = () => {
  const items = new Map<string, string>();
  return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};
const KEY = 'biotope.last-stage';

describe('最後に遊んだ舞台の印 (M24-05、localStorage)', () => {
  it('書いた印をそのまま読む (自由モード・石板)', () => {
    const s = fakeStorage();
    writeLastStage(s, { stage: 'free' }, 100);
    expect(readLastStage(s)).toEqual({ stage: 'free', at: 100 });
    writeLastStage(s, { stage: 'scenario', scenarioId: 'test-quick' }, 200);
    expect(readLastStage(s)).toEqual({ stage: 'scenario', scenarioId: 'test-quick', at: 200 });
  });

  const broken: [why: string, raw: string | null][] = [
    ['無い', null],
    ['JSON でない', '{stage'],
    ['知らない舞台', '{"stage":"visit","at":1}'],
    ['時刻が数でない', '{"stage":"free","at":"1"}'],
    ['時刻が有限でない', '{"stage":"free","at":null}'],
    ['石板の id が無い', '{"stage":"scenario","at":1}'],
    ['石板の id が空', '{"stage":"scenario","scenarioId":"","at":1}'],
    ['配列', '[1]'],
    ['null', 'null'],
  ];
  it.each(broken)('壊れた印は無いものとして扱う: %s', (_why, raw) => {
    const s = fakeStorage();
    if (raw !== null) s.items.set(KEY, raw);
    expect(readLastStage(s)).toBeNull();
  });

  it('置き場が投げても (使えない localStorage) 読みは null、書きは何もしない', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readLastStage(throwing)).toBeNull();
    expect(() => writeLastStage(throwing, { stage: 'free' }, 1)).not.toThrow();
  });
});

describe('石板の続きの要約 scenarioProgressOf (M24-05)', () => {
  it('年は石板の初めの tick から数える (石板の板の年と同じ)。判定が出ていれば finished', () => {
    const save = { tick: 360 * 3 + 100 + 20, config: { ticksPerYear: 360 } };
    expect(scenarioProgressOf('test-quick', { save, runner: { startTick: 100, verdict: { status: 'running' } } })).toEqual({ scenarioId: 'test-quick', year: 3, finished: false });
    expect(scenarioProgressOf('test-quick', { save, runner: { startTick: 100, verdict: { status: 'dead' } } })).toEqual({ scenarioId: 'test-quick', year: 3, finished: true });
  });
});

describe('「続きから」の行き先 continueTargetOf (M24-05)', () => {
  const titleOf = (id: string) => ({ 'test-quick': '試し読み' })[id] ?? null;
  const auto: SlotSummary = { slot: 'auto', savedAt: 1000, year: 12, stage: 'free' };
  const running: ScenarioProgress = { scenarioId: 'test-quick', year: 2, finished: false };
  const atScenario = (at: number): LastStage => ({ stage: 'scenario', scenarioId: 'test-quick', at });
  const free: Continuation = { stage: 'free', year: 12, savedAt: 1000 };
  const scenario = (savedAt: number): Continuation => ({ stage: 'scenario', scenarioId: 'test-quick', title: '試し読み', year: 2, savedAt });

  const rows: [why: string, mark: LastStage | null, auto: SlotSummary | null, progress: ScenarioProgress | null, to: Continuation | null][] = [
    ['何も無ければ出さない', null, null, null, null],
    ['自由だけ (印が無くても自動の枠があれば自由モード)', null, auto, null, free],
    ['自由だけ (印も自由モード)', { stage: 'free', at: 2000 }, auto, null, free],
    ['石板だけ', atScenario(2000), null, running, scenario(2000)],
    ['両方で石板が新しい', atScenario(2000), auto, running, scenario(2000)],
    ['両方で同じ時刻なら石板 (印の舞台)', atScenario(1000), auto, running, scenario(1000)],
    ['両方で自由が新しい (別のタブで後から自由モードを遊んだ)', atScenario(500), auto, running, free],
    ['判定の出た石板は続きにしない (自由があれば自由)', atScenario(2000), auto, { ...running, finished: true }, free],
    ['判定の出た石板だけなら出さない', atScenario(2000), null, { ...running, finished: true }, null],
    ['印の石板に続きが無ければ自由', atScenario(2000), auto, null, free],
    ['印と違う石板の続きは使わない', atScenario(2000), null, { ...running, scenarioId: 'sinking' }, null],
    ['知らない石板 (一覧に無い id) は使わない', { stage: 'scenario', scenarioId: 'gone', at: 2000 }, auto, { ...running, scenarioId: 'gone' }, free],
    ['石板の枠 (自動の枠でない) は自由の続きにしない', null, { slot: 'auto', savedAt: 1000, year: 3, stage: 'scenario', scenarioId: 'test-quick' }, null, null],
  ];
  it.each(rows)('%s', (_why, mark, a, progress, to) => {
    expect(continueTargetOf(mark, a, progress, titleOf)).toEqual(to);
  });
});
