import { el } from './el';
import { startTitleDemo, type DemoStats } from './titleDemo';
import { menuKeyOf, titleMenuOf, type TitleItem, type TitleItemId } from './titleMenu';
import type { SlotSummary } from '../persist/slots';
import './title.css';

/**
 * タイトル画面 (M24-01、docs/uiux/2026-10-04-title-flow.md、W/F は docs/uiux/wireframes/title-*.svg)。
 * 舞台の起動より前に出し、選ばれたら背景のデモを止めて資源を返し、画面を外してから舞台を組む。
 * メニューは role="menu" と menuitem。矢印・Home・End で選び、Enter (と空白) で決める。板は Esc と「戻る」でメニューへ返る
 */
export type TitleChoice = { kind: 'free' };

export type TitleDeps = {
  /** 自動の枠の続き。あれば「続きから」を先頭に出して既定にする */
  continuation: SlotSummary | null;
  reducedMotion: boolean;
  log: (event: string, extra: Record<string, unknown>) => void;
};

/** 中身がまだ無い板 (M24-02・M24-03 で作る) の文 */
const PENDING_TEXT: Record<Exclude<TitleItemId, 'continue'>, string> = {
  new: '新しい島の始め方 (いまの島を残すかの確かめ) は準備中です。いまは「続きから」で島へ入れます。',
  load: '枠とファイルからの読込は準備中です。島の中の「枠」からは、いまも読めます。',
  harbor: 'タイトルからの港は準備中です。島の中の港の口からは、いまも訪れられます。',
  config: 'コンフィグ (画質・動きを減らす・始めの速さ) は準備中です。',
};

/** ロゴ: 石板 (上に星の紋、下に予言の刻線) を台にし、動物の紋 (月鹿の三日月の角・土兎の六角の紋・灰狼の背の稜線) をシアンの光の線で刻む */
const LOGO_SVG = `<svg class="title-logo-mark" viewBox="0 0 84 120" aria-hidden="true" focusable="false">
  <defs><linearGradient id="title-stone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d8790"/><stop offset="1" stop-color="#4a535b"/></linearGradient></defs>
  <path d="M10 112 L10 30 Q10 6 42 6 Q74 6 74 30 L74 112 Z" fill="url(#title-stone)" stroke="#a3adb5" stroke-width="1.5"/>
  <path class="glow" d="M42 13 L44.2 19.8 L51 22 L44.2 24.2 L42 31 L39.8 24.2 L33 22 L39.8 19.8 Z"/>
  <path class="glow line" d="M27 62 Q30 42 46 38 Q36 46 36 58 Q36 68 46 74 Q31 74 27 62 Z"/>
  <path class="glow line" d="M52 50 l6 3.5 v7 l-6 3.5 l-6 -3.5 v-7 Z"/>
  <path class="glow line" d="M20 86 l6 -5 l5 4 l6 -6 l5 5 l6 -5 l5 4 l6 -5 l5 4"/>
  <path d="M20 96 H64 M24 102 H60 M28 108 H56" stroke="#2c343b" stroke-width="1.6" fill="none"/>
</svg>`;

export function showTitle(root: HTMLElement, deps: TitleDeps): Promise<TitleChoice> {
  return new Promise((resolve) => {
    const demo = startTitleDemo({ reducedMotion: deps.reducedMotion });
    deps.log('title.demo.start', { images: demo.host.querySelectorAll('img').length, reducedMotion: deps.reducedMotion, triangles: 0, drawCalls: 0 });
    const menu = titleMenuOf(deps.continuation);
    const list = el('div', { role: 'menu', 'aria-label': 'タイトルのメニュー', 'aria-orientation': 'vertical', class: 'title-menu' });
    const items = menu.items.map((item, i) => itemButton(item, i === menu.focus));
    list.append(...items);
    const logo = el('h1', { class: 'title-logo' });
    logo.insertAdjacentHTML('afterbegin', LOGO_SVG);
    logo.append(el('span', { class: 'title-logo-text' }, 'ビオトープ島'));
    const body = el(
      'div',
      { class: 'title-body' },
      logo,
      el('p', { class: 'title-tagline' }, '沈みゆく島の命を、見守る'),
      list,
      el('p', { class: 'title-hint' }, '↑↓ で選ぶ · Enter で決める'),
    );
    const screen = el('section', { class: 'title', 'aria-label': 'タイトル' }, demo.host, el('div', { class: 'title-shade' }), body);
    root.append(screen);

    let at = menu.focus;
    const focusAt = (i: number) => {
      items[at].tabIndex = -1;
      at = i;
      items[at].tabIndex = 0;
      items[at].focus();
    };
    const finish = (choice: TitleChoice) => {
      const stats: DemoStats = demo.stop();
      deps.log('title.demo.stop', { ...stats, triangles: 0, drawCalls: 0 });
      screen.remove();
      resolve(choice);
    };
    const choose = (i: number) => {
      const id = menu.items[i].id;
      if (id === 'continue' || (id === 'new' && !deps.continuation)) finish({ kind: 'free' });
      else openPanel(screen, menu.items[i].label, PENDING_TEXT[id], () => focusAt(i));
    };
    list.addEventListener('keydown', (e) => {
      const k = menuKeyOf(e.key, at, items.length);
      if (!k) return;
      e.preventDefault();
      if (k.kind === 'move') focusAt(k.to);
      else if (k.kind === 'activate') choose(k.at);
    });
    items.forEach((b, i) =>
      b.addEventListener('click', () => {
        focusAt(i);
        choose(i);
      }),
    );
    items[at].focus();
  });
}

function itemButton(item: TitleItem, isDefault: boolean): HTMLButtonElement {
  const b = el('button', { type: 'button', role: 'menuitem', class: isDefault ? 'title-item default' : 'title-item', 'data-item': item.id, tabindex: isDefault ? '0' : '-1' }, el('span', { class: 'title-item-label' }, item.label));
  if (item.note) b.append(el('span', { class: 'title-item-note' }, item.note));
  return b;
}

/** 中身がまだ無い板。開くと「戻る」に focus を置き、Esc・「戻る」で閉じてメニューの行へ focus を返す */
function openPanel(screen: HTMLElement, heading: string, text: string, back: () => void): void {
  const id = `title-panel-${Math.random().toString(36).slice(2, 8)}`;
  const close = el('button', { type: 'button', class: 'title-panel-back' }, '戻る');
  const panel = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, class: 'title-panel' }, el('h2', { id }, heading), el('p', {}, text), close);
  const done = () => {
    panel.remove();
    back();
  };
  close.addEventListener('click', done);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      if (e.key === 'Escape') done();
    }
  });
  screen.append(panel);
  close.focus();
}
