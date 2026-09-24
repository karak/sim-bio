#!/usr/bin/env node
/**
 * 観察画面の計測の台 (M23-01、docs/design/2026-09-24-observe-perf.md)。
 * 試作のページ (observe.html、空の舟 25 年目・朝・時間を止める・舟は肋材の段) を Playwright で開き、
 * 寄せ先の 6 画 (集落・船台・群れ・林・狼・海岸) を順に押して、__observeStats (三角形・draw call・fps) と
 * __observeBreakdown() (区分ごとの内訳) を JSON に書く。軽量化の各チケットの前後の比較に使う (比べるのは tools/bench-observe-compare.ts)。
 *
 * 使い方:
 *   npm run bench:observe                                  # .bench/observe-<日時>.json に書く
 *   npm run bench:observe -- --out /path/to/before.json
 *   npm run bench:observe -- --url http://localhost:5181   # 動いている Vite を使う (無ければ自分で 5331 番から空きを探して立てる)
 *   その他: --settle <ms> (押してから測り始めるまで、既定 2500)、--samples <回> (fps を平均する回数、既定 4)、--dpr <倍> (既定 1)、--headed、--vsync (fps を 60 で頭打ちにする。既定は上限なし)
 *   (M23-07) --size <幅>x<高さ> (既定 1280x720)、--params <指定> (ページの URL に足す。例 "air=0&bloom=0"。パスを切った前後の fps の差でパスの重さを見る)
 *
 * 測りは 2 回に分ける。
 * 1. 三角形・draw call・内訳: ページの performance.now と requestAnimationFrame を台のものに差し替え、1 コマ 1/60 s で決まったコマ数だけ進める。
 *    時刻を止めても動物は歩き続け (観察の層の個体は実時間で動く)、近い個体の骨入りや木の段が変わるので、実時間のままだと画ごとに数千三角形揺れる。
 *    コマを台が進めれば同じ条件で毎回同じ値になる。
 *    (Playwright の page.clock では揃わなかった: ページごとに performance.now の起点が数 ms ずれ、最初のコマの dt が変わって個体の状態が分かれる)
 * 2. fps: ページを開き直して実時間で回り、画ごとに何回か読んで平均する。同じ GPU で別の作業の画面が動いていると揺れるので、幅を残して読む。
 * e2e (playwright.config.ts の tests/e2e) とは別の台で、npm run test:e2e では走らない。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { summarizeBench, type BenchBreakdownRow, type BenchResult, type BenchShot } from './bench-observe-compare.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 寄せ先の 6 画 (src/observe/view.ts の presets と同じ名前・順) */
const SHOTS = ['集落', '船台', '群れ', '林', '狼', '海岸'] as const;
/** 空の舟 25 年目の保存を、朝 (time=0.12) で時刻と本体を止め (freeze=1)、舟を肋材の段 (ship=60) にし、自動カメラを切る (auto=0) */
const PAGE = '/observe.html?time=0.12&freeze=1&ship=60&auto=0';
const VIEWPORT = { width: 1280, height: 720 };
/** 1 コマの長さ (ms)。台がコマを進めるときの performance.now の刻み */
const FRAME_MS = 1000 / 60;
/** 描き始めてから最初の画を押すまでに進める時間 (ms) */
const WARMUP_MS = 3000;
/** __observeStats は 0.5 s ごとに更新されるので、それより少し長く間を空けて別の窓を拾う */
const SAMPLE_GAP_MS = 600;

/**
 * ページの時計を台のものに差し替える (ページの読み込みの前に入れる)。performance.now は台が進めるまで止まり、
 * requestAnimationFrame はためておいて __benchStep(コマ数) で 1 コマずつ呼ぶ。観察画面が時間に使うのはこの 2 つだけ
 * (src/observe の view.ts・render/instancer.ts)。保存・素材の読み込み (fetch・画像) は時計に依らず進む
 */
function installFrameStepper(frameMs: number): void {
  let now = 0;
  let next = 0;
  let queue = new Map<number, FrameRequestCallback>();
  Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
  window.requestAnimationFrame = (cb) => {
    queue.set(++next, cb);
    return next;
  };
  window.cancelAnimationFrame = (h) => void queue.delete(h);
  (window as unknown as { __benchStep: (frames: number) => void }).__benchStep = (frames) => {
    for (let i = 0; i < frames; i++) {
      now += frameMs;
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) cb(now);
    }
  };
}

/** 手元の時刻の ISO 表記 (作業ログの日付と揃える。例 2026-09-24T08:54:18+09:00) */
function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19)}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

type Stats = { calls: number; triangles: number; fps: number; camera: string; at: number[]; assets: Record<string, boolean> };
type Opt = ReturnType<typeof parseArgs>;

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stamp = localIso(new Date()).slice(0, 19).replace(/:/g, '-');
  return {
    out: resolve(get('out') ?? resolve(root, '.bench', `observe-${stamp}.json`)),
    url: get('url'),
    port: Number(get('port') ?? 5331),
    settleMs: Number(get('settle') ?? 2500),
    samples: Math.max(1, Number(get('samples') ?? 4)),
    dpr: Number(get('dpr') ?? 1),
    headed: argv.includes('--headed'),
    vsync: argv.includes('--vsync'),
    // (M23-07) 画面の大きさ・足す指定
    viewport: parseSize(get('size') ?? `${VIEWPORT.width}x${VIEWPORT.height}`),
    params: get('params') ?? '',
  };
}

function parseSize(v: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(v);
  if (!m) throw new Error(`--size は <幅>x<高さ> (例 2560x1440): ${v}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

function commit(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).toString().trim() !== '';
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

const readStats = (page: Page) => page.evaluate(() => (window as unknown as { __observeStats?: Stats }).__observeStats ?? null);
const readBreakdown = (page: Page) => page.evaluate(() => (window as unknown as { __observeBreakdown: () => Record<string, BenchBreakdownRow> }).__observeBreakdown());
const press = (page: Page, name: string) => page.locator('#shots').getByRole('button', { name, exact: true }).click();
const assetsReady = (st: Stats | null) => !!st && Object.values(st.assets).every(Boolean);

async function openPage(browser: Browser, opt: Opt, url: string, errors: string[], fixedClock: boolean): Promise<Page> {
  // (M23-07 で変更: 画面の大きさは --size)
  const context = await browser.newContext({ viewport: opt.viewport, deviceScaleFactor: opt.dpr });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  if (fixedClock) await page.addInitScript(installFrameStepper, FRAME_MS);
  await page.goto(url);
  return page;
}

/** 台の時計で ms だけ進める (1 回の evaluate が長くならないよう、30 コマずつ) */
async function runFor(page: Page, ms: number): Promise<void> {
  for (let left = Math.round(ms / FRAME_MS); left > 0; left -= 30) {
    await page.evaluate((n) => (window as unknown as { __benchStep: (frames: number) => void }).__benchStep(n), Math.min(30, left));
  }
}

/** 1. 台の時計で三角形・draw call・内訳を測る */
async function measureFixed(browser: Browser, opt: Opt, url: string, errors: string[]) {
  const page = await openPage(browser, opt, url, errors, true);
  // 素材が揃って組み上がるまでは実時間で待つ (観察画面は素材を全部読んでから rAF を回し始め、組み上がると #status を空にする)。
  // 時計は止めてあるので、待ちの長さに依らず、描き始めからのコマ数は WARMUP_MS で決まる
  const deadline = Date.now() + 180_000;
  // (#status は読み込みの前も空なので、組み上がりの最後に置かれる __observeBreakdown が出たことも見る)
  while (!(await page.evaluate(() => document.getElementById('status')?.textContent === '' && typeof (window as unknown as { __observeBreakdown?: unknown }).__observeBreakdown === 'function'))) {
    if (Date.now() > deadline) throw new Error('観察画面が組み上がらない');
    await page.waitForTimeout(250);
  }
  await runFor(page, WARMUP_MS);
  const st0 = await readStats(page);
  if (!assetsReady(st0)) throw new Error(`素材が揃っていない: ${JSON.stringify(st0?.assets)}`);
  const out: Record<string, Pick<BenchShot, 'calls' | 'triangles' | 'camera' | 'at' | 'breakdown'> & { samples: { calls: number[]; triangles: number[] } }> = {};
  for (const name of SHOTS) {
    await press(page, name);
    await runFor(page, opt.settleMs);
    const samples = { calls: [] as number[], triangles: [] as number[] };
    let last: Stats | null = null;
    for (let i = 0; i < opt.samples; i++) {
      if (i > 0) await runFor(page, SAMPLE_GAP_MS);
      last = (await readStats(page))!;
      samples.calls.push(last.calls);
      samples.triangles.push(last.triangles);
    }
    out[name] = { calls: last!.calls, triangles: last!.triangles, camera: last!.camera, at: last!.at, breakdown: await readBreakdown(page), samples };
  }
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  await page.context().close();
  return { shots: out, gpu };
}

/** 2. 実時間で fps を測る */
async function measureFps(browser: Browser, opt: Opt, url: string, errors: string[]) {
  const page = await openPage(browser, opt, url, errors, false);
  await page.waitForFunction(() => {
    const st = (window as unknown as { __observeStats?: Stats }).__observeStats;
    return !!st && Object.values(st.assets).every(Boolean);
  }, undefined, { timeout: 180_000, polling: 250 });
  const out: Record<string, number[]> = {};
  for (const name of SHOTS) {
    await press(page, name);
    await page.waitForTimeout(opt.settleMs);
    const fps: number[] = [];
    for (let i = 0; i < opt.samples; i++) {
      if (i > 0) await page.waitForTimeout(SAMPLE_GAP_MS);
      fps.push((await readStats(page))!.fps);
    }
    out[name] = fps;
  }
  await page.context().close();
  return out;
}

async function main(): Promise<void> {
  const opt = parseArgs(process.argv.slice(2));
  let server: ViteDevServer | null = null;
  let base = opt.url;
  if (!base) {
    // 自分の Vite を立てる (strictPort にしないので、5331 番が塞がっていれば次の空きを使う)
    server = await createServer({ root, logLevel: 'warn', server: { port: opt.port, strictPort: false, host: '127.0.0.1' } });
    await server.listen();
    base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('Vite の URL が取れない');
  }
  // (M23-07 で変更: --params をページの URL に足す)
  const url = base.replace(/\/$/, '') + PAGE + (opt.params ? `&${opt.params}` : '');
  console.log(`開く: ${url}`);
  // 自分のブラウザを立てる (ほかの作業のページには触れない)。GPU で描くよう、headless shell ではなく Chromium 本体の新しい headless を使う
  // headless の rAF は 60 で頭打ちになり、60 より上の伸びが見えないので、既定で垂直同期とコマの上限を外す (--vsync で戻す)
  const uncap = opt.vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
  const browser = await chromium.launch({ headless: !opt.headed, channel: 'chromium', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...uncap] });
  const errors: string[] = [];
  try {
    const fixed = await measureFixed(browser, opt, url, errors);
    const fpsBy = await measureFps(browser, opt, url, errors);
    const shots: BenchShot[] = SHOTS.map((name) => {
      const f = fixed.shots[name];
      const fps = fpsBy[name];
      return { name, calls: f.calls, triangles: f.triangles, fps: +(fps.reduce((a, b) => a + b, 0) / fps.length).toFixed(1), samples: { ...f.samples, fps }, camera: f.camera, at: f.at, breakdown: f.breakdown };
    });
    for (const s of shots) {
      const steady = new Set(s.samples.triangles).size === 1 && new Set(s.samples.calls).size === 1 ? '' : ` (測りの間に動物が歩いて変わった: ${s.samples.triangles.join(' / ')})`;
      console.log(`${s.name}: 三角形 ${(s.triangles / 1000).toFixed(1)} 千 · draw call ${s.calls} · ${s.fps.toFixed(1)} fps (${s.samples.fps.join(' / ')})${steady}`);
    }
    const result: BenchResult = {
      meta: {
        date: localIso(new Date()),
        commit: commit(),
        url: PAGE,
        viewport: { ...opt.viewport, deviceScaleFactor: opt.dpr },
        ...(opt.params ? { params: opt.params } : {}),
        settleMs: opt.settleMs,
        browser: `chromium ${browser.version()}${opt.headed ? ' headed' : ' headless'}${opt.vsync ? ' vsync' : ' 上限なし'}`,
        gpu: fixed.gpu,
        note: '三角形・draw call・内訳は台の時計 (1 コマ 1/60 s を台が進める) で測り、同じ条件なら毎回同じ。fps は開き直して実時間で測り、同じ GPU で別の作業の画面が動いていると揺れる',
      },
      shots,
    };
    mkdirSync(dirname(opt.out), { recursive: true });
    writeFileSync(opt.out, JSON.stringify(result, null, 2) + '\n');
    console.log('');
    console.log(summarizeBench(result));
    console.log('');
    console.log(`書いた: ${opt.out}`);
    if (errors.length) console.warn(`ページのエラー ${errors.length} 件: ${errors.slice(0, 3).join(' / ')}`);
  } finally {
    await browser.close();
    await server?.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
