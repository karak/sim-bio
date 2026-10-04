export type Rect = { x: number; y: number; width: number; height: number };

/** judge に当てる切り抜きの大きさ。全体の 1280x720 では選んだセルの帯が約 25 px で読めない (M26-11) */
export const CROP_SIZE = { width: 320, height: 240 } as const;

/** center を真ん中にした切り抜きの四角 (画素は整数)。frame (0,0 から) の外へはみ出す分は、大きさを変えずに内へ寄せる */
export function cropRectAround(center: { x: number; y: number }, frame: { width: number; height: number }): Rect {
  const width = Math.min(CROP_SIZE.width, frame.width);
  const height = Math.min(CROP_SIZE.height, frame.height);
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max);
  return {
    x: clamp(center.x - width / 2, frame.width - width),
    y: clamp(center.y - height / 2, frame.height - height),
    width,
    height,
  };
}
