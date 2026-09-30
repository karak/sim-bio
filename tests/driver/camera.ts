import { expect, type Page } from '@playwright/test';
import type { Probe } from '../../src/dev/probe';

export type View = { sea: boolean; cellHidden: boolean; markerHidden: boolean; markerOnScreen: boolean; screen: { x: number; y: number } };
export type Selection = { cell: number | null; size: number; marker: { scale: number } | null; view: View | null; camera: { x: number; y: number; z: number } };

export const selection = (page: Page) =>
  page.evaluate(() => {
    const scene = (window as unknown as { __probe?: Probe }).__probe?.scene;
    return (scene ? scene.selection() : null) as Selection | null;
  });

/** カメラが止まるまで待つ (OrbitControls の damping。低い fps では数秒かかる)。3 回続けて動かなければ止まったとみる */
export async function settle(page: Page) {
  let last = { x: NaN, y: NaN, z: NaN };
  let still = 0;
  await expect
    .poll(
      async () => {
        const c = (await selection(page))?.camera ?? last;
        still = Math.hypot(c.x - last.x, c.y - last.y, c.z - last.z) < 1e-4 ? still + 1 : 0;
        last = c;
        return still >= 3;
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe(true);
}

/**
 * カメラを縦に倒す (度、正で水平へ)。OrbitControls は画面の高さのドラッグで 1 回りする。
 * 角の限り (真上・水平の手前) に当てると余りの回しが後に残るので、限りに当てない角だけを使う。
 * ドラッグを離した所のセルが選ばれる (canvas の click) ので、水平へ倒すときは空 (画面の上の縁) で離し、選んだセルを変えない
 */
export async function tilt(page: Page, box: { x: number; y: number; width: number; height: number }, degrees: number) {
  const x = box.x + box.width * 0.4;
  const top = box.y + 5;
  const d = (box.height * Math.abs(degrees)) / 360;
  const [from, to] = degrees > 0 ? [top + d, top] : [top, top + d];
  await page.mouse.move(x, from);
  await page.mouse.down();
  await page.mouse.move(x, to, { steps: 10 });
  await page.mouse.up();
  await settle(page);
}
