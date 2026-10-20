import { test, expect, type Page } from '@playwright/test';
import { advanceTo, openPaused, shownTick, TICKS_PER_YEAR } from '../driver/island';

/**
 * タイトルのメニュー (M24-02): 新規ゲーム・ロード (枠・ファイル)・コンフィグ。title.spec と同じく開発の印を外して素の / を開く。
 * 港は閉港 (page.route で /api を落とす) にし、操作の前に置く。各 lane の画は test の出力の置き場に m24-02-lane<n>.png で残す
 */
test.use({ storageState: { cookies: [], origins: [] } });

type Logged = { event: string; slot?: string; tick?: number };

function collectLogs(page: Page): Logged[] {
  const logs: Logged[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('"event":"persist.')) logs.push(JSON.parse(t) as Logged);
  });
  return logs;
}

const menu = (page: Page) => page.getByRole('menu', { name: 'タイトルのメニュー' });
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name });
const toTitle = (page: Page) => page.getByRole('button', { name: 'タイトルへ' });
const lane = (page: Page, n: number) => page.screenshot({ path: test.info().outputPath(`m24-02-lane${n}.png`) });

/** 確かめの板の題と文を確かめてから、受ける (ok の札) か断る (やめる) */
async function answer(page: Page, ask: { title: string; message: string }, ok: string | null): Promise<void> {
  const d = page.getByRole('alertdialog');
  await expect(d.getByRole('heading')).toHaveText(ask.title);
  await expect(d.locator('.confirm-message')).toHaveText(ask.message);
  await d.getByRole('button', { name: ok ?? 'やめる' }).click();
  await expect(d).toHaveCount(0);
}

/** 自由モードを 1 年より先まで回し、自動の枠に書けるまで待って止める */
async function playFreeYear(page: Page, logs: Logged[]): Promise<void> {
  await page.click('#speed-100');
  await expect.poll(() => logs.some((l) => l.event === 'persist.saved' && l.slot === 'auto' && (l.tick ?? 0) >= TICKS_PER_YEAR), { timeout: 30_000 }).toBe(true);
  await page.click('#speed-0');
}

test.beforeEach(async ({ context }) => {
  // 文脈ごと (lane4 の新しいタブにも効く)
  await context.route('**/api/**', (route) => route.abort('failed'));
});

test('M24-02 lane1: 新規ゲームは、続きの無い手元ならそのまま Year 0 の最初の島 (seed 42)。自動の枠があれば板の「自由モード」から、確かめてから新しい seed の Year 0', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/');
  await expect(item(page, '新規ゲーム')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.locator('#hud-seed')).toHaveText('seed 42');

  await playFreeYear(page, logs);
  await toTitle(page).click();
  await expect(item(page, '続きから')).toBeFocused();

  await item(page, '新規ゲーム').click();
  const panel = page.getByRole('dialog', { name: '新規ゲーム' });
  await expect(panel.getByRole('button', { name: '戻る' })).toBeFocused();
  // 石板を選ぶは石板の板 (中身は M24-03)。戻るとメニューの新規ゲームへ
  await panel.getByRole('button', { name: /^石板を選ぶ/ }).click();
  const stones = page.getByRole('dialog', { name: '石板を選ぶ' });
  await expect(stones.locator('p')).toHaveText('タイトルからの石板の選択は準備中です。島の中の石板の板から選べます。');
  await stones.getByRole('button', { name: '戻る' }).click();
  await expect(item(page, '新規ゲーム')).toBeFocused();

  await page.keyboard.press('Enter');
  const free = panel.getByRole('button', { name: /^自由モード/ });
  const ask = { title: '新しい島', message: '今の島を捨てて、新しい島を始めますか (自動の枠は上書きされます)' };
  // 断れば板に留まる
  await free.click();
  await answer(page, ask, null);
  await expect(panel).toBeVisible();
  await expect(free).toBeFocused();
  await expect(page.locator('#hud-year')).toHaveCount(0);

  await free.click();
  await answer(page, ask, '新しい島を始める');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expect(page.locator('#hud-seed')).not.toHaveText('seed 42');
  const seed = new URL(page.url()).searchParams.get('seed');
  expect(seed).toMatch(/^\d+$/);
  await expect(page.locator('#hud-seed')).toHaveText(`seed ${seed}`);
  await expect(page.getByRole('region', { name: 'タイトル' })).toHaveCount(0);
  await lane(page, 1);
});

test('M24-02 lane2: ロード (枠) は、石板の枠を選ぶと確かめてからその石板を開き、枠の年から続く', async ({ page }) => {
  test.setTimeout(120_000);
  const logs = collectLogs(page);
  // test-quick は 2 年目に必ず滅ぶ。止めた島を口 (advanceTo) で 1 年と 1 季節へ進めてから枠に保存する
  await openPaused(page, '/?scenario=test-quick&paused=1');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 5 年');
  const savedTick = TICKS_PER_YEAR + TICKS_PER_YEAR / 4;
  await advanceTo(page, savedTick);
  await expect(page.locator('#tablet-year')).toHaveText('1 / 5 年');
  await expect.poll(() => shownTick(page)).toBe(savedTick);
  await page.selectOption('#slot-select', 'manual-2');
  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-2"]')).toHaveText('枠 2 · 試し読み · 1 年');
  await expect.poll(() => logs.some((l) => l.event === 'persist.saved' && l.slot === 'manual-2')).toBe(true);
  // 枠の後も 2 季節進め (判定の出る前)、枠と違う続きを残してからタイトルへ
  const leftTick = savedTick + TICKS_PER_YEAR / 2;
  await advanceTo(page, leftTick);
  await expect.poll(() => shownTick(page)).toBe(leftTick);
  await toTitle(page).click();
  await expect(menu(page)).toBeVisible();

  await item(page, 'ロード').click();
  const panel = page.getByRole('dialog', { name: 'ロード' });
  await expect(panel.locator('.title-slot-name')).toHaveText(['自動の枠', '枠 1', '枠 2', '枠 3']);
  await expect(panel.locator('[data-slot="manual-2"] .title-slot-note')).toHaveText(/^石板『試し読み』 · 1 年 · \d\d\/\d\d \d\d:\d\d$/);
  await expect(panel.locator('[data-slot="manual-1"] .title-slot-note')).toHaveText('空');
  await expect(panel.getByRole('button', { name: '枠 1を読み込む' })).toBeDisabled();
  await panel.getByRole('button', { name: '枠 2を読み込む' }).click();
  await answer(page, { title: '舞台を移って読む', message: '石板『試し読み』の枠です。石板を開いて読みますか' }, '移って読む');

  await expect(page.locator('#tablet-year')).toHaveText('1 / 5 年');
  expect(new URL(page.url()).searchParams.get('scenario')).toBe('test-quick');
  await page.click('#speed-0');
  // 続き (leftTick) ではなく枠の時点 (savedTick) から。読んだ直後は 1x で少し進む
  const at = await shownTick(page);
  expect(at).toBeGreaterThanOrEqual(savedTick);
  expect(at).toBeLessThan(leftTick);
  expect(logs.filter((l) => l.event === 'persist.slot.load.failed')).toEqual([]);
  await lane(page, 2);
});

test('M24-02 lane3: ロード (ファイル) は、保存したファイルを選ぶと確かめ (自動の枠は上書きされます) の後に自由モードを開き、ファイルの年から続く', async ({ page }) => {
  const logs = collectLogs(page);
  await page.goto('/?seed=42');
  await playFreeYear(page, logs);
  const fileTick = await shownTick(page);
  const fileYear = `Year ${Math.floor(fileTick / TICKS_PER_YEAR)}`;
  const download = page.waitForEvent('download');
  await page.click('#save-btn');
  const file = await (await download).path();
  // ファイルの後も進めてからタイトルへ (自動の枠はファイルより先の島)
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText(fileYear, { timeout: 30_000 });
  await page.click('#speed-0');
  await toTitle(page).click();
  await expect(menu(page)).toBeVisible();

  await item(page, 'ロード').click();
  const panel = page.getByRole('dialog', { name: 'ロード' });
  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: /^ファイルから読む/ }).click();
  await (await chooser).setFiles(file);
  await answer(page, { title: '舞台を移って読む', message: '自由モードの枠です。自由モードを開いて読みますか (自動の枠は上書きされます)' }, '移って読む');

  await expect(page.locator('#hud-year')).toHaveText(fileYear);
  await expect(page.locator('#hud-seed')).toHaveText('seed 42');
  expect(new URL(page.url()).searchParams.get('scenario')).toBeNull();
  // 移った先で、読んだ島をその場で自動の枠に書く (操作画面から移って読むのと同じ道)
  await expect.poll(() => logs.filter((l) => l.event === 'persist.saved' && l.slot === 'auto').map((l) => l.tick)).toContain(fileTick);
  expect(logs.filter((l) => l.event === 'persist.slot.load.failed')).toEqual([]);
  await lane(page, 3);
});

test('M24-02 lane4: コンフィグを変えると置き場に残り、再読み込みでも板の値が戻って効く。壊れた値は既定に戻す', async ({ page }) => {
  await page.goto('/');
  await item(page, 'コンフィグ').click();
  const panel = page.getByRole('dialog', { name: 'コンフィグ' });
  const choice = (group: string, name: string) => panel.getByRole('group', { name: group }).getByRole('radio', { name });
  await expect(choice('画質', '自動')).toBeChecked();
  await expect(choice('動きを減らす', 'OS に従う')).toBeChecked();
  await expect(choice('最初の速さ', '1x')).toBeChecked();
  await choice('最初の速さ', '10x').check();
  await choice('動きを減らす', '入').check();
  await choice('画質', '軽い').check();
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('biotope.config'))) ?? 'null')).toEqual({ quality: 'light', motion: 'on', speed: 10 });

  await page.reload();
  await expect(menu(page)).toBeVisible();
  // 動きを減らすが入なので、OS の設定に関わらず背景は止めた 1 枚
  await expect(page.locator('.title-demo')).toHaveClass(/still/);
  await item(page, 'コンフィグ').click();
  await expect(choice('最初の速さ', '10x')).toBeChecked();
  await expect(choice('動きを減らす', '入')).toBeChecked();
  await expect(choice('画質', '軽い')).toBeChecked();
  await lane(page, 4);
  await page.keyboard.press('Escape');
  await expect(item(page, 'コンフィグ')).toBeFocused();

  // 最初の速さは島を開いたときに効く
  await item(page, '新規ゲーム').click();
  await expect(page.locator('#hud-year')).toBeVisible();
  await expect(page.locator('#speed-10')).toHaveClass(/\bon\b/);

  // 壊れた値は既定に戻す (新しいタブはタイトルから)
  await page.evaluate(() => localStorage.setItem('biotope.config', '{"speed":"x","motion":7'));
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('menu', { name: 'タイトルのメニュー' }).getByRole('menuitem', { name: 'コンフィグ' }).click();
  const fresh = other.getByRole('dialog', { name: 'コンフィグ' });
  await expect(fresh.getByRole('group', { name: '最初の速さ' }).getByRole('radio', { name: '1x' })).toBeChecked();
  await expect(fresh.getByRole('group', { name: '動きを減らす' }).getByRole('radio', { name: 'OS に従う' })).toBeChecked();
  await fresh.getByRole('button', { name: '既定に戻す' }).click();
  expect(JSON.parse((await other.evaluate(() => localStorage.getItem('biotope.config'))) ?? 'null')).toEqual({ quality: 'auto', motion: 'os', speed: 1 });
});
