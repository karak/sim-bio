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

test('observe view: clicking an animal follows it, and the speed stays in the game controls', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/?scenario=sky-ship');
  await page.getByRole('button', { name: '3D で見る' }).click();
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^\d+ 年 · \d+ fps/, { timeout: 90_000 });
  // 観察画面では速さのボタンを出さない (操作画面の速さに従う)
  await expect(page.locator('#observe-layer .o-shots').getByRole('button', { name: '10x' })).toHaveCount(0);
  // 群れの寄せ先で画面の中の個体を 1 つ選び、その位置を押す
  await page.locator('#observe-layer .o-shots').getByRole('button', { name: '群れ' }).click();
  const onScreen = () =>
    page.evaluate(() => {
      const w = window as unknown as { __observeDebug: { agents: { id: number; st: string }[] }; __observeScreen: (id: number) => { x: number; y: number } | null };
      for (const a of w.__observeDebug.agents) {
        if (a.st === 'enter' || a.st === 'leave') continue;
        const p = w.__observeScreen(a.id);
        if (p) return { id: a.id, ...p };
      }
      return null;
    });
  await expect.poll(onScreen, { timeout: 15_000 }).not.toBeNull();
  const target = await onScreen();
  if (!target) throw new Error('no animal on screen');
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __observeStats: { follow: number | null; camera: string } }).__observeStats), { timeout: 5_000 })
    .toMatchObject({ follow: expect.any(Number), camera: 'free' });
});
