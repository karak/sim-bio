import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_CHRONICLE, FIXTURE_HASH } from '../fixtures/chronicle';

/**
 * 年代記 (M19-06) を実際のブラウザで確かめる。Vite の dev サーバーが src と tests/fixtures をそのまま配るので、
 * ページの中で replayInWorker を import し、本物の Web Worker で回す
 */
const MODULES = { client: '/src/chronicle/replayInWorker.ts', fixture: '/tests/fixtures/chronicle.ts' };

type Outcome = { kind: string; digest?: { hash: string; year: number }; error?: { path: string; reason: string } };

/** ページの中で年代記を Worker に渡す。size・years で石板の島を縮め、abortAfterYears 年の進みが来たら中断する */
function replayInPage(page: Page, args: { chronicle: unknown; size: number; years: number; abortAfterYears?: number }) {
  return page.evaluate(
    async ({ modules, chronicle, size, years, abortAfterYears }) => {
      const { replayInWorker } = await import(/* @vite-ignore */ modules.client);
      const [base, species, scenarios] = await Promise.all(['world.default', 'species', 'scenarios'].map((n) => fetch(`/data/${n}.json`).then((r) => r.json())));
      const found = scenarios.find((d: { id: string }) => d.id === 'sinking');
      const def = { ...found, years };
      const config = { ...base, size, seed: 42, species: species.map((d: { id: string }) => ({ ...d, ...(def.start?.species?.[d.id] ?? {}) })) };
      const ctl = new AbortController();
      const years_: number[] = [];
      const t0 = performance.now();
      const outcome: Outcome = await replayInWorker(chronicle, { def, config }, {
        signal: ctl.signal,
        onYear: (y: number) => {
          years_.push(y);
          if (abortAfterYears !== undefined && y >= abortAfterYears) ctl.abort();
        },
      });
      return { outcome, years: years_, ms: performance.now() - t0 };
    },
    { modules: MODULES, ...args },
  );
}

test('M19-06: 年代記は Web Worker で回り、Node の単体テストと同じ Digest になる (Chromium の V8 で Math.sin・cos の差が出ない)', async ({ page }) => {
  await page.goto('/');
  const fixture = await page.evaluate(async (url) => {
    const m = await import(/* @vite-ignore */ url);
    return { size: m.FIXTURE_SIZE as number, years: m.FIXTURE_YEARS as number };
  }, MODULES.fixture);
  const r = await replayInPage(page, { chronicle: FIXTURE_CHRONICLE, ...fixture });
  expect(r.outcome).toMatchObject({ kind: 'done', digest: { hash: FIXTURE_HASH, year: fixture.years } });
  expect(r.years).toEqual([1, 2, 3]);
});

test('M19-06: 壊れた年代記 (tick の逆行) は Worker が broken を返し、ページは動き続ける', async ({ page }) => {
  await page.goto('/');
  const reversed = { ...FIXTURE_CHRONICLE, commands: [FIXTURE_CHRONICLE.commands[1], FIXTURE_CHRONICLE.commands[0]] };
  const r = await replayInPage(page, { chronicle: reversed, size: 32, years: 3 });
  expect(r.outcome).toEqual({ kind: 'broken', error: { path: 'commands[1].tick', reason: 'not_monotonic' } });
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
});

test('M19-06: 数百年かかる再生も、中断すれば Worker ごと止まってすぐ返り、ページは動き続ける', async ({ page }) => {
  await page.goto('/');
  const r = await replayInPage(page, { chronicle: { ...FIXTURE_CHRONICLE, commands: [] }, size: 64, years: 300, abortAfterYears: 1 });
  expect(r.outcome).toEqual({ kind: 'aborted' });
  expect(r.years).toEqual([1]);
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
});

/** IndexedDB に確定した石板の年代記。ページの記録ではなく置き場そのものを読む */
const storedChronicle = (page: Page, scenarioId: string) =>
  page.evaluate(
    (id) =>
      new Promise<{ simVersion: string; scenarioId: string; seed: number; commands: { tick: number; command: { type: string } }[] } | null>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('chronicles').objectStore('chronicles').get(id);
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    scenarioId,
  );

test('M19-06: シナリオ中に受理された介入だけが、tick 付きで年代記の置き場に書かれる (力の足りない 4 回目は載らない)', async ({ page }) => {
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-0');
  // test-quick の budget: start 10, spawn 3 → 3 回で 1 になり 4 回目は弾かれる
  await expect(page.locator('#tablet-power')).toHaveText('10 / 30');
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  const spawnOnce = async () => {
    await page.click('#spawn-grass');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
    await expect(page.locator('#spawn-grass')).not.toHaveClass(/armed/);
  };
  await spawnOnce();
  await expect.poll(async () => (await storedChronicle(page, 'test-quick'))?.commands.length).toBe(1);
  for (let i = 0; i < 3; i++) await spawnOnce();
  await expect(page.locator('#tablet-power')).toHaveText('1 / 30');
  await expect.poll(async () => (await storedChronicle(page, 'test-quick'))?.commands.length).toBe(3);
  const c = await storedChronicle(page, 'test-quick');
  expect(c).toMatchObject({ simVersion: '1', scenarioId: 'test-quick', seed: 42 });
  expect(c?.commands.map((x) => x.command.type)).toEqual(['spawn_species', 'spawn_species', 'spawn_species']);
  const ticks = c?.commands.map((x) => x.tick) ?? [];
  expect(new Set(ticks).size).toBe(1);
});
