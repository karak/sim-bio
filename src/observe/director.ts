/**
 * 観察画面の自動カメラのショット選び (M22-04、設計 docs/design/2026-09-23-observation-view-design.md §7)。
 * 純粋関数のみ。Three.js のカメラは作らず、ショットの記述 (種類・狙い・長さ) だけを返す。
 *
 * 契約:
 * - ショットは SHOT_MIN_S〜SHOT_MAX_S 秒 (rng で決める)。同じ種類のショットは続けない。
 * - 次のショットは 場面の引き金 (§6、届いた順) > 狩り > 民の行動 > 群れ > 風景 の優先で選ぶ。
 *   優先の高い候補が直前と同じ種類なら、次の候補に譲る (場面の引き金は捨てずに次のショットまで待つ)。
 * - 走っているショットより優先の高い場面・狩りが現れたら、PREEMPT_AFTER_S 秒映した後に切り替える。
 * - 操作 (ドラッグ・ホイール・個体を押す) があれば自由カメラ (mode free)。IDLE_RETURN_S 秒触らなければ自動に戻り、すぐ次のショットを選ぶ。
 *   自由カメラの間に届いた場面の引き金は、新しい方から MAX_PENDING 件まで取っておく。
 */
import type { Landmarks, Point } from './area';
import type { Agent } from './agents';
import { isFree } from './agents';
import type { SceneEvent } from './scenes';

export type ShotKind = 'herdClose' | 'groveTrack' | 'shipLookUp' | 'settlementHigh' | 'huntFollow' | 'coastWide';
export type ShotReason = 'scene' | 'hunt' | 'folk' | 'herd' | 'landscape';
/** 追う個体 (id) か、狙う位置 (m、区域の中心が原点) */
export type ShotSubject = { agent: number } | Point;
export type Shot = { kind: ShotKind; subject: ShotSubject; duration: number; reason: ShotReason; scene?: SceneEvent };

export type DirectorContext = {
  marks: Landmarks;
  hunt: { hunter: number; prey: number } | null;
  folk: { agent: number; state: 'carry' | 'gather' | 'board' } | null;
  herd: { agent: number; size: number } | null;
};

export type DirectorState = {
  mode: 'auto' | 'free';
  shot: Shot | null;
  /** 今のショットを映している秒数 */
  elapsed: number;
  /** 自由カメラで最後に触ってからの秒数 */
  idle: number;
  lastKind: ShotKind | null;
  pending: readonly SceneEvent[];
};

export const SHOT_MIN_S = 12;
export const SHOT_MAX_S = 20;
export const IDLE_RETURN_S = 20;
export const PREEMPT_AFTER_S = 4;
export const MAX_PENDING = 8;
/** 群れに寄るのは、この頭数以上の群れがいるとき */
export const HERD_MIN = 3;
const HERD_R = 20;

const RANK: Readonly<Record<ShotReason, number>> = { scene: 0, hunt: 1, folk: 2, herd: 3, landscape: 4 };

export function initialDirector(): DirectorState {
  return { mode: 'auto', shot: null, elapsed: 0, idle: 0, lastKind: null, pending: [] };
}

/** 個体の列から、カメラが狙える狩り・民の行動・群れを拾う (それぞれ id の最も小さいもの) */
export function directorContext(agents: readonly Agent[], marks: Landmarks): DirectorContext {
  let hunt: DirectorContext['hunt'] = null;
  let folk: DirectorContext['folk'] = null;
  for (const a of agents) {
    if (!hunt && a.species === 'wolf' && (a.state === 'stalk' || a.state === 'chase') && a.target && 'agent' in a.target) {
      hunt = { hunter: a.id, prey: a.target.agent };
    }
    if (!folk && a.role === 'folk' && (a.state === 'carry' || a.state === 'gather' || a.state === 'board')) folk = { agent: a.id, state: a.state };
  }
  const deer = agents.filter((a) => a.species === 'deer' && isFree(a));
  let herd: DirectorContext['herd'] = null;
  for (const a of deer) {
    const size = deer.filter((o) => Math.hypot(o.x - a.x, o.z - a.z) <= HERD_R).length;
    if (size >= HERD_MIN && (!herd || size > herd.size)) herd = { agent: a.id, size };
  }
  return { marks, hunt, folk, herd };
}

type Candidate = { kind: ShotKind; subject: ShotSubject; reason: ShotReason; scene?: number };

function sceneShot(e: SceneEvent, marks: Landmarks): { kind: ShotKind; subject: ShotSubject } {
  switch (e.kind) {
    case 'shipStage':
    case 'departure':
      return { kind: 'shipLookUp', subject: marks.slipway };
    case 'sailLost':
      return { kind: 'settlementHigh', subject: marks.center };
    case 'sprout':
      return { kind: 'groveTrack', subject: e.at };
    case 'mist':
      return { kind: 'settlementHigh', subject: e.at };
    case 'rain':
    case 'sinking':
      return { kind: 'coastWide', subject: marks.coast };
    case 'ending':
      return e.status === 'escaped' ? { kind: 'shipLookUp', subject: marks.slipway } : { kind: 'coastWide', subject: marks.coast };
  }
}

/** 風景以外の候補を優先の順に並べる (rng を使わない) */
function candidates(pending: readonly SceneEvent[], ctx: DirectorContext): Candidate[] {
  const out: Candidate[] = pending.map((e, i) => ({ ...sceneShot(e, ctx.marks), reason: 'scene' as const, scene: i }));
  if (ctx.hunt) out.push({ kind: 'huntFollow', subject: { agent: ctx.hunt.hunter }, reason: 'hunt' });
  if (ctx.folk) {
    const f = ctx.folk;
    if (f.state === 'carry') out.push({ kind: 'groveTrack', subject: { agent: f.agent }, reason: 'folk' });
    else if (f.state === 'board') out.push({ kind: 'shipLookUp', subject: ctx.marks.slipway, reason: 'folk' });
    else out.push({ kind: 'settlementHigh', subject: ctx.marks.center, reason: 'folk' });
  }
  if (ctx.herd) out.push({ kind: 'herdClose', subject: { agent: ctx.herd.agent }, reason: 'herd' });
  return out;
}

/** 次のショットを選ぶ。使った場面の引き金を pending から除いて返す */
export function nextShot(state: DirectorState, ctx: DirectorContext, rng: () => number): { shot: Shot; pending: SceneEvent[] } {
  const pending = [...state.pending];
  const duration = SHOT_MIN_S + rng() * (SHOT_MAX_S - SHOT_MIN_S);
  const pick = candidates(pending, ctx).find((c) => c.kind !== state.lastKind);
  if (pick) {
    const scene = pick.scene !== undefined ? pending.splice(pick.scene, 1)[0] : undefined;
    return { shot: { kind: pick.kind, subject: pick.subject, duration, reason: pick.reason, ...(scene ? { scene } : {}) }, pending };
  }
  const m = ctx.marks;
  const all: { kind: ShotKind; subject: ShotSubject }[] = [{ kind: 'coastWide', subject: m.coast }];
  if (m.grove) all.push({ kind: 'groveTrack', subject: m.grove });
  all.push({ kind: 'settlementHigh', subject: m.center });
  const views = all.filter((v) => v.kind !== state.lastKind);
  const v = views[Math.min(views.length - 1, Math.floor(rng() * views.length))];
  return { shot: { kind: v.kind, subject: v.subject, duration, reason: 'landscape' }, pending };
}

export type DirectorInput = {
  /** 実時間 (秒) */
  dt: number;
  /** このフレームに届いた場面の引き金 (scenes.detectScenes の結果) */
  scenes: readonly SceneEvent[];
  /** このフレームにカメラの操作があったか */
  userInput: boolean;
};

export function stepDirector(state: DirectorState, ctx: DirectorContext, input: DirectorInput, rng: () => number): DirectorState {
  const pending = [...state.pending, ...input.scenes].slice(-MAX_PENDING);
  if (input.userInput) return { ...state, mode: 'free', shot: null, elapsed: 0, idle: 0, pending };
  const take = (s: DirectorState): DirectorState => {
    const n = nextShot(s, ctx, rng);
    return { ...s, mode: 'auto', shot: n.shot, elapsed: 0, idle: 0, lastKind: n.shot.kind, pending: n.pending };
  };
  if (state.mode === 'free') {
    const idle = state.idle + input.dt;
    return idle >= IDLE_RETURN_S ? take({ ...state, pending }) : { ...state, idle, pending };
  }
  const elapsed = state.elapsed + input.dt;
  const cur = state.shot;
  if (!cur || elapsed >= cur.duration) return take({ ...state, pending });
  if (elapsed >= PREEMPT_AFTER_S) {
    const top = candidates(pending, ctx).find((c) => c.kind !== cur.kind);
    if (top && (top.reason === 'scene' || top.reason === 'hunt') && RANK[top.reason] < RANK[cur.reason]) return take({ ...state, pending });
  }
  return { ...state, elapsed, pending };
}
