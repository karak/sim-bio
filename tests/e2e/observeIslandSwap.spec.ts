import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';
import { openPaused, shownTick } from '../driver/island';

/**
 * 島を入れ替えたあとの「3D で見る」は、新しい島を見せる (M26-07)。
 * 観察画面は一度だけ組み、更新を tick の変化だけで決めていたので、同じ tick (0) の別の島を読むと、最初の島が出た。
 * 地形は __probe.observe.terrainDigest() (観察画面が載せている頂点の高さの要約) で読む
 */
const digest = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.observe?.terrainDigest() ?? null);

const answer = (page: Page) => page.getByRole('alertdialog').locator('.confirm-ok').click();

async function enter3d(page: Page) {
  await page.getByRole('button', { name: '3D で見る' }).click();
  await expect(page.locator('#observe-layer')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => digest(page), { timeout: 90_000 }).not.toBeNull();
}

async function leave3d(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.locator('#observe-layer')).toBeHidden();
}

/** 保存のファイルを取り、標高の並びを逆にした (同じ tick の別の) 島のファイルにする */
async function reversedIslandFile(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.click('#save-btn');
  const raw = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as { save: { elevation: number[] } };
  raw.save.elevation.reverse();
  return Buffer.from(JSON.stringify(raw));
}

test('M26-07: 3D を一度見たあと、同じ tick の別の島を読んでも、新しい島を押しても、3D で見ると新しい島になる', async ({ page }) => {
  test.setTimeout(240_000);
  await openPaused(page, '/?paused=1');
  await enter3d(page);
  const first = await digest(page);
  await leave3d(page);

  // 同じ tick (0) の別の島をファイルから読む
  const file = await reversedIslandFile(page);
  await page.locator('#load-input').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: file });
  await answer(page);
  await expect.poll(() => shownTick(page), { timeout: 15_000 }).toBe(0);
  await enter3d(page);
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(first);
  const other = await digest(page);
  await leave3d(page);

  // 年 0 で新しい島を押す (M26-10: 新しい seed を引く)
  await page.click('#new-island');
  await answer(page);
  await enter3d(page);
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(other);
  const fresh = await digest(page);
  await leave3d(page);

  // 島を替えていなければ、3D を出入りしても組み直さない (同じ島の地形のまま)
  await page.evaluate(() => document.querySelector('#observe-layer canvas')!.setAttribute('data-built', 'yes'));
  await enter3d(page);
  expect(await digest(page)).toBe(fresh);
  await expect(page.locator('#observe-layer canvas[data-built="yes"]')).toHaveCount(1);
});
