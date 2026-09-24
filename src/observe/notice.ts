import type { TimelineEvent } from '../scenario/ScenarioRunner';
import { describeEvent } from '../ui/Tablet';

/**
 * 知らせの帯 (M22-08): 石板の祈り・警告・結末を、観察画面の上に控えめに出す。
 * (M22-08 の手直し: 審査台の t08-band 不合格「システムメッセージのモックと区別がつかない」を受け、
 *  ムーの巨石と月鹿の装甲板のような石の銘板にした。刻んだ石の面・面取りの縁の明かり・継ぎ目の光・六角の印)
 * 並びと寿命は純粋な関数 (pushNotice / stepNotice) にし、DOM は createNoticeBand が持つ。
 */

/** 帯に出す知らせの種類。印の形と光の色だけを変える (大きさ・位置は同じで控えめに) */
export type NoticeKind = 'prayer' | 'warning' | 'verdict';

/** 1 件を出しておく秒数 */
export const NOTICE_S = 8;
/** 次の知らせが待っているとき、今の知らせを少なくとも出しておく秒数 */
export const NOTICE_MIN_S = 4;
/** 待たせておく知らせの上限 (あふれたら古いものから捨てる) */
export const NOTICE_QUEUE_MAX = 2;

export type Notice = { kind: NoticeKind; text: string };
export type NoticeState = { current: Notice | null; shown: number; queue: Notice[] };

export const initialNotice = (): NoticeState => ({ current: null, shown: 0, queue: [] });

/** 帯に出す出来事か。出すなら種類を返す (介入・文明の段階などは操作画面の年表だけに出す) */
export function noticeKind(e: TimelineEvent): NoticeKind | null {
  if (e.kind === 'prayer') return 'prayer';
  if (e.kind === 'warning') return 'warning';
  if (e.kind === 'verdict') return 'verdict';
  return null;
}

/** 帯の文言。石板の年表と同じ文にし、警告の「⚠」は帯の印が担うので外す */
export function noticeText(e: TimelineEvent, names: Record<string, string>): string {
  return describeEvent(e, names).replace(/^⚠\s*/, '');
}

/** 出来事を知らせにする。帯に出さない出来事は null */
export function toNotice(e: TimelineEvent, names: Record<string, string>): Notice | null {
  const kind = noticeKind(e);
  return kind ? { kind, text: noticeText(e, names) } : null;
}

/** 知らせを足す。何も出ていなければすぐ出し、出ていれば待たせる */
export function pushNotice(s: NoticeState, n: Notice): NoticeState {
  if (!s.current) return { current: n, shown: 0, queue: s.queue };
  const queue = [...s.queue, n];
  return { ...s, queue: queue.slice(Math.max(0, queue.length - NOTICE_QUEUE_MAX)) };
}

/** dt 秒進める。出し終えたら次の知らせへ、無ければ帯を消す */
export function stepNotice(s: NoticeState, dt: number): NoticeState {
  if (!s.current) return s;
  const shown = s.shown + dt;
  const done = shown >= NOTICE_S || (s.queue.length > 0 && shown >= NOTICE_MIN_S);
  if (!done) return { ...s, shown };
  const [next, ...rest] = s.queue;
  return { current: next ?? null, shown: 0, queue: rest };
}

/** 種類ごとの印 (六角の中の図) と光の色。祈りは月鹿の角の青緑、警告は熾火の橙、結末は石板の星の金 */
export const NOTICE_STYLE: Record<NoticeKind, { label: string; tone: string; mark: string }> = {
  prayer: { label: '祈り', tone: '#8FEADF', mark: '<path d="M14.6 7.9a4.7 4.7 0 1 0 0 8.2a3.7 3.7 0 1 1 0-8.2z" fill="currentColor" stroke="none"/>' },
  warning: { label: '警告', tone: '#F0A868', mark: '<path d="M12.6 6.4 10.3 11.4 13.5 12.5 11.3 17.6" fill="none"/>' },
  verdict: { label: '結末', tone: '#F2D27A', mark: '<path d="M12 6.4l1.4 4.2 4.2 1.4-4.2 1.4L12 17.6l-1.4-4.2L6.4 12l4.2-1.4z" fill="currentColor" stroke="none"/>' },
};

const HEX = '<path d="M12 2.4 20.3 7.2v9.6L12 21.6 3.7 16.8V7.2z" fill="none"/>';
const glyph = (kind: NoticeKind) =>
  `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${HEX}${NOTICE_STYLE[kind].mark}</svg>`;
/** 石の粒 (細かい粒と大きなむら)。feTurbulence を灰色の明暗 (k 倍のコントラスト) にし、面の色に soft-light などで重ねる */
const grain = (freq: number, k: number, size: number) => {
  const r = `${k} 0 0 0 ${(1 - k) / 2}`;
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='${r} ${r} ${r} 0 0 0 0 1'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
};

/** 見た目に依らない置き場所・種類の色・出入りのアニメ */
const FRAME = `
.o-notice { --tone: ${NOTICE_STYLE.prayer.tone}; position: absolute; left: 0; right: 0; top: 16px; margin: 0 auto; width: fit-content; max-width: min(680px, calc(100% - 32px)); pointer-events: none; opacity: 0; visibility: hidden; }
.o-notice[data-state] { visibility: visible; }
.o-notice[data-kind="warning"] { --tone: ${NOTICE_STYLE.warning.tone}; }
.o-notice[data-kind="verdict"] { --tone: ${NOTICE_STYLE.verdict.tone}; }
.o-notice-rim, .o-notice-face, .o-notice-sheen { position: absolute; }
.o-notice-body { position: relative; display: flex; align-items: center; justify-content: center; gap: 10px; }
.o-notice-glyph { flex: none; width: 20px; height: 20px; color: var(--tone); filter: drop-shadow(0 0 4px var(--tone)); }
.o-notice-glyph svg { display: block; width: 100%; height: 100%; }
.o-notice-text { display: block; font: 600 15px/1.45 "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", serif; letter-spacing: 0.08em; text-align: center; text-wrap: balance; }
.o-notice[data-state="in"] { animation: o-notice-in 1.3s cubic-bezier(0.2, 0.7, 0.2, 1) forwards; }
.o-notice[data-state="in"] .o-notice-sheen { animation: o-notice-sheen 1.8s 0.3s ease-out both; }
.o-notice[data-state="in"] .o-notice-text { animation: o-notice-condense 1.5s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.o-notice[data-state="in"] .o-notice-glyph { animation: o-notice-kindle 2.4s ease-out both; }
.o-notice[data-state="out"] { animation: o-notice-out 1.8s ease-in forwards; }
.o-notice[data-state="out"] .o-notice-text { animation: o-notice-disperse 1.8s ease-in forwards; }
@keyframes o-notice-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes o-notice-out { from { opacity: 1; transform: none; visibility: visible; } to { opacity: 0; transform: translateY(-6px); visibility: hidden; } }
@keyframes o-notice-sheen { from { background-position: 140% 0; } to { background-position: -40% 0; } }
@keyframes o-notice-condense { from { opacity: 0; filter: blur(4px); transform: scale(1.05); } to { opacity: 1; filter: blur(0); transform: none; } }
@keyframes o-notice-disperse { to { opacity: 0; filter: blur(4px); transform: scale(1.04); } }
@keyframes o-notice-kindle { 0% { opacity: 0; filter: drop-shadow(0 0 0 var(--tone)); } 45% { opacity: 1; filter: drop-shadow(0 0 9px var(--tone)); } 100% { opacity: 1; filter: drop-shadow(0 0 4px var(--tone)); } }
@media (prefers-reduced-motion: reduce) {
  .o-notice[data-state="in"], .o-notice[data-state="out"] { animation: none; transition: opacity 0.6s, visibility 0s; }
  .o-notice[data-state="in"] { opacity: 1; }
  .o-notice[data-state="out"] { opacity: 0; visibility: hidden; transition: opacity 0.6s, visibility 0s 0.6s; }
  .o-notice[data-state] .o-notice-sheen, .o-notice[data-state] .o-notice-text, .o-notice[data-state] .o-notice-glyph { animation: none; }
}
`;

/**
 * 見た目「月鹿の装甲板」(案 A 石板の銘板・案 B 霊脈の光の帯と比べて選んだ、docs/design/qa/observe/notice2-*.png):
 * 両端を六角の角のように尖らせ、青緑がかった石の面に六角の刻みと石の粒、縁は石の面取りの明かり、両端と上下に種類の色の継ぎ目の光。
 * 集落の巨石 (灰の石に青緑の光の帯と六角の紋) と月鹿の装甲板に合わせる
 */
const HEXTILE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='41.6' viewBox='0 0 24 41.6'%3E%3Cpath d='M12 0 24 6.9v13.9L12 27.7 0 20.8V6.9zM0 34.7 12 41.6 24 34.7M12 27.7v13.9' fill='none' stroke='%23000' stroke-opacity='.4' stroke-width='1'/%3E%3Cpath d='M12 1 23 7.4v12.9' fill='none' stroke='%23fff' stroke-opacity='.12' stroke-width='1'/%3E%3C/svg%3E")`;
const POINTED = (c: number) => `clip-path: polygon(${c}px 0, calc(100% - ${c}px) 0, 100% 50%, calc(100% - ${c}px) 100%, ${c}px 100%, 0 50%);`;
const LOOK = `
.o-notice { filter: drop-shadow(0 5px 12px rgba(6, 14, 14, 0.5)); }
.o-notice-rim { inset: 0; ${POINTED(22)} background: linear-gradient(180deg, #C9D6CF 0%, #7E918B 30%, #33423F 70%, #6F8580 100%); }
.o-notice-face { inset: 2px 2.5px; ${POINTED(21)}
  background: ${grain(0.8, 1.4, 140)}, radial-gradient(closest-side, rgba(36, 58, 57, 0.92) 55%, rgba(36, 58, 57, 0) 100%) center / 86% 150% no-repeat, ${HEXTILE}, ${grain(0.04, 1.5, 260)}, radial-gradient(90% 130% at 50% 0%, rgba(210, 255, 246, 0.14), transparent 60%), linear-gradient(180deg, #33504E 0%, #223736 55%, #182827 100%);
  background-size: auto, 86% 150%, 24px 41.6px, auto, auto, auto;
  background-blend-mode: soft-light, normal, normal, soft-light, normal, normal;
  box-shadow: inset 0 1px 0 rgba(220, 255, 248, 0.25), inset 0 -2px 3px rgba(0, 0, 0, 0.5); }
.o-notice-face::before, .o-notice-face::after { content: ''; position: absolute; top: 50%; width: 14px; height: 1px; background: var(--tone); box-shadow: 0 0 5px var(--tone); opacity: 0.8; }
.o-notice-face::before { left: 6px; }
.o-notice-face::after { right: 6px; }
.o-notice-sheen { inset: 0; ${POINTED(22)} background: linear-gradient(105deg, transparent 35%, rgba(220, 255, 248, 0.3) 48%, transparent 60%); background-size: 260% 100%; background-position: 140% 0; mix-blend-mode: screen; }
.o-notice-body { padding: 9px 40px 10px; }
.o-notice-body::before, .o-notice-body::after { content: ''; position: absolute; left: 30px; right: 30px; height: 1px; background: linear-gradient(90deg, transparent, var(--tone) 12%, var(--tone) 88%, transparent); opacity: 0.55; box-shadow: 0 0 4px var(--tone); }
.o-notice-body::before { top: 4px; }
.o-notice-body::after { bottom: 4px; }
.o-notice-text { color: #EEF7F2; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8), 0 0 10px rgba(0, 0, 0, 0.5); }
`;

export const NOTICE_CSS = FRAME + LOOK;

export type NoticeBand = {
  /** 出来事を帯に出す (帯に出さない出来事は無視する) */
  push(e: TimelineEvent): void;
  /** 今の時刻 (performance.now() の ms) まで進める。描画の dt は重いと切り詰められるので、帯は実時間で 8 秒を数える (1 回に進めるのは 0.5 秒まで) */
  step(nowMs: number): void;
  el: HTMLElement;
};

/** 帯の DOM を parent に置く。CSS は文書に 1 度だけ足す */
export function createNoticeBand(parent: HTMLElement, names: () => Record<string, string>): NoticeBand {
  if (!document.getElementById('o-notice-css')) {
    const style = document.createElement('style');
    style.id = 'o-notice-css';
    style.textContent = NOTICE_CSS;
    document.head.appendChild(style);
  }
  const el = document.createElement('div');
  el.className = 'o-notice';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML =
    '<span class="o-notice-rim" aria-hidden="true"></span><span class="o-notice-face" aria-hidden="true"></span><span class="o-notice-sheen" aria-hidden="true"></span>' +
    '<span class="o-notice-body"><span class="o-notice-glyph" aria-hidden="true"></span><span class="o-notice-text"></span><span class="o-notice-glyph" aria-hidden="true"></span></span>';
  parent.appendChild(el);
  const text = el.querySelector('.o-notice-text') as HTMLElement;
  const glyphs = el.querySelectorAll<HTMLElement>('.o-notice-glyph');
  let state = initialNotice();
  let showing: Notice | null = null;
  let lastMs: number | null = null;
  const render = () => {
    if (state.current === showing) return;
    showing = state.current;
    if (!showing) {
      el.dataset.state = 'out';
      return;
    }
    el.dataset.kind = showing.kind;
    // 読み上げでは種類 (祈り・警告・結末) を名前にする。見た目では印の形と色が担う
    el.setAttribute('aria-label', `${NOTICE_STYLE[showing.kind].label}: ${showing.text}`);
    text.textContent = showing.text;
    for (const g of glyphs) g.innerHTML = glyph(showing.kind);
    // 出し直しのたびにアニメを頭から (属性を外して一度描かせる)
    delete el.dataset.state;
    void el.offsetWidth;
    el.dataset.state = 'in';
  };
  return {
    el,
    push(e) {
      const n = toNotice(e, names());
      if (!n) return;
      state = pushNotice(state, n);
      render();
    },
    step(nowMs) {
      const dt = lastMs === null ? 0 : Math.min(0.5, Math.max(0, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      state = stepNotice(state, dt);
      render();
    },
  };
}
