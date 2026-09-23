import { test, expect } from '@playwright/test';

test('observe view: no settlement in free mode, so the entry is disabled', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.getByRole('button', { name: '3D で見る' })).toBeDisabled();
});

test('observe view: enter from Sky Ship, 100x drops to 10x, the view follows the game clock, and back returns to the map', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scenario=sky-ship');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  const open = page.getByRole('button', { name: '3D で見る' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page.locator('#speed-10')).toHaveClass(/on/);
  await expect(page.locator('#speed-100')).not.toHaveClass(/on/);
  const stats = page.locator('#observe-layer .o-stats');
  await expect(stats).toHaveText(/^\d+ 年 · \d+ fps/, { timeout: 90_000 });
  // 観察画面の中でも本体の時間が進む (観察画面は操作画面の runner の snapshot を描く)
  const tick = () => page.evaluate(() => (window as unknown as { __observeStats: { tick: number } }).__observeStats.tick);
  const t0 = await tick();
  await expect.poll(tick, { timeout: 10_000 }).toBeGreaterThan(t0);
  await page.getByRole('button', { name: '操作画面へ戻る' }).click();
  await expect(page.locator('#observe-layer')).toBeHidden();
  await expect(open).toBeVisible();
  // 戻ったあとも操作画面の年は進み続ける
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 20_000 });
});
