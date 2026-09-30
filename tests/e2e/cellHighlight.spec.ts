import { test, expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';

/**
 * 選んだセルを操作画面の 3D の島で示す (M22-10、受入 2026-09-27 のユーザーのメモ、示す先はユーザーの判断 2026-09-28)。
 * 島を押すと、そのセルの境界の帯と浮かぶ印が出る。別のセルを押すと移り、選びを解く (新しい島) と消える。
 * 描いている物は SceneView の __sceneSelection() で読む (読むだけ)
 */
type Selection = {
  cell: number | null;
  size: number;
  outline: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  marker: { x: number; y: number; z: number; scale: number } | null;
  drawCalls: number;
};

const selection = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as unknown as { __probe?: Probe }).__probe?.scene;
    return (scene ? scene.selection() : null) as Selection | null;
  });

/** セルの詳細 (#cell-info の「セル (x, y)」) から、押したセルの座標を読む */
async function pickedCell(page: Page): Promise<{ x: number; y: number }> {
  await expect(page.locator('#cell-info')).toContainText('セル (');
  const text = (await page.locator('#cell-info').textContent()) ?? '';
  const m = /セル \((\d+), (\d+)\)/.exec(text);
  if (!m) throw new Error(`cell-info: ${text}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** 強調がセル (x, y) にある: 帯はセルの四角の境界をまたぎ、印はセルの中心の真上にある */
async function expectHighlightAt(page: Page, at: { x: number; y: number }) {
  // 低い fps の CI でも次のフレームで置き直すまで待つ
  await expect.poll(async () => (await selection(page))?.cell, { timeout: 15_000 }).toBe(at.y * 128 + at.x);
  const s = await selection(page);
  if (!s?.outline || !s.marker) throw new Error('highlight hidden');
  expect(s.size).toBe(128);
  const x0 = at.x - s.size / 2;
  const z0 = at.y - s.size / 2;
  expect(s.outline.minX).toBeLessThan(x0);
  expect(s.outline.minX).toBeGreaterThan(x0 - 0.5);
  expect(s.outline.maxX).toBeGreaterThan(x0 + 1);
  expect(s.outline.maxX).toBeLessThan(x0 + 1.5);
  expect(s.outline.minZ).toBeLessThan(z0);
  expect(s.outline.minZ).toBeGreaterThan(z0 - 0.5);
  expect(s.outline.maxZ).toBeGreaterThan(z0 + 1);
  expect(s.outline.maxZ).toBeLessThan(z0 + 1.5);
  expect(s.marker.x).toBeCloseTo(x0 + 0.5, 5);
  expect(s.marker.z).toBeCloseTo(z0 + 0.5, 5);
}

test('M22-10: 操作画面で島を押すと、そのセルに境界の帯と浮かぶ印が出て、別のセルで移り、層を替えても残り、新しい島で消える', async ({ page }) => {
  await page.goto('/');
  // 島を止めて、フレームごとの描画の数を比べられるようにする
  await page.click('#speed-0');
  await expect.poll(async () => (await selection(page))?.drawCalls ?? 0, { timeout: 15_000 }).toBeGreaterThan(0);
  const before = await selection(page);
  expect(before?.cell).toBeNull();
  expect(before?.outline).toBeNull();
  expect(before?.marker).toBeNull();

  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  const first = await pickedCell(page);
  await expectHighlightAt(page, first);
  // 予算: 強調で増える draw call は帯と印の 2 つだけ
  await expect.poll(async () => (await selection(page))?.drawCalls, { timeout: 15_000 }).toBe((before?.drawCalls ?? 0) + 2);

  // 別のセルを押すと移る
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height * 0.45);
  await expect.poll(async () => (await pickedCell(page)).x, { timeout: 15_000 }).not.toBe(first.x);
  const second = await pickedCell(page);
  await expectHighlightAt(page, second);

  // 重ね図 (気温) と種の層に替えても残る
  await page.click('#layer-temperature');
  await expectHighlightAt(page, second);
  await page.click('#layer-species-forest');
  await expectHighlightAt(page, second);

  // 新しい島で選びが解けると消える
  await page.click('#new-island');
  await page.getByRole('alertdialog').locator('.confirm-ok').click();
  await expect.poll(async () => (await selection(page))?.cell, { timeout: 15_000 }).toBeNull();
  const cleared = await selection(page);
  expect(cleared?.outline).toBeNull();
  expect(cleared?.marker).toBeNull();
});
