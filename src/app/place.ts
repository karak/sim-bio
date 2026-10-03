import type { Chronicle, ChronicleHead } from '../harbor/chronicle';
import { parseChronicleId, type ChronicleId } from '../harbor/contract';
import { checkSlot, planSlotLoad, type Here, type SlotSave } from '../persist/slotSave';
import type { ManualSlot, PendingSlot, SlotId } from '../persist/slots';
import type { RunnerState } from '../scenario/ScenarioRunner';
import type { ScenarioDef, ScenarioStatus } from '../scenario/types';
import type { SaveData } from '../simulation/types';
import { askOf, type Ask } from '../ui/confirmAsk';

/**
 * 島の置き場の判断 (M21-07)。操作の確かめと行き先・起動の舞台と戻し方・枠の札を押せるかを、DOM と置き場から離して決める。
 * main.ts は Plan の ask で確かめ、effects を順に行うだけにする
 */

/** 今いる舞台。finished は判定の出た石板の島にいるか */
export type At =
  | { stage: 'free' }
  | { stage: 'scenario'; head: ChronicleHead; finished: boolean }
  | { stage: 'visit' };

/** やり直しの効かない操作。select は石板を選ぶ・もう一度・自由モードへ (null)、visit は港の訪れる札。load の slot が null ならファイル */
export type Op =
  | { kind: 'new_island' }
  | { kind: 'load'; data: SlotSave; slot: SlotId | null }
  | { kind: 'slot_save'; slot: ManualSlot; overwrites: string | null }
  | { kind: 'select'; scenarioId: string | null }
  | { kind: 'visit'; href: string };

/** 確かめを受けた後に順に行うこと。replace が島を戻せなければ、残りを行わない */
export type Effect =
  | { kind: 'new_world' }
  | { kind: 'restart'; from: { runner: RunnerState; chronicle: Chronicle } | null }
  | { kind: 'replace'; save: SaveData; slot: SlotId | null }
  | { kind: 'refuse'; slot: SlotId | null; tick: number; error: string }
  | { kind: 'stash_import'; data: SlotSave }
  | { kind: 'put_pending'; slot: PendingSlot }
  | { kind: 'save_slot'; slot: ManualSlot }
  | { kind: 'flush' }
  | { kind: 'go'; scenarioId: string | null }
  | { kind: 'assign'; href: string };

export type Plan = { ask: Ask | null; effects: readonly Effect[] };

/** 今いる舞台を、訪問か・石板の頭・石板の判定 (runner が無ければ null) から決める */
export function atOf(visiting: boolean, head: ChronicleHead | null, status: ScenarioStatus | null): At {
  if (visiting) return { stage: 'visit' };
  return head ? { stage: 'scenario', head, finished: status !== null && status !== 'running' } : { stage: 'free' };
}

/** 確かめを断れば何もしない。受ければ effects を並びどおりに行い、false が返った所で残りをやめる */
export async function runPlan(plan: Plan, confirm: (ask: Ask) => Promise<boolean>, perform: (e: Effect) => Promise<boolean>): Promise<void> {
  if (plan.ask && !(await confirm(plan.ask))) return;
  for (const e of plan.effects) if (!(await perform(e))) return;
}

const NOTHING: Plan = { ask: null, effects: [] };

export function planOp(op: Op, at: At, titleOf: (scenarioId: string) => string): Plan {
  switch (op.kind) {
    case 'new_island':
      if (at.stage === 'visit') return NOTHING;
      // 石板の中では「石板を初めから」(M19-17)。今の続きを Year 0 で上書きする。判定の出た島 (港へ出せる島) は別の置き場に残る
      return {
        ask: askOf({ kind: 'new_island', inScenario: at.stage === 'scenario' }),
        effects: at.stage === 'scenario' ? [{ kind: 'new_world' }, { kind: 'restart', from: null }] : [{ kind: 'new_world' }],
      };
    case 'load':
      return at.stage === 'visit' ? NOTHING : planLoad(op, at, titleOf);
    case 'slot_save':
      return at.stage === 'visit' ? NOTHING : { ask: askOf({ kind: 'slot_save', overwrites: op.overwrites }), effects: [{ kind: 'save_slot', slot: op.slot }] };
    case 'select':
      return { ask: leaving(at), effects: [{ kind: 'flush' }, { kind: 'go', scenarioId: op.scenarioId }] };
    case 'visit':
      return { ask: leaving(at), effects: [{ kind: 'assign', href: op.href }] };
  }
}

/**
 * 舞台を移る操作 (石板を選ぶ・自由モードへ・もう一度・訪れる) の確かめ (M21-04)。走っている島は書き切ってから移るので確かめない。
 * 判定の出た自分の石板の島は、開き直すと初めからになる (M19-14) ので確かめる
 */
const leaving = (at: At): Ask | null => askOf({ kind: 'leave', finished: at.stage === 'scenario' && at.finished });

/**
 * 枠とファイルの読込 (M19-17 §4)。確かめてから、同じ舞台ならその場で差し替え、違う舞台ならその舞台へ移って読む。
 * 移った先へは読む枠の名前を sessionStorage で渡す。ファイルは枠の一覧に出さない置き場 (import) に置いてから移る
 */
function planLoad(op: Extract<Op, { kind: 'load' }>, at: Exclude<At, { stage: 'visit' }>, titleOf: (scenarioId: string) => string): Plan {
  // (M19-17 で変更: 石板の中でも、同じ石板の枠は runner の状態・年代記と一緒に戻すので読める。別の島の差し込みは下の checkSlot (checkedSlot) の舞台の確かめで弾く。無効は訪問だけ)
  const here: Here = at.stage === 'scenario' ? { stage: 'scenario', head: at.head } : { stage: 'free' };
  const plan = planSlotLoad(op.data, here, titleOf);
  const ask = askOf({ kind: 'load', plan });
  if (plan.kind === 'navigate') {
    const pending: Effect[] = op.slot ? [{ kind: 'put_pending', slot: op.slot }] : [{ kind: 'stash_import', data: op.data }, { kind: 'put_pending', slot: 'import' }];
    return { ask, effects: [...pending, { kind: 'flush' }, { kind: 'go', scenarioId: plan.to.stage === 'scenario' ? plan.to.scenarioId : null }] };
  }
  const checked = checkedSlot(op.data, here);
  if (!checked.ok) return { ask, effects: [{ kind: 'refuse', slot: op.slot, tick: op.data.save.tick, error: checked.error }] };
  const s = checked.value;
  const replace: Effect = { kind: 'replace', save: s.save, slot: op.slot };
  return { ask, effects: s.stage === 'scenario' ? [replace, { kind: 'restart', from: { runner: s.runner, chronicle: s.chronicle } }] : [replace] };
}

/** 読めない包み (runner の無いファイルなど) は checkSlot が投げることがある。確かめを出してから記録に残すので、投げずに返す */
function checkedSlot(data: SlotSave, here: Here): { ok: true; value: SlotSave } | { ok: false; error: string } {
  try {
    const checked = checkSlot(data, here);
    return checked.ok ? checked : { ok: false, error: String(new Error(checked.reason)) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 石板を選んだ先の検索語 (? は付けない)。scenario だけを差し替え、ほかの検索語はそのまま残す */
export function searchFor(search: string, scenarioId: string | null): string {
  const q = new URLSearchParams(search);
  if (scenarioId) q.set('scenario', scenarioId);
  else q.delete('scenario');
  return q.toString();
}

/** 起動で島を戻す置き場。上から順に試し、最初に戻せたものから開く。どれも無ければ新しい島 */
export type Restore = { from: 'slot'; slot: PendingSlot } | { from: 'scenario' } | { from: 'auto' };

export type BootPlan<S> = {
  scenario: S | null;
  visitId: ChronicleId | null;
  /** 知らない石板の URL。書き換えた検索語 (? から。無ければ空) と、記録に残す石板の名前 */
  unknown: { scenarioId: string; search: string } | null;
  restore: readonly Restore[];
};

export function bootPlanOf<S extends { id: string }>(search: string, scenarios: readonly S[], pending: PendingSlot | null): BootPlan<S> {
  // ?scenario=<id> で石板を選ぶ。無ければ自由モード
  const params = new URLSearchParams(search);
  const asked = params.get('scenario');
  const scenario = scenarios.find((d) => d.id === asked) ?? null;
  // 知らない石板は自由モードで開き、URL からも消す (M19-17)。URL と画面の島を食い違わせない
  let unknown: BootPlan<S>['unknown'] = null;
  if (asked !== null && !scenario) {
    params.delete('scenario');
    params.delete('visit');
    unknown = { scenarioId: asked, search: params.size ? `?${params.toString()}` : '' };
  }
  const visitId = visitIdOf(params, scenario);
  const slot: Restore[] = pending ? [{ from: 'slot', slot: pending }] : [];
  const restore: Restore[] = visitId ? [] : [...slot, scenario ? { from: 'scenario' } : { from: 'auto' }];
  return { scenario, visitId, unknown, restore };
}

/** 訪問の道。石板の無い道 (自由モード) では訪問しない (その島を組めない) */
function visitIdOf(params: URLSearchParams, scenario: Pick<ScenarioDef, 'id'> | null): ChronicleId | null {
  if (!scenario) return null;
  const id = parseChronicleId(params.get('visit'));
  return id.ok ? id.value : null;
}

/** save は枠へ保存、load は枠の読込、file はファイルの読込、newIsland は新しい島 (石板を初めから)。why は押せないわけ */
export type SlotControls = { save: boolean; load: boolean; file: boolean; newIsland: boolean; why: string };

export function slotControlsOf(at: { visiting: boolean; slot: SlotId; filled: boolean }): SlotControls {
  const own = !at.visiting;
  return { save: own && at.slot !== 'auto', load: own && at.filled, file: own, newIsland: own, why: own ? '' : '訪れている島は差し替えられない (他人の島)' };
}
