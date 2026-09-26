import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page, type Route } from '@playwright/test';
import { chronicleId } from '../../src/harbor/contract';
import type { WireRequest } from '../../src/harbor/wire';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';

/**
 * 港のクライアントと画面 (M19-09) を実際のブラウザで確かめる。港の API と Turnstile の script は page.route() で決定論的に答える
 * (本物の Worker と同じ readRequest で読み、writeResponse・writeRefusal で書く港の写し tests/fixtures/fakeHarbor.ts)。
 * HARBOR_SHOTS に置き場を渡すと、画面の撮影を残す
 */
const data = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: data('scenarios'), species: data('species'), inscriptions: data('inscriptions') });

/** Turnstile の script の代わり。widget を置いて、少し待ってからテストの札を返す (本物のテストの sitekey と同じ札) */
const FAKE_TURNSTILE = `window.turnstile = {
  render(el, o) { const d = document.createElement('div'); d.className = 'fake-turnstile'; d.textContent = '確認中'; el.appendChild(d); setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 300); return 'w' + Math.random(); },
  remove() {},
};`;

async function shot(page: Page, name: string) {
  const dir = process.env.HARBOR_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

const wireOf = (route: Route): WireRequest => {
  const req = route.request();
  const url = new URL(req.url());
  return { method: req.method() as WireRequest['method'], path: url.pathname + url.search, headers: req.headers(), body: req.postData() };
};

/** 港の API を港の写しで答える。closed の間は網の失敗 (abort) にする。送られた要求を順に残す */
async function routeHarbor(page: Page) {
  const fake = createFakeHarbor(catalog);
  const sent: WireRequest[] = [];
  const state = { closed: false };
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs',
    async (route) => {
      const wire = wireOf(route);
      sent.push(wire);
      if (state.closed) return route.abort('failed');
      const r = await fake.serve(wire);
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body ?? '' });
    },
  );
  await page.route('**/api/v1/logs', (route) => route.fulfill({ status: 204 }));
  return { fake, sent, state };
}

/** 石板を 100 倍速で判定まで回す */
async function playToVerdict(page: Page, scenario: string) {
  await page.goto(`/?scenario=${scenario}`);
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
}

const publishFrom = (page: Page) => page.getByRole('region', { name: '港へ出す' });

test('M19-09: 出港 → リンク → 訪問 (3D 観察画面) → 照合 (年表を読む) の一連', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page);
  await playToVerdict(page, 'test-civ');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた');

  const panel = publishFrom(page);
  await expect(panel.getByRole('heading', { name: '港へ出す' })).toBeVisible();
  await expect(panel.getByRole('radio')).toHaveText(['まだ、ここにいる', 'できることはした', '雨は来た', '狼は残った', '海が勝った', 'また始めよう']);
  await panel.getByRole('radio', { name: '雨は来た' }).click();
  await expect(panel.getByRole('radio', { name: '雨は来た' })).toHaveAttribute('aria-checked', 'true');
  await shot(page, '01-publish-choose');
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');

  const published = harbor.sent.find((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  expect(published?.headers['cf-turnstile-response']).toBe(DUMMY_TOKEN);
  expect(published?.headers.authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
  const [id] = [...harbor.fake.ledger.keys()];
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ scenarioId: 'test-civ', inscription: 'rain-came', verdict: 'alive', year: 5 });
  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();
  expect(url).toBe(`${new URL(page.url()).origin}/?scenario=test-civ&visit=${id}`);
  await shot(page, '02-published-link');

  // 一覧: 自分が出港した島として、取り下げの札が付く
  await page.goto('/');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const list = page.getByRole('list', { name: '流れ着いた年代記' });
  const card = list.getByRole('listitem');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading')).toHaveText(/^[ア-ン]{3,4}の(島|環|洲)$/);
  await expect(card).toContainText('「雨は来た」');
  await expect(card).toContainText('文明の試し読みを 5 年、生き延びた');
  await expect(card).toContainText('まだ誰もたどっていない');
  await expect(card).toContainText('あなたが出港した島');
  await expect(card.getByRole('button', { name: '取り下げる' })).toBeVisible();
  await shot(page, '03-browse');
  const name = await card.getByRole('heading').textContent();

  // 訪問: リンクを開くと、その石板の島を普段どおり組み、港から引いた年代記を 10 倍速で打ち直し、3D 観察画面に入る
  await card.getByRole('link', { name: '訪れる' }).click();
  await expect(page).toHaveURL(url);
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await expect(plaque.getByRole('heading')).toHaveText(name ?? '');
  await expect(plaque).toContainText('「雨は来た」');
  await expect(plaque.locator('#harbor-visit-ending')).toHaveText('文明の試し読みを 5 年、生き延びた');
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#speed-10')).toHaveClass(/on/);
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^\d+ 年/, { timeout: 90_000 });
  await shot(page, '04-visit-observe');

  // 照合: 明示の操作で Web Worker が回し直し、進みを見せ、終われば港へ結末を送る。港の写しが hash を比べて確認を数える
  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await expect(plaque.getByRole('progressbar', { name: '年表を読む進み' })).toBeVisible();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読み終えた。港の記録と同じ結末になった', { timeout: 90_000 });
  await expect(plaque.locator('#harbor-visit-confirms')).toHaveText('1 人がたどって確かめた');
  expect(harbor.fake.ledger.get(id)?.card).toMatchObject({ confirms: 1, mismatches: 0 });
  await shot(page, '05-visit-read');
});

test('M19-09: 照合は「やめる」で止まり、もう一度読める', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page);
  await playToVerdict(page, 'test-civ');
  await publishFrom(page).getByRole('button', { name: '出港する' }).click();
  await expect(publishFrom(page).getByRole('textbox', { name: '訪問のリンク' })).toBeVisible();
  const [id] = [...harbor.fake.ledger.keys()];

  await page.goto(`/?scenario=test-civ&visit=${id}`);
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await plaque.getByRole('button', { name: '年表を読む' }).click();
  await plaque.getByRole('button', { name: 'やめる' }).click();
  await expect(plaque.locator('#harbor-read-status')).toHaveText('読むのをやめた。もう一度読むと、初めから読む');
  await expect(plaque.getByRole('button', { name: '年表を読む' })).toBeVisible();
  expect(harbor.sent.filter((w) => w.path.endsWith('/confirm'))).toEqual([]);
});

test('M19-09: 港を全部閉じても 1 シナリオ遊べ、出港は outbox に入る。港が開いてから開き直すと、同じ id・同じ鍵で送り直す', async ({ page }) => {
  test.setTimeout(180_000);
  const harbor = await routeHarbor(page);
  harbor.state.closed = true;

  await playToVerdict(page, 'test-quick');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const panel = publishFrom(page);
  await panel.getByRole('button', { name: '出港する' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('港は今日は閉まっている。年代記は手元に預けた。港が開いたら、同じ島として送り直す');
  await expect(page.locator('#harbor-dock-count')).toHaveText('預け 1');
  await shot(page, '06-closed-queued');

  // 閉じた港の一覧は、閉港を普段の状態として言う
  await page.locator('#verdict-free').click();
  await page.getByRole('button', { name: /^港を開く/ }).click();
  await expect(page.locator('#harbor-state')).toHaveText('港は今日は閉まっている。遊ぶ・保存するはそのまま続けられる');
  await shot(page, '07-closed-browse');

  const first = harbor.sent.find((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  if (!first?.body) throw new Error('出港の要求が無い');
  const queuedId = await chronicleId(JSON.parse(first.body).chronicle);

  harbor.state.closed = false;
  const before = harbor.sent.length;
  await page.reload();
  await expect(page.locator('#harbor-toast')).toHaveText('預けていた年代記 1 件を港へ出した', { timeout: 30_000 });
  const resent = harbor.sent.slice(before).filter((w) => w.method === 'POST' && w.path === '/api/v1/chronicles');
  expect(resent).toHaveLength(1);
  expect(await chronicleId(JSON.parse(resent[0].body ?? '{}').chronicle)).toBe(queuedId);
  expect(resent[0].headers.authorization).toBe(first.headers.authorization);
  expect([...harbor.fake.ledger.keys()]).toEqual([queuedId]);
  await expect(page.locator('#harbor-dock-count')).toBeHidden();
});

test('M19-09 不変条件: main.ts は静的アセット以外のネットワークに頼らずに起動し、遊べる (港の API と外の origin を全部断つ)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? '').origin;
  const refused: string[] = [];
  await page.route(
    (url) => url.origin !== origin || url.pathname.startsWith('/api/'),
    (route) => {
      refused.push(new URL(route.request().url()).pathname);
      return route.abort('failed');
    },
  );
  for (const path of ['/', '/?scenario=test-quick']) {
    await page.goto(path);
    await expect(page.locator('#hud-year')).toHaveText('Year 0');
    await page.click('#speed-100');
    await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  }
  // ログの送り (M19-02) は失敗しても本体を止めない。港 (出港・一覧) には、起動では問い合わせない
  expect(refused.filter((p) => p !== '/api/v1/logs')).toEqual([]);
});
