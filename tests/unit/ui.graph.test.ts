import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { drawGraph, graphLayout, GRAPH_PANEL_H, LOCAL_GRAPH_PANEL_H, renderGraph } from '../../src/ui/graph';
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
    scale: 1,
    setTransform(a: number) {
      ctx.scale = a;
    },
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

  it('目印の文は軸の数より大きく書く', () => {
    const { ctx, texts } = recordingContext();
    drawGraph(ctx, ts, lines, [{ x: 2, label: '隕石', color: '#E07A55' }], W, 200);
    expect(pxOf(texts.find((t) => t.text === '隕石')?.font ?? '')).toBeGreaterThan(pxOf(texts.find((t) => t.text === 'Y0')?.font ?? ''));
  });
});

describe('renderGraph の字の実寸 (M25-11: 画面の上で軸 5px・目印 9px)', () => {
  const ts = new TimeSeries(10);
  for (let y = 0; y <= 4; y++) ts.push(y, { grass: 100 + y, temp: 10 });
  const lines = [{ key: 'grass', color: '#6FBF7C', label: '草' }];
  const markers = [{ x: 2, label: '隕石', color: '#E07A55' }];
  const canvasOf = (clientWidth: number, clientHeight: number) => ({ clientWidth, clientHeight, width: 640, height: 200 }) as HTMLCanvasElement;

  it.each([
    ['HUD のグラフ (320×100 に描く)', 320, 100, 1],
    ['同じ、DPR 2', 320, 100, 2],
    ['同じ、DPR 3', 320, 100, 3],
    ['同じ、DPR 1.5', 320, 100, 1.5],
    ['局所のグラフ (240×80)', 240, 80, 1],
  ])('%s: 軸の字は画面の上で 11px 以上、目印は 12px 以上', (_n, cw, ch, dpr) => {
    const { ctx, texts } = recordingContext();
    const canvas = canvasOf(cw, ch);
    renderGraph(canvas, ctx, ts, lines, markers, dpr);
    const scale = (ctx as unknown as { scale: number }).scale;
    const shown = (font: string) => pxOf(font) * scale * (canvas.clientWidth / canvas.width);
    expect(shown(texts.find((t) => t.text === 'Y0')?.font ?? '')).toBeGreaterThanOrEqual(11);
    expect(shown(texts.find((t) => t.text === '隕石')?.font ?? '')).toBeGreaterThanOrEqual(12);
  });

  it.each([
    [1, 640, 200],
    [2, 640, 200],
    [3, 960, 300],
  ])('描く解像度は画面の大きさ × max(2, DPR) (DPR %s → %s×%s、縮んで潰れない)', (dpr, w, h) => {
    const { ctx } = recordingContext();
    const canvas = canvasOf(320, 100);
    renderGraph(canvas, ctx, ts, lines, markers, dpr);
    expect([canvas.width, canvas.height]).toEqual([w, h]);
  });

  it('目印の文は線の内側 (0〜画面の幅) に収まる', () => {
    const { ctx, texts } = recordingContext();
    renderGraph(canvasOf(320, 100), ctx, ts, lines, [{ x: 4, label: '漂着 (狼・鹿)', color: '#8FEADF' }], 1);
    const m = texts.find((t) => t.text.startsWith('漂着'));
    expect(m?.align).toBe('right');
    expect(m?.x).toBeLessThanOrEqual(320);
  });

  it('画面に出ていない (clientWidth 0) ときは描かず、canvas の大きさも変えない', () => {
    const { ctx, texts } = recordingContext();
    const canvas = canvasOf(0, 0);
    renderGraph(canvas, ctx, ts, lines, markers, 3);
    renderGraph(canvas, ctx, ts, lines, markers, 3);
    expect([canvas.width, canvas.height, texts.length]).toEqual([640, 200, 0]);
  });
});

describe('graphLayout の描く高さ (M26-01: plot を 68 → 120 px に)', () => {
  it('plot の高さは板の高さ − 上 16 − 下 16', () => {
    expect(graphLayout(320, 100).plotH).toBe(68);
    expect(graphLayout(320, 152).plotH).toBe(120);
  });

  it('HUD のグラフ (#graph) と局所のグラフ (#local-graph) の板の高さで plot は 110〜130 px', () => {
    for (const h of [GRAPH_PANEL_H, LOCAL_GRAPH_PANEL_H]) {
      const { plotH } = graphLayout(320, h);
      expect(plotH).toBeGreaterThanOrEqual(110);
      expect(plotH).toBeLessThanOrEqual(130);
    }
  });

  it('drawGraph の目盛り線は plot の上端と下端に引く (線の間隔 = plotH)', () => {
    const ys: number[] = [];
    const { ctx } = recordingContext();
    (ctx as unknown as { moveTo: (x: number, y: number) => void }).moveTo = (_x, y) => ys.push(y);
    const ts = new TimeSeries(10);
    ts.push(0, { grass: 1, temp: 10 });
    ts.push(1, { grass: 2, temp: 10 });
    drawGraph(ctx, ts, [{ key: 'grass', color: '#fff', label: '草' }], [], 320, 152);
    expect(ys[2] - ys[0]).toBe(120);
  });

  it('hud.css の板の高さが定数と同じ (CSS だけ変わって plot が戻らない)', () => {
    const css = readFileSync(new URL('../../src/ui/hud.css', import.meta.url), 'utf8');
    expect(css).toMatch(new RegExp(`#local-graph \\{[^}]*height: ${LOCAL_GRAPH_PANEL_H}px`));
    expect(css).toMatch(new RegExp(`\\.hud-r canvas \\{[^}]*height: ${GRAPH_PANEL_H}px`));
  });

  it('Hud.ts の canvas の属性は CSS の大きさの 2 倍 (renderGraph の下限の倍率)。初めの描く前の一瞬も同じ縦横比 (C の 17)', () => {
    const hud = readFileSync(new URL('../../src/ui/Hud.ts', import.meta.url), 'utf8');
    expect(hud).toContain(`<canvas id="graph" width="640" height="${GRAPH_PANEL_H * 2}">`);
    expect(hud).toContain(`<canvas id="local-graph" width="480" height="${LOCAL_GRAPH_PANEL_H * 2}">`);
  });
});
