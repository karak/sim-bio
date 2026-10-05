import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const OUT = process.env.PROBE_OUT!;
const RUN = process.env.PROBE_RUN ?? '0';

async function freeMode(page: Page) {
  await page.route('**/api/**', (r) => r.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await page.waitForTimeout(1500);
}

test('free mode page twice (same page) and dialog clip', async ({ page }) => {
  await freeMode(page);
  await page.screenshot({ path: `${OUT}/free-r${RUN}-a.png` });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/free-r${RUN}-b.png` });
  await page.click('#new-island');
  const d = page.getByRole('alertdialog');
  await expect(d).toBeVisible();
  await d.screenshot({ path: `${OUT}/dialog-r${RUN}.png` });
});

test('selected cell pin: default motion vs reduced', async ({ browser }) => {
  for (const motion of ['no-preference', 'reduce'] as const) {
    const ctx = await browser.newContext({ reducedMotion: motion });
    const page = await ctx.newPage();
    await freeMode(page);
    const box = (await page.locator('#scene').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
    await expect(page.locator('#cell-info')).toContainText(/^セル/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/pin-${motion}-r${RUN}-a.png` });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/pin-${motion}-r${RUN}-b.png` });
    await ctx.close();
  }
});

test('readability probe on free mode + confirm dialog', async ({ page }) => {
  await freeMode(page);
  await page.click('#new-island');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  const els = await page.evaluate(() => {
    const out: unknown[] = [];
    const all = document.querySelectorAll('body *');
    for (const el of Array.from(all)) {
      const h = el as HTMLElement;
      const own = Array.from(h.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
      if (!own) continue;
      const cs = getComputedStyle(h);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = h.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let op = 1; for (let e: HTMLElement | null = h; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      out.push({ tag: h.tagName, id: h.id, cls: h.className, text: h.textContent!.trim().slice(0, 30), color: cs.color, fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, opacity: op,
        box: { x: r.x, y: r.y, w: r.width, h: r.height }, overflowX: h.scrollWidth > h.clientWidth + 1 && cs.overflow !== 'visible', inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight });
    }
    return out;
  });
  writeFileSync(`${OUT}/read-els.json`, JSON.stringify(els, null, 1));
  await page.screenshot({ path: `${OUT}/read-text.png` });
  await page.addStyleTag({ content: '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/read-bg.png` });
});
