import type { Page } from '@playwright/test';

/** 1 コマの長さ (ms)。60 fps */
const FRAME_MS = 1000 / 60;

type Frames = { step(n: number): void; realFrames(on: boolean): void };
type Host = { __frames: Frames };

/**
 * ページの時計を手で進める (goto の前に呼ぶ)。performance.now と requestAnimationFrame を差し替え、stepFrames(n) が n コマだけ
 * 1/60 秒ずつ進める。観察画面は dt が壁時計で個体が実時間で歩くので、?clock= で止めると個体が出入りの途中で固まる。
 * コマを数えて進めれば、同じ手順で同じ画になる。保存・素材の読み込み (fetch・画像・Promise) は時計に依らず進む。
 */
export async function installFrames(page: Page): Promise<void> {
  await page.addInitScript((frameMs) => {
    let now = 0;
    let next = 0;
    let queue = new Map<number, FrameRequestCallback>();
    const real = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    const manual = (cb: FrameRequestCallback) => {
      queue.set(++next, cb);
      return next;
    };
    const manualCancel = (h: number) => void queue.delete(h);
    Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
    window.requestAnimationFrame = manual;
    window.cancelAnimationFrame = manualCancel;
    const api: Frames = {
      step(n) {
        for (let i = 0; i < n; i++) {
          now += frameMs;
          const due = queue;
          queue = new Map();
          for (const cb of due.values()) cb(now);
        }
      },
      // 撮る間だけ本物の rAF に戻す (Playwright の撮影は画面の更新を待つ)。ためたコールバックは触らない
      realFrames(on) {
        window.requestAnimationFrame = on ? real : manual;
        window.cancelAnimationFrame = on ? realCancel : manualCancel;
      },
    };
    Object.defineProperty(window, '__frames', { value: api });
  }, FRAME_MS);
}

export const stepFrames = (page: Page, n: number) => page.evaluate((count) => (window as unknown as Host).__frames.step(count), n);

/** fn (撮影) の間だけ、ページの rAF を本物にする */
export async function withRealFrames<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  await page.evaluate(() => (window as unknown as Host).__frames.realFrames(true));
  try {
    return await fn();
  } finally {
    await page.evaluate(() => (window as unknown as Host).__frames.realFrames(false));
  }
}
