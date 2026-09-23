import { describe, it, expect } from 'vitest';
import { extractArea } from '../../src/observe/area';
import { targetCounts, reconcile, folkRuleFor, K_DEFAULT, FALL_SHARE, type Targets } from '../../src/observe/population';
import { applyPlan, isPresent, type Agent, type AgentWorld } from '../../src/observe/agents';
import { mulberry32 } from '../../src/simulation/rng';
import { fakeSnapshot, OBS_HOME, OBS_SIZE } from './observeFixtures';

const agent = (over: Partial<Agent> & Pick<Agent, 'id' | 'species' | 'x' | 'z'>): Agent => ({ role: 'wild', heading: 0, state: 'idle', t: 0, ...over });
const present = (w: AgentWorld, sp: Agent['species']) => w.agents.filter((a) => a.species === sp && isPresent(a)).length;

describe('観察画面 (M22-04): targetCounts — 頭数は密度に比例する', () => {
  it('一様な密度なら区域の頭数 = round(Σ 密度 × K)、密度を倍にすると頭数も倍になる (鹿 10・狼 8・兎 10)', () => {
    const at = (d: number) => targetCounts(extractArea(fakeSnapshot({ density: { deer: () => d, wolf: () => d, rabbit: () => d } }), OBS_HOME, 8));
    const one = at(0.02);
    // 197 セル × 0.02 × 10 = 39.4 → 39、狼は × 8 = 31.52 → 32
    expect(one.totals).toEqual({ deer: 39, wolf: 32, rabbit: 39 });
    const two = at(0.04);
    expect(two.totals).toEqual({ deer: 79, wolf: 63, rabbit: 79 });
    expect(K_DEFAULT).toEqual({ deer: 10, wolf: 8, rabbit: 10 });
  });

  it('セルの頭数は密度に比例し、セルの頭数の和が区域の頭数と一致する (薄い密度でも 0 に丸めない)', () => {
    const snap = fakeSnapshot({
      density: { deer: (col, row) => (col === 16 && row === 16 ? 2.0 : col === 17 && row === 16 ? 1.0 : 0.02) },
    });
    const t = targetCounts(extractArea(snap, OBS_HOME, 8));
    expect(t.perCell.deer.get(OBS_HOME)).toBe(20);
    expect(t.perCell.deer.get(OBS_HOME + 1)).toBe(10);
    const sum = [...t.perCell.deer.values()].reduce((s, v) => s + v, 0);
    // 20 + 10 + 195 セル × 0.2 = 69。残りの 195 セルは floor で 0、端数の大きい順 (同じ端数は index の小さい順) に 39 セルへ 1 頭ずつ
    expect(t.totals.deer).toBe(69);
    expect(sum).toBe(69);
    const ones = [...t.perCell.deer.entries()].filter(([, v]) => v === 1).map(([k]) => k);
    expect(ones.length).toBe(39);
    expect(Math.max(...ones)).toBeLessThan(OBS_HOME);
  });

  it('海のセルには頭数を置かない', () => {
    const snap = fakeSnapshot({ elevation: (col) => (col >= 20 ? 0.25 : 0.4), density: { deer: () => 0.5 } });
    const area = extractArea(snap, OBS_HOME, 8);
    const t = targetCounts(area);
    const seaCells = area.cells.filter((c) => !c.isLand);
    expect(seaCells.length).toBeGreaterThan(0);
    for (const c of seaCells) expect(t.perCell.deer.has(c.index)).toBe(false);
    expect(t.totals.deer).toBe(area.landCount * 5);
  });

  it('folkRuleFor: 帆の月鹿は支え半径 8 の民、文明が無い・段階 0・個体層に無い種なら null', () => {
    expect(folkRuleFor(fakeSnapshot().civ)).toEqual({ species: 'deer', radius: 8 });
    expect(folkRuleFor(null)).toBeNull();
    expect(folkRuleFor(fakeSnapshot({ civ: { stage: 0 } }).civ)).toBeNull();
    expect(folkRuleFor(fakeSnapshot({ civ: { speciesId: 'firelizard' } }).civ)).toBeNull();
  });
});

describe('観察画面 (M22-04): reconcile — 出入りの計画', () => {
  const area = extractArea(fakeSnapshot({ density: { deer: (col, row) => (col === 16 && row === 16 ? 1 : 0) } }), OBS_HOME, 8);
  const targets = targetCounts(area);
  /** 鹿は集落のセルに 10 頭、狼は与えたセル (col, row) に 1 頭ずつ (狼の目標を合わせ、狼自身の出入りを計画に混ぜない) */
  const withWolves = (cells: [number, number][]) =>
    targetCounts(
      extractArea(
        fakeSnapshot({
          density: {
            deer: (col, row) => (col === 16 && row === 16 ? 1 : 0),
            wolf: (col, row) => (cells.some(([c, r]) => c === col && r === row) ? 1 / 8 : 0),
          },
        }),
        OBS_HOME,
        8,
      ),
    );

  it('足りなければ、同じ種がいないセルには区域の縁から入り (enter)、近くに同じ種がいれば生まれる (born)', () => {
    const empty = reconcile([], targets, 100, 1, mulberry32(1));
    expect(empty.spawns.length).toBe(10);
    expect(empty.spawns[0]).toMatchObject({ species: 'deer', kind: 'enter', cell: OBS_HOME, target: { x: 0, z: 0 } });
    // 縁 = 中心から 7 セルより外の陸セル
    expect(Math.hypot(empty.spawns[0].x, empty.spawns[0].z)).toBeGreaterThan(70);
    const withKin = reconcile([agent({ id: 1, species: 'deer', x: 10, z: 0 })], targets, 100, 1, mulberry32(1));
    expect(withKin.spawns.length).toBe(9);
    expect(withKin.spawns.every((s) => s.kind === 'born')).toBe(true);
    for (const s of withKin.spawns) expect(Math.hypot(s.x - 10, s.z)).toBeLessThanOrEqual(Math.SQRT2 * 2 + 1e-9);
  });

  it('民の決め方があれば、支え半径の中に生まれる鹿は folk', () => {
    const plan = reconcile([], { ...targets, folk: { species: 'deer', radius: 8 } }, 100, 1, mulberry32(1));
    expect(plan.spawns.every((s) => s.role === 'folk')).toBe(true);
    // 集落から東へ 3 セルの鹿は、民の半径 2 の外なので野生
    const east = targetCounts(extractArea(fakeSnapshot({ density: { deer: (col, row) => (col === 19 && row === 16 ? 1 : 0) } }), OBS_HOME, 8), K_DEFAULT, { species: 'deer', radius: 2 });
    const far = reconcile([], east, 100, 1, mulberry32(1));
    expect(far.spawns.length).toBe(10);
    expect(far.spawns.every((s) => s.role === 'wild' && s.cell === OBS_HOME + 3)).toBe(true);
    const none = reconcile([], { ...targets, folk: { species: 'wolf', radius: 8 } }, 100, 1, mulberry32(1));
    expect(none.spawns.every((s) => s.role === 'wild')).toBe(true);
  });

  it('多ければ、狼がいないところでは fall か leave (leave は最寄りの縁へ)。狩りは起きない', () => {
    const many = Array.from({ length: 30 }, (_, i) => agent({ id: i + 1, species: 'deer', x: 0, z: 0 }));
    const wolfFar = agent({ id: 100, species: 'wolf', x: -60, z: 0 });
    const plan = reconcile([...many, wolfFar], withWolves([[10, 16]]), 100, 1, mulberry32(3));
    expect(plan.removals.length).toBe(20);
    expect(plan.removals.some((r) => r.kind === 'hunt')).toBe(false);
    const falls = plan.removals.filter((r) => r.kind === 'fall').length;
    expect(falls).toBeGreaterThan(0);
    expect(falls).toBeLessThan(20);
    expect(FALL_SHARE).toBe(0.3);
    for (const r of plan.removals) if (r.kind === 'leave') expect(Math.hypot(r.target.x, r.target.z)).toBeGreaterThan(70);
  });

  it('狩りは狼と鹿が同じか隣のセルにいるときだけ。狼 1 頭は 1 回の計画で 1 頭だけ狩る', () => {
    const deer = [agent({ id: 1, species: 'deer', x: 0, z: 0 }), agent({ id: 2, species: 'deer', x: 0, z: 0 })];
    const extra = Array.from({ length: 10 }, (_, i) => agent({ id: 10 + i, species: 'deer', x: 0, z: 0 }));
    const adjacentWolf = agent({ id: 50, species: 'wolf', x: 10, z: 10 });
    const twoAway = agent({ id: 51, species: 'wolf', x: 20, z: 0 });
    const plan = reconcile([...deer, ...extra, adjacentWolf, twoAway], withWolves([[17, 17], [18, 16]]), 100, 1, mulberry32(3));
    expect(plan.spawns).toEqual([]);
    const hunts = plan.removals.filter((r) => r.kind === 'hunt');
    expect(hunts).toEqual([{ kind: 'hunt', agent: 1, hunter: 50 }]);
    expect(plan.removals.length).toBe(2);
  });

  it('狩られている鹿 (flee)・倒れた個体は数えず、入ってくる個体は向かう先のセルで数える', () => {
    const agents = [
      ...Array.from({ length: 10 }, (_, i) => agent({ id: i + 1, species: 'deer', x: 80, z: 0, state: 'enter', target: { x: 0, z: 0 } })),
      agent({ id: 20, species: 'deer', x: 0, z: 0, state: 'flee', target: { agent: 30 } }),
      agent({ id: 21, species: 'deer', x: 0, z: 0, state: 'fall' }),
    ];
    const plan = reconcile(agents, targets, 100, 1, mulberry32(1));
    expect(plan.spawns).toEqual([]);
    expect(plan.removals).toEqual([]);
  });

  it('出入りは 1 秒あたり budgetPerSecond 件まで。フレームの刻み (1/60 秒) でも credit を持ち越して同じ速さ', () => {
    const rng = mulberry32(7);
    let world: AgentWorld = { agents: [], nextId: 1 };
    const big = targetCounts(extractArea(fakeSnapshot({ density: { deer: () => 1 } }), OBS_HOME, 8));
    let credit = 0;
    let ops = 0;
    for (let f = 0; f < 600; f++) {
      const plan = reconcile(world.agents, big, 2, 1 / 60, rng, credit);
      credit = plan.credit;
      ops += plan.spawns.length + plan.removals.length;
      world = applyPlan(world, plan);
    }
    // 10 秒 × 2 件/秒 (+ 貯められる 1 件)
    expect(ops).toBeGreaterThanOrEqual(19);
    expect(ops).toBeLessThanOrEqual(21);
    expect(present(world, 'deer')).toBe(ops);
  });

  it('暦の速さに関わらず出入りは実時間の上限を守る: 目標が毎フレーム大きく跳ねても (10x の暦) 1 秒 2 件を超えない', () => {
    const rng = mulberry32(9);
    const lo = targetCounts(extractArea(fakeSnapshot({ density: { deer: () => 0.01 } }), OBS_HOME, 8));
    const hi = targetCounts(extractArea(fakeSnapshot({ density: { deer: () => 0.5 } }), OBS_HOME, 8));
    let world: AgentWorld = { agents: [], nextId: 1 };
    let credit = 0;
    const perSecond: number[] = [];
    for (let s = 0; s < 20; s++) {
      let n = 0;
      for (let f = 0; f < 60; f++) {
        const t: Targets = (s * 60 + f) % 2 === 0 ? hi : lo;
        const plan = reconcile(world.agents, t, 2, 1 / 60, rng, credit);
        credit = plan.credit;
        n += plan.spawns.length + plan.removals.length;
        world = applyPlan(world, plan);
      }
      perSecond.push(n);
    }
    expect(Math.max(...perSecond)).toBeLessThanOrEqual(3);
    expect(perSecond.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(41);
  });

  it('同じ入力と種なら同じ計画 (決定論)', () => {
    const agents = Array.from({ length: 30 }, (_, i) => agent({ id: i + 1, species: 'deer', x: (i % 5) * 10, z: 0 }));
    const a = reconcile(agents, targets, 100, 1, mulberry32(11));
    const b = reconcile(agents, targets, 100, 1, mulberry32(11));
    expect(a).toEqual(b);
    expect(OBS_SIZE).toBe(32);
  });
});
