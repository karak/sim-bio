import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';
import { openPaused, shownTick } from '../driver/island';

/**
 * 同じ tick の別の島でも、地形を作り直す (M26-05)。
 * 描き直しを tick だけで決めていたので、年 0 で新しい島を押す・今と同じ tick の枠やファイルを読むと、前の島の地形が残った。
 * 地形は __probe.scene.terrainDigest() (載せている頂点の高さの要約) で読む
 */
const digest = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe: Probe }).__probe.scene?.terrainDigest() ?? null);

const answer = (page: Page) => page.getByRole('alertdialog').locator('.confirm-ok').click();

/** 保存のファイルを取り、標高の並びを逆にした (同じ tick の別の) 島のファイルにする */
async function reversedIslandFile(page: Page): Promise<Buffer> {
  const download = page.waitForEvent('download');
  await page.click('#save-btn');
  const raw = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as { save: { elevation: number[] } };
  raw.save.elevation.reverse();
  return Buffer.from(JSON.stringify(raw));
}

test('M26-05: 年 0 で別の島を読み、新しい島を押しても、枠を読んでも、同じ tick のまま地形が替わる', async ({ page }) => {
  await openPaused(page, '/?paused=1');
  const original = await digest(page);
  expect(original).not.toBeNull();

  // 同じ tick (0) の別の島をファイルから読む
  const file = await reversedIslandFile(page);
  await page.locator('#load-input').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: file });
  await answer(page);
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(original);
  expect(await shownTick(page)).toBe(0);
  const other = await digest(page);

  // 別の島を枠 1 に置く
  await page.selectOption('#slot-select', 'manual-1');
  await page.click('#slot-save');
  await expect(page.locator('#slot-select option[value="manual-1"]')).toHaveText('枠 1 · Year 0');

  // 年 0 で新しい島 (同じ tick 0) を押すと、新しい seed の別の地形になる (M26-10)
  await page.click('#new-island');
  await answer(page);
  // M26-10: 自由モードの新しい島は新しい seed を引くので、元の島 (seed 42) には戻らず、読んだ別の島とも違う島になる
  await expect.poll(() => digest(page), { timeout: 15_000 }).not.toBe(other);
  expect(await shownTick(page)).toBe(0);

  // 同じ tick の枠を読むと、別の島の地形になる
  await page.click('#slot-load');
  await answer(page);
  await expect.poll(() => digest(page), { timeout: 15_000 }).toBe(other);
  expect(await shownTick(page)).toBe(0);
});
