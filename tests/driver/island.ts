import type { Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';

/** assets/data/world.default.json の ticksPerYear。test-quick も上書きしない */
export const TICKS_PER_YEAR = 360;

/** HUD の年と日の文から tick を読む (Day は tick % ticksPerYear) */
export function tickFromHud(yearText: string | null, seasonText: string | null): number {
  const year = Number(yearText?.replace('Year ', ''));
  const day = Number(seasonText?.split('Day ')[1]);
  return year * TICKS_PER_YEAR + day;
}

/** HUD の年と日から今の tick を読む (Day は tick % ticksPerYear) */
export async function shownTick(page: Page): Promise<number> {
  return tickFromHud(await page.locator('#hud-year').textContent(), await page.locator('#hud-season').textContent());
}

/** 止めた島から始める (?paused=1)。口 (__probe) が付き、速さの札が ⏸ になったら、島は tick 0 のまま動いていない */
export async function openPaused(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
}

/** 島を tick N まで進める。速さの札と待ちでは止まる tick が回ごとに違う */
export const advanceTo = (page: Page, tick: number) => page.evaluate((t) => (window as unknown as { __probe: Probe }).__probe.advanceTo(t), tick);
