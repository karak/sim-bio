import { expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';
import { advanceTo } from './island';
import { installFrames, stepFrames } from './frames';

/** 観察画面の撮る視点 (tools/bench-observe.ts の 6 画から 3 つ。src/observe/view.ts の presets と同じ距離・高さ・向き) */
export const OBSERVE_VIEWS = ['集落', '群れ', '海岸'] as const;
export type ObserveView = (typeof OBSERVE_VIEWS)[number];

/** 空の舟の 10 年目の春 (1 年 = 360 tick)。集落があり、鹿が群れている */
export const OBSERVE_TICK = 3600;
/** 入ってから個体が区域へ歩き入るまでに進めるコマ (5 秒) */
const WARM_FRAMES = 300;
/** 視点を寄せてからカメラが落ち着くまでに進めるコマ */
const SETTLE_FRAMES = 90;

type Marks = { center: { x: number; z: number }; coast: { x: number; z: number } };

/** 止めた空の舟を OBSERVE_TICK まで進め、観察画面に入る。freeze で本体の時間を、dynres=0 で解像度の自動調整を、auto=0 で自動カメラを切る */
export async function enterObserve(page: Page) {
  await installFrames(page);
  await page.goto('/?scenario=sky-ship&paused=1&freeze=1&dynres=0&auto=0');
  // 島の最初の 1 コマは手で進める (Playwright の待ちも rAF を使うので、待つ間にコマを進めておく)
  await expect
    .poll(async () => {
      await stepFrames(page, 1);
      return page.evaluate(() => '__probe' in window && document.querySelector('#speed-0.on') !== null);
    })
    .toBe(true);
  await advanceTo(page, OBSERVE_TICK);
  await stepFrames(page, 1);
  await page.getByRole('button', { name: '3D で見る' }).click();
  // 素材は観察画面の start の前に読み終わる。start の後の帯が書かれたら、コマはまだ 1 つも進んでいない
  await expect(page.getByRole('toolbar', { name: '観察画面' }).locator('.o-live b')).toHaveText('一時停止中');
  await stepFrames(page, WARM_FRAMES);
}

/** 視点へ寄せ、カメラが落ち着くまでコマを進める */
export async function lookFrom(page: Page, view: ObserveView) {
  await page.evaluate((v) => {
    const o = (window as unknown as { __probe: Probe }).__probe.observe;
    if (!o) throw new Error('観察画面に入っていない');
    const marks = o.debug()?.marks as Marks | undefined;
    if (!marks) throw new Error('観察画面の目印が読めない (コマが進んでいない)');
    if (v === '集落') o.look(marks.center, 30, 10, 1.9);
    else if (v === '群れ') o.look('deer', 14, 2.6, 0.6);
    else o.look(marks.coast, 55, 24, 3.6);
  }, view);
  await stepFrames(page, SETTLE_FRAMES);
}
