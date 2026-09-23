/**
 * 観察画面の個体層: 個体の型と状態機械 (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §3・§4)。
 * 純粋関数のみ (Three.js・DOM に依存しない)。本体の値は読まない (区域 Area と目印 Landmarks だけを見る)。
 *
 * 契約:
 * - stepAgents は実時間 dt (秒) で進める。暦の速さ (1x / 10x) は入力に無く、個体は早送りしない。
 *   1 回の dt は MAX_FRAME_DT (1 秒) で打ち切り、MAX_SUBSTEP_DT (0.25 秒) ごとに刻む (最速 9 m/s でも 1 刻み 2.25 m < 1 セル)。
 * - 個体は区域の陸セルの外へ踏み出さない (海・区域外に当たる向きは避け、避けきれなければ止まる)。
 *   沈降で足元が海になった個体だけは、最寄りの陸へ向かって歩ける。
 * - 同じ AgentWorld・入力・dt の列・rng の種なら同じ動きになる (rng = mulberry32、個体の配列の順に引く)。
 *   他の個体の位置・状態は、その刻みの開始時の値を読む (配列の順に依存しない)。
 * - 狩り: 狼 stalk → chase、獲物の鹿 flee。捕まると鹿は fall (FALL_S 秒) → return (RETURN_S 秒) → 消える。
 * - 民 (role folk): 飛び立ち (launched) で船台に gather → GATHER_BOARD_S 秒後に board (以後そのまま)。
 *   夜 (night) は最寄りの灯りに gather。舟の建造中 (building) は CARRY_EVERY 頭に 1 頭が林と船台の間を carry。
 *   それ以外は野生と同じに振る舞う。野生 (role wild) は carry / gather / board に入らない。
 *
 * heading はラジアンで、進む向きは (sin heading, cos heading) = (x, z)。
 */
import type { Area, AreaCell, Landmarks, Point } from './area';
import { cellAt, cellDistance, isLandAt, nearestLand, rimCells } from './area';
import type { Plan, Targets } from './population';

export type AgentSpecies = 'deer' | 'wolf' | 'rabbit';
export type AgentRole = 'wild' | 'folk';
export type AgentState =
  | 'idle' | 'walk' | 'graze' | 'flee' | 'stalk' | 'chase'
  | 'carry' | 'gather' | 'board'
  | 'enter' | 'leave' | 'fall' | 'return';
export type AgentTarget = Point | { agent: number };

export type Agent = {
  id: number;
  species: AgentSpecies;
  /** folk = 知性ある月鹿 (civ.speciesId の種、集落の支え半径の中で生まれた個体) */
  role: AgentRole;
  /** m、区域の中心が原点 */
  x: number;
  z: number;
  heading: number;
  state: AgentState;
  /** 今の状態に入ってからの実時間 (秒) */
  t: number;
  target?: AgentTarget;
};

export type AgentWorld = { agents: readonly Agent[]; nextId: number };

export type AgentInput = {
  area: Area;
  marks: Landmarks;
  /** 夜 (民が灯りに寄る) */
  night: boolean;
  /** 舟の建造中 (ship があり、飛び立っておらず、文明が帆以上) */
  building: boolean;
  /** 舟が飛び立った (民が船台に集い乗り込む) */
  launched: boolean;
  /** 目標頭数。あれば歩く先を頭数の多いセルに寄せる (場所を密度に忠実に保つ) */
  targets?: Targets;
};

/** 倒れて横たわる秒数 (設計 §3) */
export const FALL_S = 8;
/** 生気の光になって土に沈む秒数 (設計 §3) */
export const RETURN_S = 6;
/** 船台に集ってから乗り込むまでの秒数 (設計 §6: 民が船台に集う 20 秒) */
export const GATHER_BOARD_S = 20;
/** 建造中に材を運ぶのは民の CARRY_EVERY 頭に 1 頭 (id で決める。設計 §3「一部が carry」) */
export const CARRY_EVERY = 3;
/** 狼が忍び寄りから追いに切り替える距離 (m) と、忍び寄りの最長 (秒) */
export const CHASE_DIST = 18;
export const STALK_MAX_S = 6;
/** 捕まえる距離 (m)。追いが CHASE_MAX_S 秒続いたら、その場で捕まえたことにする (獲物が岸で止まっても狩りを終わらせる) */
export const CATCH_M = 1.5;
export const CHASE_MAX_S = 15;
/** 出ていく・入ってくる個体が詰まっても、この秒数で打ち切る */
export const LEAVE_MAX_S = 40;
export const ENTER_MAX_S = 40;
export const MAX_FRAME_DT = 1;
export const MAX_SUBSTEP_DT = 0.25;

/** 種ごとの速さ (m/s)。run は flee / chase */
export const SPEED: Readonly<Record<AgentSpecies, { walk: number; graze: number; run: number; stalk: number; carry: number }>> = {
  deer: { walk: 1.3, graze: 0.15, run: 7.5, stalk: 1.3, carry: 0.9 },
  wolf: { walk: 1.5, graze: 0, run: 9, stalk: 1.1, carry: 0 },
  rabbit: { walk: 1.0, graze: 0.1, run: 5, stalk: 1.0, carry: 0 },
};
/** どの個体もこれより速くは動かない (m/s) */
export const MAX_SPEED = 9;

const ARRIVE_M = 1;
const CARRY_ARRIVE_M = 2;
const GATHER_R = 6;
const LANTERN_R = 4;
const HERD_R = 25;
const SEP_R = 2.5;
/** 鹿が群れの重心から歩き出す先の最大の距離 (m) と、はぐれとみなして重心へ戻る距離 (m) */
const HERD_STEP_M = 8;
const STRAY_M = 12;
const WANDER_CELLS = 2;
const WALK_MAX_S = 30;
/** 1 秒あたりの遷移の確率 */
const P_IDLE_END = 0.25;
const P_GRAZE_END = 0.1;

/** 目標頭数に数える個体 (出ていく・倒れた・還る・狩られている個体は数えない) */
export function isPresent(a: Agent): boolean {
  return a.state !== 'leave' && a.state !== 'fall' && a.state !== 'return' && a.state !== 'flee';
}

/** 出入りの計画で取り除いてよい個体 (乗り込んだ民・狩りの最中・出入りの最中は除く) */
export function isRemovable(a: Agent): boolean {
  return a.state === 'idle' || a.state === 'walk' || a.state === 'graze' || a.state === 'carry' || a.state === 'gather';
}

/** 狩りに入れる狼・群れの計算に入る鹿の、ふだんの状態 */
export function isFree(a: Agent): boolean {
  return a.state === 'idle' || a.state === 'walk' || a.state === 'graze';
}

const isAgentTarget = (t: AgentTarget | undefined): t is { agent: number } => t !== undefined && 'agent' in t;
const isPointTarget = (t: AgentTarget | undefined): t is Point => t !== undefined && 'x' in t;
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);
const samePoint = (a: Point | undefined, b: Point | null): boolean => !!a && !!b && a.x === b.x && a.z === b.z;

/** 狼 h が獲物 p を捕まえたか (両側が刻みの開始時の値で同じ判定をする) */
function caught(h: Agent, p: Agent): boolean {
  return h.state === 'chase' && (dist(h, p) <= CATCH_M || h.t >= CHASE_MAX_S);
}

/** 計画 (population.reconcile) を個体に当てる。生まれる・入る個体に id を振り、取り除く個体の状態を変える */
export function applyPlan(world: AgentWorld, plan: Plan): AgentWorld {
  let nextId = world.nextId;
  const change = new Map<number, Partial<Agent>>();
  for (const r of plan.removals) {
    if (r.kind === 'hunt') {
      change.set(r.agent, { state: 'flee', t: 0, target: { agent: r.hunter } });
      change.set(r.hunter, { state: 'stalk', t: 0, target: { agent: r.agent } });
    } else if (r.kind === 'fall') {
      change.set(r.agent, { state: 'fall', t: 0, target: undefined });
    } else {
      change.set(r.agent, { state: 'leave', t: 0, target: r.target });
    }
  }
  const agents: Agent[] = world.agents.map((a) => {
    const c = change.get(a.id);
    return c ? { ...a, ...c } : a;
  });
  for (const s of plan.spawns) {
    const heading = Math.atan2(s.target.x - s.x, s.target.z - s.z);
    agents.push({
      id: nextId++,
      species: s.species,
      role: s.role,
      x: s.x,
      z: s.z,
      heading: s.kind === 'enter' ? heading : 0,
      state: s.kind === 'enter' ? 'enter' : 'idle',
      t: 0,
      target: s.kind === 'enter' ? s.target : undefined,
    });
  }
  return { agents, nextId };
}

type StepCtx = {
  input: AgentInput;
  byId: ReadonlyMap<number, Agent>;
  /** 群れの計算に入る鹿 (刻みの開始時) */
  herd: readonly Agent[];
  rim: readonly AreaCell[];
  dt: number;
  rng: () => number;
};

/** 個体を実時間 dt 秒だけ進める。消えた個体 (還り終えた・出ていった) は配列から除く */
export function stepAgents(world: AgentWorld, input: AgentInput, dt: number, rng: () => number): AgentWorld {
  let remaining = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  let agents = world.agents;
  const rim = rimCells(input.area);
  while (remaining > 1e-9) {
    const h = Math.min(remaining, MAX_SUBSTEP_DT);
    remaining -= h;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const herd = agents.filter((a) => a.species === 'deer' && isFree(a));
    const ctx: StepCtx = { input, byId, herd, rim, dt: h, rng };
    const next: Agent[] = [];
    for (const a of agents) {
      const n = stepOne(a, ctx);
      if (n) next.push(n);
    }
    agents = next;
  }
  return { agents, nextId: world.nextId };
}

function stepOne(a: Agent, ctx: StepCtx): Agent | null {
  const { dt } = ctx;
  const t = a.t + dt;
  const sp = SPEED[a.species];
  switch (a.state) {
    case 'fall':
      return t >= FALL_S ? { ...a, state: 'return', t: 0 } : { ...a, t };
    case 'return':
      return t >= RETURN_S ? null : { ...a, t };
    case 'leave': {
      if (!isPointTarget(a.target) || t >= LEAVE_MAX_S || dist(a, a.target) <= ARRIVE_M) return null;
      return { ...moveToward(a, a.target, sp.walk, ctx), t };
    }
    case 'enter': {
      if (!isPointTarget(a.target) || t >= ENTER_MAX_S || dist(a, a.target) <= ARRIVE_M) return { ...a, state: 'idle', t: 0, target: undefined };
      return { ...moveToward(a, a.target, sp.walk, ctx), t };
    }
    case 'flee':
      return stepFlee(a, t, ctx);
    case 'stalk':
    case 'chase':
      return stepHunter(a, t, ctx);
    case 'board': {
      const slip = ctx.input.marks.slipway;
      return dist(a, slip) <= ARRIVE_M ? { ...a, t } : { ...moveToward(a, slip, SPEED[a.species].walk, ctx), t };
    }
    default:
      break;
  }
  if (a.role === 'folk') {
    const folk = stepFolk(a, t, ctx);
    if (folk) return folk;
  }
  return stepWild(a, t, ctx);
}

function stepFlee(a: Agent, t: number, ctx: StepCtx): Agent | null {
  const hunter = isAgentTarget(a.target) ? ctx.byId.get(a.target.agent) : undefined;
  const hunted = hunter && (hunter.state === 'stalk' || hunter.state === 'chase') && isAgentTarget(hunter.target) && hunter.target.agent === a.id;
  if (!hunter || !hunted) {
    // 狩り手がいなくなった: 取り除く予定の個体なので、静かに縁から出ていく
    const exit = nearestLand(ctx.input.area, a.x, a.z, ctx.rim) ?? cellAt(ctx.input.area, a.x, a.z);
    return { ...a, state: 'leave', t: 0, target: exit ? { x: exit.x, z: exit.z } : { x: a.x, z: a.z } };
  }
  if (caught(hunter, a)) return { ...a, state: 'fall', t: 0, target: undefined };
  const speed = hunter.state === 'chase' ? SPEED[a.species].run : SPEED[a.species].walk;
  const away = { x: a.x + (a.x - hunter.x), z: a.z + (a.z - hunter.z) };
  return { ...moveToward(a, away, speed, ctx), t };
}

function stepHunter(a: Agent, t: number, ctx: StepCtx): Agent {
  const prey = isAgentTarget(a.target) ? ctx.byId.get(a.target.agent) : undefined;
  if (!prey || prey.state !== 'flee') return { ...a, state: 'idle', t: 0, target: undefined };
  if (caught(a, prey)) return { ...a, state: 'idle', t: 0, target: undefined };
  const sp = SPEED[a.species];
  if (a.state === 'stalk' && (dist(a, prey) <= CHASE_DIST || t >= STALK_MAX_S)) {
    return { ...moveToward(a, prey, sp.run, ctx), state: 'chase', t: 0 };
  }
  return { ...moveToward(a, prey, a.state === 'chase' ? sp.run : sp.stalk, ctx), t };
}

/** 民の仕事。仕事が無ければ null (野生と同じに振る舞う) */
function stepFolk(a: Agent, t: number, ctx: StepCtx): Agent | null {
  const { marks, launched, night, building } = ctx.input;
  const sp = SPEED[a.species];
  if (launched) {
    const slip = marks.slipway;
    if (a.state !== 'gather' || !samePoint(isPointTarget(a.target) ? a.target : undefined, slip)) {
      return { ...a, state: 'gather', t: 0, target: slip };
    }
    if (t >= GATHER_BOARD_S) return { ...a, state: 'board', t: 0, target: slip };
    return dist(a, slip) <= GATHER_R ? { ...a, t } : { ...moveToward(a, slip, sp.walk, ctx), t };
  }
  if (night && marks.lanterns.length > 0) {
    let lantern = marks.lanterns[0];
    for (const l of marks.lanterns) if (dist(a, l) < dist(a, lantern)) lantern = l;
    const s = a.state === 'gather' ? { ...a, t, target: lantern } : { ...a, state: 'gather' as const, t: 0, target: lantern };
    return dist(a, lantern) <= LANTERN_R ? s : { ...moveToward(s, lantern, sp.walk, ctx) };
  }
  if (building && marks.grove && a.id % CARRY_EVERY === 0) {
    const grove = marks.grove;
    const slip = marks.slipway;
    const cur = a.state === 'carry' && isPointTarget(a.target) ? a.target : grove;
    const s = a.state === 'carry' ? { ...a, t } : { ...a, state: 'carry' as const, t: 0, target: grove };
    if (dist(a, cur) <= CARRY_ARRIVE_M) {
      // 林に着いたら材を曳いて船台へ、船台に着いたら林へ戻る
      return { ...s, target: samePoint(cur, grove) ? slip : grove };
    }
    return moveToward(s, cur, sp.carry, ctx);
  }
  if (a.state === 'carry' || a.state === 'gather') return { ...a, state: 'idle', t: 0, target: undefined };
  return null;
}

function stepWild(a: Agent, t: number, ctx: StepCtx): Agent {
  const { area } = ctx.input;
  const sp = SPEED[a.species];
  const grazer = a.species !== 'wolf';
  if (!isLandAt(area, a.x, a.z)) {
    // 沈降で足元が海になった: 最寄りの陸へ上がる
    const land = nearestLand(area, a.x, a.z);
    if (land) return { ...moveToward(a, land, sp.walk, ctx), state: 'walk', t: a.state === 'walk' ? t : 0, target: { x: land.x, z: land.z } };
    return { ...a, t };
  }
  if (a.state === 'walk' && isPointTarget(a.target)) {
    if (dist(a, a.target) <= ARRIVE_M || t >= WALK_MAX_S) {
      return grazer ? { ...a, state: 'graze', t: 0, target: undefined } : { ...a, state: 'idle', t: 0, target: undefined };
    }
    return { ...moveToward(a, a.target, sp.walk, ctx), t };
  }
  if (a.species === 'deer' && (a.state === 'graze' || a.state === 'idle')) {
    const herd = herdCentroid(a, ctx);
    if (herd && dist(a, herd) > STRAY_M) {
      const back = { x: herd.x + (ctx.rng() - 0.5) * 6, z: herd.z + (ctx.rng() - 0.5) * 6 };
      if (isLandAt(area, back.x, back.z)) return { ...a, state: 'walk', t: 0, target: back };
    }
  }
  if (a.state === 'graze') {
    if (ctx.rng() < P_GRAZE_END * ctx.dt) return { ...a, state: 'idle', t: 0 };
    const flock = flockVector(a, ctx);
    if (flock.x === 0 && flock.z === 0) return { ...a, t };
    return { ...moveToward(a, { x: a.x + flock.x, z: a.z + flock.z }, sp.graze, ctx), t };
  }
  // idle (と、状態の食い違いで行き先を失った walk)。鹿は近すぎる仲間がいれば食みながら離れる
  if (a.state === 'idle' && a.species === 'deer' && crowded(a, ctx)) return { ...a, state: 'graze', t: 0 };
  if (a.state === 'idle' && ctx.rng() >= P_IDLE_END * ctx.dt) return { ...a, t };
  if (grazer && ctx.rng() < 0.5) return { ...a, state: 'graze', t: 0, target: undefined };
  const to = wanderTarget(a, ctx);
  return { ...a, state: 'walk', t: 0, target: to };
}

/** 鹿の群れ: 群れの重心へ寄せ (cohesion)、近すぎる相手から離す (separation)。鹿以外は 0 */
function flockVector(a: Agent, ctx: StepCtx): Point {
  if (a.species !== 'deer') return { x: 0, z: 0 };
  let cx = 0;
  let cz = 0;
  let n = 0;
  let sx = 0;
  let sz = 0;
  for (const o of ctx.herd) {
    if (o.id === a.id) continue;
    const d = dist(a, o);
    if (d > HERD_R) continue;
    cx += o.x;
    cz += o.z;
    n++;
    if (d < SEP_R && d > 1e-6) {
      const w = (SEP_R - d) / SEP_R / d;
      sx += (a.x - o.x) * w;
      sz += (a.z - o.z) * w;
    }
  }
  let vx = sx * 2;
  let vz = sz * 2;
  if (n > 0) {
    const gx = cx / n - a.x;
    const gz = cz / n - a.z;
    const gd = Math.hypot(gx, gz);
    if (gd > 6) {
      vx += (gx / gd) * 0.5;
      vz += (gz / gd) * 0.5;
    }
  }
  return { x: vx, z: vz };
}

/** SEP_R より近くに仲間の鹿がいるか */
function crowded(a: Agent, ctx: StepCtx): boolean {
  return ctx.herd.some((o) => o.id !== a.id && dist(a, o) < SEP_R);
}

/** 群れの重心 (自分を除く HERD_R 以内の鹿)。仲間がいなければ null */
function herdCentroid(a: Agent, ctx: StepCtx): Point | null {
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (const o of ctx.herd) {
    if (o.id === a.id || dist(a, o) > HERD_R) continue;
    cx += o.x;
    cz += o.z;
    n++;
  }
  return n > 0 ? { x: cx / n, z: cz / n } : null;
}

/**
 * 歩く先: 近くの陸セル (鹿は群れの重心の近く) から、目標頭数の多いセルほど選ばれやすく引く。
 * 鹿はそのセルへ重心から HERD_STEP_M だけ寄せた点にする (群れごと少しずつ密度の高い方へ動き、ばらけない)
 */
function wanderTarget(a: Agent, ctx: StepCtx): Point {
  const { area, targets } = ctx.input;
  const herd = a.species === 'deer' ? herdCentroid(a, ctx) : null;
  const ox = herd ? herd.x : a.x;
  const oz = herd ? herd.z : a.z;
  const origin = cellAt(area, ox, oz) ?? cellAt(area, a.x, a.z);
  const here = { x: a.x, z: a.z };
  if (!origin) return here;
  const near = area.cells.filter((c) => c.isLand && cellDistance(c, origin) <= WANDER_CELLS);
  if (near.length === 0) return here;
  const per = targets?.perCell[a.species];
  const weights = near.map((c) => (per ? (per.get(c.index) ?? 0) + 0.1 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = ctx.rng() * total;
  let pick = near[near.length - 1];
  for (let i = 0; i < near.length; i++) {
    r -= weights[i];
    if (r < 0) {
      pick = near[i];
      break;
    }
  }
  let p = { x: pick.x + (ctx.rng() - 0.5) * 8, z: pick.z + (ctx.rng() - 0.5) * 8 };
  if (herd) {
    const d = dist(herd, pick);
    const k = d > HERD_STEP_M ? HERD_STEP_M / d : 1;
    p = { x: herd.x + (pick.x - herd.x) * k + (ctx.rng() - 0.5) * 6, z: herd.z + (pick.z - herd.z) * k + (ctx.rng() - 0.5) * 6 };
  }
  return isLandAt(area, p.x, p.z) ? p : { x: pick.x, z: pick.z };
}

/** 避ける向きの順 (まっすぐ → 左右 30° → 60° → 90° → 120°) */
const DETOURS = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, (2 * Math.PI) / 3, (-2 * Math.PI) / 3];

/**
 * to へ向かって speed × dt だけ進む (行き過ぎない)。行き先が海・区域外なら向きを振って避け、
 * 全部だめなら止まる。鹿は群れの分離をまっすぐの向きに足す。足元が海なら避けずにまっすぐ進む (陸へ上がるため)。
 */
function moveToward(a: Agent, to: Point, speed: number, ctx: StepCtx): Agent {
  const { area } = ctx.input;
  let dx = to.x - a.x;
  let dz = to.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-9 || speed <= 0) return a;
  dx /= d;
  dz /= d;
  if (a.species === 'deer' && (a.state === 'walk' || a.state === 'enter' || a.state === 'carry')) {
    const f = flockVector(a, ctx);
    dx += f.x * 0.3;
    dz += f.z * 0.3;
  }
  const base = Math.atan2(dx, dz);
  const step = Math.min(speed * ctx.dt, d);
  const onLand = isLandAt(area, a.x, a.z);
  for (const dev of onLand ? DETOURS : [0]) {
    const h = base + dev;
    const nx = a.x + Math.sin(h) * step;
    const nz = a.z + Math.cos(h) * step;
    if (!onLand || isLandAt(area, nx, nz)) return { ...a, x: nx, z: nz, heading: h };
  }
  return a;
}
