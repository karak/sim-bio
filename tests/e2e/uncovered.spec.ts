import { test, expect } from '@playwright/test';
import { expectUncovered, expectAllRowsUncoveredAtFivePoints } from './uncovered';

/**
 * 部品が覆われない (M21-05)。部品ごとの「覆われない」試験を uncovered.ts の 1 つの型で並べる。
 * 部品の中の振る舞いは tests/unit/ の ui.movable.dom.test.ts (ドラッグ・キー・覚え)・ui.tablet.dom.test.ts (石板)・ui.confirm.dom.test.ts (確かめのダイアログ)。港は閉じたまま (網の失敗)
 */

test('M21-05: 自由モード (/) の時間の箱・石板・下の行の札は、どれも覆われない', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await expectUncovered({
    '3D で見る': page.getByRole('button', { name: '3D で見る' }),
    一時停止: page.locator('#speed-0'),
    石板の選び: page.locator('#tablet-select'),
    枠へ保存: page.getByRole('button', { name: '枠へ保存' }),
    新しい島: page.getByRole('button', { name: '新しい島' }),
  });
});

test('M21-05: 判定の板が出ているとき、板の取っ手・札と、板の外の「3D で見る」・枠へ保存は、どれも覆われない。板を動かしても変わらない', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 60_000 });
  const grip = page.getByRole('button', { name: /^判定の板を動かす/ });
  const targets = {
    '3D で見る': page.getByRole('button', { name: '3D で見る' }),
    判定の板の取っ手: grip,
    もう一度: page.getByRole('button', { name: 'もう一度' }),
    自由モードへ: page.getByRole('button', { name: '自由モードへ' }),
    枠へ保存: page.getByRole('button', { name: '枠へ保存' }),
  };
  await expectUncovered(targets);
  await grip.focus();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(page.locator('#verdict-box')).toHaveCSS('translate', '-64px 64px');
  await expectUncovered(targets);
});

test('M21-09: 石板 (?scenario=test-quick) の選び・年・年表・力は、どれも覆われない', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await expectUncovered({
    石板の選び: page.locator('#tablet-select'),
    石板の年: page.locator('#tablet-year'),
    年表: page.locator('#tablet-timeline-summary'),
    力: page.locator('#tablet-power'),
  });
});

test('M21-09: 判定の板が出ているときに開いた確かめのダイアログの札は、判定の板に覆われない', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 90_000 });
  await page.getByRole('button', { name: '石板を初めから', exact: true }).click();
  const d = page.getByRole('alertdialog', { name: '石板を初めから' });
  await expectUncovered({
    やめる: d.getByRole('button', { name: 'やめる', exact: true }),
    初めからやり直す: d.getByRole('button', { name: '初めからやり直す', exact: true }),
  });
  await page.keyboard.press('Escape');
  await expect(d).toBeHidden();
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
});

/** 島を押してセルの詳細を出し、行の札 (生気 / 枯死・輝石・草を含む全部) を 5 点で見る (M25-10。港の札が左の縁からこの行の札に掛かっていた) */
async function pickCellAndExpectRowsUncovered(page: import('@playwright/test').Page) {
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-info')).toContainText(/^セル/);
  await expectAllRowsUncoveredAtFivePoints(page.locator('#cell-info'));
}

test('M25-10: 自由モード (/) でセルの詳細の行の札は港の札に覆われない', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await pickCellAndExpectRowsUncovered(page);
});

test('M25-10: 石板 (?scenario=test-quick) でセルの詳細の行の札は港の札に覆われない', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await pickCellAndExpectRowsUncovered(page);
});

test('M25-10: 判定の板が出ているときも、セルの詳細の行の札は港の札に覆われない', async ({ page }) => {
  test.setTimeout(150_000);
  await page.route('**/api/**', (route) => route.abort('failed'));
  await page.goto('/?scenario=test-quick');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-info')).toContainText(/^セル/);
  await page.click('#speed-100');
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた', { timeout: 90_000 });
  await expectAllRowsUncoveredAtFivePoints(page.locator('#cell-info'));
});

/** 1 つの部品を 5 点 (左端・右端・上端・下端・真ん中) で見て、一番上の要素が部品自身 (かその中) か (M26-04) */
const expectUncoveredAtFivePoints = (target: import('@playwright/test').Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + 1, r.top + r.height / 2],
      [r.right - 1, r.top + r.height / 2],
      [r.left + r.width / 2, r.top + 1],
      [r.left + r.width / 2, r.bottom - 1],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit && el.contains(hit) ? 'self' : hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.getAttribute('class') ?? ''}` : 'nothing';
    });
  });

for (const size of [
  { width: 1280, height: 720 },
  { width: 1024, height: 640 },
]) {
  test(`M26-04: 開発の板 (?dev=1) は『新しい島』を覆わない (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.goto('/?dev=1');
    await expect(page.locator('#hud-year')).toHaveText('Year 0');
    const panel = page.getByRole('region', { name: '開発' });
    await expect(panel).toBeVisible();
    const button = page.getByRole('button', { name: '新しい島' });
    await expect(button).toBeVisible();
    expect(await expectUncoveredAtFivePoints(button)).toEqual(Array(5).fill('self'));
    const [b, p] = await Promise.all([button.boundingBox(), panel.boundingBox()]);
    const overlap = b!.x < p!.x + p!.width && p!.x < b!.x + b!.width && b!.y < p!.y + p!.height && p!.y < b!.y + b!.height;
    expect(overlap, `板 ${JSON.stringify(p)} がボタン ${JSON.stringify(b)} と重なる`).toBe(false);
  });
}
