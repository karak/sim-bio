import { describe, expect, it } from 'vitest';
import { blend, contrastRatio, p10ContrastOver, relativeLuminance, type Rgb } from '../e2e/lens/contrast';
import { onScreenFontPx, parseFontPx } from '../e2e/lens/fontSize';

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

describe('relativeLuminance (WCAG 2.x の式)', () => {
  it('黒は 0、白は 1', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
  });
  it('sRGB の折れ目の下は線形 (c/12.92)、上はべき乗で数える', () => {
    expect(relativeLuminance([10, 10, 10])).toBeCloseTo(10 / 255 / 12.92, 10);
    expect(relativeLuminance([128, 128, 128])).toBeCloseTo(0.2158605, 6);
  });
});

describe('contrastRatio', () => {
  it('黒と白は 21、同じ色は 1 (WCAG の両端)', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio([90, 90, 90], [90, 90, 90])).toBe(1);
  });
  it('順序に依らない', () => {
    expect(contrastRatio(BLACK, WHITE)).toBe(contrastRatio(WHITE, BLACK));
  });
  it('WCAG の例: #767676 の灰と白は 4.54 (AA の 4.5 をぎりぎり越える)', () => {
    expect(contrastRatio([0x76, 0x76, 0x76], WHITE)).toBeCloseTo(4.54, 2);
  });
  it('#777777 の灰と白は 4.48 (4.5 に届かない)', () => {
    expect(contrastRatio([0x77, 0x77, 0x77], WHITE)).toBeCloseTo(4.48, 2);
  });
});

describe('blend (字の不透明度で背景に重ねる)', () => {
  it('alpha 1 は字の色、0 は背景', () => {
    expect(blend(WHITE, 1, BLACK)).toEqual([255, 255, 255]);
    expect(blend(WHITE, 0, BLACK)).toEqual([0, 0, 0]);
  });
  it('alpha 0.4 の白を黒に重ねると灰 102', () => {
    expect(blend(WHITE, 0.4, BLACK)).toEqual([102, 102, 102]);
  });
});

describe('p10ContrastOver (箱の中の背景の画素ごとの比の 10 パーセンタイル)', () => {
  it('背景が一様ならその 1 つの比', () => {
    const bg = Array.from({ length: 50 }, () => WHITE);
    expect(p10ContrastOver([0x76, 0x76, 0x76], 1, bg)).toBeCloseTo(4.54, 2);
  });
  it('暗い画素が 1 割を越えて混ざれば、その悪い側の比を返す (平均で隠さない)', () => {
    const bg: Rgb[] = [...Array.from({ length: 80 }, () => BLACK), ...Array.from({ length: 20 }, () => WHITE)];
    expect(p10ContrastOver(WHITE, 1, bg)).toBeCloseTo(1, 10);
  });
  it('薄い字 (opacity 0.4 の灰) は 4.5 を割る (押せない札の値)', () => {
    const bg = Array.from({ length: 10 }, () => [15, 26, 36] as Rgb);
    expect(p10ContrastOver([0x9f, 0xb3, 0xc2], 0.4, bg)).toBeLessThan(4.5);
  });
  it('背景の画素が無ければ投げる', () => {
    expect(() => p10ContrastOver(WHITE, 1, [])).toThrow();
  });
});

describe('画面の上の字の大きさ (canvas は font × clientWidth / width)', () => {
  it('HUD のグラフ: width 640 を 320 で表示すると、10px は 5px、太字の 18px は 9px', () => {
    expect(onScreenFontPx(10, 320, 640)).toBe(5);
    expect(onScreenFontPx(18, 320, 640)).toBe(9);
  });
  it('ctx.setTransform の拡大は font に掛けてから縮める (M25-11 の描き方: 拡大 2、width は clientWidth の 2 倍で、11px は 11px のまま)', () => {
    expect(onScreenFontPx(11 * 2, 320, 640)).toBe(11);
  });
  it('等倍なら font のまま、拡大なら大きくなる', () => {
    expect(onScreenFontPx(12, 480, 480)).toBe(12);
    expect(onScreenFontPx(10, 960, 480)).toBe(20);
  });
  it('width が 0 の canvas は投げる (割れない)', () => {
    expect(() => onScreenFontPx(10, 100, 0)).toThrow();
  });
  it('ctx.font の文字列から px を読む', () => {
    expect(parseFontPx('10px ui-monospace, monospace')).toBe(10);
    expect(parseFontPx('bold 18px system-ui, sans-serif')).toBe(18);
    expect(parseFontPx('italic 700 12.5px "Noto Sans JP"')).toBe(12.5);
  });
  it('px が無い font は投げる', () => {
    expect(() => parseFontPx('1.2em serif')).toThrow();
  });
});
