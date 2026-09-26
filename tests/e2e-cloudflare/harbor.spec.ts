import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { cloudflarePort } from '../../playwright.cloudflare.config';
import { decodeLogBatch } from '../../src/core/log/batch';

const base = `http://127.0.0.1:${cloudflarePort}`;
let wrangler: ChildProcess;
let output = '';

test.beforeAll(async () => {
  // detached で process group を分け、後で workerd ごと止める
  wrangler = spawn('node_modules/.bin/wrangler', ['dev', '--port', String(cloudflarePort), '--ip', '127.0.0.1'], {
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
  await page.goto('/');
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
  await page.goto('/');
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

  const unknownApi = await request.get('/api/v1/chronicles');
  expect(unknownApi.status()).toBe(404);
  expect(await unknownApi.json()).toEqual({ error: 'not_found' });

  const foreign = await request.post('/api/v1/logs', { headers: { origin: 'https://evil.example' }, data: { records: [], dropped: 0 } });
  expect(foreign.status()).toBe(403);
});
