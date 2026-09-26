import type { Digest, ReplayOutcome } from '../harbor/chronicle';
import type { PublishResult } from '../harbor/client';
import type { ChronicleCard } from '../harbor/contract';

/**
 * 港の画面の言葉 (M19-09)。閉港は誤りではなく普段の状態なので、何が起き、何ができるかを書く (設計書 §6.2)。
 * DOM を持たない純粋な関数にし、単体テストで文を確かめる
 */

type Ending = Pick<Digest, 'verdict' | 'year'>;

/** 「沈む欠片を 100 年、生き延びた」。石板の名はカタログから、無ければ id */
export function endingText(e: Ending, scenarioTitle: string): string {
  switch (e.verdict) {
    case 'alive':
      return `${scenarioTitle}を ${e.year} 年、生き延びた`;
    case 'dead':
      return `${scenarioTitle}の ${e.year} 年目に滅びた`;
    case 'escaped':
      return `${scenarioTitle}の ${e.year} 年目に、次の島へ逃れた`;
  }
}

export function confirmText(card: Pick<ChronicleCard, 'confirms' | 'mismatches'>): string {
  if (card.confirms === 0 && card.mismatches === 0) return 'まだ誰もたどっていない';
  const confirmed = card.confirms > 0 ? `${card.confirms} 人がたどって確かめた` : 'たどって確かめた人はまだいない';
  return card.mismatches > 0 ? `${confirmed}。${card.mismatches} 人は違う結末になった` : confirmed;
}

/** 版違いの島は回し直せないので、刻まれた要約だけを見せる (設計書 §2.2・§8-2) */
export function otherVersionText(simVersion: string): string {
  return `別の版 (版 ${simVersion}) の島。今の版では回し直せないので、刻まれた要約だけを見せる`;
}

export const HARBOR_CLOSED_TEXT = '港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる';
export const HARBOR_EMPTY_TEXT = 'まだ誰の年代記も流れ着いていない。石板の判定のあとに、自分の島を港へ出せる';

export function publishText(r: PublishResult): string {
  switch (r.kind) {
    case 'published':
      return '港へ出した。リンクを渡せば、誰でもこの島をたどれる';
    case 'queued':
      return '港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す';
    case 'not_human':
      return '人の手と確かめられなかった。もう一度「出港する」を押す';
    case 'slow_down':
      return '港が混んでいる。少し待ってから、もう一度「出港する」を押す';
    case 'rejected':
      return `港が受け取れない年代記だった (${r.reason})`;
  }
}

/** 預けていた年代記を送り直した結果。送れたものだけを知らせる */
export function resentText(published: number): string | null {
  return published > 0 ? `預けていた年代記 ${published} 件を港へ出した` : null;
}

export type ReadResult = { kind: 'matched' | 'differed'; digest: Digest } | Exclude<ReplayOutcome, { kind: 'done' }>;

/** 照合の結末。hash の比べは港がする (confirm)。手元は判定と年を港の記録と比べて言う */
export function readResultOf(outcome: ReplayOutcome, card: Pick<ChronicleCard, 'verdict' | 'year'>): ReadResult {
  if (outcome.kind !== 'done') return outcome;
  const same = outcome.digest.verdict === card.verdict && outcome.digest.year === card.year;
  return { kind: same ? 'matched' : 'differed', digest: outcome.digest };
}

export function readText(r: ReadResult, scenarioTitle: string): string {
  switch (r.kind) {
    case 'matched':
      return '読み終えた。港の記録と同じ結末になった';
    case 'differed':
      return `読み終えた。港の記録と違う結末になった (${endingText(r.digest, scenarioTitle)})`;
    case 'aborted':
      return '読むのをやめた。もう一度読むと、初めから読む';
    case 'broken':
      return `年代記が壊れていて、読み切れなかった (${r.error.path || '全体'}: ${r.error.reason})`;
    case 'other_version':
      return otherVersionText(r.simVersion);
    case 'crashed':
      return '読む途中で止まった。ページを開き直して、もう一度読む';
  }
}

export function readingText(year: number, years: number): string {
  return `${Math.min(year, years)} / ${years} 年を読んだ`;
}
