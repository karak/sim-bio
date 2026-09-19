/** セル index は y * size + x。 */
export const idx = (x: number, y: number, size: number): number => y * size + x;

/** 上下左右 4 近傍を走査する (境界外は呼ばない)。 */
export function forEachNeighbor4(i: number, size: number, fn: (j: number) => void): void {
  const x = i % size;
  const y = (i - x) / size;
  if (x > 0) fn(i - 1);
  if (x < size - 1) fn(i + 1);
  if (y > 0) fn(i - size);
  if (y < size - 1) fn(i + size);
}
