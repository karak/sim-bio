import { test, expect, type Page } from '@playwright/test';
import { shownTick, TICKS_PER_YEAR } from '../driver/island';

/**
 * タイトル画面 (M24-01)。ほかの spec は playwright.config.ts の storageState (開発の印) でタイトルを飛ばすので、ここだけ印を外して素の / を開く
 */
test.use({ storageState: { cookies: [], origins: [] } });

type Logged = { event: string; slot?: string; tick?: number; images?: number; loaded?: number; animations?: number; shownMs?: number; triangles?: number; drawCalls?: number };

function collectLogs(page: Page): Logged[] {
  const logs: Logged[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"title.') || t.includes('"event":"persist.saved"')) logs.push(JSON.parse(t) as Logged);
  });
  return logs;
}

const menu = (page: Page) => page.getByRole('menu', { name: 'タイトルのメニュー' });
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name });

test('M24-01: 素の / はタイトルを出し、キーボードだけで選べる。選ぶと背景のデモを止めて外し、舞台に入った後の再読み込みと検索語の URL はタイトルを飛ばす', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'タイトル' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ビオトープ島');
  // 続きの無い手元: 4 行で、既定 (focus) は新規ゲーム
  await expect(menu(page).getByRole('menuitem')).toHaveText(['新規ゲーム', 'ロード', '港', 'コンフィグ']);
  await expect(item(page, '新規ゲーム')).toBeFocused();
  await expect(page.locator('#hud-year')).toHaveCount(0);

  // 矢印で選び、Enter で板を開き、Esc でメニューのその行へ戻る
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'ロード')).toBeFocused();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'ロード' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: '戻る' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(item(page, 'ロード')).toBeFocused();
  // 端で回り込む
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(item(page, 'コンフィグ')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(item(page, '新規ゲーム')).toBeFocused();

  // 新規ゲーム (続きが無い) は自由モードの最初の島へ。タイトルと背景の画は DOM から外れる
  await page.keyboard.press('Enter');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
  await expect(page.locator('img[src*="/textures/title/"]')).toHaveCount(0);
  await expect.poll(() => logs.find((l) => l.event === 'title.demo.stop') ?? null).toMatchObject({ images: 4, triangles: 0, drawCalls: 0 });
  const stop = logs.find((l) => l.event === 'title.demo.stop');
  expect(stop?.loaded).toBeGreaterThanOrEqual(1);
  expect(stop?.shownMs).toBeGreaterThan(0);

  // このタブで舞台に入った後の再読み込みはタイトルへ戻さない
  await page.reload();
  await expect(page.locator('#hud-year')).toBeVisible();
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);

  // 検索語のある URL は、新しいタブ (印の無い sessionStorage) でもタイトルを経ない
  const other = await page.context().newPage();
  await other.goto('/?seed=42');
  await expect(other.locator('#hud-year')).toBeVisible();
  await expect(other.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
});

test('M24-01: 自動の枠に続きがあれば「続きから」を先頭に出して既定にし、Enter 1 回で閉じた年から続く', async ({ context }) => {
  const first = await context.newPage();
  const logs = collectLogs(first);
  await first.goto('/?seed=42');
  await expect(first.locator('#hud-year')).toHaveText('Year 0');
  await first.click('#speed-100');
  await expect.poll(() => logs.some((l) => l.event === 'persist.saved' && l.slot === 'auto' && (l.tick ?? 0) >= TICKS_PER_YEAR), { timeout: 30_000 }).toBe(true);
  await first.click('#speed-0');
  const savedTick = Math.max(...logs.filter((l) => l.event === 'persist.saved' && l.slot === 'auto').map((l) => l.tick ?? 0));
  await first.close();

  // 新しいタブで素の / (このタブではまだ舞台に入っていない)
  const page = await context.newPage();
  await page.goto('/');
  await expect(menu(page).getByRole('menuitem')).toHaveText([/^続きから自由モード · \d+ 年 · \d\d\/\d\d \d\d:\d\d$/, '新規ゲーム', 'ロード', '港', 'コンフィグ']);
  await expect(item(page, '続きから')).toBeFocused();
  await expect(item(page, '続きから').locator('.title-item-note')).toHaveText(/^自由モード · [1-9]\d* 年 · /);
  await page.keyboard.press('Enter');
  await expect(page.locator('#hud-year')).toBeVisible();
  expect(await shownTick(page)).toBeGreaterThanOrEqual(savedTick);
});
