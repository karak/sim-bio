/** HUD のグラフの文での説明 (M25-02)。canvas の中の字は DOM で読めないので、点の範囲と目印を canvas の aria-label に出す */
export function describeGraph(range: readonly [number, number], points: number, markers: readonly { x: number; label: string }[]): string {
  if (points === 0) return '個体数と気温の推移。点はまだ無い';
  const base = `個体数と気温の推移。Y${range[0]} から Y${range[1]}、${points} 点`;
  return markers.length === 0 ? base : `${base}。目印: ${markers.map((m) => `${m.label} Y${m.x}`).join('、')}`;
}
