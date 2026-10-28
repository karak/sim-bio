import { el } from './el';
import { startTitleDemo, type DemoStats } from './titleDemo';
import { CONFIG_ROWS, menuKeyOf, scenarioRowsOf, slotRowsOf, titleMenuOf, titleStepOf, type TitleAction, type TitleChoice, type TitleContext, type TitleItem, type TitlePanel, type TitleStep } from './titleMenu';
import { titleHarborBody } from './Harbor';
import type { Continuation, ScenarioProgress } from '../persist/lastStage';
import { slotSaveOf } from '../persist/slotSave';
import { DEFAULT_CONFIG, type Config } from '../persist/config';
import type { TitleScreenDeps } from '../app/title';
import './title.css';

/**
 * タイトル画面 (M24-01、docs/uiux/2026-10-04-title-flow.md、W/F は docs/uiux/wireframes/title-*.svg)。
 * 舞台の起動より前に出し、選ばれたら背景のデモを止めて資源を返し、画面を外してから舞台を組む。
 * メニューは role="menu" と menuitem。矢印・Home・End で選び、Enter (と空白、button の既定) で決める。板は Esc と「戻る」でメニューへ返る
 */
export type { TitleChoice };

export type TitleDeps = {
  /** 続き (自動の枠か石板の続き。どちらかは persist/lastStage.ts の continueTargetOf が決める、M24-05)。あれば「続きから」を先頭に出して既定にする */
  continuation: Continuation | null;
  /** 自動の枠 (自由モード) に続きがあるか (M24-05)。無ければ新規ゲームは自由モードの最初の島 */
  freeSaved: boolean;
  reducedMotion: boolean;
  log: (event: string, extra: Record<string, unknown>) => void;
  /** (M24-02) ロードの板に並べる枠 (保存のある枠だけ) */
  slots: TitleScreenDeps['slots'];
  titleOf: (scenarioId: string) => string;
  /** (M24-02) 枠の包みを置き場から読む */
  loadSlot: TitleScreenDeps['loadSlot'];
  /** (M24-02) planOp の確かめと効果をタイトルで行う (app/title.ts の runAtTitle)。移る先の舞台、断れば null */
  run: TitleScreenDeps['run'];
  /** (M24-02) コンフィグの今の値と、変えたときに置き場へ書く口 */
  config: Config;
  saveConfig: (config: Config) => void;
  /** (M24-03) 石板の板に並べる石板と、石板ごとの続きを読む口 (板を開いたときに読む) */
  scenarios: TitleScreenDeps['scenarios'];
  progressOf: TitleScreenDeps['progressOf'];
  /** (M24-03) 港の板が港へ問う元と、取り下げの確かめ */
  harbor: TitleScreenDeps['harbor'];
  ask: TitleScreenDeps['ask'];
};

/** (M24-02) 板の題 */
const PANEL_HEADINGS: Record<TitlePanel, string> = { new: '新規ゲーム', load: 'ロード', config: 'コンフィグ', harbor: '港', scenarios: '石板を選ぶ' };

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
    const ctx: TitleContext = { continuation: deps.continuation, freeSaved: deps.freeSaved, titleOf: deps.titleOf };
    let busy = false;
    /** (M24-02) 行き先へ進む。plan は確かめと効果をタイトルで行い、移る先が決まれば舞台へ、断れば stay (板に留まる) */
    const go = async (step: TitleStep, stay: () => void): Promise<void> => {
      if (step.kind === 'enter') return finish(step.choice);
      if (step.kind !== 'plan' || busy) return;
      busy = true;
      const choice = await deps.run(step.plan).finally(() => (busy = false));
      if (choice) finish(choice);
      else stay();
    };
    /** (M24-02) 板を開く。板の中から次の板へ移るときも、閉じたらメニューの元の行へ戻る */
    const openOf = (panel: TitlePanel, back: () => void): void => {
      const heading = PANEL_HEADINGS[panel];
      // (M24-03) 石板の板: 選んだ石板は操作画面の石板の選択と同じ planOp (select) を通る
      if (panel === 'scenarios') return void openBoard(screen, heading, scenariosBody(deps, (scenarioId, stay) => go(titleStepOf({ kind: 'select', scenarioId }, ctx), stay)), back, true).classList.add('stones');
      if (panel === 'harbor') {
        // (M24-03) 港の板: 訪れるは操作画面の港の札と同じ planOp (visit)。空の港・閉港の「石板を選ぶ」は石板の板へ移る (閉じるとメニューの港へ戻る)
        const guard = { ask: deps.ask, leave: (href: string) => void go(titleStepOf({ kind: 'visit', href }, ctx), () => {}) };
        const board = openBoard(screen, heading, titleHarborBody({ ...deps.harbor, scenarios: deps.scenarios, guard }, {
          toScenarios: () => {
            board.remove();
            openOf('scenarios', back);
          },
        }), back, true);
        return;
      }
      if (panel === 'new') {
        const board = openBoard(screen, heading, newGameBody({
          free: (b) => void go(titleStepOf({ kind: 'new_free' }, ctx), () => b.focus()),
          scenarios: () => {
            board.remove();
            openOf('scenarios', back);
          },
        }), back);
        return;
      }
      if (panel === 'load') return void openBoard(screen, heading, loadBody(deps, (action, stay) => go(titleStepOf(action, ctx), stay)), back, true);
      openBoard(screen, heading, configBody(deps), back);
    };
    const choose = (i: number) => {
      const step = titleStepOf({ kind: 'item', id: menu.items[i].id }, ctx);
      if (step.kind !== 'panel') return void go(step, () => focusAt(i));
      // 板の間はメニューを inert にする (aria-modal の板の外を押せない・focus が出ない)
      list.inert = true;
      openOf(step.panel, () => {
        list.inert = false;
        focusAt(i);
      });
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

/**
 * (M24-02) 中身のある板 (W/F new-game・load・config)。上に「戻る」と題を置き、開くと「戻る」に focus を置く。
 * Esc・「戻る」で閉じて back を呼ぶ。Tab は板の中を回る。返す要素を外すと、back を呼ばずに閉じる (次の板へ移るとき)
 */
function openBoard(screen: HTMLElement, heading: string, body: readonly HTMLElement[], back: () => void, wide = false): HTMLElement {
  const id = `title-panel-${Math.random().toString(36).slice(2, 8)}`;
  const close = el('button', { type: 'button', class: 'title-panel-back' }, '戻る');
  const head = el('div', { class: 'title-board-head' }, close, el('h2', { id }, heading), el('span', { class: 'title-board-esc' }, 'Esc でタイトルへ'));
  const panel = el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, class: wide ? 'title-panel title-board wide' : 'title-panel title-board' }, head, ...body);
  const done = () => {
    panel.remove();
    back();
  };
  close.addEventListener('click', done);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      done();
    } else if (e.key === 'Tab') {
      // 押せる札と、選んである丸 (同じ組の丸は矢印で動く) だけを回る
      // (M24-03) 港の板の訪れる札 (a) も回る。隠した札 (もっと古い年代記など) は飛ばす
      const stops = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input[type="radio"]:checked')].filter((x) => !x.closest('[hidden]'));
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
      e.preventDefault();
      stops[next]?.focus();
    }
  });
  screen.append(panel);
  close.focus();
  return panel;
}

/** (M24-02) 札の 1 つ (題と小さな添え書き)。押すと on に自分を渡す */
function optionButton(label: string, note: string, on: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el('button', { type: 'button', class: 'title-option' }, el('span', { class: 'title-option-label' }, label), el('span', { class: 'title-option-note' }, note));
  b.addEventListener('click', () => on(b));
  return b;
}

/** (M24-02) 新規ゲームの板 (W/F new-game-*.svg)。自由モードは確かめてから新しい島、石板を選ぶは石板の板 (中身は M24-03) */
function newGameBody(on: { free: (b: HTMLButtonElement) => void; scenarios: () => void }): HTMLElement[] {
  return [
    el(
      'div',
      { class: 'title-options' },
      optionButton('自由モード', '制約の無い島。好きに介入する (今の島は新しい島に替わる)', on.free),
      optionButton('石板を選ぶ', '予言に抗う島', () => on.scenarios()),
    ),
  ];
}

/**
 * (M24-03) 石板の板 (W/F new-game-*.svg の石板の欄)。左に石板の一覧 (題と「種類 · 年数」、続きがあれば添える)、右に選んだ石板の予言と始める札。
 * 開いたときは最初の石板を選んである。続きは石板ごとに読み、届いたら添え書きと札の文を書き換える。始めるは操作画面の石板の選択と同じ行き先 (start)
 */
function scenariosBody(deps: TitleDeps, start: (scenarioId: string, stay: () => void) => Promise<void>): HTMLElement[] {
  const progress: Record<string, ScenarioProgress | null> = {};
  const rowsNow = () => scenarioRowsOf(deps.scenarios, progress);
  let picked: string | null = rowsNow()[0]?.id ?? null;
  const name = el('h3', { class: 'title-stone-name' });
  const meta = el('p', { class: 'title-option-note' });
  const prophecy = el('p', { class: 'title-stone-prophecy' });
  const begin = el('button', { type: 'button', class: 'title-panel-back title-stone-start' });
  const detail = el('section', { class: 'title-stone-detail', 'aria-label': '選んだ石板' }, name, meta, prophecy, begin);
  const buttons = new Map<string, HTMLButtonElement>();
  const paint = () => {
    const rows = rowsNow();
    for (const r of rows) {
      const b = buttons.get(r.id);
      b?.setAttribute('aria-pressed', String(r.id === picked));
      const note = b?.querySelector('.title-option-note');
      if (note) note.textContent = r.note ? `${r.meta} · ${r.note}` : r.meta;
    }
    const r = rows.find((x) => x.id === picked);
    detail.hidden = !r;
    if (!r) return;
    name.textContent = r.title;
    meta.textContent = r.note ? `${r.meta} · ${r.note}` : r.meta;
    prophecy.textContent = r.prophecy;
    begin.textContent = r.start;
  };
  const list = el(
    'div',
    { class: 'title-stones-list', role: 'group', 'aria-label': '石板の一覧' },
    ...rowsNow().map((r) => {
      const b = optionButton(r.title, r.meta, () => {
        picked = r.id;
        paint();
        begin.focus();
      });
      b.dataset.scenario = r.id;
      buttons.set(r.id, b);
      return b;
    }),
  );
  begin.addEventListener('click', () => {
    if (picked) void start(picked, () => begin.focus());
  });
  paint();
  // 続きは板を開いたこの時に読む (タイトルの初めの描画を待たせない)。読めない石板は続き無し (progressOf が null を返す)
  void Promise.all(rowsNow().map(async (r) => void (progress[r.id] = await deps.progressOf(r.id)))).then(paint);
  return [el('div', { class: 'title-stones' }, list, detail)];
}

/**
 * (M24-02) ロードの板 (W/F load-*.svg)。自動の枠と枠 1〜3、下にファイル。読むと確かめ (舞台を移って読む) の後に包みの舞台を開く。
 * 読めない枠・ファイルは板の中に知らせ、板に留まる
 */
function loadBody(deps: TitleDeps, load: (action: Extract<TitleAction, { kind: 'load' }>, stay: () => void) => Promise<void>): HTMLElement[] {
  const status = el('p', { class: 'title-board-status', role: 'status' });
  const rows = slotRowsOf(deps.slots, deps.titleOf).map((r) => {
    const read = el('button', { type: 'button', class: 'title-panel-back', 'aria-label': `${r.name}を読み込む` }, '読み込む');
    read.disabled = r.note === null;
    read.addEventListener('click', () => {
      status.textContent = '';
      void deps.loadSlot(r.slot).then((data) => {
        if (data) return load({ kind: 'load', data, slot: r.slot }, () => read.focus());
        status.textContent = `${r.name}を読めませんでした`;
      });
    });
    return el('div', { class: 'title-slot', 'data-slot': r.slot }, el('span', { class: 'title-slot-name' }, r.name), el('span', { class: 'title-slot-note' }, r.note ?? '空'), read);
  });
  const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
  const pick = el('button', { type: 'button', class: 'title-option title-file' }, el('span', { class: 'title-option-label' }, 'ファイルから読む…'), el('span', { class: 'title-option-note' }, '保存したファイル (.json) を選ぶ'));
  pick.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    status.textContent = '';
    // 操作画面の読込 (Hud の load-input) と同じく、JSON を読んで包み (slotSaveOf) にする
    void f
      .text()
      .then((t) => load({ kind: 'load', data: slotSaveOf(JSON.parse(t)), slot: null }, () => pick.focus()))
      .catch(() => {
        status.textContent = 'ファイルを読めませんでした';
      })
      .finally(() => {
        input.value = '';
      });
  });
  return [
    el('div', { class: 'title-slots' }, ...rows),
    el('div', { class: 'title-options' }, pick, input),
    el('p', { class: 'title-board-note' }, '読むと確かめの後に、保存した舞台 (自由モード・石板) をその年から開きます。'),
    status,
  ];
}

/** (M24-02) コンフィグの板 (W/F config-*.svg)。変えた値はその場で置き場へ書き、次の起動でも戻る。既定に戻すは 3 つとも既定へ */
function configBody(deps: TitleDeps): HTMLElement[] {
  let now: Config = deps.config;
  const radios: { key: keyof Config; value: Config[keyof Config]; input: HTMLInputElement }[] = [];
  const set = (next: Config) => {
    now = next;
    for (const r of radios) r.input.checked = now[r.key] === r.value;
    deps.saveConfig(now);
  };
  const groups = CONFIG_ROWS.map((row) => {
    const labels = row.choices.map((c) => {
      const input = el('input', { type: 'radio', name: `title-config-${row.key}`, value: String(c.value) });
      input.checked = now[row.key] === c.value;
      input.addEventListener('change', () => {
        if (input.checked) set({ ...now, [row.key]: c.value });
      });
      radios.push({ key: row.key, value: c.value, input });
      return el('label', { class: 'title-choice' }, input, el('span', {}, c.label));
    });
    return el('fieldset', { class: 'title-config-row' }, el('legend', {}, row.legend), el('span', { class: 'title-option-note' }, row.hint), el('div', { class: 'title-choices' }, ...labels));
  });
  const reset = el('button', { type: 'button', class: 'title-panel-back' }, '既定に戻す');
  reset.addEventListener('click', () => set(DEFAULT_CONFIG));
  return [...groups, el('p', { class: 'title-board-note' }, '変えた値はその場で保存し、次の起動でも戻ります。'), el('div', { class: 'title-board-actions' }, reset)];
}
