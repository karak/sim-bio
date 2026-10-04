import { test, expect, type Page } from '@playwright/test';
import { shownTick, TICKS_PER_YEAR } from '../driver/island';
import { expectUncovered } from './uncovered';

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

test('M24-01: 動きを減らす設定では背景は止めた 1 枚。板の間はメニューを押せない (板は 1 つだけ)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('.title-demo')).toHaveClass(/still/);
  await expect(page.locator('.title-demo img')).toHaveCount(1);
  await expect(page.locator('.title-demo img')).toHaveAttribute('src', '/textures/title/06-deer.jpg');

  await item(page, '港').click();
  await expect(page.getByRole('dialog', { name: '港' })).toBeVisible();
  await expect(menu(page)).toHaveJSProperty('inert', true);
  await item(page, 'コンフィグ').click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('button', { name: '戻る' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(item(page, '港')).toBeFocused();
});

const toTitle = (page: Page) => page.getByRole('button', { name: 'タイトルへ' });

test('M24-04: 自由モードの「タイトルへ」(キーボードで押せる) は、書き切ってからタイトルを出し、「続きから」で同じ島の同じ年へ戻る', async ({ page }) => {
  await page.goto('/?seed=42');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 30_000 });
  await page.click('#speed-0');
  const left = await shownTick(page);

  // 走っている島は確かめない。focus して Enter で押せる
  await toTitle(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'タイトル' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect(new URL(page.url()).search).toBe('');
  await expect(item(page, '続きから')).toBeFocused();
  await expect(item(page, '続きから').locator('.title-item-note')).toHaveText(new RegExp(`^自由モード · ${Math.floor(left / TICKS_PER_YEAR)} 年 · `));

  await page.keyboard.press('Enter');
  await expect(page.locator('#hud-year')).toBeVisible();
  await expect(page.locator('#hud-seed')).toHaveText('seed 42');
  expect(await shownTick(page)).toBeGreaterThanOrEqual(left);
  // 戻った後の再読み込みはタイトルへ戻さない (舞台に入った印を置き直す)
  await page.reload();
  await expect(page.locator('#hud-year')).toBeVisible();
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
});

test('M24-04: 判定の出た石板の「タイトルへ」は離れる確かめを経る (判定の板に覆われない)。取り消せば判定の島のまま、受ければタイトル', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick&shortcut=alive');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は生き延びた', { timeout: 60_000 });
  const url = page.url();
  await expectUncovered({ タイトルへ: toTitle(page) });

  await toTitle(page).click();
  const d = page.getByRole('alertdialog');
  await expect(d.getByRole('heading')).toHaveText('判定の出た島を離れる');
  await d.getByRole('button', { name: 'やめる' }).click();
  await expect(d).toBeHidden();
  expect(page.url()).toBe(url);
  await expect(page.locator('#verdict')).toBeVisible();

  await toTitle(page).click();
  await d.getByRole('button', { name: '離れる' }).click();
  await expect(page.getByRole('region', { name: 'タイトル' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  // (M24-05) 判定の出た石板は「続きから」にしない (開き直すと初めから)。自動の枠も無いので 4 行
  await expect(menu(page).getByRole('menuitem')).toHaveText(['新規ゲーム', 'ロード', '港', 'コンフィグ']);
});

test('M24-05: 石板を少し進めてタイトルへ戻ると、「続きから」が石板の題と年を言い、Enter で同じ年から続く', async ({ page }) => {
  test.setTimeout(90_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  await page.click('#speed-10');
  await expect(page.locator('#tablet-year')).toHaveText('1 / 5 年', { timeout: 60_000 });
  await page.click('#speed-0');
  const left = await shownTick(page);

  // 走っている石板は確かめない。flush が石板の続きを書き切ってからタイトルへ
  await toTitle(page).click();
  await expect(page.getByRole('region', { name: 'タイトル' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(menu(page).getByRole('menuitem')).toHaveText([/^続きから石板『試し読み』 · 1 年 · \d\d\/\d\d \d\d:\d\d$/, '新規ゲーム', 'ロード', '港', 'コンフィグ']);
  await expect(item(page, '続きから')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#tablet-year')).toHaveText('1 / 5 年');
  expect(new URL(page.url()).searchParams.get('scenario')).toBe('test-quick');
  expect(await shownTick(page)).toBeGreaterThanOrEqual(left);
  await expect(page.locator('#hud-year')).toBeVisible();
});
