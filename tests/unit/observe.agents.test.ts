import { describe, it, expect } from 'vitest';
import { extractArea, isLandAt, landmarks, type Area } from '../../src/observe/area';
import { targetCounts, reconcile } from '../../src/observe/population';
import {
  applyPlan,
  stepAgents,
  CARRY_EVERY,
  FALL_S,
  GATHER_BOARD_S,
  MAX_SPEED,
  RETURN_S,
  type Agent,
  type AgentInput,
  type AgentState,
  type AgentWorld,
} from '../../src/observe/agents';
import { mulberry32 } from '../../src/simulation/rng';
import { fakeSnapshot, OBS_HOME } from './observeFixtures';

const agent = (over: Partial<Agent> & Pick<Agent, 'id' | 'species' | 'x' | 'z'>): Agent => ({ role: 'wild', heading: 0, state: 'idle', t: 0, ...over });
const world = (agents: Agent[]): AgentWorld => ({ agents, nextId: Math.max(0, ...agents.map((a) => a.id)) + 1 });
const plainArea = extractArea(fakeSnapshot(), OBS_HOME, 8);
const input = (area: Area, over: Partial<AgentInput> = {}): AgentInput => ({
  area,
  marks: landmarks(area),
  night: false,
  building: false,
  launched: false,
  ...over,
});
const byId = (w: AgentWorld, id: number) => w.agents.find((a) => a.id === id);

describe('観察画面 (M22-04): 倒れた個体は生気に還って消える', () => {
  it(`fall は ${FALL_S} 秒横たわって return、return は ${RETURN_S} 秒で配列から消える`, () => {
    let w = world([agent({ id: 1, species: 'deer', x: 0, z: 0, state: 'fall' })]);
    const rng = mulberry32(1);
    const inp = input(plainArea);
    for (let i = 0; i < 15; i++) w = stepAgents(w, inp, 0.5, rng);
    expect(byId(w, 1)).toMatchObject({ state: 'fall', t: 7.5, x: 0, z: 0 });
    w = stepAgents(w, inp, 0.5, rng);
    expect(byId(w, 1)).toMatchObject({ state: 'return', t: 0 });
    for (let i = 0; i < 11; i++) w = stepAgents(w, inp, 0.5, rng);
    expect(byId(w, 1)).toMatchObject({ state: 'return', t: 5.5 });
    w = stepAgents(w, inp, 0.5, rng);
    expect(byId(w, 1)).toBeUndefined();
  });
});

describe('観察画面 (M22-04): 狩り (stalk → chase → fall → return)', () => {
  it('狩りの計画を当てると、狼が忍び寄り・追い、鹿が逃げて倒れ、還って消える。狼はふだんに戻る', () => {
    let w = world([agent({ id: 1, species: 'deer', x: 0, z: 0 }), agent({ id: 2, species: 'wolf', x: 30, z: 0 })]);
    w = applyPlan(w, { spawns: [], removals: [{ kind: 'hunt', agent: 1, hunter: 2 }], credit: 0 });
    expect(byId(w, 1)).toMatchObject({ state: 'flee', target: { agent: 2 } });
    expect(byId(w, 2)).toMatchObject({ state: 'stalk', target: { agent: 1 } });
    const rng = mulberry32(5);
    const inp = input(plainArea);
    const wolfStates = new Set<AgentState>();
    const deerStates: AgentState[] = [];
    let time = 0;
    while (byId(w, 1) && time < 60) {
      w = stepAgents(w, inp, 0.1, rng);
      time += 0.1;
      wolfStates.add(byId(w, 2)!.state);
      const d = byId(w, 1);
      if (d && deerStates[deerStates.length - 1] !== d.state) deerStates.push(d.state);
    }
    expect(deerStates).toEqual(['flee', 'fall', 'return']);
    expect(byId(w, 1)).toBeUndefined();
    expect(wolfStates.has('stalk')).toBe(true);
    expect(wolfStates.has('chase')).toBe(true);
    expect(['idle', 'walk', 'graze']).toContain(byId(w, 2)!.state);
    // 忍び寄り 6 秒 + 追い 15 秒 + 横たわる 8 秒 + 還る 6 秒 を超えない
    expect(time).toBeLessThanOrEqual(35.2);
  });

  it('狩り手がいなくなった獲物は、静かに縁へ出ていく (leave)', () => {
    let w = world([agent({ id: 1, species: 'deer', x: 0, z: 0, state: 'flee', target: { agent: 99 } })]);
    w = stepAgents(w, input(plainArea), 0.1, mulberry32(1));
    expect(byId(w, 1)?.state).toBe('leave');
  });

  it('狩りは狼と鹿が重なるところでだけ起きる: 鹿を減らし続けても、狼が遠ければ狩りは 1 度も起きず、近ければ起きる', () => {
    const run = (wolfX: number) => {
      // 鹿の目標は 0 (全部減らす)、狼の目標は狼のいるセルに 3 頭
      const area = extractArea(
        fakeSnapshot({ density: { wolf: (col, row) => (col === 16 + wolfX / 10 && row === 16 ? 3 / 8 : 0) } }),
        OBS_HOME,
        8,
      );
      const targets = targetCounts(area);
      let w = world([
        ...Array.from({ length: 6 }, (_, i) => agent({ id: i + 1, species: 'deer', x: -50 + i, z: 0, state: 'graze' })),
        ...Array.from({ length: 3 }, (_, i) => agent({ id: 10 + i, species: 'wolf', x: wolfX, z: i })),
      ]);
      const rng = mulberry32(3);
      const inp = input(area, { targets });
      let credit = 0;
      let hunts = 0;
      for (let f = 0; f < 200; f++) {
        const plan = reconcile(w.agents, targets, 2, 0.1, rng, credit);
        credit = plan.credit;
        hunts += plan.removals.filter((r) => r.kind === 'hunt').length;
        w = applyPlan(w, plan);
        w = stepAgents(w, inp, 0.1, rng);
        for (const a of w.agents) if (a.state === 'stalk' || a.state === 'chase') expect(a.species).toBe('wolf');
      }
      return hunts;
    };
    expect(run(50)).toBe(0);
    expect(run(-40)).toBeGreaterThan(0);
  });
});

describe('観察画面 (M22-04): 個体は海に踏み込まない', () => {
  it('海の帯と池のある区域で 5 分動かしても (出入り・狩りを含めて)、どの個体も毎刻み陸にいる', () => {
    const area = extractArea(
      fakeSnapshot({
        // 東の海 (col 21〜) と、集落の南東の池 (col 17〜18, row 17〜19)
        elevation: (col, row) => (col >= 21 || (col >= 17 && col <= 18 && row >= 17 && row <= 19) ? 0.2 : 0.4),
        density: { deer: () => 0.03, wolf: () => 0.02, rabbit: () => 0.02 },
      }),
      OBS_HOME,
      8,
    );
    const targets = targetCounts(area);
    let w: AgentWorld = { agents: [], nextId: 1 };
    const rng = mulberry32(21);
    const inp = input(area, { targets });
    let credit = 0;
    let steps = 0;
    for (let f = 0; f < 3000; f++) {
      const plan = reconcile(w.agents, targets, 4, 0.1, rng, credit);
      credit = plan.credit;
      w = applyPlan(w, plan);
      // 半分の時間は鹿の目標を 0 にして狩り・倒れる・出ていくを起こす
      if (f === 1500) Object.assign(targets, targetCounts(area, { deer: 2, wolf: 8, rabbit: 10 }));
      w = stepAgents(w, inp, 0.1, rng);
      for (const a of w.agents) {
        expect(isLandAt(area, a.x, a.z), `${a.species} ${a.id} ${a.state} at (${a.x.toFixed(1)}, ${a.z.toFixed(1)})`).toBe(true);
        steps++;
      }
    }
    expect(steps).toBeGreaterThan(3000 * 20);
  });

  it('沈降で足元が海になった個体は、最寄りの陸へ上がる', () => {
    const sunk = extractArea(fakeSnapshot({ elevation: (col) => (col >= 16 ? 0.2 : 0.4) }), OBS_HOME, 8);
    let w = world([agent({ id: 1, species: 'deer', x: 3, z: 0, state: 'graze' })]);
    const rng = mulberry32(2);
    for (let i = 0; i < 100; i++) w = stepAgents(w, input(sunk), 0.1, rng);
    expect(isLandAt(sunk, byId(w, 1)!.x, byId(w, 1)!.z)).toBe(true);
  });
});

describe('観察画面 (M22-04): 民 (知性ある月鹿)', () => {
  const area = extractArea(
    fakeSnapshot({
      elevation: (col) => (col >= 21 ? 0.2 : 0.4),
      density: { belltree: (col, row) => (col === 13 && row === 16 ? 1 : 0) },
    }),
    OBS_HOME,
    8,
  );
  const marks = landmarks(area);
  const herd = () =>
    world([
      ...Array.from({ length: 6 }, (_, i) => agent({ id: i + 1, species: 'deer', role: 'folk', x: i * 2 - 5, z: 5 })),
      agent({ id: 30, species: 'deer', role: 'wild', x: 0, z: -10 }),
    ]);

  it('建造中だけ、民の CARRY_EVERY 頭に 1 頭が林と船台の間を運ぶ。野生の鹿は運ばない。建造が止まると運ぶのをやめる', () => {
    expect(marks.grove).toEqual({ x: -30, z: 0 });
    expect(marks.slipway).toEqual({ x: 40, z: 0 });
    const rng = mulberry32(4);
    let w = herd();
    const idle = stepAgents(w, input(area), 0.1, rng);
    expect(idle.agents.filter((a) => a.state === 'carry')).toEqual([]);
    const reached = new Set<string>();
    for (let i = 0; i < 1500; i++) {
      w = stepAgents(w, input(area, { building: true }), 0.1, rng);
      for (const a of w.agents) {
        if (a.state === 'carry') {
          expect(a.role).toBe('folk');
          expect(a.id % CARRY_EVERY).toBe(0);
          reached.add(JSON.stringify(a.target));
        }
      }
    }
    expect(w.agents.filter((a) => a.state === 'carry').map((a) => a.id)).toEqual([3, 6]);
    // 林に着いて船台へ向きを変えた (材を曳いた) ことがある
    expect(reached.has(JSON.stringify(marks.slipway))).toBe(true);
    w = stepAgents(w, input(area, { building: false }), 0.1, rng);
    expect(w.agents.filter((a) => a.state === 'carry')).toEqual([]);
  });

  it('飛び立ちで民は船台に集い、20 秒で乗り込み、船台に留まる。野生の鹿は乗らない', () => {
    const rng = mulberry32(6);
    let w = herd();
    const inp = input(area, { launched: true });
    w = stepAgents(w, inp, 0.1, rng);
    expect(w.agents.filter((a) => a.role === 'folk').every((a) => a.state === 'gather')).toBe(true);
    let time = 0.1;
    while (time < GATHER_BOARD_S - 0.05) {
      w = stepAgents(w, inp, 0.1, rng);
      time += 0.1;
    }
    expect(w.agents.filter((a) => a.state === 'board')).toEqual([]);
    for (let i = 0; i < 600; i++) w = stepAgents(w, inp, 0.1, rng);
    const folk = w.agents.filter((a) => a.role === 'folk');
    expect(folk.every((a) => a.state === 'board')).toBe(true);
    for (const a of folk) expect(Math.hypot(a.x - marks.slipway.x, a.z - marks.slipway.z)).toBeLessThanOrEqual(1.01);
    expect(byId(w, 30)!.state).not.toBe('board');
    expect(byId(w, 30)!.state).not.toBe('gather');
  });

  it('夜は民が最寄りの灯りの 4 m 以内に寄り、朝になるとふだんに戻る', () => {
    const rng = mulberry32(8);
    let w = herd();
    for (let i = 0; i < 400; i++) w = stepAgents(w, input(area, { night: true }), 0.1, rng);
    for (const a of w.agents.filter((x) => x.role === 'folk')) {
      expect(a.state).toBe('gather');
      const near = Math.min(...marks.lanterns.map((l) => Math.hypot(a.x - l.x, a.z - l.z)));
      expect(near).toBeLessThanOrEqual(4.01);
    }
    expect(byId(w, 30)!.state).not.toBe('gather');
    w = stepAgents(w, input(area), 0.1, rng);
    expect(w.agents.filter((a) => a.state === 'gather')).toEqual([]);
  });
});

describe('観察画面 (M22-04): 実時間と決定論', () => {
  const setup = () => {
    const area = extractArea(fakeSnapshot({ density: { deer: () => 0.05, wolf: () => 0.02, rabbit: () => 0.03 } }), OBS_HOME, 8);
    return { area, targets: targetCounts(area) };
  };
  const simulate = (seed: number, frames: number, dt: number) => {
    const { area, targets } = setup();
    const rng = mulberry32(seed);
    let w: AgentWorld = { agents: [], nextId: 1 };
    let credit = 0;
    const trace: string[] = [];
    for (let f = 0; f < frames; f++) {
      const plan = reconcile(w.agents, targets, 3, dt, rng, credit);
      credit = plan.credit;
      w = applyPlan(w, plan);
      w = stepAgents(w, input(area, { targets }), dt, rng);
      if (f % 50 === 0) trace.push(w.agents.map((a) => `${a.id}:${a.state}:${a.x.toFixed(3)},${a.z.toFixed(3)}`).join('|'));
    }
    return { w, trace };
  };

  it('同じ種と入力なら同じ軌跡、種が違えば違う軌跡', () => {
    const a = simulate(42, 600, 1 / 30);
    const b = simulate(42, 600, 1 / 30);
    const c = simulate(43, 600, 1 / 30);
    expect(a.w).toEqual(b.w);
    expect(a.trace).toEqual(b.trace);
    expect(a.trace).not.toEqual(c.trace);
    expect(a.w.agents.length).toBeGreaterThan(20);
  });

  it('どの個体も 1 刻みで MAX_SPEED (9 m/s) × dt より遠くへ動かない。大きな dt (タブの復帰) も 1 秒で打ち切る', () => {
    const { area, targets } = setup();
    const rng = mulberry32(12);
    let w: AgentWorld = { agents: [], nextId: 1 };
    let credit = 0;
    let fastest = 0;
    for (let f = 0; f < 400; f++) {
      const dt = f % 100 === 99 ? 10 : 0.05;
      const plan = reconcile(w.agents, targets, 3, dt, rng, credit);
      credit = plan.credit;
      w = applyPlan(w, plan);
      const before = new Map(w.agents.map((a) => [a.id, a]));
      w = stepAgents(w, input(area, { targets }), dt, rng);
      for (const a of w.agents) {
        const p = before.get(a.id)!;
        const moved = Math.hypot(a.x - p.x, a.z - p.z);
        fastest = Math.max(fastest, moved / Math.min(dt, 1));
        expect(moved).toBeLessThanOrEqual(MAX_SPEED * Math.min(dt, 1) + 1e-9);
      }
    }
    expect(fastest).toBeGreaterThan(0.5);
  });

  it('鹿は群れる: ばらばらに置いた鹿は 2 分で重心に寄り、1 m より近くに重ならない', () => {
    const rng = mulberry32(31);
    const place = mulberry32(99);
    let w = world(Array.from({ length: 12 }, (_, i) => agent({ id: i + 1, species: 'deer', x: (place() - 0.5) * 40, z: (place() - 0.5) * 40, state: 'walk', target: { x: 0, z: 0 } })));
    const spread = (x: AgentWorld) => {
      const cx = x.agents.reduce((s, a) => s + a.x, 0) / x.agents.length;
      const cz = x.agents.reduce((s, a) => s + a.z, 0) / x.agents.length;
      return x.agents.reduce((s, a) => s + Math.hypot(a.x - cx, a.z - cz), 0) / x.agents.length;
    };
    const before = spread(w);
    for (let i = 0; i < 1200; i++) w = stepAgents(w, input(plainArea), 0.1, rng);
    expect(spread(w)).toBeLessThan(before * 0.8);
    let closest = Infinity;
    for (const a of w.agents) for (const b of w.agents) if (a.id < b.id) closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
    expect(closest).toBeGreaterThan(1);
  });
});
