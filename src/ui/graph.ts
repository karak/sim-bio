import type { TimeSeries } from './timeSeries';

export type GraphLine = { key: string; color: string; label: string; axis?: 'left' | 'right' };
export type GraphMarker = { x: number; label: string; color: string };

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
  const pad = { l: 40, r: 44, t: 18, b: 16 };
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
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(rl[1].toFixed(0), pad.l - 4, pad.t + 4);
  ctx.fillText(rl[0].toFixed(0), pad.l - 4, pad.t + ih);
  ctx.textAlign = 'left';
  ctx.fillText(`${rr[1].toFixed(1)}℃`, w - pad.r + 4, pad.t + 4);
  ctx.fillText(`${rr[0].toFixed(1)}℃`, w - pad.r + 4, pad.t + ih);
  ctx.textAlign = 'center';
  ctx.fillText(`Y${x0}`, pad.l, h - 4);
  ctx.fillText(`Y${x1}`, w - pad.r, h - 4);

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
    ctx.fillText(m.label, x, pad.t - 6);
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
