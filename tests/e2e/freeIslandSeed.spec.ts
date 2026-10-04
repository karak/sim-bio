import { test, expect, type Browser, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';
import { advanceTo, openPaused, shownTick } from '../driver/island';

/**
 * 自由モードの「新しい島」は押すたびに新しい seed を引き、HUD の seed と URL の seed= に出す (M26-10)。
 * 石板は seed 42 のまま (seed= は無視して URL から落とす)。地形は __probe.scene.terrainDigest() で読む
 */
const digest = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.scene?.terrainDigest() ?? null);
const answer = (page: Page) => page.getByRole('alertdialog').locator('.confirm-ok').click();
const seedParam = (page: Page) => new URL(page.url()).searchParams.get('seed');

/** 何も戻さない新しい置き場 (IndexedDB が空) で開く */
async function openFresh(browser: Browser, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openPaused(page, path);
  return { context, page };
}

test('M26-10: 新しい島は seed と地形を変え、URL の seed= で開き直すと同じ地形になる。最初の島は seed 42 のまま', async ({ page, browser }) => {
  await openPaused(page, '/?paused=1');
  await expect(page.locator('#hud-seed')).toHaveText('seed 42');
  expect(seedParam(page)).toBeNull();
  const first = await digest(page);
  expect(first).not.toBeNull();

  await page.click('#new-island');
  await answer(page);
  await expect.poll(() => seedParam(page)).toMatch(/^\d+$/);
  const drawn = seedParam(page);
  expect(drawn).not.toBe('42');
  await expect(page.locator('#hud-seed')).toHaveText(`seed ${drawn}`);
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(first);
  const second = await digest(page);

  // 押すたびに引き直す
  await page.click('#new-island');
  await answer(page);
  await expect.poll(() => seedParam(page)).not.toBe(drawn);
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(second);

  // 戻す枠の無い置き場で seed= 付きで開くと、その seed の島
  const reopened = await openFresh(browser, `/?paused=1&seed=${drawn}`);
  await expect(reopened.page.locator('#hud-seed')).toHaveText(`seed ${drawn}`);
  expect(await digest(reopened.page)).toBe(second);
  await reopened.context.close();

  // 自動の続きがあっても、seed= が違えばその seed の新しい島で開く (seed=42 は最初の島と同じ地形)
  await page.goto('/?paused=1&seed=42');
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
  await expect(page.locator('#hud-seed')).toHaveText('seed 42');
  expect(await digest(page)).toBe(first);
});

test('M26-10: 石板の島は seed 42 のまま。seed= は無視して URL から落とし、石板を初めからにしても変わらない', async ({ browser }) => {
  const plain = await openFresh(browser, '/?paused=1&scenario=test-quick');
  const expected = await digest(plain.page);
  await expect(plain.page.locator('#hud-seed')).toHaveText('seed 42');
  await plain.context.close();

  const seeded = await openFresh(browser, '/?paused=1&scenario=test-quick&seed=777');
  await expect(seeded.page.locator('#hud-seed')).toHaveText('seed 42');
  expect(new URL(seeded.page.url()).search).toBe('?paused=1&scenario=test-quick');
  expect(await digest(seeded.page)).toBe(expected);

  await seeded.page.click('#new-island');
  await answer(seeded.page);
  await expect(seeded.page.locator('#hud-seed')).toHaveText('seed 42');
  expect(new URL(seeded.page.url()).search).toBe('?paused=1&scenario=test-quick');
  expect(await digest(seeded.page)).toBe(expected);
  await seeded.context.close();
});

test('M26-10: 同じ seed= で開き直すと自動の続きから戻り、違う seed= なら新しい島 (続きは脇へ退く)', async ({ browser }) => {
  const { context, page } = await openFresh(browser, '/?paused=1&seed=777');
  await advanceTo(page, 400);
  await expect(page.locator('#slot-select option[value="auto"]')).toHaveText('自動 · Year 1');

  await page.goto('/?paused=1&seed=777');
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
  await expect(page.locator('#hud-seed')).toHaveText('seed 777');
  expect(await shownTick(page)).toBeGreaterThan(0);

  await page.goto('/?paused=1&seed=778');
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
  await expect(page.locator('#hud-seed')).toHaveText('seed 778');
  expect(await shownTick(page)).toBe(0);
  await context.close();
});
