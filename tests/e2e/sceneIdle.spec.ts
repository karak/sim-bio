import { test, expect, type Page } from '@playwright/test';

/**
 * 操作画面の 3D の島は、見た目が変わるときだけ描き直す (M21-10)。
 * 止めた島を毎フレーム描き直すと、GPU の無い E2E の Chromium (ソフトウェア描画) では 1 ページで 2 コア余りを使い続け、通しの E2E が固まった。
 * #scene の canvas への WebGL の draw の数を数え、描いたかどうかを外から見る
 */
const COUNT_DRAWS = `(() => {
  window.__sceneDraws = 0;
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const m of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const f = C.prototype[m];
      if (!f) continue;
      C.prototype[m] = function (...args) {
        if (this.canvas && this.canvas.id === 'scene') window.__sceneDraws++;
        return f.apply(this, args);
      };
    }
  }
})();`;

const draws = (page: Page) => page.evaluate(() => (window as unknown as { __sceneDraws: number }).__sceneDraws);

/** frames 枚のアニメーションフレームの間に #scene へ描いた draw の数 */
const drawsOver = async (page: Page, frames: number): Promise<number> => {
  const before = await draws(page);
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const next = () => (--left <= 0 ? resolve() : requestAnimationFrame(next));
        requestAnimationFrame(next);
      }),
    frames,
  );
  return (await draws(page)) - before;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(COUNT_DRAWS);
});

test('M21-10: 止めた島は描き直さず、層を替える・カメラを動かす・島が進むと描き直す', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => draws(page), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.click('#speed-0');
  await expect.poll(() => drawsOver(page, 30), { timeout: 15_000 }).toBe(0);

  const redraws = async (act: () => Promise<void>) => {
    const before = await draws(page);
    await act();
    await expect.poll(() => draws(page), { timeout: 15_000 }).toBeGreaterThan(before);
    await expect.poll(() => drawsOver(page, 30), { timeout: 15_000 }).toBe(0);
  };
  await redraws(() => page.click('#layer-temperature'));
  // 火山チップを持つと、火山セルの誘導の印が出る
  await redraws(() => page.click('#disaster-volcano'));

  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await redraws(async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
  });

  await page.click('#speed-1');
  await expect.poll(() => drawsOver(page, 30), { timeout: 15_000 }).toBeGreaterThan(0);
});

test('M21-10: 選んだセルの印は浮き沈みする間だけ描き直し、動きを減らす設定では止めた島と同じく描かない', async ({ page }) => {
  await page.goto('/');
  await page.click('#speed-0');
  await expect.poll(() => drawsOver(page, 30), { timeout: 15_000 }).toBe(0);

  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-info')).toContainText('セル (');
  expect(await drawsOver(page, 30)).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => drawsOver(page, 30), { timeout: 15_000 }).toBe(0);
});
