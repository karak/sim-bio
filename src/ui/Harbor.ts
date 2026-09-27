import type { LandResult } from '../harbor/cargo';
import type { Chronicle, Digest } from '../harbor/chronicle';
import { createHarbor, type HarborLog, type PublishResult } from '../harbor/client';
import { chronicleId, parseChronicleId, type BrowseCursor, type Cargo, type ChronicleCard, type ChronicleId, type DrawnCargo, type InscriptionId } from '../harbor/contract';
import { inscriptionText, islandName, parseInscriptions, type Inscription } from '../harbor/names';
import { createTurnstile, TEST_SITEKEY } from '../harbor/turnstile';
import { createMemoryHarborStore, openHarborStore, type HarborStore } from '../persist/harborStore';
import type { ScenarioDef } from '../scenario/types';
import { publishClick, visitHref } from './clicks';
import { el } from './el';
import { mountVisit, type HarborContext, type Visit } from './HarborVisit';
import {
  avoidanceText,
  cargoItemsText,
  castText,
  confirmText,
  DISMISSED_TEXT,
  drawText,
  endingText,
  HARBOR_CLOSED_TEXT,
  HARBOR_EMPTY_TEXT,
  otherVersionText,
  publishText,
  receiveText,
  reportText,
  resentText,
  withdrawText,
} from './harborText';
import './harbor.css';

/**
 * 港の画面 (M19-09、設計書 §5.2・§6.2)。港の口 (左の縁の石の札)・一覧 (流れ着いた年代記の石碑)・判定の後の出港・訪問の板 (HarborVisit.ts)。
 * main.ts へは、出港を差し出す口と、訪問の年代記を引く口だけを出す。港が閉まっていても、起動と遊ぶことには関わらない
 */
export type HarborUi = {
  /** 石板の判定の直後。判定の板に「港へ出す」を出す */
  offerPublish(island: { chronicle: Chronicle; digest: Digest }): void;
  /** 判定の後の港の仕事 (M19-10・11)。結末を回避率に 1 回数えて石板に回避率を出し直し、空の舟の積荷があれば港に流す */
  settle(island: { chronicle: Chronicle; digest: Digest }, cargo: Cargo | null): void;
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
  visit: Visit | null;
  /** 自分の島の石板。判定の後に閉じた島 (M19-14 の直し) を港の板から出港できるようにする。自由モードと訪問では null */
  scenarioId: string | null;
  /** 種 id → 表示名。積荷の中身に使う */
  speciesNames: Readonly<Record<string, string>>;
  /** 漂着を島の浜に放つ (M19-10)。訪問では null (浜の漂着を出さない) */
  land: ((d: DrawnCargo) => LandResult) | null;
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

type Ready = HarborContext & { store: HarborStore };

export function mountHarbor(app: HTMLElement, deps: HarborUiDeps): HarborUi {
  const titleOf = (scenarioId: string) => deps.scenarios.find((d) => d.id === scenarioId)?.title ?? scenarioId;

  // 人間確認の widget の置き場。同時に 2 つ (再送と出港) 確かめても、最後の 1 つが終わるまで出しておく
  const human = el('div', { class: 'harbor-stone harbor-human', role: 'status', hidden: '' }, el('p', { class: 'harbor-line' }, '港の番人が、人の手か確かめている'));
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

  const storeReady = openHarborStore({ indexedDB }).catch((e: unknown) => {
    deps.log('warn', 'harbor.store.unavailable', { error: String(e) });
    return createMemoryHarborStore();
  });
  // 碑文のカタログは静的アセット。読めなければ碑文の無いカタログになり、出港は港へ送る前に断る
  const inscriptionsReady = fetch('/data/inscriptions.json')
    .then((r) => r.json() as Promise<unknown>)
    .then(parseInscriptions, (e: unknown): Inscription[] => {
      deps.log('warn', 'harbor.inscriptions.unavailable', { error: String(e) });
      return [];
    });
  const ready: Promise<Ready> = Promise.all([storeReady, inscriptionsReady]).then(([store, inscriptions]) => ({
    store,
    inscriptions,
    simVersion: deps.simVersion,
    titleOf,
    harbor: createHarbor({
      baseUrl: deps.baseUrl,
      linkBase: location.origin,
      store,
      catalog: { scenarios: new Set(deps.scenarios.map((d) => d.id)), species: new Set(deps.speciesIds), inscriptions: new Set(inscriptions.map((d) => d.id)) },
      turnstile: createTurnstile({ sitekey: deps.sitekey || TEST_SITEKEY, host: hostOf }),
      log: deps.log,
    }),
  }));

  // 港の口: 左の縁の石の札。預けた年代記があれば数を刻む
  const dockCount = el('span', { class: 'harbor-dock-count', id: 'harbor-dock-count', hidden: '' });
  const dock = el('button', { class: 'harbor-dock', 'aria-expanded': 'false', 'aria-controls': 'harbor-drawer', 'aria-label': '港を開く' }, el('span', { class: 'harbor-dock-glyph' }, '港'), dockCount);
  const refreshCount = async () => {
    const n = (await (await ready).store.queued()).length;
    dockCount.hidden = n === 0;
    dockCount.textContent = `預け ${n}`;
    dock.setAttribute('aria-label', n === 0 ? '港を開く' : `港を開く (預けた年代記 ${n} 件)`);
  };

  const finishedSlot = el('div', { class: 'harbor-finished', hidden: '' });
  /** 判定の出た最後の島 (手元に残したもの)。判定の板を閉じた後・開き直した後も、ここから港へ出せる */
  const showFinished = async (scenarioId: string) => {
    const ctx = await ready;
    const island = await ctx.harbor.finished(scenarioId);
    finishedSlot.hidden = island === null;
    finishedSlot.replaceChildren(...(island ? [el('p', { class: 'harbor-sub' }, 'この石板で最後に判定の出た島'), publishPanel(ctx, island, refreshCount)] : []));
  };
  /** 自由モードの港の口には、どの石板の判定の出た島も並べる (M19-15)。石板を選び直さなくても港へ出せる */
  const showAllFinished = async () => {
    const ctx = await ready;
    const found = await Promise.all(deps.scenarios.map(async (d) => ({ def: d, island: await ctx.harbor.finished(d.id) })));
    const rows = found.flatMap(({ def, island }) => (island ? [el('p', { class: 'harbor-sub' }, `『${def.title}』で最後に判定の出た島`), publishPanel(ctx, island, refreshCount)] : []));
    finishedSlot.hidden = rows.length === 0;
    finishedSlot.replaceChildren(...rows);
  };
  if (deps.scenarioId) void showFinished(deps.scenarioId);
  else if (!deps.visit) void showAllFinished();
  const drawerState = el('p', { class: 'harbor-line harbor-state', id: 'harbor-state' });
  const list = el('ul', { class: 'harbor-list', 'aria-label': '流れ着いた年代記' });
  const more = el('button', { class: 'harbor-chip', hidden: '' }, 'もっと古い年代記');
  const close = el('button', { class: 'harbor-chip harbor-close' }, '閉じる');
  const drawer = el(
    'aside',
    { class: 'harbor-stone harbor-drawer', id: 'harbor-drawer', 'aria-label': '港', hidden: '' },
    el('header', { class: 'harbor-head' }, el('h2', { class: 'harbor-title' }, '港'), el('p', { class: 'harbor-sub' }, '流れ着いた島の年代記'), close),
    deps.land && driftSection(ready, deps.speciesNames, deps.land),
    finishedSlot,
    drawerState,
    list,
    more,
  );
  let cursor: BrowseCursor | null = null;
  const loadPage = async (reset: boolean) => {
    const ctx = await ready;
    if (reset) {
      cursor = null;
      list.replaceChildren();
      drawerState.textContent = '年代記を引いている…';
    }
    const [page, own] = await Promise.all([ctx.harbor.browse(cursor ? { before: cursor } : {}), ctx.harbor.ownIds()]);
    if (page.kind === 'closed') {
      drawerState.textContent = HARBOR_CLOSED_TEXT;
      more.hidden = true;
      return;
    }
    list.append(...page.cards.map((c) => cardItem(ctx, c, own.has(c.id))));
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
    const results = await (await ready).harbor.flushOutbox();
    const text = resentText(results.filter((r) => r.kind === 'published').length);
    if (text) say(text);
    await refreshCount();
  };
  void refreshCount().then(resend);
  setInterval(() => void resend(), RESEND_MS);

  // 回避率 (M19-11) は判定の後に、石板と判定の板に出す。閉港とまだ誰も終えていない石板では出さない。
  // 起動では港に問い合わせない (M19-09 の不変条件の E2E)
  const showAvoidance = async (scenarioId: string) => {
    const text = avoidanceText(await (await ready).harbor.avoidance(scenarioId));
    for (const line of app.querySelectorAll<HTMLElement>('#tablet-avoidance, #verdict-avoidance')) {
      line.hidden = text === null;
      line.textContent = text ?? '';
    }
  };

  return {
    offerPublish(island) {
      const slot = app.querySelector<HTMLElement>('#verdict-harbor');
      if (slot) void ready.then((ctx) => slot.replaceChildren(publishPanel(ctx, island, refreshCount)));
    },
    settle(island, cargo) {
      void ready.then(async (ctx) => {
        await ctx.harbor.keepFinished(island);
        await showFinished(island.chronicle.scenarioId);
        await ctx.harbor.reportOutcome(island);
        await showAvoidance(island.chronicle.scenarioId);
        if (cargo) say(castText(await ctx.harbor.castCargo(cargo)));
      });
    },
    visitChronicle: () => (deps.visit ? mountVisit(app, ready, deps.visit) : Promise.resolve(null)),
  };
}

/** 一覧の 1 件は石碑: 島の呼び名・ひとこと・結末・確かめた人。版違いは要約だけで、訪れる札を出さない */
function cardItem(ctx: HarborContext, card: ChronicleCard, own: boolean): HTMLLIElement {
  const sameVersion = card.simVersion === ctx.simVersion;
  const status = el('p', { class: 'harbor-line harbor-card-status', role: 'status' });
  const actions = el('div', { class: 'harbor-actions' }, sameVersion && el('a', { class: 'harbor-chip harbor-primary', href: visitHref(card) }, '訪れる'));
  const item = el(
    'li',
    { class: `harbor-card ${card.verdict}`, 'data-id': card.id },
    el('h3', { class: 'harbor-name' }, islandName(card.id)),
    el('p', { class: 'harbor-inscription' }, `「${inscriptionText(card.inscription, ctx.inscriptions)}」`),
    el('p', { class: 'harbor-line' }, endingText(card, ctx.titleOf(card.scenarioId))),
    el('p', { class: sameVersion ? 'harbor-line harbor-dim' : 'harbor-line harbor-version' }, sameVersion ? confirmText(card) : otherVersionText(card.simVersion)),
    own && el('p', { class: 'harbor-line harbor-own' }, 'あなたが出港した島'),
    actions,
    status,
  );
  const act = (label: string, run: () => Promise<{ text: string; done: boolean }>) => {
    const b = el('button', { class: 'harbor-chip' }, label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await run();
      status.textContent = r.text;
      b.disabled = r.done;
    });
    actions.append(b);
  };
  act('通報', async () => {
    const r = await ctx.harbor.report(card.id);
    return { text: reportText(r), done: r === 'ok' };
  });
  if (own) {
    act('取り下げる', async () => {
      const r = await ctx.harbor.withdraw(card.id);
      item.classList.toggle('harbor-card-gone', r === 'ok');
      return { text: withdrawText(r), done: r === 'ok' };
    });
  }
  return item;
}

/** 判定の板の「港へ出す」。ひとことは碑文のカタログから選ぶ (自由文は受けない) */
function publishPanel(ctx: HarborContext, island: { chronicle: Chronicle; digest: Digest }, published: () => Promise<void>): HTMLElement {
  let chosen: InscriptionId | undefined = ctx.inscriptions[0]?.id;
  const choices = el('div', { class: 'harbor-inscriptions', role: 'radiogroup', 'aria-label': '島に添えるひとこと' });
  for (const d of ctx.inscriptions) {
    const b = el('button', { class: 'harbor-carve', role: 'radio', 'aria-checked': String(d.id === chosen), 'data-id': d.id }, d.text);
    b.addEventListener('click', () => {
      chosen = d.id;
      for (const c of choices.children) c.setAttribute('aria-checked', String(c.getAttribute('data-id') === d.id));
    });
    choices.append(b);
  }
  const send = el('button', { class: 'harbor-chip harbor-primary', ...(chosen === undefined ? { disabled: '' } : {}) }, '出港する');
  const status = el('p', { class: 'harbor-line harbor-publish-status', role: 'status' });
  const link = el('div', { class: 'harbor-link', hidden: '' });
  const lead = el('p', { class: 'harbor-line harbor-dim' }, 'ひとことを刻んで、この島を港に並べる');
  void chronicleId(island.chronicle).then((id) => (lead.textContent = `ひとことを刻んで、${islandName(id)}として港に並べる`));
  send.addEventListener('click', async () => {
    if (chosen === undefined) return;
    send.disabled = true;
    status.textContent = '港へ運んでいる…';
    const r = await ctx.harbor.publish(publishClick(island, chosen));
    status.textContent = publishText(r);
    send.disabled = r.kind === 'published' || r.kind === 'queued';
    showLink(link, r);
    await published();
  });
  return el('section', { class: 'harbor-publish', 'aria-label': '港へ出す' }, el('h3', { class: 'harbor-publish-title' }, '港へ出す'), lead, choices, send, status, link);
}

function showLink(link: HTMLElement, r: PublishResult) {
  link.hidden = r.kind !== 'published';
  if (r.kind !== 'published') return;
  const field = el('input', { class: 'harbor-url', readonly: '', value: r.url, 'aria-label': '訪問のリンク' });
  const copy = el('button', { class: 'harbor-chip' }, 'リンクを写す');
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(r.url).then(
      () => (copy.textContent = '写した'),
      () => field.select(),
    );
  });
  link.replaceChildren(field, copy, el('a', { class: 'harbor-chip', href: r.url }, 'この島を訪れる'));
}

/** 浜の漂着 (M19-10)。港から 1 件引き、受け取るか追い払うかを選ばせる。受け取れば land が外来種として島の浜に放つ */
function driftSection(ready: Promise<Ready>, names: Readonly<Record<string, string>>, land: (d: DrawnCargo) => LandResult): HTMLElement {
  const status = el('p', { class: 'harbor-line', id: 'harbor-drift-status', role: 'status' }, 'ほかの見守り手の空の舟が流した積荷が、浜に着くことがある');
  const items = el('p', { class: 'harbor-inscription', id: 'harbor-drift-items', hidden: '' });
  const look = el('button', { class: 'harbor-chip' }, '浜を見る');
  const take = el('button', { class: 'harbor-chip harbor-primary', hidden: '' }, '受け取る');
  const shoo = el('button', { class: 'harbor-chip', hidden: '' }, '追い払う');
  let offered: DrawnCargo | null = null;
  const offer = (d: DrawnCargo | null) => {
    offered = d;
    take.hidden = d === null;
    shoo.hidden = d === null;
    look.hidden = d !== null;
  };
  look.addEventListener('click', async () => {
    look.disabled = true;
    const r = await (await ready).harbor.drawCargo();
    look.disabled = false;
    status.textContent = drawText(r);
    const drawn = r.kind === 'ok' ? r.drawn : null;
    items.hidden = drawn === null;
    items.textContent = drawn ? cargoItemsText(drawn.cargo, names) : '';
    offer(r.kind === 'ok' && r.drawn && !r.received ? r.drawn : null);
  });
  take.addEventListener('click', async () => {
    const d = offered;
    if (!d) return;
    take.disabled = true;
    let landed: LandResult = 'refused';
    const r = await (await ready).harbor.receiveCargo(d, () => (landed = land(d)) === 'ok');
    take.disabled = false;
    status.textContent = receiveText(r === 'received' ? 'ok' : r === 'already' ? 'already' : landed);
    if (r !== 'refused') offer(null);
  });
  shoo.addEventListener('click', () => {
    status.textContent = DISMISSED_TEXT;
    items.hidden = true;
    offer(null);
  });
  return el('section', { class: 'harbor-drift', 'aria-label': '浜の漂着' }, el('h3', { class: 'harbor-publish-title' }, '浜の漂着'), status, items, el('div', { class: 'harbor-actions' }, look, take, shoo));
}
