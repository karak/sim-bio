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

test('species palette: pick a species and click the island to spawn it', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await page.goto('/');
  await expect(page.locator('#spawn-forest')).toBeVisible();
  await page.click('#spawn-forest');
  await expect(page.locator('#spawn-forest')).toHaveClass(/armed/);
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#spawn-forest')).not.toHaveClass(/armed/);
  await expect
    .poll(() => logs.filter((l) => l.includes('"event":"cmd.received"') && l.includes('"type":"spawn_species"')).length)
    .toBeGreaterThan(0);
  expect(logs.filter((l) => l.includes('"event":"cmd.rejected"'))).toHaveLength(0);
});

test('clicking the island opens the cell panel with a local time series', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#cell-panel')).toBeHidden();
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.55);
  await expect(page.locator('#cell-panel')).toBeVisible();
  await expect(page.locator('#local-graph')).toBeVisible();
  await expect(page.locator('#cell-info')).toContainText('セル (');
});

test('stone tablet: ?scenario=sinking shows the prophecy and counts years', async ({ page }) => {
  await page.goto('/?scenario=sinking');
  await expect(page.locator('#tablet-title')).toContainText('沈む欠片');
  await expect(page.locator('#tablet-prophecy')).toContainText('百年');
  await expect(page.locator('#tablet-year')).toHaveText('0 / 100 年');
  await page.click('#speed-100');
  await expect(page.locator('#tablet-year')).not.toHaveText('0 / 100 年', { timeout: 20_000 });
  await expect(page.locator('#verdict')).toBeHidden();
});

test('stone tablet: verdict overlay appears and stops the clock', async ({ page }) => {
  await page.goto('/?scenario=test-quick');
  await page.click('#speed-100');
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#verdict-title')).toHaveText('島は滅びた');
  const y = await page.locator('#hud-year').textContent();
  await page.waitForTimeout(1500);
  expect(await page.locator('#hud-year').textContent()).toBe(y);
});

test('free mode has the selector but no prophecy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#tablet-select')).toBeVisible();
  await expect(page.locator('#tablet-title')).toHaveCount(0);
});
