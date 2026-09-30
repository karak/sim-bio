import type { TimeSeries } from './timeSeries';

export type GraphLine = { key: string; color: string; label: string; axis?: 'left' | 'right' };
export type GraphMarker = { x: number; label: string; color: string };

const AXIS_FONT = '11px ui-monospace, monospace';
const MARKER_FONT = 'bold 12px system-ui, sans-serif';

/** Canvas 2D に折れ線グラフを描く。左軸は個体数、右軸は気温 (破線)。 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  ts: TimeSeries,
  lines: GraphLine[],
  markers: GraphMarker[],
  w: number,
  h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 32, r: 44, t: 16, b: 16 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const [x0, x1] = ts.xRange();
  const xs = (x: number) => pad.l + (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * iw);

  const range = (axis: 'left' | 'right'): readonly [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lines) {
      if ((l.axis ?? 'left') !== axis) continue;
      for (const p of ts.series(l.key)) {
        if (!Number.isFinite(p.y)) continue;
        lo = Math.min(lo, p.y);
        hi = Math.max(hi, p.y);
      }
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (axis === 'left') lo = 0;
    if (hi === lo) hi = lo + 1;
    return [lo, hi];
  };
  const rl = range('left');
  const rr = range('right');
  const ys = (v: number, r: readonly [number, number]) => pad.t + ih - ((v - r[0]) / (r[1] - r[0])) * ih;

  ctx.strokeStyle = 'rgba(159,179,194,.25)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 2; g++) {
    const y = pad.t + (ih * g) / 2;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#9FB3C2';
  ctx.font = AXIS_FONT;
  ctx.textAlign = 'right';
  const fy = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(2));
  ctx.fillText(fy(rl[1]), pad.l - 4, pad.t + 4);
  ctx.fillText(fy(rl[0]), pad.l - 4, pad.t + ih);
  ctx.textAlign = 'left';
  ctx.fillText(`${rr[1].toFixed(1)}℃`, w - pad.r + 4, pad.t + 4);
  ctx.fillText(`${rr[0].toFixed(1)}℃`, w - pad.r + 4, pad.t + ih);
  ctx.textAlign = 'center';
  const fx = (x: number) => (Number.isInteger(x) ? `Y${x}` : `Y${x.toFixed(1)}`);
  ctx.fillText(fx(x0), pad.l, h - 3);
  ctx.fillText(fx(x1), w - pad.r, h - 3);

  for (const m of markers) {
    if (m.x < x0 || m.x > x1) continue;
    const x = xs(m.x);
    ctx.strokeStyle = m.color;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + ih);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color;
    // M19-15: 今の年の目印は右の縁にあり、中央揃えでは半分切れた。線の内側へ寄せ、表示で半分に縮むので大きく書く
    const right = x > pad.l + iw / 2;
    ctx.textAlign = right ? 'right' : 'left';
    ctx.font = MARKER_FONT;
    ctx.fillText(m.label, right ? x - 4 : x + 4, pad.t + 12);
    ctx.font = AXIS_FONT;
  }

  for (const l of lines) {
    const right = (l.axis ?? 'left') === 'right';
    const r = right ? rr : rl;
    ctx.strokeStyle = l.color;
    ctx.lineWidth = right ? 1 : 2;
    if (right) ctx.setLineDash([4, 3]);
    ctx.beginPath();
    let first = true;
    for (const p of ts.series(l.key)) {
      if (!Number.isFinite(p.y)) continue;
      const x = xs(p.x);
      const y = ys(p.y, r);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/**
 * canvas の描く解像度を画面の大きさ × devicePixelRatio に合わせ、CSS px の座標系で drawGraph する。
 * 字は画面の上で font の px のまま読める (属性の大きさと CSS の大きさが違うと縮む)。
 */
export function renderGraph(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  ts: TimeSeries,
  lines: GraphLine[],
  markers: GraphMarker[],
  dpr: number = globalThis.devicePixelRatio || 1,
): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  const scale = Math.max(2, dpr);
  const pw = Math.round(w * scale);
  const ph = Math.round(h * scale);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
  drawGraph(ctx, ts, lines, markers, w, h);
}
