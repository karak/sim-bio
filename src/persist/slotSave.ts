import { isObject } from '../core/parse';
import { parseChronicle, type Chronicle, type ChronicleHead } from '../harbor/chronicle';
import type { RunnerState } from '../scenario/ScenarioRunner';
import type { SaveData } from '../simulation/types';
import { checkScenarioSave } from './scenarioSave';
import { SLOTS, type PendingSlot, type Stage } from './slots';

/**
 * 手動の枠とファイルの包み (M19-17、設計 docs/design/2026-09-27-scenario-save-url.md §3)。どれも自分の舞台を名乗る。
 * 石板の枠は、続きからの復帰 (M19-14) と同じ 3 つ (島・runner の状態・年代記) を同じ tick で持つ
 */
export type SlotSave =
  | { stage: 'free'; save: SaveData }
  | { stage: 'scenario'; scenarioId: string; save: SaveData; runner: RunnerState; chronicle: Chronicle };

/** 置き場とファイルから読んだ値。包みの無い古い SaveData は自由モードの枠。中身の確かめは checkSlot と World.restore が持つ */
export function slotSaveOf(raw: unknown): SlotSave {
  if (isObject(raw) && (raw.stage === 'free' || raw.stage === 'scenario') && 'save' in raw) return raw as SlotSave;
  return { stage: 'free', save: raw as SaveData };
}

/** 今いる舞台。石板では、枠の年代記の頭を比べるために石板の頭を持つ */
export type Here = { stage: 'free' } | { stage: 'scenario'; head: ChronicleHead };

const stageName = (s: Stage) => (s.stage === 'free' ? 'free' : `scenario:${s.scenarioId}`);
const stageOfHere = (h: Here): Stage => (h.stage === 'free' ? h : { stage: 'scenario', scenarioId: h.head.scenarioId });
const sameStage = (a: Stage, b: Stage) => stageName(a) === stageName(b);

/**
 * 今の舞台で読める枠か。違う舞台の枠は読まない (別の島を石板の途中に差し込まない)。
 * 石板の枠は続きからの復帰と同じ確かめ (版・石板・seed・runner の状態) を通す。判定の出た枠も読める (判定の後にも保存できるので)
 */
export function checkSlot(s: SlotSave, here: Here): { ok: true; value: SlotSave } | { ok: false; reason: string } {
  if (!sameStage(s, stageOfHere(here))) return { ok: false, reason: `stage ${stageName(s)}, here ${stageName(stageOfHere(here))}` };
  if (s.stage === 'free' || here.stage === 'free') return { ok: true, value: s };
  const checked = checkScenarioSave({ ...s, chronicle: parseChronicle(s.chronicle) }, here.head);
  return checked.ok ? { ok: true, value: { ...s, ...checked.value } } : checked;
}

export type SlotLoadPlan = { kind: 'replace'; confirm: string } | { kind: 'navigate'; to: Stage; confirm: string };

/** 枠 (とファイル) を読む操作の行き先 (§4)。同じ舞台ならその場で差し替え、違う舞台ならその舞台へ移ってから読む。どちらも確かめてから */
export function planSlotLoad(slot: Stage, here: Here, titleOf: (scenarioId: string) => string): SlotLoadPlan {
  if (sameStage(slot, stageOfHere(here))) {
    return { kind: 'replace', confirm: here.stage === 'free' ? '今の島を捨てて、枠の島を読み込みますか (自動の枠は上書きされます)' : '石板を枠の時点に戻しますか (今の続きは上書きされます)' };
  }
  const to: Stage = slot.stage === 'free' ? { stage: 'free' } : { stage: 'scenario', scenarioId: slot.scenarioId };
  const confirm = to.stage === 'free' ? '自由モードの枠です。自由モードを開いて読みますか' : `石板『${titleOf(to.scenarioId)}』の枠です。石板を開いて読みますか`;
  return { kind: 'navigate', to, confirm };
}

/** 違う舞台へ移った先で読む枠の名前。URL に載せると読み直しや共有で二度読むので、sessionStorage に 1 回だけ置く */
const PENDING_KEY = 'biotope-pending-slot';
const PENDING: readonly string[] = [...SLOTS, 'import'];

export function putPendingSlot(storage: Pick<Storage, 'setItem'>, slot: PendingSlot): void {
  storage.setItem(PENDING_KEY, slot);
}

/** 置いた名前を取り出して消す。知らない名前は捨てる */
export function takePendingSlot(storage: Pick<Storage, 'getItem' | 'removeItem'>): PendingSlot | null {
  const v = storage.getItem(PENDING_KEY);
  if (v === null) return null;
  storage.removeItem(PENDING_KEY);
  return PENDING.includes(v) ? (v as PendingSlot) : null;
}
