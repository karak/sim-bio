import { test, expect, type Page } from '@playwright/test';

/** assets/data/world.default.json の ticksPerYear。test-quick も上書きしない */
const TICKS_PER_YEAR = 360;

type Logged = { event: string; slot?: string; tick: number };

function collectLogs(page: Page): Logged[] {
  const logs: Logged[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"persist.')) logs.push(JSON.parse(t) as Logged);
  });
  return logs;
}

const saved = (logs: Logged[], slot: string) => logs.filter((l) => l.event === 'persist.saved' && l.slot === slot);

/** IndexedDB に確定した自動の枠の tick。ページの記録ではなく置き場そのものを読む */
const storedAutoTick = (page: Page): Promise<number | null> =>
  page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open('biotope-island');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('saves').objectStore('saves').get('auto');
          req.onsuccess = () => {
            open.result.close();
            resolve((req.result as { tick: number } | undefined)?.tick ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );

/** HUD の年と日から今の tick を読む (Day は tick % ticksPerYear) */
async function shownTick(page: Page): Promise<number> {
  const year = Number((await page.locator('#hud-year').textContent())?.replace('Year ', ''));
  const day = Number((await page.locator('#hud-season').textContent())?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

async function runUntilAutosaved(page: Page, logs: Logged[], minTick: number) {
  await page.click('#speed-100');
  await expect.poll(() => saved(logs, 'auto').some((l) => l.tick >= minTick), { timeout: 30_000 }).toBe(true);
  await page.click('#speed-0');
}

/** タブが隠れたときと同じ経路を通す (page.close では visibilitychange が出るとは限らない) */
const hideTab = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

test('M19-05: 閉じて開き直すと、止めた所の続きから遊べる (自動保存と、隠れたときの書き込み)', async ({ context }) => {
  const first = await context.newPage();
  const firstLogs = collectLogs(first);
  await first.goto('/');
  await expect(first.locator('#hud-year')).toHaveText('Year 0');
  await runUntilAutosaved(first, firstLogs, TICKS_PER_YEAR);
  const pausedAt = await shownTick(first);
  await hideTab(first);
  await expect.poll(() => storedAutoTick(first)).toBe(pausedAt);
  await first.close();

  const second = await context.newPage();
  const secondLogs = collectLogs(second);
  await second.goto('/');
  // 開き直した島は 1 倍速で進むので、HUD は止めた tick 以上 (ちょうどの値は persist.resumed の tick で見る)
  await expect.poll(() => shownTick(second)).toBeGreaterThanOrEqual(pausedAt);
  expect(await shownTick(second)).toBeLessThan(pausedAt + 60);
  await expect.poll(() => secondLogs.filter((l) => l.event === 'persist.resumed')).toEqual([expect.objectContaining({ slot: 'auto', tick: pausedAt })]);
  await expect(second.locator('#slot-select option[value="auto"]')).toHaveText(`自動 · Year ${Math.floor(pausedAt / TICKS_PER_YEAR)}`);
});

test('M19-05: 手動の枠に保存し、先へ進めてから読み込むと保存した島に戻り、開き直してもその島から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await page.selectOption('#slot-select', 'manual-2');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText('枠 2 · 空き');
  await expect(page.locator('#slot-load')).toBeDisabled();
  await runUntilAutosaved(page, logs, TICKS_PER_YEAR);
  const savedAt = await shownTick(page);
  const savedYear = `Year ${Math.floor(savedAt / TICKS_PER_YEAR)}`;

  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(savedYear, { timeout: 30_000 });
  await page.click('#speed-0');
  await page.click('#slot-load');
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  // 読み込んだ島をその場で自動の枠に書く (止めたまま閉じても、読み込む前の島に戻らない)
  await expect.poll(() => storedAutoTick(page)).toBe(savedAt);

  await page.reload();
  await expect(page.locator('#hud-year')).toHaveText(savedYear);
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);
});

test('M19-05: 「新しい島」は確かめてから Year 0 に作り直し (取り消せば今の島のまま)、開き直しても新しい島から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await runUntilAutosaved(page, logs, TICKS_PER_YEAR);
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0');

  page.once('dialog', (d) => void d.dismiss());
  await page.click('#new-island');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0');

  page.once('dialog', (d) => void d.accept());
  await page.click('#new-island');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect.poll(() => storedAutoTick(page)).toBe(0);
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText('自動 · Year 0');

  await page.reload();
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
});

test('M19-05: シナリオ中は島を差し替えられず (予言と矛盾する)、自動保存からも戻さず、自動の枠にも書かない', async ({ context }) => {
  const free = await context.newPage();
  const freeLogs = collectLogs(free);
  await free.goto('/');
  await runUntilAutosaved(free, freeLogs, 90);
  await free.close();

  const page = await context.newPage();
  const logs = collectLogs(page);
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  const before = await storedAutoTick(page);
  expect(before).not.toBeNull();
  await page.selectOption('#slot-select', 'auto');
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText(`自動 · Year ${Math.floor((before ?? 0) / TICKS_PER_YEAR)}`);
  await expect(page.locator('#slot-load')).toBeDisabled();
  await expect(page.locator('#load-input')).toBeDisabled();
  await expect(page.locator('#new-island')).toBeDisabled();

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).toHaveText('Year 1', { timeout: 30_000 });
  await hideTab(page);
  expect(await storedAutoTick(page)).toBe(before);
  expect(logs.filter((l) => l.event === 'persist.resumed' || l.event === 'persist.saved')).toEqual([]);
});
