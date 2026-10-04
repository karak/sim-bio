import type { Chronicle, ChronicleHead } from '../harbor/chronicle';
import { parseChronicleId, type ChronicleId } from '../harbor/contract';
import { checkSlot, planSlotLoad, type Here, type SlotSave } from '../persist/slotSave';
import type { ManualSlot, PendingSlot, SlotId } from '../persist/slots';
import type { TabMarks } from '../persist/tabMarks';
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

/** やり直しの効かない操作。select は石板を選ぶ・自由モードへ (null)、retry は判定の板のもう一度 (訪問中は visit を残す、M26-08)、visit は港の訪れる札。load の slot が null ならファイル */
export type Op =
  | { kind: 'new_island' }
  | { kind: 'load'; data: SlotSave; slot: SlotId | null }
  | { kind: 'slot_save'; slot: ManualSlot; overwrites: string | null }
  | { kind: 'select'; scenarioId: string | null }
  | { kind: 'retry'; scenarioId: string }
  | { kind: 'visit'; href: string }
  /** (M24-04) title は操作画面の「タイトルへ」。舞台を離れる操作で、確かめは select と同じ */
  | { kind: 'title' };

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
  | { kind: 'go'; scenarioId: string | null; keepVisit?: true }
  | { kind: 'assign'; href: string }
  /** (M24-04) タイトルへ移る: このタブの舞台に入った印を消し、タイトルを開く合図を置いてから素の / へ */
  | { kind: 'to_title' };

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
    case 'retry':
      // 判定の板の「もう一度」(M26-08)。石板を選ぶのと違い visit を残す。訪問中は同じ訪問を初めから開き直す
      return { ask: leaving(at), effects: [{ kind: 'flush' }, { kind: 'go', scenarioId: op.scenarioId, keepVisit: true }] };
    case 'visit':
      return { ask: leaving(at), effects: [{ kind: 'assign', href: op.href }] };
    case 'title':
      // タイトルへ (M24-04、docs/uiux/2026-10-04-title-flow.md の「タイトルへ戻るときの約束」)。書き切ってから移る。訪問では flush が何も書かない
      return { ask: leaving(at), effects: [{ kind: 'flush' }, { kind: 'to_title' }] };
  }
}

// (M24-04) タイトルへ (title) も舞台を離れる操作なので、同じ確かめを通す
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

/** 石板を選んだ先の検索語 (? は付けない)。scenario を差し替え、石板へ移る時は seed= を落とし、visit は keepVisit (もう一度) の時だけ残し、ほかの検索語はそのまま残す */
export function searchFor(search: string, scenarioId: string | null, opts: { keepVisit?: boolean } = {}): string {
  const q = new URLSearchParams(search);
  if (scenarioId) q.set('scenario', scenarioId);
  else q.delete('scenario');
  // 石板の島は seed 42 (M26-10)。自由モードの seed= を石板へ持ち込まない
  if (scenarioId) q.delete('seed');
  // 石板を選ぶのは訪問を離れる操作。visit を残すと、選んだ石板がその島の訪問として開き直る (M26-02)
  if (!opts.keepVisit) q.delete('visit');
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

/** 起動の行き先 (M24-01)。タイトルか、bootPlanOf が決める舞台か */
export type BootRoute<S> = { kind: 'title' } | { kind: 'stage'; plan: BootPlan<S> };

/**
 * 起動の行き先 (M24-01、docs/uiux/2026-10-04-title-flow.md の「起動の判断」)。上から順に: タイトルの合図ならタイトル、
 * 移る途中の枠・検索語が 1 つでもある・このタブで舞台に入った後・開発の印 (devSkip、本番のビルドでは常に false) なら舞台、どれでもなければタイトル。
 * 舞台の中身は bootPlanOf が決める (起動の道を 2 つ持たない)。pending は takePendingSlot が取り出した後の値
 */
export function bootRouteOf<S extends { id: string }>(search: string, scenarios: readonly S[], pending: PendingSlot | null, marks: TabMarks, devSkip: boolean): BootRoute<S> {
  if (marks.openTitle) return { kind: 'title' };
  const stage = pending !== null || new URLSearchParams(search).size > 0 || marks.entered || devSkip;
  return stage ? { kind: 'stage', plan: bootPlanOf(search, scenarios, pending) } : { kind: 'title' };
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

/** 自由モードの最初の島の seed (assets/data/world.default.json と同じ)。基準画・E2E・採点表はこの島の画を前提にする (M26-10) */
export const DEFAULT_SEED = 42;

const SEED_MAX = 0xffffffff;

function seedParam(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n <= SEED_MAX ? n : null;
}

/**
 * 起動時の URL の seed= (M26-10)。自由モードだけが読む: 整数 (0 以上 2^32-1) ならその seed、無い・壊れていれば null (戻す枠も無ければ 42)。
 * 石板・訪問 (scenario) は seed= を無視し、URL から落とした検索語 (? から。空もある) を search に返す。落とすものが無ければ null
 */
export function bootSeedOf(search: string, scenario: boolean): { seed: number | null; search: string | null } {
  const params = new URLSearchParams(search);
  if (scenario) {
    if (!params.has('seed')) return { seed: null, search: null };
    params.delete('seed');
    return { seed: null, search: params.size ? `?${params.toString()}` : '' };
  }
  const seed = seedParam(params.get('seed'));
  if (seed !== null || !params.has('seed')) return { seed, search: null };
  // 壊れた seed= は URL に残さない (HUD の seed と食い違う)
  params.delete('seed');
  return { seed: null, search: params.size ? `?${params.toString()}` : '' };
}

/** 新しい島の seed。draw は 0 以上 2^32-1 の整数を返す乱数 (差し替え口)。今と同じ値は引き直す */
export function freshSeed(current: number, draw: () => number): number {
  let next = draw();
  while (next === current) next = draw();
  return next;
}

/** 新しい島の seed。自由モードだけ引き、石板 (初めから) は石板の seed (base) のまま */
export function newWorldSeed(at: At, base: number, current: number, draw: () => number): number {
  return at.stage === 'free' ? freshSeed(current, draw) : base;
}

/** 検索語 (? から) の seed= を今の seed に揃える。null なら落とす。ほかの検索語は残す。無ければ空 */
export function seedSearchFor(search: string, seed: number | null): string {
  const q = new URLSearchParams(search);
  if (seed === null) q.delete('seed');
  else q.set('seed', String(seed));
  return q.size ? `?${q.toString()}` : '';
}

/** 自動の続きを戻してよいか。URL に seed= があれば、その seed の島の続きだけ (違えば、その seed の新しい島で開く) */
export function seedMatches(urlSeed: number | null, savedSeed: number): boolean {
  return urlSeed === null || urlSeed === savedSeed;
}
