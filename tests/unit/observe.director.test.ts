import { describe, it, expect } from 'vitest';
import {
  directorContext,
  initialDirector,
  nextShot,
  stepDirector,
  IDLE_RETURN_S,
  PREEMPT_AFTER_S,
  SHOT_MAX_S,
  SHOT_MIN_S,
  type DirectorContext,
  type DirectorState,
  type ShotKind,
} from '../../src/observe/director';
import type { Landmarks } from '../../src/observe/area';
import type { Agent } from '../../src/observe/agents';
import type { SceneEvent } from '../../src/observe/scenes';
import { mulberry32 } from '../../src/simulation/rng';

const marks: Landmarks = {
  center: { x: 0, z: 0 },
  grove: { x: -30, z: 0 },
  slipway: { x: 40, z: 0 },
  lanterns: [{ x: 0, z: 0 }],
  coast: { x: 70, z: 10 },
};
const ctx = (over: Partial<DirectorContext> = {}): DirectorContext => ({ marks, hunt: null, folk: null, herd: null, ...over });
const full = ctx({ hunt: { hunter: 7, prey: 3 }, folk: { agent: 12, state: 'carry' }, herd: { agent: 4, size: 6 } });
const ship: SceneEvent = { kind: 'shipStage', stage: 'ribs', from: 'keel' };
const state = (over: Partial<DirectorState> = {}): DirectorState => ({ ...initialDirector(), ...over });

describe('観察画面 (M22-04): ショットの優先 (場面 > 狩り > 民 > 群れ > 風景)', () => {
  it('場面の引き金があれば場面、無ければ狩り、民、群れ、風景の順に選ぶ', () => {
    const rng = mulberry32(1);
    expect(nextShot(state({ pending: [ship] }), full, rng).shot).toMatchObject({ kind: 'shipLookUp', subject: { x: 40, z: 0 }, reason: 'scene', scene: ship });
    expect(nextShot(state(), full, rng).shot).toMatchObject({ kind: 'huntFollow', subject: { agent: 7 }, reason: 'hunt' });
    expect(nextShot(state(), ctx({ folk: full.folk, herd: full.herd }), rng).shot).toMatchObject({ kind: 'groveTrack', subject: { agent: 12 }, reason: 'folk' });
    expect(nextShot(state(), ctx({ herd: full.herd }), rng).shot).toMatchObject({ kind: 'herdClose', subject: { agent: 4 }, reason: 'herd' });
    expect(nextShot(state(), ctx(), rng).shot.reason).toBe('landscape');
  });

  it('使った場面の引き金は pending から除く', () => {
    const rain: SceneEvent = { kind: 'rain', year: 3 };
    const n = nextShot(state({ pending: [ship, rain] }), full, mulberry32(1));
    expect(n.pending).toEqual([rain]);
  });

  it('優先の高い候補が直前と同じ種類なら次に譲り、場面の引き金は次のショットまで待つ', () => {
    const rng = mulberry32(2);
    const n = nextShot(state({ lastKind: 'shipLookUp', pending: [ship] }), full, rng);
    expect(n.shot).toMatchObject({ kind: 'huntFollow', reason: 'hunt' });
    expect(n.pending).toEqual([ship]);
    const again = nextShot(state({ lastKind: 'huntFollow', pending: n.pending }), full, rng);
    expect(again.shot).toMatchObject({ kind: 'shipLookUp', reason: 'scene' });
  });

  it('風景は直前と違う種類 (海岸の引き・林の横移動・集落の俯瞰) から選ぶ', () => {
    const rng = mulberry32(3);
    for (const last of ['coastWide', 'groveTrack', 'settlementHigh'] as ShotKind[]) {
      for (let i = 0; i < 20; i++) {
        const s = nextShot(state({ lastKind: last }), ctx(), rng).shot;
        expect(s.reason).toBe('landscape');
        expect(s.kind).not.toBe(last);
        expect(['coastWide', 'groveTrack', 'settlementHigh']).toContain(s.kind);
      }
    }
  });

  it('場面ごとのショット: 飛び立ち → 舟を見上げる、帆を失う → 集落の俯瞰、芽吹き → 林 (植えた場所)、沈む → 海岸の引き', () => {
    const rng = mulberry32(4);
    const pick = (e: SceneEvent) => nextShot(state({ pending: [e] }), ctx(), rng).shot;
    expect(pick({ kind: 'departure', year: 40 })).toMatchObject({ kind: 'shipLookUp', subject: marks.slipway });
    expect(pick({ kind: 'sailLost' })).toMatchObject({ kind: 'settlementHigh', subject: marks.center });
    expect(pick({ kind: 'sprout', year: 1, cell: 5, at: { x: 20, z: -10 }, speciesId: 'belltree', radius: 0 })).toMatchObject({ kind: 'groveTrack', subject: { x: 20, z: -10 } });
    expect(pick({ kind: 'sinking', from: 185, to: 184 })).toMatchObject({ kind: 'coastWide', subject: marks.coast });
    expect(pick({ kind: 'ending', year: 40, status: 'escaped' })).toMatchObject({ kind: 'shipLookUp' });
  });
});

describe('観察画面 (M22-04): ショットの流れ', () => {
  it('30 分回しても同じ種類が続かず、長さは 12〜20 秒', () => {
    const rng = mulberry32(5);
    const world = mulberry32(6);
    let s = initialDirector();
    const kinds: ShotKind[] = [];
    let changes = 0;
    for (let f = 0; f < 30 * 60 * 10; f++) {
      const c = ctx({
        hunt: world() < 0.3 ? { hunter: 1, prey: 2 } : null,
        folk: world() < 0.5 ? { agent: 3, state: world() < 0.5 ? 'carry' : 'gather' } : null,
        herd: world() < 0.7 ? { agent: 4, size: 5 } : null,
      });
      const scenes: SceneEvent[] = world() < 0.002 ? [ship] : [];
      const prev = s.shot;
      s = stepDirector(s, c, { dt: 0.1, scenes, userInput: false }, rng);
      if (s.shot !== prev && s.shot) {
        kinds.push(s.shot.kind);
        changes++;
        expect(s.shot.duration).toBeGreaterThanOrEqual(SHOT_MIN_S);
        expect(s.shot.duration).toBeLessThanOrEqual(SHOT_MAX_S);
      }
    }
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    expect(changes).toBeGreaterThan(90);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(5);
  });

  it(`走っているショットより優先の高い場面は ${PREEMPT_AFTER_S} 秒映した後に割り込む。群れ → 民のような下位の候補では割り込まない`, () => {
    const rng = mulberry32(7);
    let s = stepDirector(initialDirector(), ctx({ herd: full.herd }), { dt: 0.1, scenes: [], userInput: false }, rng);
    expect(s.shot?.kind).toBe('herdClose');
    s = stepDirector(s, ctx({ herd: full.herd, folk: full.folk }), { dt: 1, scenes: [ship], userInput: false }, rng);
    expect(s.shot?.kind).toBe('herdClose');
    for (let i = 0; i < 2; i++) s = stepDirector(s, ctx({ herd: full.herd, folk: full.folk }), { dt: 1, scenes: [], userInput: false }, rng);
    expect(s.shot?.kind).toBe('herdClose');
    s = stepDirector(s, ctx({ herd: full.herd, folk: full.folk }), { dt: 1, scenes: [], userInput: false }, rng);
    expect(s.shot).toMatchObject({ kind: 'shipLookUp', reason: 'scene' });
    expect(s.elapsed).toBe(0);

    let h = stepDirector(initialDirector(), ctx({ herd: full.herd }), { dt: 0.1, scenes: [], userInput: false }, rng);
    for (let i = 0; i < 8; i++) h = stepDirector(h, ctx({ herd: full.herd, folk: full.folk }), { dt: 1, scenes: [], userInput: false }, rng);
    expect(h.shot?.kind).toBe('herdClose');
    h = stepDirector(h, ctx({ herd: full.herd, hunt: full.hunt }), { dt: 1, scenes: [], userInput: false }, rng);
    expect(h.shot?.kind).toBe('huntFollow');
  });

  it(`操作で自由カメラになり、${IDLE_RETURN_S} 秒触らないと自動に戻って次のショットを選ぶ。その間の場面は取っておく`, () => {
    const rng = mulberry32(8);
    let s = stepDirector(initialDirector(), full, { dt: 0.1, scenes: [], userInput: false }, rng);
    expect(s.mode).toBe('auto');
    s = stepDirector(s, full, { dt: 0.1, scenes: [], userInput: true }, rng);
    expect(s).toMatchObject({ mode: 'free', shot: null, idle: 0 });
    for (let i = 0; i < 199; i++) s = stepDirector(s, full, { dt: 0.1, scenes: i === 50 ? [ship] : [], userInput: false }, rng);
    expect(s.mode).toBe('free');
    expect(s.idle).toBeCloseTo(19.9);
    s = stepDirector(s, full, { dt: 0.1, scenes: [], userInput: true }, rng);
    expect(s.idle).toBe(0);
    for (let i = 0; i < 201; i++) s = stepDirector(s, full, { dt: 0.1, scenes: [], userInput: false }, rng);
    expect(s.mode).toBe('auto');
    expect(s.shot).toMatchObject({ kind: 'shipLookUp', reason: 'scene', scene: ship });
    expect(s.pending).toEqual([]);
  });
});

describe('観察画面 (M22-04): directorContext', () => {
  const a = (over: Partial<Agent> & Pick<Agent, 'id' | 'species'>): Agent => ({ role: 'wild', x: 0, z: 0, heading: 0, state: 'idle', t: 0, ...over });

  it('狩りの狼・仕事中の民・最も大きい群れ (3 頭以上) を拾う', () => {
    const agents: Agent[] = [
      a({ id: 1, species: 'deer', x: 0 }),
      a({ id: 2, species: 'deer', x: 3 }),
      a({ id: 3, species: 'deer', x: 60 }),
      a({ id: 4, species: 'deer', x: 6, state: 'graze' }),
      a({ id: 5, species: 'deer', state: 'flee', target: { agent: 9 } }),
      a({ id: 9, species: 'wolf', x: 20, state: 'chase', target: { agent: 5 } }),
      a({ id: 11, species: 'deer', role: 'folk', x: -40, state: 'carry', target: { x: -30, z: 0 } }),
    ];
    expect(directorContext(agents, marks)).toEqual({ marks, hunt: { hunter: 9, prey: 5 }, folk: { agent: 11, state: 'carry' }, herd: { agent: 1, size: 3 } });
    expect(directorContext(agents.slice(0, 3), marks).herd).toBeNull();
  });
});
