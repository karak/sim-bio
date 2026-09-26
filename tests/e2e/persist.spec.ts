import { test, expect, type Page } from '@playwright/test';

type Saved = { event: string; slot: string; tick: number };

function collectLogs(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  return logs;
}

const events = (logs: string[], event: string): Saved[] =>
  logs.filter((l) => l.includes(`"event":"${event}"`)).map((l) => JSON.parse(l) as Saved);

async function runPastYearZero(page: Page): Promise<string> {
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).toHaveText(/^Year [1-9]\d*$/, { timeout: 30_000 });
  await page.click('#speed-0');
  return (await page.locator('#hud-year').textContent()) ?? '';
}

test('M19-05: 閉じて開き直すと、自動保存の続きから遊べる', async ({ context }) => {
  const first = await context.newPage();
  const firstLogs = collectLogs(first);
  await first.goto('/');
  await expect(first.locator('#hud-year')).toHaveText('Year 0');
  await first.click('#speed-100');
  await expect.poll(() => events(firstLogs, 'persist.saved').some((e) => e.slot === 'auto' && e.tick >= 360), { timeout: 30_000 }).toBe(true);
  await first.click('#speed-0');
  await first.close();
  const lastSaved = Math.max(...events(firstLogs, 'persist.saved').filter((e) => e.slot === 'auto').map((e) => e.tick));

  const second = await context.newPage();
  const secondLogs = collectLogs(second);
  await second.goto('/');
  await expect(second.locator('#hud-year')).toHaveText(`Year ${Math.floor(lastSaved / 360)}`);
  await expect.poll(() => events(secondLogs, 'persist.resumed')).toEqual([expect.objectContaining({ slot: 'auto', tick: lastSaved })]);
  await expect(second.locator('#slot-select option[value="auto"]')).toHaveText(`自動 · Year ${Math.floor(lastSaved / 360)}`);
});

test('M19-05: 手動の枠に保存し、先へ進めてから読み込むと保存した年に戻る。枠は開き直しても残る', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await page.selectOption('#slot-select', 'manual-2');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText('枠 2 · 空き');
  await expect(page.locator('#slot-load')).toBeDisabled();
  const savedYear = await runPastYearZero(page);

  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);
  await expect.poll(() => events(logs, 'persist.saved').filter((e) => e.slot === 'manual-2').length).toBe(1);

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(savedYear, { timeout: 30_000 });
  await page.click('#speed-0');
  await page.click('#slot-load');
  await expect(page.locator('#hud-year')).toHaveText(savedYear);

  await page.reload();
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText(`枠 2 · ${savedYear}`);
});

test('M19-05: シナリオ中は読み込めず (予言と矛盾する)、自動保存からも戻さず、自動の枠にも書かない', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await runPastYearZero(page);
  await expect.poll(() => events(logs, 'persist.saved').filter((e) => e.slot === 'auto').length).toBeGreaterThan(0);
  const autoText = await page.locator('#slot-select option[value="auto"]').textContent();

  logs.length = 0;
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.selectOption('#slot-select', 'auto');
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText(autoText ?? '');
  await expect(page.locator('#slot-load')).toBeDisabled();
  await expect(page.locator('#load-input')).toBeDisabled();

  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).toHaveText('Year 1', { timeout: 30_000 });
  expect(events(logs, 'persist.resumed')).toEqual([]);
  expect(events(logs, 'persist.saved')).toEqual([]);
});
