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

for (const [w, h] of [
  [1280, 720],
  [1024, 640],
] as const) {
  test(`M26-01: ${w}×${h} でグラフの plot は 110〜130 px で、セルの詳細の板・グラフの板は他の HUD と重ならない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.route('**/api/**', (route) => route.abort('failed'));
    await page.goto('/');
    await expect(page.locator('#hud-year')).toHaveText('Year 0');
    await page.click('#speed-0');
    await pickCellAndExpectRowsUncovered(page);
    const got = await page.evaluate(() => {
      const rect = (el: Element) => el.getBoundingClientRect();
      const plot = (id: string) => (document.getElementById(id) as HTMLCanvasElement).clientHeight - 32;
      const panels: Record<string, Element> = {
        セルの詳細: document.querySelector('.hud-bl')!,
        右のグラフ: document.querySelector('.hud-r')!,
        レイヤーの列: document.querySelector('.hud-tr')!,
        時間の箱: document.querySelector('.hud-tl')!,
        下の行: document.querySelector('.hud-b')!,
        種を放つ: document.querySelector('.hud-palette')!,
        港の札: document.querySelector('.harbor-dock')!,
      };
      const names = Object.keys(panels);
      const overlaps: string[] = [];
      for (let i = 0; i < names.length; i++)
        for (let j = i + 1; j < names.length; j++) {
          const a = rect(panels[names[i]]);
          const b = rect(panels[names[j]]);
          // 下の行×種を放つは 1024 幅で元から重なる (グラフの高さと無関係)。グラフの板 2 つが絡む組だけ見る
          if (!['セルの詳細', '右のグラフ'].some((n) => names[i] === n || names[j] === n)) continue;
          if (a.width && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${names[i]}×${names[j]}`);
        }
      const bl = rect(panels['セルの詳細']);
      return { graphPlot: plot('graph'), localPlot: plot('local-graph'), overlaps, blTop: bl.top, blBottom: bl.bottom, vh: window.innerHeight };
    });
    expect(got.graphPlot).toBeGreaterThanOrEqual(110);
    expect(got.graphPlot).toBeLessThanOrEqual(130);
    expect(got.localPlot).toBeGreaterThanOrEqual(110);
    expect(got.localPlot).toBeLessThanOrEqual(130);
    expect(got.overlaps).toEqual([]);
    expect(got.blTop).toBeGreaterThanOrEqual(0);
    expect(got.blBottom).toBeLessThanOrEqual(got.vh);
  });
}
