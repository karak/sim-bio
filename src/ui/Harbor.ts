import type { ReplayIsland } from '../chronicle/replay';
import { replayInWorker } from '../chronicle/replayInWorker';
import type { Chronicle, Digest } from '../harbor/chronicle';
import { createHarbor, type Harbor, type HarborLog, type PublishResult } from '../harbor/client';
import { chronicleId, parseChronicleId, type BrowseCursor, type ChronicleCard, type ChronicleId, type HarborCatalog, type InscriptionId } from '../harbor/contract';
import { inscriptionText, islandName, parseInscriptions, type Inscription } from '../harbor/names';
import { createTurnstile, TEST_SITEKEY } from '../harbor/turnstile';
import { createMemoryHarborStore, openHarborStore, type HarborStore } from '../persist/harborStore';
import type { ScenarioDef } from '../scenario/types';
import { publishClick, visitHref } from './clicks';
import {
  confirmText,
  endingText,
  HARBOR_CLOSED_TEXT,
  HARBOR_EMPTY_TEXT,
  otherVersionText,
  publishText,
  readingText,
  readResultOf,
  readText,
  resentText,
} from './harborText';
import './harbor.css';

/**
 * 港の画面 (M19-09、設計書 §5.2・§6.2)。港の口 (左の縁の石の札)・一覧 (流れ着いた年代記の石碑)・判定の後の出港・訪問の板 (照合つき)。
 * main.ts へは、出港を差し出す口と、訪問の年代記を引く口だけを出す。港が閉まっていても、起動と遊ぶことには関わらない
 */
export type HarborUi = {
  /** 石板の判定の直後。判定の板に「港へ出す」を出す */
  offerPublish(island: { chronicle: Chronicle; digest: Digest }): void;
  /** 訪問の年代記を引く。この島で回し直せる (同じ版・同じ石板・同じ seed) なら返し、ほかは訪問の板に理由を出して null */
  visitChronicle(): Promise<Chronicle | null>;
};

export type HarborUiDeps = {
  scenarios: readonly ScenarioDef[];
  speciesIds: readonly string[];
  simVersion: string;
  /** 港の API の置き場。無ければ常に閉港 */
  baseUrl?: string;
  sitekey?: string;
  /** 訪問の道 (?scenario=…&visit=…) で開いたとき。island は照合の再生に渡す、main.ts が組んだその石板の島 */
  visit: { id: ChronicleId; island: ReplayIsland } | null;
  log: HarborLog;
};

/** 1 時間ごとに outbox を送り直す (設計書 §5.2) */
const RESEND_MS = 60 * 60 * 1000;
const TOAST_MS = 6000;

/** 訪問の道。石板の無い道 (自由モード) では訪問しない (その島を組めない) */
export function visitIdOf(params: URLSearchParams, scenario: ScenarioDef | null): ChronicleId | null {
  if (!scenario) return null;
  const id = parseChronicleId(params.get('visit'));
  return id.ok ? id.value : null;
}

type Child = Node | string | null | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) node.append(c);
  return node;
}

const VERDICT_TONE: Record<Digest['verdict'], string> = { alive: 'alive', dead: 'dead', escaped: 'escaped' };

export function mountHarbor(app: HTMLElement, deps: HarborUiDeps): HarborUi {
  const titleOf = (scenarioId: string) => deps.scenarios.find((d) => d.id === scenarioId)?.title ?? scenarioId;
  const catalogOf = (inscriptions: readonly Inscription[]): HarborCatalog => ({
    scenarios: new Set(deps.scenarios.map((d) => d.id)),
    species: new Set(deps.speciesIds),
    inscriptions: new Set(inscriptions.map((d) => d.id)),
  });

  // 人間確認の widget の置き場。同時に 2 つ (再送と出港) 確かめても、最後の 1 つが終わるまで出しておく
  const human = el('div', { class: 'harbor-stone harbor-human', id: 'harbor-human', role: 'status', hidden: '' }, el('p', { class: 'harbor-line' }, '港の番人が、人の手か確かめている'));
  let checks = 0;
  const hostOf = (show: boolean) => {
    checks = Math.max(0, checks + (show ? 1 : -1));
    human.hidden = checks === 0;
    return human;
  };
  const toast = el('div', { class: 'harbor-stone harbor-toast', id: 'harbor-toast', role: 'status', 'aria-live': 'polite', hidden: '' });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
  };

  const storeReady: Promise<HarborStore> = openHarborStore({ indexedDB }).catch((e: unknown) => {
    deps.log('warn', 'harbor.store.unavailable', { error: String(e) });
    return createMemoryHarborStore();
  });
  // 碑文のカタログは静的アセット。読めなければ碑文の無いカタログになり、出港は港へ送る前に断る
  const inscriptionsReady: Promise<Inscription[]> = fetch('/data/inscriptions.json')
    .then((r) => r.json() as Promise<unknown>)
    .then(parseInscriptions, (e: unknown) => {
      deps.log('warn', 'harbor.inscriptions.unavailable', { error: String(e) });
      return [];
    });
  const ready: Promise<{ harbor: Harbor; store: HarborStore; inscriptions: readonly Inscription[] }> = Promise.all([storeReady, inscriptionsReady]).then(([store, inscriptions]) => ({
    store,
    inscriptions,
    harbor: createHarbor({
      baseUrl: deps.baseUrl,
      linkBase: location.origin,
      store,
      catalog: catalogOf(inscriptions),
      turnstile: createTurnstile({ sitekey: deps.sitekey || TEST_SITEKEY, host: hostOf }),
      log: deps.log,
    }),
  }));

  // 港の口: 左の縁の石の札。預けた年代記があれば数を刻む
  const dockCount = el('span', { class: 'harbor-dock-count', id: 'harbor-dock-count', hidden: '' });
  const dock = el('button', { class: 'harbor-dock', id: 'harbor-open', 'aria-expanded': 'false', 'aria-controls': 'harbor-drawer' }, el('span', { class: 'harbor-dock-glyph' }, '港'), dockCount);
  const refreshCount = async () => {
    const { store } = await ready;
    const n = (await store.queued()).length;
    dockCount.hidden = n === 0;
    dockCount.textContent = `預け ${n}`;
    dock.setAttribute('aria-label', n === 0 ? '港を開く' : `港を開く (預けた年代記 ${n} 件)`);
  };

  // 一覧
  const drawerState = el('p', { class: 'harbor-line harbor-state', id: 'harbor-state' });
  const list = el('ul', { class: 'harbor-list', id: 'harbor-list', 'aria-label': '流れ着いた年代記' });
  const more = el('button', { class: 'harbor-chip', id: 'harbor-more', hidden: '' }, 'もっと古い年代記');
  const close = el('button', { class: 'harbor-chip harbor-close', id: 'harbor-close' }, '閉じる');
  const drawer = el(
    'aside',
    { class: 'harbor-stone harbor-drawer', id: 'harbor-drawer', 'aria-label': '港', hidden: '' },
    el('header', { class: 'harbor-head' }, el('h2', { class: 'harbor-title' }, '港'), el('p', { class: 'harbor-sub' }, '流れ着いた島の年代記'), close),
    drawerState,
    list,
    more,
  );
  let cursor: BrowseCursor | null = null;

  const cardItem = (card: ChronicleCard, own: ReadonlySet<ChronicleId>, harbor: Harbor, inscriptions: readonly Inscription[]): HTMLLIElement => {
    const sameVersion = card.simVersion === deps.simVersion;
    const status = el('p', { class: 'harbor-line harbor-card-status', role: 'status' });
    const actions = el('div', { class: 'harbor-actions' });
    if (sameVersion) actions.append(el('a', { class: 'harbor-chip harbor-primary', href: visitHref(card) }, '訪れる'));
    const report = el('button', { class: 'harbor-chip' }, '通報');
    report.addEventListener('click', async () => {
      report.disabled = true;
      const r = await harbor.report(card.id);
      status.textContent = { ok: '通報した。3 件集まると、港から隠れる', closed: HARBOR_CLOSED_TEXT, not_human: '人の手と確かめられなかった。もう一度「通報」を押す', slow_down: '港が混んでいる。少し待ってから、もう一度「通報」を押す' }[r];
      report.disabled = r === 'ok';
    });
    actions.append(report);
    if (own.has(card.id)) {
      const withdraw = el('button', { class: 'harbor-chip harbor-withdraw' }, '取り下げる');
      withdraw.addEventListener('click', async () => {
        withdraw.disabled = true;
        const r = await harbor.withdraw(card.id);
        status.textContent = { ok: '取り下げた。港にはもう並ばない', closed: HARBOR_CLOSED_TEXT, forbidden: 'この島の取り下げ鍵が手元に無い' }[r];
        withdraw.disabled = r === 'ok';
        if (r === 'ok') item.classList.add('harbor-card-gone');
      });
      actions.append(withdraw);
    }
    const item = el(
      'li',
      { class: `harbor-card ${VERDICT_TONE[card.verdict]}`, 'data-id': card.id },
      el('h3', { class: 'harbor-name' }, islandName(card.id)),
      el('p', { class: 'harbor-inscription' }, `「${inscriptionText(card.inscription, inscriptions)}」`),
      el('p', { class: 'harbor-line' }, endingText(card, titleOf(card.scenarioId))),
      sameVersion ? el('p', { class: 'harbor-line harbor-dim' }, confirmText(card)) : el('p', { class: 'harbor-line harbor-dim harbor-version' }, otherVersionText(card.simVersion)),
      own.has(card.id) ? el('p', { class: 'harbor-line harbor-own' }, 'あなたが出港した島') : null,
      actions,
      status,
    );
    return item;
  };

  const loadPage = async (reset: boolean) => {
    const { harbor, inscriptions } = await ready;
    if (reset) {
      cursor = null;
      list.replaceChildren();
      drawerState.textContent = '年代記を引いている…';
    }
    const [page, own] = await Promise.all([harbor.browse(cursor ? { before: cursor } : {}), harbor.ownIds()]);
    if (page.kind === 'closed') {
      drawerState.textContent = HARBOR_CLOSED_TEXT;
      more.hidden = true;
      return;
    }
    list.append(...page.cards.map((c) => cardItem(c, own, harbor, inscriptions)));
    cursor = page.next;
    more.hidden = cursor === null;
    drawerState.textContent = list.childElementCount === 0 ? HARBOR_EMPTY_TEXT : '港は開いている';
  };
  const setOpen = (open: boolean) => {
    drawer.hidden = !open;
    dock.setAttribute('aria-expanded', String(open));
    if (open) void loadPage(true);
  };
  dock.addEventListener('click', () => setOpen(drawer.hidden === true));
  close.addEventListener('click', () => setOpen(false));
  more.addEventListener('click', () => void loadPage(false));

  app.append(dock, drawer, toast, human);
  if (deps.visit) app.classList.add('harbor-visiting');

  // 預けた年代記の送り直し: 起動の後と 1 時間ごと。起動は待たない
  const resend = async () => {
    const { harbor } = await ready;
    const results = await harbor.flushOutbox();
    const text = resentText(results.filter((r) => r.kind === 'published').length);
    if (text) say(text);
    await refreshCount();
  };
  void refreshCount().then(resend);
  setInterval(() => void resend(), RESEND_MS);

  return {
    offerPublish(island) {
      const slot = app.querySelector<HTMLElement>('#verdict-harbor');
      if (!slot || deps.visit) return;
      void ready.then(({ inscriptions }) => slot.replaceChildren(publishPanel(island, inscriptions)));
    },
    visitChronicle: () => (deps.visit ? openVisit(deps.visit) : Promise.resolve(null)),
  };

  function publishPanel(island: { chronicle: Chronicle; digest: Digest }, inscriptions: readonly Inscription[]): HTMLElement {
    let chosen = (inscriptions[0]?.id ?? '') as InscriptionId;
    const choices = el('div', { class: 'harbor-inscriptions', role: 'radiogroup', 'aria-label': '島に添えるひとこと' });
    for (const d of inscriptions) {
      const b = el('button', { class: 'harbor-carve', role: 'radio', 'aria-checked': String(d.id === chosen), 'data-id': d.id }, d.text);
      b.addEventListener('click', () => {
        chosen = d.id as InscriptionId;
        for (const c of choices.children) c.setAttribute('aria-checked', String(c.getAttribute('data-id') === d.id));
      });
      choices.append(b);
    }
    const send = el('button', { class: 'harbor-chip harbor-primary', id: 'harbor-publish' }, '出港する');
    const status = el('p', { class: 'harbor-line', id: 'harbor-publish-status', role: 'status' });
    const link = el('div', { class: 'harbor-link', hidden: '' });
    const lead = el('p', { class: 'harbor-line harbor-dim' }, 'ひとことを刻んで、この島を港に並べる');
    void chronicleId(island.chronicle).then((id) => (lead.textContent = `ひとことを刻んで、${islandName(id)}として港に並べる`));
    const panel = el(
      'section',
      { class: 'harbor-publish', 'aria-label': '港へ出す' },
      el('h3', { class: 'harbor-publish-title' }, '港へ出す'),
      lead,
      choices,
      send,
      status,
      link,
    );
    send.addEventListener('click', async () => {
      send.disabled = true;
      status.textContent = '港へ運んでいる…';
      const { harbor } = await ready;
      const r = await harbor.publish(publishClick(island, chosen));
      status.textContent = publishText(r);
      send.disabled = r.kind === 'published' || r.kind === 'queued';
      showLink(link, r);
      await refreshCount();
    });
    return panel;
  }

  function showLink(link: HTMLElement, r: PublishResult) {
    link.hidden = r.kind !== 'published';
    if (r.kind !== 'published') return;
    const field = el('input', { class: 'harbor-url', id: 'harbor-url', readonly: '', value: r.url, 'aria-label': '訪問のリンク' });
    const copy = el('button', { class: 'harbor-chip' }, 'リンクを写す');
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(r.url).then(
        () => (copy.textContent = '写した'),
        () => field.select(),
      );
    });
    link.replaceChildren(field, copy, el('a', { class: 'harbor-chip', href: r.url }, 'この島を訪れる'));
  }

  async function openVisit(visit: { id: ChronicleId; island: ReplayIsland }): Promise<Chronicle | null> {
    const title = titleOf(visit.island.def.id);
    const name = el('h2', { class: 'harbor-name', id: 'harbor-visit-name' }, islandName(visit.id));
    const body = el('div', { class: 'harbor-visit-body' }, el('p', { class: 'harbor-line' }, '港から年代記を引いている…'));
    const plaque = el(
      'section',
      { class: 'harbor-stone harbor-visit', id: 'harbor-visit', 'aria-label': '訪れている島' },
      el('p', { class: 'harbor-sub' }, '訪れている島'),
      name,
      body,
      el('a', { class: 'harbor-chip', href: '/' }, '自分の島へ戻る'),
    );
    app.append(plaque);
    const { harbor, inscriptions } = await ready;
    const got = await harbor.visit(visit.id);
    if (got.kind !== 'ok') {
      body.replaceChildren(el('p', { class: 'harbor-line' }, got.kind === 'missing' ? 'この年代記は港に無い (取り下げられたか、隠された)' : HARBOR_CLOSED_TEXT));
      return null;
    }
    const { chronicle, card } = got;
    const confirmLine = el('p', { class: 'harbor-line harbor-dim', id: 'harbor-visit-confirms' }, confirmText(card));
    body.replaceChildren(
      el('p', { class: 'harbor-inscription' }, `「${inscriptionText(card.inscription, inscriptions)}」`),
      el('p', { class: 'harbor-line', id: 'harbor-visit-ending' }, endingText(card, title)),
      confirmLine,
    );
    body.classList.add(VERDICT_TONE[card.verdict]);
    if (chronicle.simVersion !== deps.simVersion) {
      body.append(el('p', { class: 'harbor-line harbor-version' }, otherVersionText(chronicle.simVersion)));
      return null;
    }
    if (chronicle.scenarioId !== visit.island.def.id || chronicle.seed !== visit.island.config.seed) {
      body.append(el('p', { class: 'harbor-line harbor-version' }, 'この石板の島と年代記の島が合わない。一覧から訪れ直す'));
      return null;
    }
    body.append(readerOf(visit, chronicle, card, harbor, confirmLine, title));
    return chronicle;
  }

  /** 照合 (「年表を読む」)。再生は重い (Chromium で size 64 の 100 年が 25 秒ほど) ので、明示の操作にし、進みと中断を見せる */
  function readerOf(visit: { id: ChronicleId; island: ReplayIsland }, chronicle: Chronicle, card: ChronicleCard, harbor: Harbor, confirmLine: HTMLElement, title: string): HTMLElement {
    const years = visit.island.def.years;
    const start = el('button', { class: 'harbor-chip harbor-primary', id: 'harbor-read' }, '年表を読む');
    const stop = el('button', { class: 'harbor-chip', id: 'harbor-read-stop', hidden: '' }, 'やめる');
    const bar = el('div', { class: 'harbor-track', role: 'progressbar', 'aria-label': '年表を読む進み', 'aria-valuemin': '0', 'aria-valuemax': String(years), 'aria-valuenow': '0', hidden: '' }, el('i'));
    const status = el('p', { class: 'harbor-line', id: 'harbor-read-status', role: 'status' });
    let ctl: AbortController | null = null;
    const progress = (year: number) => {
      bar.setAttribute('aria-valuenow', String(Math.min(year, years)));
      bar.style.setProperty('--read', `${Math.min(1, year / years)}`);
      status.textContent = readingText(year, years);
    };
    start.addEventListener('click', async () => {
      ctl = new AbortController();
      start.hidden = true;
      stop.hidden = false;
      bar.hidden = false;
      progress(0);
      const outcome = await replayInWorker(chronicle, visit.island, { onYear: progress, signal: ctl.signal });
      const r = readResultOf(outcome, card);
      status.textContent = readText(r, title);
      stop.hidden = true;
      start.hidden = false;
      start.textContent = r.kind === 'aborted' ? '年表を読む' : 'もう一度読む';
      if (outcome.kind !== 'done') return;
      await harbor.confirm(visit.id, outcome.digest);
      const again = await harbor.visit(visit.id);
      if (again.kind === 'ok') confirmLine.textContent = confirmText(again.card);
    });
    stop.addEventListener('click', () => ctl?.abort());
    return el('div', { class: 'harbor-reader' }, el('p', { class: 'harbor-line harbor-dim' }, 'この島の年代記を手元で初めから回し直し、港の記録と同じ結末になるか確かめる'), bar, status, el('div', { class: 'harbor-actions' }, start, stop));
  }
}
