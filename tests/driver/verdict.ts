import { expect, type Page } from '@playwright/test';

/**
 * 島を判定まで回す。title があれば判定の題で、なければ判定の板が見えるまで待つ
 */
export async function playToVerdict(page: Page, path: string, opts: { speed: 100 | 1000; title?: string; timeoutMs: number }) {
  await page.goto(path);
  await expect(page.locator('#hud-year')).toHaveText('Year 0');
  await page.click(`#speed-${opts.speed}`);
  if (opts.title === undefined) await expect(page.locator('#verdict')).toBeVisible({ timeout: opts.timeoutMs });
  else await expect(page.locator('#verdict-title')).toHaveText(opts.title, { timeout: opts.timeoutMs });
}

/** 石板を 100 倍速で判定まで回す */
export const playScenarioToVerdict = (page: Page, scenario: string, title?: string) => playToVerdict(page, `/?scenario=${scenario}`, { speed: 100, title, timeoutMs: 90_000 });
