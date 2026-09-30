import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const OUT = process.env.PROBE_OUT!;
test('text occlusion probe: every text glyph box sampled at 5 points', async ({ page }) => {
  await page.route('**/api/**', (r) => r.abort('failed'));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-0');
  const box = (await page.locator('#scene').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-info')).toContainText(/^セル/);
  const covered = await page.evaluate(() => {
    const out: { text: string; by: string; owner: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent!.trim(); if (!t) continue;
      const owner = n.parentElement!; const cs = getComputedStyle(owner);
      if (cs.visibility === 'hidden') continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width === 0) continue;
        const pts = [[r.left + 1, r.top + r.height / 2], [r.right - 1, r.top + r.height / 2], [r.left + r.width / 2, r.top + 1], [r.left + r.width / 2, r.bottom - 1], [r.left + r.width / 2, r.top + r.height / 2]];
        for (const [x, y] of pts) {
          const hit = document.elementFromPoint(x, y);
          if (hit && !owner.contains(hit) && !hit.contains(owner)) { out.push({ text: t.slice(0, 20), by: `${hit.tagName}#${hit.id}.${hit.className}`, owner: `${owner.tagName}#${owner.id}` }); break; }
        }
      }
    }
    return out;
  });
  writeFileSync(`${OUT}/occlusion.json`, JSON.stringify(covered, null, 1));
  const tab = await page.getByRole('button', { name: /^港を開く/ }).boundingBox();
  const info = await page.locator('#cell-info').boundingBox();
  writeFileSync(`${OUT}/occlusion-boxes.json`, JSON.stringify({ tab, info }));
});
