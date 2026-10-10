import type { SlotLoadPlan } from '../persist/slotSave';

/**
 * やり直しの効かない操作 (M21-04)。どれに確かめを付け、何と尋ねるかをここだけで決める (ダイアログの DOM は confirm.ts)。
 * 一覧と決めた理由は issues/M21-04-destructive-confirm.md の作業ログ
 */
export type Risky =
  /** 新しい島 (自由モード)・石板を初めから (石板の中) */
  | { kind: 'new_island'; inScenario: boolean }
  /** 枠とファイルの読込。行き先 (差し替え・移って読む) は planSlotLoad が決める */
  | { kind: 'load'; plan: SlotLoadPlan }
  /** 枠へ保存。overwrites は書いてある枠の一覧の 1 行 (空きなら null) */
  | { kind: 'slot_save'; overwrites: string | null }
  /** 舞台を移る (石板を選ぶ・自由モードへ・もう一度・訪れる・タイトルへ)。finished は判定の出た石板の島にいるか */
  | { kind: 'leave'; finished: boolean }
  /** 自分が出港した島を港から取り下げる */
  | { kind: 'withdraw'; name: string };

export type Ask = { title: string; message: string; ok: string };

/** 確かめる文。確かめの要らない操作は null */
export function askOf(r: Risky): Ask | null {
  switch (r.kind) {
    case 'new_island':
      return r.inScenario
        ? { title: '石板を初めから', message: '今の続きを捨てて、石板を初めからやり直しますか (判定の出た島は港へ出せるまま残ります)', ok: '初めからやり直す' }
        : { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)', ok: '新しい島を始める' };
    case 'load':
      return r.plan.kind === 'replace'
        ? { title: '枠の島を読み込む', message: r.plan.confirm, ok: '読み込む' }
        : { title: '舞台を移って読む', message: r.plan.confirm, ok: '移って読む' };
    case 'slot_save':
      return r.overwrites === null ? null : { title: '枠を上書きする', message: `「${r.overwrites}」を今の島で上書きしますか (前の保存には戻せません)`, ok: '上書きする' };
    case 'leave':
      // 走っている島は移る前に書き切り、開き直せば続きから (M19-14・M19-17)。判定の出た石板は開き直すと初めから (M19-14)
      return r.finished
        ? { title: '判定の出た島を離れる', message: '判定の出た島を離れますか。枠へ保存していなければ、この島には戻れません (港へ出す島は港に残ります)', ok: '離れる' }
        : null;
    case 'withdraw':
      return { title: '港から取り下げる', message: `${r.name}を港から取り下げますか (たどって確かめた人の数ごと消え、戻せません)`, ok: '取り下げる' };
  }
}
