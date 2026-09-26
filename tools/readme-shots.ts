#!/usr/bin/env node
/**
 * README のスクリーンショットを撮る台。docs/design/screenshots/ に PNG を書く。
 * 1 枚目は本体の全体俯瞰 (index.html に空の舟 25 年目の保存を読み込ませる)、残りは観察画面 (observe.html) の寄せ先・飛び立ち・夜。
 * 観察画面の画は開発用の表示 (寄せ先のボタン・統計) を隠して撮る。
 *
 * 使い方:
 *   node tools/readme-shots.ts --url http://localhost:5173   # 動いている Vite を指す
 *   その他: --only <名前,...> (例 "05-night,08-rabbit")、--headed
 * e2e (playwright.config.ts の tests/e2e) とは別の台で、npm run test:e2e では走らない。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/design/screenshots');
const SAVE = resolve(root, 'assets/data/observe/sky-ship-y25.json');
const VIEWPORT = { width: 1600, height: 900 };
/** 観察画面の開発用の表示を隠す */
const HIDE_DEV_UI = '#stats, #shots, #status { display: none !important; }';

type Shot = {
  name: string;
  /** index.html か observe.html からのパスと URL の指定 */
  path: string;
  /** 読み込んでから撮るまでの待ち (ms) */
  wait: number;
  /** 読み込み後、待つ前にページへする操作 */
  act?: (page: Page) => Promise<void>;
};

const look = (at: string, dist: number, height: number, yaw: number) => async (page: Page) => {
  await page.waitForTimeout(4000);
  await page.evaluate(
    ([a, d, h, y]) => (window as unknown as { __observeLook: (at: string, d: number, h: number, y: number) => void }).__observeLook(a as string, d as number, h as number, y as number),
    [at, dist, height, yaw],
  );
};

const SHOTS: Shot[] = [
  {
    name: '01-overview',
    path: '/',
    wait: 6000,
    act: async (page) => {
      await page.waitForTimeout(3000);
      await page.setInputFiles('#load-input', SAVE);
      // 島を画面いっぱいに寄せる
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -200);
        await page.waitForTimeout(100);
      }
    },
  },
  { name: '02-settlement', path: '/observe.html?shot=集落&time=0.12&freeze=1', wait: 9000 },
  { name: '03-slipway', path: '/observe.html?shot=船台&time=0.2&freeze=1&ship=100', wait: 9000 },
  // 飛び立ち: 自動カメラが船台の後ろの高い所から、外海へ去る舟を追う (src/observe/view.ts の departCam)
  { name: '04-departure', path: '/observe.html?depart=1&time=0.62&freeze=1', wait: 16000 },
  { name: '05-night', path: '/observe.html?shot=集落&time=0.8&freeze=1', wait: 9000 },
  { name: '06-deer', path: '/observe.html?shot=群れ&time=0.14&freeze=1', wait: 9000 },
  { name: '07-wolf', path: '/observe.html?shot=狼&time=0.25&freeze=1', wait: 9000 },
  { name: '08-rabbit', path: '/observe.html?time=0.18&freeze=1&auto=0', wait: 5000, act: look('rabbit', 3, 0.8, 0.6) },
  { name: '09-grove', path: '/observe.html?shot=林&time=0.3&freeze=1', wait: 9000 },
  { name: '10-coast', path: '/observe.html?shot=海岸&time=0.5&freeze=1', wait: 9000 },
];

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const url = get('url');
  if (!url) throw new Error('--url <Vite の URL> を指定する');
  return { url, only: get('only')?.split(','), headed: argv.includes('--headed') };
}

async function main(): Promise<void> {
  const opt = parseArgs(process.argv.slice(2));
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !opt.headed, channel: 'chromium', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  try {
    for (const shot of SHOTS.filter((s) => !opt.only || opt.only.includes(s.name))) {
      const page = await browser.newPage({ viewport: VIEWPORT });
      page.on('pageerror', (e) => console.error(`[${shot.name}] pageerror: ${e.message}`));
      await page.goto(opt.url + shot.path);
      if (shot.path.startsWith('/observe.html')) await page.addStyleTag({ content: HIDE_DEV_UI });
      await shot.act?.(page);
      await page.waitForTimeout(shot.wait);
      const file = resolve(OUT, `${shot.name}.png`);
      await page.screenshot({ path: file });
      console.log(`wrote ${file}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
