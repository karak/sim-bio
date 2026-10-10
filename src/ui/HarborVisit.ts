import type { ReplayIsland } from '../chronicle/replay';
import { replayInWorker } from '../chronicle/replayInWorker';
import type { Chronicle } from '../harbor/chronicle';
import type { Harbor } from '../harbor/client';
import type { ChronicleCard, ChronicleId } from '../harbor/contract';
import { inscriptionText, islandName, type Inscription } from '../harbor/names';
import { el } from './el';
import { confirmText, endingText, HARBOR_CLOSED_TEXT, otherVersionText, readingText, readResultOf, readText, recountLineOf, type RecountEvent, VISIT_MISMATCH_TEXT, VISIT_MISSING_TEXT } from './harborText';

/** 港の画面の部品が共に使うもの。港のクライアントと碑文のカタログが揃ってから組む */
export type HarborContext = { harbor: Harbor; inscriptions: readonly Inscription[]; simVersion: string; titleOf(scenarioId: string): string };

export type Visit = { id: ChronicleId; island: ReplayIsland };

/**
 * 訪問の板 (M19-09)。観察画面の上にも出す。港から年代記を引き、この島で回し直せる (同じ版・同じ石板・同じ seed) なら返す。
 * ほかは板に理由を出して null (main.ts は島を進めない)
 */
export async function mountVisit(app: HTMLElement, ready: Promise<HarborContext>, visit: Visit): Promise<Chronicle | null> {
  const body = el('div', { class: 'harbor-visit-body' }, el('p', { class: 'harbor-line' }, '港から年代記を引いている…'));
  app.append(
    el(
      'section',
      { class: 'harbor-stone harbor-visit', id: 'harbor-visit', 'aria-label': '訪れている島' },
      el('p', { class: 'harbor-sub' }, '訪れている島'),
      el('h2', { class: 'harbor-name' }, islandName(visit.id)),
      body,
      el('a', { class: 'harbor-chip', href: '/' }, '自分の島へ戻る'),
    ),
  );
  const ctx = await ready;
  const got = await ctx.harbor.visit(visit.id);
  if (got.kind !== 'ok') {
    body.replaceChildren(el('p', { class: 'harbor-line' }, got.kind === 'missing' ? VISIT_MISSING_TEXT : HARBOR_CLOSED_TEXT));
    return null;
  }
  const { chronicle, card } = got;
  const confirms = el('p', { class: 'harbor-line harbor-dim', id: 'harbor-visit-confirms' }, confirmText(card));
  body.classList.add(card.verdict);
  body.replaceChildren(
    el('p', { class: 'harbor-inscription' }, `「${inscriptionText(card.inscription, ctx.inscriptions)}」`),
    el('p', { class: 'harbor-line', id: 'harbor-visit-ending' }, endingText(card, ctx.titleOf(card.scenarioId))),
    confirms,
  );
  if (chronicle.simVersion !== ctx.simVersion) {
    body.append(el('p', { class: 'harbor-line harbor-version' }, otherVersionText(chronicle.simVersion)));
    return null;
  }
  if (chronicle.scenarioId !== visit.island.def.id || chronicle.seed !== visit.island.config.seed) {
    body.append(el('p', { class: 'harbor-line harbor-version' }, VISIT_MISMATCH_TEXT));
    return null;
  }
  body.append(reader(ctx, visit, chronicle, card, (text) => (confirms.textContent = text)));
  return chronicle;
}

/** 照合 (「年表を読む」)。再生は重い (Chromium で size 64 の 100 年が 25 秒ほど) ので、明示の操作にし、進みと中断を見せる */
function reader(ctx: HarborContext, visit: Visit, chronicle: Chronicle, card: ChronicleCard, countLine: (text: string) => void): HTMLElement {
  const years = visit.island.def.years;
  const start = el('button', { class: 'harbor-chip harbor-primary' }, '年表を読む');
  const stop = el('button', { class: 'harbor-chip', hidden: '' }, 'やめる');
  const bar = el('div', { class: 'harbor-track', role: 'progressbar', 'aria-label': '年表を読む進み', 'aria-valuemin': '0', 'aria-valuemax': String(years), 'aria-valuenow': '0', hidden: '' }, el('i'));
  const status = el('p', { class: 'harbor-line', id: 'harbor-read-status', role: 'status' });
  let ctl: AbortController | null = null;
  /**
   * 何回目の読みか (runs) と、確かめた人の数の行を持つ読み (shown。途中の行を書いた読み)。引き直しは閉港なら間を置いて問い直すので、
   * 読み直すと前の読みの答えが後から届くことがある。後の読みが行を持った後に届いた前の読みの答えは、数も届かなかったことも書かない
   * (M26-15。決め方は recountLineOf)
   */
  let runs = 0;
  let shown = 0;
  const recount = (e: RecountEvent) => {
    const next = recountLineOf(shown, e);
    shown = next.shown;
    if (next.text !== null) countLine(next.text);
  };
  const progress = (year: number) => {
    bar.setAttribute('aria-valuenow', String(Math.min(year, years)));
    bar.style.setProperty('--read', `${Math.min(1, year / years)}`);
    status.textContent = readingText(year, years);
  };
  const reading = (on: boolean) => {
    start.hidden = on;
    stop.hidden = !on;
  };
  start.addEventListener('click', async () => {
    const run = ++runs;
    ctl = new AbortController();
    reading(true);
    bar.hidden = false;
    progress(0);
    const outcome = await replayInWorker(chronicle, visit.island, { onYear: progress, signal: ctl.signal });
    const r = readResultOf(outcome, card);
    status.textContent = readText(r, ctx.titleOf(card.scenarioId));
    reading(false);
    start.textContent = r.kind === 'aborted' ? '年表を読む' : 'もう一度読む';
    if (outcome.kind !== 'done') return;
    recount({ kind: 'asking', run });
    await ctx.harbor.confirm(visit.id, outcome.digest);
    // 引き直しが投げても途中の行を残さず、届かなかったことにする
    const again = await ctx.harbor.recount(visit.id).catch(() => null);
    recount(again === null ? { kind: 'dropped', run } : { kind: 'counted', run, card: again });
  });
  stop.addEventListener('click', () => ctl?.abort());
  return el(
    'div',
    { class: 'harbor-reader' },
    el('p', { class: 'harbor-line harbor-dim' }, 'この島の年代記を手元で初めから回し直し、港の記録と同じ結末になるか確かめる'),
    bar,
    status,
    el('div', { class: 'harbor-actions' }, start, stop),
  );
}
