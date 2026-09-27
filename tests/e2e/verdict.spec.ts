import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/**
 * 判定の板 (M19-15 の 3)。板を上の取っ手で動かし、覆っていた画面 (観察画面の入口「3D で見る」) を押せるようにする。
 * 港は閉じたまま (網の失敗) にして、外へ出ない
 */
/** HARBOR_SHOTS に置き場を渡すと、画面の撮影を残す (harbor.spec.ts と同じ) */
async function shot(page: Page, name: string) {
  const dir = process.env.HARBOR_SHOTS;
  if (dir) await page.screenshot({ path: join(dir, `${name}.png`) });
}
const box = (page: Page) => page.locator('#verdict .verdict-box');
const grip = (page: Page) => page.getByRole('button', { name: /^判定の板を動かす/ });

async function toVerdict(page: Page) {
  await page.goto('/?scenario=test-civ');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた', { timeout: 90_000 });
}

const at = async (page: Page) => {
  const b = await box(page).boundingBox();
  if (!b) throw new Error('判定の板が描かれていない');
  return { x: Math.round(b.x), y: Math.round(b.y) };
};

test('M19-15 (3): 判定の板は上の取っ手のドラッグとキーボードで動き、下の観察画面の入口を押せる。動かした位置はそのタブの間だけ覚える', async ({ page }) => {
  test.setTimeout(180_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await toVerdict(page);
  const open = page.locator('#observe-open');
  await expect(open).toBeEnabled();
  const start = await at(page);

  const g = await grip(page).boundingBox();
  if (!g) throw new Error('取っ手が描かれていない');
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 260, g.y + g.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  expect(await at(page)).toEqual({ x: start.x + 260, y: start.y + 120 });

  // 矢印キーで 1 回 16 px、Shift で 64 px
  await grip(page).focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowUp');
  const moved = { x: start.x + 260 - 16, y: start.y + 120 - 64 };
  expect(await at(page)).toEqual(moved);
  await shot(page, '17-verdict-moved');

  // 動かした板は下の画面を塞がない
  await open.click();
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();

  // 「もう一度」(同じタブで開き直す) の判定の板は、動かした位置に出る
  await page.locator('#verdict-retry').click();
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた', { timeout: 90_000 });
  expect(await at(page)).toEqual(moved);
});

test('M19-15 (3): 判定の板は画面の外へは出ない (取っ手が画面に残る)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await toVerdict(page);
  const g = await grip(page).boundingBox();
  if (!g) throw new Error('取っ手が描かれていない');
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(-400, -400, { steps: 8 });
  await page.mouse.up();
  const after = await grip(page).boundingBox();
  expect(after?.y).toBeGreaterThanOrEqual(0);
  expect((after?.x ?? -1) + (after?.width ?? 0)).toBeGreaterThan(0);
  await expect(grip(page)).toBeInViewport();
});
