// M21-03 の審査台の画 (使い捨て。tests/e2e には入れない)。迎撃の塔を UI と同じ手 (放流のチップと島のクリック・勅令の札・星を砕け) で
// 想定解 1 (儀式 2 年ごと、星に届いたら止めよ、星が見えたら再開せよ、砕いたら止めよ) を流し、a〜e を撮る。
// 星の窓の外の画 (b) を撮るため、止めよは星に届いた次の年 (工事の行が出る年) に出す (tests/slow の想定解 1 より 1 年遅い)
import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Probe } from '../../../../src/dev/probe';
import type { Selection } from '../../../../tests/driver/camera';

const OUT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(OUT, '..');
const YEAR = 360;
/** intercept-tower の集落 (size 64 の 1770 = x 42, y 27) */
const HOME = { x: 1770 % 64, y: Math.floor(1770 / 64) };

const advanceTo = (page: Page, tick: number) => page.evaluate((t) => (window as unknown as { __probe: Probe }).__probe.advanceTo(t), tick);
const selection = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __probe?: Probe }).__probe?.scene?.selection() ?? null) as Selection | null);
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT_DIR, `m21-03-${name}.png`), fullPage: true });

/** 集落に最も近いセルに当たる画面の点を探す (チップを持たずにクリックするとセルが選ばれ、__probe.scene.selection().cell で読める) */
async function findHome(page: Page) {
  const box = await page.locator('#scene').boundingBox();
  if (!box) throw new Error('canvas not found');
  let best = { d: Infinity, x: 0, y: 0, cell: -1 };
  const probe = async (x: number, y: number) => {
    // 板・札の上は押さない (石板の札を押すと別の画面へ行く)。画面の点の一番上が島の canvas のときだけ
    const onScene = await page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.id === 'scene', [x, y]);
    if (!onScene) return;
    await page.mouse.click(x, y);
    const c = (await selection(page))?.cell;
    if (c == null) return;
    const d = Math.hypot((c % 64) - HOME.x, Math.floor(c / 64) - HOME.y);
    if (d < best.d) best = { d, x, y, cell: c };
  };
  for (let fy = 0.1; fy <= 0.95; fy += 0.05) for (let fx = 0.1; fx <= 0.95; fx += 0.05) await probe(box.x + box.width * fx, box.y + box.height * fy);
  // 山登り: 一番近い点の周りを細かく探す
  for (const step of [24, 12, 6, 3]) {
    for (let k = 0; k < 6 && best.d > 0; k++) {
      const { x, y } = best;
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step], [step, step], [-step, -step], [step, -step], [-step, step]]) await probe(x + dx, y + dy);
    }
  }
  return best;
}

test('M21-03 迎撃の塔 (見える星) の画 a〜e', async ({ page }) => {
  await page.goto('/?scenario=intercept-tower&dev=1&paused=1');
  await page.waitForFunction(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
  // (a) 石板の予言
  await expect(page.locator('#tablet-prophecy')).toContainText('星は二度落ちる');
  await shot(page, 'a');

  // 集落 (北寄り) が石板の板の下に隠れるので、島を右ドラッグで手前 (画面の下) へずらしてから探す
  await page.mouse.move(700, 560);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(700, 760, { steps: 10 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1500);
  const home = await findHome(page);
  console.log(`home click ${JSON.stringify(home)}`);
  expect(home.d).toBeLessThanOrEqual(2);
  const civText = () => page.locator('#hud-civ').textContent();
  const next = () => page.locator('#intercept-next').textContent();
  const grass = async () => {
    await page.click('#spawn-grass');
    await page.mouse.click(home.x, home.y);
    await expect(page.locator('#spawn-grass')).not.toHaveClass(/armed/);
  };
  let tookB = false;
  let tookC = false;
  let tookD = false;
  let firedYear = -1;
  for (let y = 0; y <= 110; y++) {
    await advanceTo(page, y * YEAR);
    await page.waitForTimeout(50);
    if (await page.locator('#verdict').isVisible()) break;
    if (y % 2 === 0) await grass();
    const civ = (await civText()) ?? '';
    const star = civ.includes('星(7)');
    const stopped = civ.includes('採掘 止');
    const worksShown = await page.locator('#hud-works').isVisible();
    const nx = worksShown ? ((await next()) ?? '') : '';
    if (star && worksShown) {
      if (nx.includes('見えている')) {
        if (stopped) await page.click('#edict-resume');
        if (!tookC && y >= 52) {
          await expect(page.locator('#tablet-warnings')).toContainText('星が見えている');
          await shot(page, 'c');
          tookC = true;
        }
        const btn = page.locator('#intercept-btn');
        if (!(await btn.getAttribute('class'))?.includes('unaffordable')) {
          await btn.click();
          if (firedYear < 0) firedYear = y;
        }
      } else if (nx.includes('まだ見えない') && !stopped) {
        if (!tookB) {
          await expect(page.locator('#tablet-warnings')).toContainText('灯に焚かれ');
          await shot(page, 'b');
          tookB = true;
        }
        await page.click('#edict-stop');
      }
    }
    if (!tookD && firedYear >= 0 && y === firedYear + 1) {
      await expect(page.locator('#tablet-timeline')).toContainText('星が砕けた');
      // 年表を開いて撮り、閉じ戻す (開いたままだと石板の板が伸びて後の画が隠れる)
      await page.click('#tablet-timeline-summary');
      await expect(page.locator('#tablet-timeline')).toBeVisible();
      await shot(page, 'd');
      await page.click('#tablet-timeline-summary');
      tookD = true;
    }
  }
  await expect(page.locator('#verdict')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#verdict-reason')).toContainText('星を 2 回砕いた');
  await shot(page, 'e');
  expect([tookB, tookC, tookD]).toEqual([true, true, true]);
});
