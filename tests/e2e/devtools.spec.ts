import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page } from '@playwright/test';
import type { WireRequest } from '../../src/harbor/wire';
import { snapshotRoutes } from '../../tools/acceptance-snapshots.ts';
import { catalogFrom, createFakeHarbor, DUMMY_TOKEN } from '../fixtures/fakeHarbor';
import { openSnapshot, readSnapshot } from '../fixtures/devSnapshot';

/**
 * 受入を AI が確かめる仕組み (M19-16) を、vite dev (開発のビルド) の画面で確かめる。
 * 受入の画面のサーバーの写しの道 (tools/acceptance-snapshots.ts) は、使い捨ての置き場で spec が立てる。港は港の写し (page.route) で答える
 */
const TICKS_PER_YEAR = 360;
const dir = mkdtempSync(join(tmpdir(), 'acceptance-e2e-'));
let server: Server;
let acceptance = '';

test.beforeAll(async () => {
  const route = snapshotRoutes(dir);
  server = createServer((req, res) => {
    if (!route(req, res, new URL(req.url ?? '/', 'http://x'))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  acceptance = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function shownTick(page: Page): Promise<number> {
  const year = Number((await page.locator('#hud-year').textContent())?.replace('Year ', ''));
  const day = Number((await page.locator('#hud-season').textContent())?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

const data = (name: string) => JSON.parse(readFileSync(`assets/data/${name}.json`, 'utf8')) as { id: string }[];
const catalog = catalogFrom({ scenarios: data('scenarios'), species: data('species'), inscriptions: data('inscriptions') });
const FAKE_TURNSTILE = `window.turnstile = { render(el, o) { setTimeout(() => o.callback(${JSON.stringify(DUMMY_TOKEN)}), 50); return 'w'; }, remove() {} };`;

/** 1 つの港の写しを、見守り手の page すべてで分け合う (手元で別の人として同じ港に当たる) */
async function routeHarbor(page: Page, harbor: ReturnType<typeof createFakeHarbor>, sent: WireRequest[]) {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE }));
  await page.route('**/api/v1/logs', (route) => route.fulfill({ status: 204 }));
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/') && url.pathname !== '/api/v1/logs',
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const wire: WireRequest = { method: req.method() as WireRequest['method'], path: url.pathname + url.search, headers: req.headers(), body: req.postData() };
      sent.push(wire);
      const r = await harbor.serve(wire);
      return route.fulfill({ status: r.status, headers: r.headers, body: r.body ?? '' });
    },
  );
}

test('M19-16: 状態を受入の画面へ送って id を得、その id の写しを別のブラウザに流し込むと、同じ島・同じ枠から続く', async ({ page, browser }) => {
  await page.goto(`/?dev=1&acceptance=${encodeURIComponent(acceptance)}`);
  await page.click('#speed-100');
  await expect.poll(() => shownTick(page), { timeout: 30_000 }).toBeGreaterThan(TICKS_PER_YEAR);
  await page.click('#speed-0');
  await page.click('#slot-save');
  const slotText = page.locator('#slot-select option[value="manual-1"]');
  await expect(slotText).toHaveText(/^枠 1 · Year \d+$/);
  const saved = await slotText.textContent();
  const pausedAt = await shownTick(page);

  const dev = page.getByRole('region', { name: '開発' });
  await dev.getByRole('button', { name: '状態を受入の画面へ送る' }).click();
  const id = page.locator('#dev-snapshot-id');
  await expect(id).toHaveText(/^s-\d{8}-\d{6}-[0-9a-f]{4}$/);

  const snap = readSnapshot(join(dir, `${await id.textContent()}.json`));
  expect(snap.current.save.tick).toBe(pausedAt);
  expect(snap.db.name).toBe('biotope-island');
  expect(Object.keys(snap.db.stores).sort()).toEqual(['chronicles', 'finished', 'keys', 'marks', 'outbox', 'saves', 'scenarios', 'slots']);

  const other = await browser.newContext();
  const again = await other.newPage();
  const resumed: { event: string; slot?: string; tick: number }[] = [];
  again.on('console', (m) => {
    if (m.text().includes('"event":"persist.resumed"')) resumed.push(JSON.parse(m.text()));
  });
  await openSnapshot(again, snap);
  await expect(again.locator('#slot-select option[value="manual-1"]')).toHaveText(saved ?? '');
  await expect.poll(() => resumed).toEqual([expect.objectContaining({ slot: 'auto', tick: pausedAt })]);
  await other.close();
});

test('M19-16: ?player= で見守り手を分けると、置き場・取り下げ鍵が分かれ、港への要求に名乗りが付く。1000x で石板を判定まで回せる', async ({ context }) => {
  test.setTimeout(120_000);
  const harbor = createFakeHarbor(catalog);
  const sent: WireRequest[] = [];
  const alice = await context.newPage();
  await routeHarbor(alice, harbor, sent);
  await alice.goto('/?scenario=test-quick&player=alice&dev=1');
  await expect(alice.locator('#hud-year')).toHaveText('Year 0');
  await alice.click('#speed-1000');
  await expect(alice.locator('#verdict')).toBeVisible({ timeout: 60_000 });
  const publish = alice.getByRole('region', { name: '港へ出す' });
  await publish.getByRole('button', { name: '出港する' }).click();
  await expect(publish.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const [id] = [...harbor.ledger.keys()];

  const bob = await context.newPage();
  await routeHarbor(bob, harbor, sent);
  await bob.goto('/?player=bob');
  await bob.getByRole('button', { name: /^港を開く/ }).click();
  const card = bob.getByRole('list', { name: '流れ着いた年代記' }).locator(`[data-id="${id}"]`);
  await expect(card).toContainText('試し読み');
  await expect(card).not.toContainText('あなたが出港した島');
  await card.getByRole('button', { name: '通報' }).click();
  await expect(card.getByRole('status')).toHaveText('通報した。3 件集まると、港から隠れる');

  await alice.goto('/?player=alice');
  await alice.getByRole('button', { name: /^港を開く/ }).click();
  await expect(alice.getByRole('list', { name: '流れ着いた年代記' }).locator(`[data-id="${id}"]`)).toContainText('あなたが出港した島');

  const who = (kind: RegExp) => sent.filter((w) => w.method === 'POST' && kind.test(w.path)).map((w) => w.headers['x-dev-sender']);
  expect(who(/^\/api\/v1\/chronicles$/)).toEqual(['alice']);
  expect(who(/\/report$/)).toEqual(['bob']);
  expect(harbor.ledger.get(id)?.reports).toBe(1);
  const names = await bob.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).sort());
  expect(names).toEqual(['biotope-island@alice', 'biotope-island@bob']);
});

test('M19-16: 沈む欠片でも、開発の板の近道で次の年の境目に alive になり、その判定は港へ出さない', async ({ page }) => {
  test.setTimeout(120_000);
  const harbor = createFakeHarbor(catalog);
  const sent: WireRequest[] = [];
  await routeHarbor(page, harbor, sent);
  await page.goto('/?scenario=sinking&dev=1');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.getByRole('region', { name: '開発' }).getByRole('button', { name: '近道: 次の年の境目で alive にする' }).click();
  await page.waitForURL(/shortcut=alive/);
  await expect(page.locator('#dev-shortcut')).toHaveText('近道の島。判定は港へ出さない');

  await page.click('#speed-1000');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた');
  await expect(page.getByRole('region', { name: '港へ出す' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(sent.filter((w) => w.method === 'POST').map((w) => w.path)).toEqual([]);
});
