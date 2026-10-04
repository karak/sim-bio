import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { cloudflarePort } from '../../playwright.cloudflare.config';
import { decodeLogBatch } from '../../src/core/log/batch';
import type { Cargo } from '../../src/harbor/contract';
import { cargoItemsText } from '../../src/ui/harborText';

const base = `http://127.0.0.1:${cloudflarePort}`;
let wrangler: ChildProcess;
let output = '';

test.beforeAll(async () => {
  // M19-08: 港の帳簿は使い捨てのローカルの D1 に置き、本番と同じマイグレーションを当ててから立てる。secret はテストの値
  const persist = mkdtempSync(join(tmpdir(), 'harbor-e2e-'));
  const migrated = spawnSync('node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'biotope-harbor', '--local', '--persist-to', persist], {
    env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    encoding: 'utf8',
  });
  expect(migrated.status, migrated.stderr || migrated.stdout).toBe(0);
  const secrets = ['--var', 'TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA', '--var', 'SENDER_SECRET:e2e-only'];
  // detached で process group を分け、後で workerd ごと止める
  wrangler = spawn('node_modules/.bin/wrangler', ['dev', '--port', String(cloudflarePort), '--ip', '127.0.0.1', '--persist-to', persist, ...secrets], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  wrangler.stdout?.on('data', (b: Buffer) => (output += b.toString()));
  wrangler.stderr?.on('data', (b: Buffer) => (output += b.toString()));
  await expect
    .poll(() => fetch(`${base}/`).then((r) => r.status, () => 0), { timeout: 60_000, message: 'wrangler dev が立たない' })
    .toBe(200);
});

test.afterAll(() => {
  if (wrangler.pid !== undefined) process.kill(-wrangler.pid, 'SIGTERM');
});

test('ビルドした画面のログが wrangler dev の受け口に 1 バッチ届き、Workers Logs 向けの JSON 1 行になる (M19-02)', async ({ page }) => {
  const delivered = page.waitForResponse((r) => r.url() === `${base}/api/v1/logs` && r.request().method() === 'POST', { timeout: 60_000 });
  await page.goto('/?seed=42');
  await page.click('#speed-100');
  const res = await delivered;

  expect(res.status()).toBe(204);
  const batch = decodeLogBatch(res.request().postData() ?? '');
  expect(batch.ok).toBe(true);
  const records = batch.ok ? batch.value.records : [];
  expect(records.length).toBeGreaterThan(0);
  await expect
    .poll(() => output.split('\n').filter((l) => l.includes('"event":"harbor.logs.record"')).length, { message: '受け口が console に書いた行 (wrangler dev の出力)' })
    .toBeGreaterThanOrEqual(records.length);
  const first = output.split('\n').find((l) => l.includes('"event":"harbor.logs.record"')) ?? '';
  expect(JSON.parse(first.slice(first.indexOf('{')))).toEqual({ event: 'harbor.logs.record', record: records[0] });
});

test('タブが隠れたときの sendBeacon も Origin 付きで受け口に届く (403 で捨てられない)', async ({ page }) => {
  const beacons: { status: number }[] = [];
  page.on('response', (r) => {
    if (r.url() === `${base}/api/v1/logs` && r.request().resourceType() === 'ping') beacons.push({ status: r.status() });
  });
  await page.goto('/?seed=42');
  await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }));
  await page.click('#speed-100');

  // 送り残しがあるときだけ beacon が出る。10 秒待ちの fetch が先に運ぶこともあるので、出るまで隠れた合図を送り続ける
  await expect
    .poll(
      async () => {
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        return beacons.length;
      },
      { timeout: 60_000, intervals: [500], message: 'beacon の返事が見えない' },
    )
    .toBeGreaterThan(0);
  expect(beacons.every((b) => b.status === 204)).toBe(true);
});

test('配るもの・配らないもの・知らない道 (.assetsignore と SPA の fallback と run_worker_first)', async ({ request }) => {
  const index = readFileSync('dist/index.html', 'utf8');

  const glb = await request.get('/models/observe/deer.glb');
  expect(glb.status()).toBe(200);
  expect((await glb.body()).equals(readFileSync('dist/models/observe/deer.glb'))).toBe(true);
  const species = await request.get('/data/species.json');
  expect(await species.json()).toEqual(JSON.parse(readFileSync('dist/data/species.json', 'utf8')));

  const unserved = [
    '/models/observe/deer.blend',
    '/models/deer.glb',
    '/textures/concept/deer-angular.png',
    '/textures/board/README.md',
    '/textures/observe/leaf_card.png',
    '/audio/.gitkeep',
    '/.assetsignore',
  ];
  expect(unserved.filter((p) => !existsSync(`dist${p}`)), '配らないものは dist にはある (名前が変わって空振りしていない)').toEqual([]);
  for (const path of [...unserved, '/island/deep/link']) {
    const res = await request.get(path);
    expect({ path, status: res.status(), servesIndex: (await res.text()) === index }).toEqual({ path, status: 200, servesIndex: true });
  }

  const unknownApi = await request.get('/api/v1/nowhere');
  expect(unknownApi.status()).toBe(404);
  expect(await unknownApi.json()).toEqual({ error: 'not_found' });

  const foreign = await request.post('/api/v1/logs', { headers: { origin: 'https://evil.example' }, data: { records: [], dropped: 0 } });
  expect(foreign.status()).toBe(403);
});

test('港の道がローカルの D1 に届く: 結末を報告すると回避率に数えられ、一覧は空で返る (M19-08)', async ({ request }) => {
  const same = { origin: base, 'content-type': 'application/json' };
  for (const verdict of ['alive', 'dead', 'escaped']) {
    const res = await request.post('/api/v1/outcomes', { headers: same, data: { scenarioId: 'volcano', verdict } });
    expect(res.status(), await res.text()).toBe(204);
  }
  const rate = await request.get('/api/v1/outcomes/volcano');
  expect(rate.status()).toBe(200);
  expect(await rate.json()).toEqual({ finished: 3, avoided: 2 });

  const browse = await request.get('/api/v1/chronicles');
  expect(browse.status()).toBe(200);
  expect(await browse.json()).toEqual({ cards: [], next: null });

  const human = await request.post('/api/v1/chronicles', { headers: same, data: {} });
  expect(human.status()).toBe(400);
  expect(await human.json()).toEqual({ error: 'bad_request', path: 'headers.cf-turnstile-response', reason: 'invalid' });
});

test('本物の港と通しで: 判定のあとに出港 → 一覧に並ぶ → リンクで訪れると、港から引いた年代記の島になる (M19-09)', async ({ page }) => {
  test.setTimeout(120_000);
  // Turnstile の widget の script だけは手元で答える (テストの sitekey と同じダミーの札)。札の確かめは Worker が siteverify にテストの secret で問う
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 100); return 'w'; }, remove() {} };`,
    }),
  );
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
  const panel = page.getByRole('region', { name: '港へ出す' });
  await panel.getByRole('radio', { name: 'また始めよう' }).click();
  const published = page.waitForResponse((r) => r.url() === `${base}/api/v1/chronicles` && r.request().method() === 'POST');
  await panel.getByRole('button', { name: '出港する' }).click();
  const res = await published;
  expect(res.status(), await res.text()).toBe(201);
  await expect(panel.getByRole('status').first()).toHaveText('港へ出した。リンクを渡せば、誰でもこの島をたどれる');
  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();
  const id = new URL(url).searchParams.get('visit');
  expect(id).toMatch(/^[0-9a-f]{64}$/);

  await page.goto('/?seed=42');
  await page.getByRole('button', { name: /^港を開く/ }).click();
  const card = page.getByRole('list', { name: '流れ着いた年代記' }).locator(`[data-id="${id}"]`);
  await expect(card).toContainText('「また始めよう」');
  await expect(card).toContainText('試し読みの 2 年目に滅びた');
  await expect(card).toContainText('あなたが出港した島');

  await card.getByRole('link', { name: '訪れる' }).click();
  const plaque = page.getByRole('region', { name: '訪れている島' });
  await expect(plaque.locator('#harbor-visit-ending')).toHaveText('試し読みの 2 年目に滅びた');
  await expect(plaque).toContainText('「また始めよう」');
  await expect(plaque.getByRole('button', { name: '年表を読む' })).toBeVisible();
});

test('手元の 3 人の見守り手 (M19-16): wrangler dev では x-dev-sender で別の送り手に数え、2 人の通報では並び、3 人目で港から隠れる', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const answerTurnstile = (p: Page) =>
    p.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 100); return 'w'; }, remove() {} };` }),
    );
  await answerTurnstile(page);
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 90_000 });
  const panel = page.getByRole('region', { name: '港へ出す' });
  await panel.getByRole('button', { name: '出港する' }).click();
  const url = await panel.getByRole('textbox', { name: '訪問のリンク' }).inputValue();
  const id = new URL(url).searchParams.get('visit');

  const listed = async () => ((await (await fetch(`${base}/api/v1/chronicles`)).json()) as { cards: { id: string }[] }).cards.some((c) => c.id === id);
  // 手元の網では 3 人とも 127.0.0.1 から来る。名乗りの header が無ければ、同じ 1 人に数えられる
  for (const [i, name] of ['alice', 'bob', 'carol'].entries()) {
    const context = await browser.newContext({ extraHTTPHeaders: { 'x-dev-sender': name } });
    const watcher = await context.newPage();
    await answerTurnstile(watcher);
    await watcher.goto('/?seed=42');
    await watcher.getByRole('button', { name: /^港を開く/ }).click();
    const card = watcher.getByRole('list', { name: '流れ着いた年代記' }).locator(`[data-id="${id}"]`);
    await card.getByRole('button', { name: '通報' }).click();
    await expect(card.getByRole('status')).toHaveText('通報した。3 件集まると、港から隠れる');
    await context.close();
    expect(await listed(), `${name} (${i + 1} 人目) の通報のあと`).toBe(i < 2);
  }
});

test('積荷を流し、別の見守り手が引いて受け取る (本物の D1)', async ({ browser }) => {
  test.setTimeout(150_000);
  const answerTurnstile = (p: Page) =>
    p.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 100); return 'w'; }, remove() {} };` }),
    );
  const names = Object.fromEntries((JSON.parse(readFileSync('dist/data/species.json', 'utf8')) as { id: string; name: string }[]).map((d) => [d.id, d.name]));

  // 見守り手 a が帆の試し読みで空の舟を出し、次の島へ逃れて積荷を港 (wrangler dev のローカルの D1) に流す
  const a = await browser.newContext({ extraHTTPHeaders: { 'x-dev-sender': 'cargo-a' } });
  const ship = await a.newPage();
  await answerTurnstile(ship);
  const cast = ship.waitForRequest((r) => r.url() === `${base}/api/v1/cargo` && r.method() === 'POST', { timeout: 90_000 });
  await ship.goto('/?scenario=test-ship');
  await ship.click('#speed-100');
  await expect(ship.locator('#verdict-title')).toHaveText('次の島へ', { timeout: 90_000 });
  const sent = await cast;
  expect((await sent.response())?.status()).toBe(204);
  await expect(ship.locator('#harbor-toast')).toHaveText('積荷を港に流した。どこかの見守り手の浜に流れ着く');
  const { cargo } = JSON.parse(sent.postData() ?? '{}') as { cargo: Cargo };
  expect(cargo.items.length).toBeGreaterThanOrEqual(1);
  await a.close();

  // 別の見守り手 b (別の手元の置き場) が自由モードの浜で引き、受け取る。港に積荷はこの 1 件だけ
  const b = await browser.newContext({ extraHTTPHeaders: { 'x-dev-sender': 'cargo-b' } });
  const shore = await b.newPage();
  await answerTurnstile(shore);
  await shore.goto('/?seed=42');
  await shore.getByRole('button', { name: /^港を開く/ }).click();
  const drift = shore.getByRole('region', { name: '浜の漂着' });
  const status = drift.locator('#harbor-drift-status');
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(status).toHaveText('積荷が流れ着いた。受け取れば、外来種として島の浜に放たれる');
  await expect(drift.locator('#harbor-drift-items')).toHaveText(cargoItemsText(cargo, names));
  await drift.getByRole('button', { name: '受け取る' }).click();
  await expect(status).toHaveText('積荷を受け取った。外来種が島の浜に放たれた');
  await drift.getByRole('button', { name: '浜を見る' }).click();
  await expect(status).toHaveText('この積荷はもう受け取った');
  await b.close();
});
