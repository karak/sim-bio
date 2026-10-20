import type { Continuation, ScenarioProgress } from '../persist/lastStage';
import type { ScenarioDef } from '../scenario/types';
import { KIND_LABEL } from './Tablet';
import type { SlotSave } from '../persist/slotSave';
import { SLOTS, type SlotId, type SlotSummary } from '../persist/slots';
import { MOTIONS, QUALITIES, START_SPEEDS, type Config } from '../persist/config';
import type { TitleChoice } from '../app/title';
import { planOp, type At, type Plan } from '../app/place';
export type { TitleChoice };

/** タイトルのメニューの 1 行 (M24-01)。note は「続きから」の下に小さく添える要約 */
export type TitleItemId = 'continue' | 'new' | 'load' | 'harbor' | 'config';
export type TitleItem = { id: TitleItemId; label: string; note?: string };
export type TitleMenu = { items: readonly TitleItem[]; focus: number };

const pad = (n: number) => String(n).padStart(2, '0');

/** 「続きから」の要約: 舞台 · 年 · 保存の日時 (月/日 時:分、手元の時刻) */
// (M24-05) 石板の続きは「石板『題』」。savedAt は石板なら最後に遊んだ舞台の印の時刻 (persist/lastStage.ts)
export function continueNoteOf(s: Continuation): string {
  const d = new Date(s.savedAt);
  const stage = s.stage === 'free' ? '自由モード' : `石板『${s.title ?? s.scenarioId}』`;
  return `${stage} · ${s.year} 年 · ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * メニューの並び (docs/uiux/2026-10-04-title-flow.md の「メニューの並び」)。続きがあるときだけ「続きから」を先頭に出して既定にし、
 * 無ければ新規ゲームが既定。押せない行は並べない
 */
export function titleMenuOf(continuation: Continuation | null): TitleMenu {
  const rest: TitleItem[] = [
    { id: 'new', label: '新規ゲーム' },
    { id: 'load', label: 'ロード' },
    { id: 'harbor', label: '港' },
    { id: 'config', label: 'コンフィグ' },
  ];
  return continuation ? { items: [{ id: 'continue', label: '続きから', note: continueNoteOf(continuation) }, ...rest], focus: 0 } : { items: rest, focus: 0 };
}

/**
 * メニューの行を決めたときの行き先。panel は中身がまだ無い板 (M24-02・M24-03 で作る)。
 * 新規ゲームは自動の枠 (freeSaved) が無ければ自由モードの最初の島。あれば今の島を残すかの確かめが要る (M24-02) ので板。石板の続きは自動の枠を上書きしない
 */
export function titleChoiceOf(id: TitleItemId, continuation: Continuation | null, freeSaved: boolean): TitleChoice | { kind: 'panel' } {
  if (id === 'continue' && continuation) return continuation.stage === 'scenario' ? { kind: 'scenario', scenarioId: continuation.scenarioId } : { kind: 'free' };
  if (id === 'new' && !freeSaved) return { kind: 'free' };
  return { kind: 'panel' };
}

/** (M24-02) タイトルの板。scenarios は新規ゲームの「石板を選ぶ」、harbor は港 (どちらも中身は M24-03) */
export type TitlePanel = 'new' | 'load' | 'config' | 'harbor' | 'scenarios';

/**
 * (M24-02) タイトルの操作。item はメニューの行、new_free は新規ゲームの板の「自由モード」、scenarios は同じ板の「石板を選ぶ」、
 * load はロードの板の枠 (slot) かファイル (slot が null)
 */
export type TitleAction =
  | { kind: 'item'; id: TitleItemId }
  | { kind: 'new_free' }
  | { kind: 'scenarios' }
  | { kind: 'load'; data: SlotSave; slot: SlotId | null }
  /** (M24-03) 石板の板で選んだ石板。操作画面の石板の選択 (Tablet の select) と同じ planOp を通る */
  | { kind: 'select'; scenarioId: string }
  /** (M24-03) 港の板の訪れる札 (href は visitHref)。操作画面の港の札と同じ planOp の visit を通る */
  | { kind: 'visit'; href: string };

/** 行き先。stay は何もしない、panel は板を開く、enter は確かめずに舞台へ、plan は操作画面と同じ planOp の確かめと効果を通る (タイトルでの効果は app/title.ts の runAtTitle) */
export type TitleStep = { kind: 'stay' } | { kind: 'panel'; panel: TitlePanel } | { kind: 'enter'; choice: TitleChoice } | { kind: 'plan'; plan: Plan };

export type TitleContext = { continuation: Continuation | null; freeSaved: boolean; titleOf: (scenarioId: string) => string };

/**
 * タイトルの操作 → 行き先 (M24-02、docs/uiux/2026-10-04-title-flow.md の遷移図)。メニューの行は titleChoiceOf のまま (続きから・自動の枠の無い新規ゲームは舞台へ)、
 * 新しい島と読込は操作画面と同じ planOp をタイトル (舞台なし) から通す。読込はいつも包みの舞台へ移って読む (planSlotLoad、別の読み方を作らない)
 */
export function titleStepOf(action: TitleAction, ctx: TitleContext): TitleStep {
  const at: At = { stage: 'title', freeSaved: ctx.freeSaved };
  switch (action.kind) {
    case 'item': {
      const to = titleChoiceOf(action.id, ctx.continuation, ctx.freeSaved);
      if (to.kind !== 'panel') return { kind: 'enter', choice: to };
      return action.id === 'continue' ? { kind: 'stay' } : { kind: 'panel', panel: action.id };
    }
    case 'new_free':
      return { kind: 'plan', plan: planOp({ kind: 'new_island' }, at, ctx.titleOf) };
    case 'scenarios':
      return { kind: 'panel', panel: 'scenarios' };
    case 'load':
      return { kind: 'plan', plan: planOp({ kind: 'load', data: action.data, slot: action.slot }, at, ctx.titleOf) };
    case 'select':
      return { kind: 'plan', plan: planOp({ kind: 'select', scenarioId: action.scenarioId }, at, ctx.titleOf) };
    case 'visit':
      return { kind: 'plan', plan: planOp({ kind: 'visit', href: action.href }, at, ctx.titleOf) };
  }
}

/** (M24-03) 石板の板の 1 行。meta は種類と年数、note は続きか判定の添え書き (無ければ null)、start は始める札の文 */
export type ScenarioRow = { id: string; title: string; meta: string; prophecy: string; note: string | null; start: string };

/**
 * (M24-03) 石板の板の並び (W/F new-game-*.svg、docs/uiux/2026-10-04-title-flow.md の M24-03 への申し送り)。操作画面の石板 (Tablet の select) と同じく hidden を除いた同じ順。
 * progress は石板ごとの続き (読んでいない石板は鍵が無い)。判定の前の続きは「続きから始める」、判定の出た石板は開き直すと初めから (M19-14)。どちらを押しても行き先は同じ select
 */
export function scenarioRowsOf(defs: readonly Pick<ScenarioDef, 'id' | 'title' | 'kind' | 'years' | 'prophecy' | 'hidden'>[], progress: Readonly<Record<string, ScenarioProgress | null>>): ScenarioRow[] {
  return defs
    .filter((d) => !d.hidden)
    .map((d) => {
      const p = progress[d.id] ?? null;
      const resumes = p !== null && !p.finished;
      const note = p === null ? null : p.finished ? '判定が出ている · 開くと初めから' : `続きあり · ${p.year} 年`;
      return { id: d.id, title: d.title, meta: `${KIND_LABEL[d.kind]} · ${d.years} 年`, prophecy: d.prophecy, note, start: resumes ? '続きから始める' : 'この石板で始める' };
    });
}

/** (M24-02) ロードの板の 1 行。note は「続きから」と同じ要約、空の枠は null (読み込むを押せない) */
export type SlotRow = { slot: SlotId; name: string; note: string | null };

const SLOT_NAMES: Record<SlotId, string> = { auto: '自動の枠', 'manual-1': '枠 1', 'manual-2': '枠 2', 'manual-3': '枠 3' };

/** ロードの板の枠の並び (W/F load-*.svg)。自動の枠と枠 1〜3 をいつも並べる (空の枠も見せ、次の手のファイルを下に置く) */
export function slotRowsOf(slots: readonly SlotSummary[], titleOf: (scenarioId: string) => string): SlotRow[] {
  return SLOTS.map((slot) => {
    const s = slots.find((x) => x.slot === slot);
    if (!s) return { slot, name: SLOT_NAMES[slot], note: null };
    const c: Continuation = s.stage === 'free' ? { stage: 'free', year: s.year, savedAt: s.savedAt } : { stage: 'scenario', scenarioId: s.scenarioId, title: titleOf(s.scenarioId), year: s.year, savedAt: s.savedAt };
    return { slot, name: SLOT_NAMES[slot], note: continueNoteOf(c) };
  });
}

type ConfigRow<K extends keyof Config> = { key: K; legend: string; hint: string; choices: readonly { value: Config[K]; label: string }[] };

/** (M24-02) コンフィグの板の行 (W/F config-*.svg、決めること 2 の案 A)。画質は観察画面にまだ繋いでいない (保存と戻りだけ) */
export const CONFIG_ROWS: readonly [ConfigRow<'quality'>, ConfigRow<'motion'>, ConfigRow<'speed'>] = [
  {
    key: 'quality',
    legend: '画質',
    hint: '観察画面の影・草・解像度 (観察画面への反映は準備中)',
    choices: QUALITIES.map((value) => ({ value, label: { auto: '自動', light: '軽い', fine: 'きれい' }[value] })),
  },
  {
    key: 'motion',
    legend: '動きを減らす',
    hint: 'タイトルの背景の動き',
    choices: MOTIONS.map((value) => ({ value, label: { os: 'OS に従う', on: '入', off: '切' }[value] })),
  },
  {
    key: 'speed',
    legend: '最初の速さ',
    hint: '島を開いたときの速さ',
    choices: START_SPEEDS.map((value) => ({ value, label: `${value}x` })),
  },
];

export type MenuKey = { kind: 'move'; to: number } | { kind: 'activate'; at: number } | { kind: 'back' } | null;

/** メニューのキー。上下は端で回り込み、Home・End は端へ、Enter は決める、Esc は戻る。空白は button の既定の click に任せる (二重に決めない) */
export function menuKeyOf(key: string, at: number, count: number): MenuKey {
  switch (key) {
    case 'ArrowDown':
      return { kind: 'move', to: (at + 1) % count };
    case 'ArrowUp':
      return { kind: 'move', to: (at - 1 + count) % count };
    case 'Home':
      return { kind: 'move', to: 0 };
    case 'End':
      return { kind: 'move', to: count - 1 };
    case 'Enter':
      return { kind: 'activate', at };
    case 'Escape':
      return { kind: 'back' };
    default:
      return null;
  }
}
