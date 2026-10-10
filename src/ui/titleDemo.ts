/**
 * タイトルの背景のデモ (M24-01、docs/uiux/2026-10-04-title-flow.md の決めること 1 の案 C)。観察画面で撮った止めた画を 1 枚ずつ、
 * ゆっくりした寄りと横移動で見せる。3D は組まない (三角形・draw call は 0)。操作できず、音も出さない。
 * prefers-reduced-motion なら最初の 1 枚を止めて見せる。最初の画だけをすぐ読み、残りは最初の画が出てから読む
 */
export const TITLE_DEMO_IMAGES: readonly string[] = ['06-deer', '07-wolf', '08-rabbit', '10-coast'].map((n) => `/textures/title/${n}.jpg`);

/** 1 枚を見せる秒。全部で 1 周 (枚数 × この秒) は 60 秒以上 (設計の「カメラの回りは 1 周 60 秒以上」) */
export const SLIDE_SECONDS = 20;
/** 最初の画が出てから残りを読み始めるまで (ms) */
const REST_DELAY_MS = 4000;

/** 止めたときの計測。bytes は画の転送の量 (Resource Timing、手元の cache なら 0 もある) */
export type DemoStats = { images: number; loaded: number; bytes: number; shownMs: number; animations: number };

export type TitleDemo = { readonly host: HTMLElement; stop(): DemoStats };

export function startTitleDemo(opts: { urls?: readonly string[]; reducedMotion: boolean; now?: () => number }): TitleDemo {
  const urls = opts.reducedMotion ? (opts.urls ?? TITLE_DEMO_IMAGES).slice(0, 1) : (opts.urls ?? TITLE_DEMO_IMAGES);
  const now = opts.now ?? (() => performance.now());
  const started = now();
  const host = document.createElement('div');
  host.className = opts.reducedMotion ? 'title-demo still' : 'title-demo';
  host.setAttribute('aria-hidden', 'true');
  host.style.setProperty('--title-cycle', `${urls.length * SLIDE_SECONDS}s`);
  let loaded = 0;
  const imgs = urls.map((url, i) => {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.style.setProperty('--title-delay', `${i * SLIDE_SECONDS}s`);
    img.addEventListener('load', () => (loaded += 1));
    img.dataset.src = url;
    host.append(img);
    return img;
  });
  let restTimer: number | undefined;
  imgs[0].addEventListener(
    'load',
    () => {
      restTimer = window.setTimeout(() => imgs.slice(1).forEach((img) => (img.src = img.dataset.src ?? '')), REST_DELAY_MS);
    },
    { once: true },
  );
  imgs[0].src = urls[0];
  return {
    host,
    stop() {
      window.clearTimeout(restTimer);
      const animations = host.getAnimations({ subtree: true });
      animations.forEach((a) => a.cancel());
      const bytes = performance
        .getEntriesByType('resource')
        .filter((e): e is PerformanceResourceTiming => urls.some((u) => e.name.endsWith(u)))
        .reduce((sum, e) => sum + (e.transferSize || 0), 0);
      // 画の decode した絵を手放す。src を外し、要素ごと DOM から外す
      for (const img of imgs) img.removeAttribute('src');
      host.remove();
      return { images: imgs.length, loaded, bytes, shownMs: Math.round(now() - started), animations: animations.length };
    },
  };
}
