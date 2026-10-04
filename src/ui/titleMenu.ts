import type { SlotSummary } from '../persist/slots';

/** タイトルのメニューの 1 行 (M24-01)。note は「続きから」の下に小さく添える要約 */
export type TitleItemId = 'continue' | 'new' | 'load' | 'harbor' | 'config';
export type TitleItem = { id: TitleItemId; label: string; note?: string };
export type TitleMenu = { items: readonly TitleItem[]; focus: number };

const pad = (n: number) => String(n).padStart(2, '0');

/** 「続きから」の要約: 舞台 · 年 · 保存の日時 (月/日 時:分、手元の時刻) */
export function continueNoteOf(s: SlotSummary): string {
  const d = new Date(s.savedAt);
  const stage = s.stage === 'free' ? '自由モード' : s.scenarioId;
  return `${stage} · ${s.year} 年 · ${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * メニューの並び (docs/uiux/2026-10-04-title-flow.md の「メニューの並び」)。続きがあるときだけ「続きから」を先頭に出して既定にし、
 * 無ければ新規ゲームが既定。押せない行は並べない
 */
export function titleMenuOf(continuation: SlotSummary | null): TitleMenu {
  const rest: TitleItem[] = [
    { id: 'new', label: '新規ゲーム' },
    { id: 'load', label: 'ロード' },
    { id: 'harbor', label: '港' },
    { id: 'config', label: 'コンフィグ' },
  ];
  return continuation ? { items: [{ id: 'continue', label: '続きから', note: continueNoteOf(continuation) }, ...rest], focus: 0 } : { items: rest, focus: 0 };
}

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
