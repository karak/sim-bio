import { describe, it, expect } from 'vitest';
import { drawGraph } from '../../src/ui/graph';
import { TimeSeries } from '../../src/ui/timeSeries';

type Text = { text: string; x: number; align: CanvasTextAlign; font: string };

/** fillText の文・位置・揃え・書体だけを控える Canvas 2D の代わり。文の幅は 1 文字 = 書体の px の半分とみなす */
function recordingContext() {
  const texts: Text[] = [];
  const ctx = {
    textAlign: 'start' as CanvasTextAlign,
    font: '10px sans-serif',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
    fillText(text: string, x: number) {
      texts.push({ text, x, align: ctx.textAlign, font: ctx.font });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, texts };
}

const pxOf = (font: string) => Number(/(\d+)px/.exec(font)?.[1] ?? 0);

describe('drawGraph の目印 (M19-15: 漂着の目印が見えない)', () => {
  const ts = new TimeSeries(10);
  for (let y = 0; y <= 4; y++) ts.push(y, { grass: 100 + y, temp: 10 });
  const lines = [{ key: 'grass', color: '#6FBF7C', label: '草' }];
  const W = 640;

  it('右端 (今の年) の目印の文は、グラフの内側へ右揃えで書き、縁で切れない', () => {
    const { ctx, texts } = recordingContext();
    drawGraph(ctx, ts, lines, [{ x: 4, label: '漂着 (胞子苔・草・狼)', color: '#8FEADF' }], W, 200);
    const m = texts.find((t) => t.text.startsWith('漂着'));
    expect(m).toMatchObject({ align: 'right' });
    expect(m?.x).toBeLessThanOrEqual(W);
  });

  it('左寄りの目印の文は左揃え', () => {
    const { ctx, texts } = recordingContext();
    drawGraph(ctx, ts, lines, [{ x: 0, label: '鹿', color: '#E2B45A' }], W, 200);
    expect(texts.find((t) => t.text === '鹿')).toMatchObject({ align: 'left' });
  });

  it('目印の文は軸の数 (10px) より大きく書く (canvas は表示で半分に縮む)', () => {
    const { ctx, texts } = recordingContext();
    drawGraph(ctx, ts, lines, [{ x: 2, label: '隕石', color: '#E07A55' }], W, 200);
    expect(pxOf(texts.find((t) => t.text === '隕石')?.font ?? '')).toBeGreaterThanOrEqual(18);
  });
});
