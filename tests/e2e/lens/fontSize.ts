/** 画面の上の字の大きさ。純粋な関数で、src/ に置かない。tests/unit/lens.pure.test.ts で固定する */

/** canvas の字は canvas の画素 (width) を CSS の幅 (clientWidth) に縮めて出るので、font × clientWidth / width */
export function onScreenFontPx(fontPx: number, clientWidth: number, width: number) {
  if (width <= 0) throw new Error(`canvas の width が ${width}`);
  return (fontPx * clientWidth) / width;
}

/** ctx.font の文字列 (例 'bold 18px system-ui') から px の大きさを読む */
export function parseFontPx(font: string) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!m) throw new Error(`font に px が無い: ${font}`);
  return Number(m[1]);
}
