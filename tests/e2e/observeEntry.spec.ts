import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * 観察画面の入口「3D で見る」の置き場所 (M19-18、受入 r2-publish-visit)。
 * 左上の時間の箱 (Year / 速さの列) の端にあり、石板・判定の板に覆われない。集落の無い島 (test-quick) でも島の真ん中から入れる。
 * OBSERVE_SHOTS に置き場を渡すと、画面の撮影を残す
 */
async function shot(page: Page, name: string) {
  const dir = process.env.OBSERVE_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}

const openButton = (page: Page) => page.getByRole('button', { name: '3D で見る' });

/** ボタンの中心の点で一番上にある要素がボタン自身か (石板・判定の板などに覆われていないか) */
const topmostAtCenter = (page: Page) =>
  page.evaluate(() => {
    const b = document.getElementById('observe-open');
    if (!b) return 'missing';
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === b ? 'self' : hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.className}` : 'nothing';
  });

/** ボタンが時間の箱の速さの列の端 (100x の右、同じ行) にあり、石板と重ならない */
async function expectInTimeBox(page: Page) {
  const open = openButton(page);
  await expect(page.locator('.hud-tl #speed-row > #observe-open')).toHaveCount(1);
  const b = await open.boundingBox();
  const last = await page.locator('#speed-100').boundingBox();
  const tablet = await page.locator('#tablet').boundingBox();
  if (!b || !last || !tablet) throw new Error('ボタン・速さの札・石板のどれかが描かれていない');
  expect(b.x).toBeGreaterThanOrEqual(last.x + last.width);
  expect(Math.abs(b.y + b.height / 2 - (last.y + last.height / 2))).toBeLessThan(4);
  const overlaps = b.x < tablet.x + tablet.width && tablet.x < b.x + b.width && b.y < tablet.y + tablet.height && tablet.y < b.y + b.height;
  expect(overlaps).toBe(false);
}

test('M19-18: 集落の無い石板 (test-quick) でも判定の前から「3D で見る」を押せ、覆われず、島の真ん中の観察画面に入って戻れる', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await expect(page.locator('#tablet-title')).toContainText('試し読み');
  const open = openButton(page);
  await expect(open).toHaveText('3D で見る');
  await expect(open).toBeEnabled();
  await expectInTimeBox(page);
  expect(await topmostAtCenter(page)).toBe('self');
  await expect(page.locator('#verdict')).toBeHidden();
  await shot(page, 'm19-18-after');

  await open.click();
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^0 年 · [春夏秋冬]$/, { timeout: 90_000 });
  // 集落が無いので、集落だけの形 (小屋・灯り柱・石垣・船台など) を置かず、民もいない
  const inside = await page.evaluate(() => {
    const w = window as unknown as { __observeProps: () => unknown[]; __observeHuts: () => unknown[]; __observeStats: { folk: number; deer: number } };
    return { props: w.__observeProps(), huts: w.__observeHuts(), folk: w.__observeStats.folk };
  });
  expect(inside).toEqual({ props: [], huts: [], folk: 0 });
  await shot(page, 'm19-18-3d');

  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();
  await expect(open).toBeVisible();
  expect(await topmostAtCenter(page)).toBe('self');
  await open.click();
  await expect(page.locator('#observe-layer')).toBeVisible();
  await page.getByRole('button', { name: '操作画面へ戻る' }).click();
  await expect(page.locator('#observe-layer')).toBeHidden();
  await expect(open).toBeEnabled();
});

test('M19-18: 判定の板が出ているときも「3D で見る」は覆われず、押せば観察画面に入る', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 60_000 });
  const open = openButton(page);
  await expect(open).toHaveText('3D で見る');
  await expect(open).toBeEnabled();
  await expectInTimeBox(page);
  expect(await topmostAtCenter(page)).toBe('self');
  await open.click();
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#observe-layer .o-stats')).toHaveText(/^\d+ 年 · [春夏秋冬]$/, { timeout: 90_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();
  await expect(page.locator('#verdict')).toBeVisible();
  expect(await topmostAtCenter(page)).toBe('self');
});

test('M19-18: 自由モード (/) でも「3D で見る」は時間の箱の端にあって覆われず、集落が無くても押せる', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  const open = openButton(page);
  await expect(open).toHaveText('3D で見る');
  await expect(open).toBeEnabled();
  await expectInTimeBox(page);
  expect(await topmostAtCenter(page)).toBe('self');
});
