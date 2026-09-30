import { test, expect } from '@playwright/test';
const OUT = process.env.PROBE_OUT!;
const variants: Record<string, string> = {
  base: '',
  geo: '* { text-rendering: geometricPrecision !important; }',
  aa: '* { -webkit-font-smoothing: antialiased !important; }',
  weight: '.confirm-message { font-weight: 500 !important; }',
  shift2: '.confirm-box { transform: translateX(2px); }',
  color: '.confirm-message { color: #b9c6bd !important; }',
};
test('font drift proxies on confirm dialog', async ({ page }) => {
  await page.route('**/api/**', (r) => r.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  await page.click('#new-island');
  const d = page.getByRole('alertdialog');
  await expect(d).toBeVisible();
  const clip = (await page.locator('.confirm-box').boundingBox())!;
  const box = { x: clip.x - 8, y: clip.y - 8, width: clip.width + 16, height: clip.height + 16 };
  for (const [k, css] of Object.entries(variants)) {
    const h = css ? await page.addStyleTag({ content: css }) : null;
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/drift-${k}.png`, clip: box });
    if (h) await h.evaluate((e) => e.remove());
  }
  await page.locator('.confirm-message').evaluate((e) => (e.textContent = e.textContent!.replace('捨てて', '捨て て')));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/drift-char.png`, clip: box });
});
