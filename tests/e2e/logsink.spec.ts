import { test, expect } from '@playwright/test';
import type { LogBatch } from '../../src/core/log/httpSink';

test('HTTP LogSink: warn/error と年ごとの要約がバッチで受け口に届き、console にも出続ける (M19-01)', async ({ page }) => {
  const batches: { contentType: string | null; body: LogBatch }[] = [];
  await page.route('**/api/v1/logs', async (route) => {
    const req = route.request();
    batches.push({ contentType: await req.headerValue('content-type'), body: req.postDataJSON() as LogBatch });
    await route.fulfill({ status: 204 });
  });
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await page.click('#speed-100');
  await expect
    .poll(() => batches.flatMap((b) => b.body.records).some((r) => r.event === 'sim.tick.summary'), { timeout: 40_000 })
    .toBe(true);

  expect(batches[0].contentType).toBe('application/json');
  expect(batches[0].body.dropped).toBe(0);
  const records = batches.flatMap((b) => b.body.records);
  expect(records.filter((r) => r.level === 'info' && r.event !== 'sim.tick.summary')).toEqual([]);
  expect(records.find((r) => r.event === 'sim.tick.summary')).toMatchObject({ level: 'info', year: 1 });
  expect(logs.some((l) => l.includes('"event":"sim.world.created"'))).toBe(true);
  expect(records.some((r) => r.event === 'sim.world.created')).toBe(false);
  expect(logs.some((l) => l.includes('"event":"sim.tick.summary"'))).toBe(true);
});
