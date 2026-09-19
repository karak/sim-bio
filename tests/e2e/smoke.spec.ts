import { test, expect } from '@playwright/test';

test('boots, advances a year at 100x, graph shows values, layer switch works', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click('#speed-100');
  await expect(page.locator('#hud-year')).not.toHaveText('Year 0', { timeout: 20_000 });
  await expect(page.locator('#stat-veg')).not.toHaveText('--%');
  await page.click('#layer-temperature');
  await expect(page.locator('#layer-temperature')).toHaveClass(/on/);
  const summaries = logs.filter((l) => l.includes('"event":"sim.tick.summary"'));
  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(JSON.parse(summaries[0])).toMatchObject({ event: 'sim.tick.summary', year: 1 });
});
