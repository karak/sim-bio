import { test, expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';

/**
 * 撮る状態を毎回同じにする口 (M25-02) の確かめ。shots.spec.ts が使う口 (?paused=1・?clock=・probe.advanceTo・pinMask) を、ACCEPTANCE_DIR なしで見る。
 * 3D の canvas への draw の数は sceneIdle.spec.ts と同じ数え方
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

async function openPaused(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
}

/** 島の真ん中あたりを押して選び、印が出るまで待つ */
async function selectCell(page: Page) {
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect.poll(() => markerOf(page), { timeout: 15_000 }).not.toBeNull();
}

const markerOf = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.scene?.selection().marker ?? null);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(COUNT_DRAWS);
});

test.describe('止めた島から始める・tick で進める', () => {
  test('?paused=1 は最初のフレームの前に ⏸ を押し、待っても島は進まない。advanceTo は年の境目をまたいで進め、戻せない', async ({ page }) => {
    await openPaused(page, '/?paused=1');
    await expect(page.locator('#hud-season')).toHaveText(/ · Day 0$/);
    await page.waitForTimeout(2500);
    await expect(page.locator('#hud-season')).toHaveText(/ · Day 0$/);
    const advance = (tick: number) => page.evaluate((t) => (window as unknown as { __probe: Probe }).__probe.advanceTo(t), tick);
    await advance(359);
    await expect(page.locator('#hud-year')).toHaveText('Year 0');
    await expect(page.locator('#hud-season')).toHaveText(/ · Day 359$/);
    await advance(360);
    await expect(page.locator('#hud-year')).toHaveText('Year 1');
    await expect(page.locator('#hud-season')).toHaveText(/ · Day 0$/);
    await advance(800);
    await expect(page.locator('#hud-year')).toHaveText('Year 2');
    await expect(page.locator('#hud-season')).toHaveText(/ · Day 80$/);
    await expect(advance(100)).rejects.toThrow(/戻せ/);
  });

  test('グラフの点は年ごとに 1 つ。3 年進めると Y0 から Y3 の 4 点 (フレームの間隔に依らない)', async ({ page }) => {
    await openPaused(page, '/?paused=1');
    await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.advanceTo(3 * 360 + 5));
    await expect(page.locator('#graph')).toHaveAttribute('aria-label', '個体数と気温の推移。Y0 から Y3、4 点');
  });
});

test.describe('ピンの時計', () => {
  test('?clock=<ms> で止めた時計は、ピンの上下を回ごとに同じにする。0.4 秒 (1.6 秒周期の 1/4) では 0 のときより 0.25 × 大きさだけ高い', async ({ page }) => {
    await openPaused(page, '/?paused=1&clock=0');
    await selectCell(page);
    const at0 = await markerOf(page);
    await page.waitForTimeout(500);
    expect((await markerOf(page))?.y).toBe(at0?.y);
    await openPaused(page, '/?paused=1&clock=400');
    await selectCell(page);
    const at400 = await markerOf(page);
    if (!at0 || !at400) throw new Error('marker missing');
    expect(at400.scale).toBeCloseTo(at0.scale, 6);
    expect(at400.y - at0.y).toBeCloseTo(0.25 * at0.scale, 4);
  });

  test.describe('動きを減らす設定 (reducedMotion: reduce)', () => {
    test.use({ reducedMotion: 'reduce' });
    test('時計が動いても印は上下せず、clock=0 と同じ高さ', async ({ page }) => {
      await openPaused(page, '/?paused=1&clock=400');
      await selectCell(page);
      const reduced = await markerOf(page);
      await openPaused(page, '/?paused=1&clock=0');
      await selectCell(page);
      expect(reduced?.y).toBe((await markerOf(page))?.y);
    });
  });
});

test.describe('ピンの ID 描き', () => {
  test.use({ reducedMotion: 'reduce' });

  test('選びが無ければ null。選ぶと、見えるピンの画素の数と外接の四角が読め、同じ状態で読み直しても同じ', async ({ page }) => {
    await openPaused(page, '/?paused=1');
    const mask = () =>
      page.evaluate(() => {
        const m = (window as unknown as { __probe: Probe }).__probe.scene?.pinMask();
        return m ? { width: m.width, height: m.height, area: m.area, bounds: m.bounds, inMask: m.mask.reduce((a, v) => a + v, 0) } : null;
      });
    expect(await mask()).toBeNull();
    await selectCell(page);
    await expect.poll(() => drawsOver(page, 20), { timeout: 15_000 }).toBe(0);
    const first = await mask();
    expect(first?.area).toBeGreaterThan(100);
    expect(first?.inMask).toBe(first?.area);
    expect(first?.bounds?.minX).toBeGreaterThanOrEqual(0);
    expect(first?.bounds?.maxX).toBeLessThan(first?.width ?? 0);
    expect(first?.bounds?.maxY).toBeLessThan(first?.height ?? 0);
    expect(await mask()).toEqual(first);
  });

  test('呼んだ後も止めた島を描き直さない (M21-10): 描き先は別の描き先で、その後のフレームは canvas へ描かない', async ({ page }) => {
    await openPaused(page, '/?paused=1');
    await selectCell(page);
    await expect.poll(() => drawsOver(page, 20), { timeout: 15_000 }).toBe(0);
    await page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.scene?.pinMask());
    expect(await drawsOver(page, 30)).toBe(0);
  });
});
