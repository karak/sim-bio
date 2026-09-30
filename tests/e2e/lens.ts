import { expect, type Locator, type Page } from '@playwright/test';
import { p10ContrastOver, type Rgb } from './lens/contrast';
import { onScreenFontPx, parseFontPx } from './lens/fontSize';

/**
 * 読みやすさの検査 (M25-01、ADR 0001 段 1)。人が「読める」と判じていたものを、機械の性質に言い換えて撮る前に確かめる。
 * 写す要素の中の文字の箱ごとに、覆われていない (5 点)・画面の内・切れていない・コントラスト比・画面の上の字の大きさを見る。
 * 実の配置は happy-dom では測れないので Playwright でだけ確かめる。計算 (コントラスト・字の大きさ) は lens/ の純粋な関数
 */

export const MIN_CONTRAST = 4.5;
export const MIN_FONT_PX = 11;

/** 横に送ってよい欄 (切れていない検査の許す欄の表)。値は欄の selector */
export const SCROLLS_X_ALLOWED: Record<string, string> = {
  訪問のリンク: 'input[aria-label="訪問のリンク"]',
};

type TextBox = { text: string; x: number; y: number; w: number; h: number; color: string; alpha: number; fontPx: number };
type CanvasFonts = { canvas: string; clientWidth: number; width: number; fonts: { font: string; scale: number }[] };
type Found = { covered: { text: string; by: string }[]; outside: string[]; cut: string[]; boxes: TextBox[]; domFonts: { text: string; px: number }[]; canvases: CanvasFonts[] };

/** canvas の fillText を拾う (canvas の中の字は DOM では読めない)。canvas ごとに font と、そのとき ctx の変換の拡大 (setTransform) を覚える。addInitScript で渡す */
function recordCanvasFonts() {
  const seen: Record<string, Record<string, number>> = {};
  (window as unknown as { __lensCanvasFonts: typeof seen }).__lensCanvasFonts = seen;
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof fill>) {
    (seen[this.canvas.id] ??= {})[this.font] = this.getTransform().a;
    return fill.apply(this, args);
  };
}

/** goto の前に呼ぶ。canvas の字の大きさを見られるようにする */
export const installLens = (page: Page) => page.addInitScript(recordCanvasFonts);

/** 写す要素の中の文字の箱を測る。ブラウザの中で走る。判定の数式は持たず、測った値だけを返す */
function measure(root: Element, allowed: string[]): Found {
  const out: Found = { covered: [], outside: [], cut: [], boxes: [], domFonts: [], canvases: [] };
  const sel = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('class') ? `.${el.getAttribute('class')!.split(' ').join('.')}` : ''}`;
  const rootRect = root.getBoundingClientRect();
  const inside = (r: { left: number; right: number; top: number; bottom: number }, box: DOMRect) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1;

  /**
   * 字の上に載る、押せない (pointer-events: none) 暗い幕 (判定の板の背の幕) があるか。elementFromPoint は幕を素通りするので覆いには出ない。
   * 幕の下の字は操作を受けない札 (押せない札と同じ) として、コントラストの検査から除く。幕の下の石板の字は幕で 2.3 まで暗くなるが、それは判定の板を読ませるための意図の暗さである
   */
  const stackOf = (el: Element) => {
    let z = 0;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') z = Math.max(z, Number(cs.zIndex));
    }
    return z;
  };
  const veilsOver = (owner: Element, rects: DOMRect[]) => {
    const r = rects[0];
    if (!r) return false;
    const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
    return Array.from(document.body.querySelectorAll('*')).some((v) => {
      const cs = getComputedStyle(v);
      if (cs.pointerEvents !== 'none' || v.contains(owner) || owner.contains(v)) return false;
      const alpha = Number(/rgba\([\d.]+, [\d.]+, [\d.]+, ([\d.]+)\)/.exec(cs.backgroundColor)?.[1] ?? 0);
      const vr = v.getBoundingClientRect();
      if (alpha === 0 || cx < vr.left || cx > vr.right || cy < vr.top || cy > vr.bottom) return false;
      return stackOf(v) > stackOf(owner) || (stackOf(v) === stackOf(owner) && Boolean(owner.compareDocumentPosition(v) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
  };

  const consider = (owner: Element, text: string, rects: DOMRect[]) => {
    const cs = getComputedStyle(owner);
    if (cs.visibility === 'hidden') return;
    let opacity = 1;
    for (let e: Element | null = owner; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity === 0) return;
    const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(cs.color);
    const alpha = Number(m?.[4] ?? 1) * opacity;
    const pressable = !owner.closest('button:disabled, [aria-disabled="true"], input:disabled');
    const veiled = veilsOver(owner, rects);
    const label = text.trim().slice(0, 16);
    let ancestors: Element[] = [];
    for (let e: Element | null = owner; e && e !== root.parentElement; e = e.parentElement) ancestors = [...ancestors, e];
    for (const r of rects) {
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) out.outside.push(label);
      if (!inside(r, rootRect)) out.cut.push(`${label} (${sel(owner)} が ${sel(root)} の外へはみ出す)`);
      for (const a of ancestors) {
        const o = getComputedStyle(a);
        if ((o.overflowX !== 'visible' || o.overflowY !== 'visible') && !inside(r, a.getBoundingClientRect())) out.cut.push(`${label} (${sel(a)} に切られる)`);
      }
      const pts = [[r.left + 1, r.top + r.height / 2], [r.right - 1, r.top + r.height / 2], [r.left + r.width / 2, r.top + 1], [r.left + r.width / 2, r.bottom - 1], [r.left + r.width / 2, r.top + r.height / 2]];
      for (const [x, y] of pts) {
        const hit = document.elementFromPoint(x, y);
        if (hit && !owner.contains(hit) && !hit.contains(owner)) {
          out.covered.push({ text: label, by: sel(hit) });
          break;
        }
      }
      const fontPx = parseFloat(cs.fontSize);
      out.domFonts.push({ text: label, px: fontPx });
      if (pressable && !veiled) out.boxes.push({ text: label, x: r.left, y: r.top, w: r.width, h: r.height, color: cs.color, alpha, fontPx });
    }
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    consider(n.parentElement!, n.textContent, Array.from(range.getClientRects()));
  }
  for (const input of [root, ...Array.from(root.querySelectorAll('input, textarea'))].filter((e) => e.matches('input, textarea'))) {
    const v = (input as HTMLInputElement).value;
    if (v) consider(input, v, [input.getBoundingClientRect()]);
  }

  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    if (allowed.some((s) => el.matches(s))) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) out.cut.push(`${sel(el)} が横に ${el.scrollWidth - el.clientWidth}px 溢れる`);
  }

  const fonts = (window as unknown as { __lensCanvasFonts?: Record<string, Record<string, number>> }).__lensCanvasFonts ?? {};
  for (const c of [root, ...Array.from(root.querySelectorAll('canvas'))].filter((e): e is HTMLCanvasElement => e instanceof HTMLCanvasElement)) {
    out.canvases.push({ canvas: `#${c.id}`, clientWidth: c.clientWidth, width: c.width, fonts: Object.entries(fonts[c.id] ?? {}).map(([font, scale]) => ({ font, scale })) });
  }
  return out;
}

/** 文字を透明にして撮った画から、箱ごとの背景の画素を取る (ブラウザの中でデコードする) */
async function backgroundsOf(page: Page, boxes: TextBox[]): Promise<Rgb[][]> {
  const style = await page.addStyleTag({ content: '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const png = (await page.screenshot()).toString('base64');
  await style.evaluate((e: Element) => e.remove());
  return page.evaluate(
    async ({ png, boxes }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const g = cv.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const k = bmp.width / innerWidth;
      return boxes.map((b) => {
        const x0 = Math.max(0, Math.floor(b.x * k));
        const y0 = Math.max(0, Math.floor(b.y * k));
        const w = Math.max(1, Math.min(bmp.width, Math.ceil((b.x + b.w) * k)) - x0);
        const h = Math.max(1, Math.min(bmp.height, Math.ceil((b.y + b.h) * k)) - y0);
        const d = g.getImageData(x0, y0, w, h).data;
        const step = Math.max(1, Math.floor((w * h) / 400));
        const px: [number, number, number][] = [];
        for (let i = 0; i < w * h; i += step) px.push([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
        return px;
      });
    },
    { png, boxes },
  );
}

const rgbOf = (css: string): Rgb => {
  const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)/.exec(css);
  if (!m) throw new Error(`色を読めない: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
};

const group = (items: string[]) => [...new Set(items)];

const sizes = (px: number[]) => [...new Set(px.map((p) => Math.round(p * 10) / 10))].sort((x, y) => x - y).map((p) => `${p}px`).join('・');

/**
 * 写す要素の中の文字が読めること。読めないものは、要素の名ごとに理由が差分に出る。
 * 覆う要素・切れる文・小さい字の大きさが理由に書かれるので、差分だけで何が起きたか分かる
 */
export async function expectLegible(page: Page, targets: Record<string, Locator>) {
  const allowed = Object.values(SCROLLS_X_ALLOWED);
  const found = await Promise.all(Object.entries(targets).map(async ([name, t]) => [name, await t.evaluate(measure, allowed)] as const));
  const boxes = found.flatMap(([, f]) => f.boxes);
  const bgs = boxes.length > 0 ? await backgroundsOf(page, boxes) : [];
  let at = 0;
  const got: Record<string, string[]> = {};
  for (const [name, f] of found) {
    const why: string[] = [];
    const byCulprit = new Map<string, string[]>();
    for (const c of f.covered) byCulprit.set(c.by, [...(byCulprit.get(c.by) ?? []), c.text]);
    for (const [by, texts] of byCulprit) why.push(`覆い: ${by} が ${group(texts).join('・')} を覆う`);
    if (f.outside.length > 0) why.push(`画面の外: ${group(f.outside).join('・')}`);
    if (f.cut.length > 0) why.push(`切れ: ${group(f.cut).join(' / ')}`);
    const low = f.boxes.flatMap((b) => {
      const ratio = p10ContrastOver(rgbOf(b.color), b.alpha, bgs[at++]);
      return ratio < MIN_CONTRAST ? [`${b.text} ${ratio.toFixed(2)}`] : [];
    });
    if (low.length > 0) why.push(`コントラスト比が ${MIN_CONTRAST} 未満: ${group(low).join('・')}`);
    const canvasPx = f.canvases.flatMap((c) => c.fonts.map(({ font, scale }) => ({ where: c.canvas, px: onScreenFontPx(parseFontPx(font) * scale, c.clientWidth, c.width) })));
    const small = [...f.domFonts.map((d) => ({ where: 'DOM', px: d.px })), ...canvasPx].filter((s) => s.px < MIN_FONT_PX);
    if (small.length > 0) why.push(`画面の上の字が ${MIN_FONT_PX}px 未満 (${group(small.map((s) => s.where)).join('・')}): ${sizes(small.map((s) => s.px))}`);
    if (why.length > 0) got[name] = why;
  }
  expect(got, '読めない文字がある').toEqual({});
}
