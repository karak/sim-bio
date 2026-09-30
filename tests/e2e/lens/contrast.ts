/** コントラスト比 (WCAG 2.x)。純粋な関数で、src/ に置かない。tests/unit/lens.pure.test.ts で固定する */

export type Rgb = readonly [number, number, number];

const linear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = ([r, g, b]: Rgb) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

export function contrastRatio(a: Rgb, b: Rgb) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 不透明度 alpha の字の色 fg を、背景 bg に重ねた色 */
export const blend = (fg: Rgb, alpha: number, bg: Rgb): Rgb => [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as unknown as Rgb;

/** 背景の画素 (箱の中) ごとに字を重ねた比を出し、悪い側の 10 パーセンタイルを返す。平均では背景の暗い部分に隠れる字を見逃す */
export function p10ContrastOver(fg: Rgb, alpha: number, bgPixels: readonly Rgb[]) {
  if (bgPixels.length === 0) throw new Error('背景の画素が無い');
  const ratios = bgPixels.map((bg) => contrastRatio(blend(fg, alpha, bg), bg)).sort((x, y) => x - y);
  return ratios[Math.floor((ratios.length - 1) * 0.1)];
}
