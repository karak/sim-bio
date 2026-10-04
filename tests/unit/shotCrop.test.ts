import { describe, expect, it } from 'vitest';
import { cropRectAround, CROP_SIZE } from '../driver/crop';

const FRAME = { width: 1280, height: 720 };

describe('選んだセルの辺りの切り抜き (M26-11)', () => {
  it('既定は 320x240 で、セルが真ん中に来る', () => {
    expect(CROP_SIZE).toEqual({ width: 320, height: 240 });
    expect(cropRectAround({ x: 640, y: 400 }, FRAME)).toEqual({ x: 480, y: 280, width: 320, height: 240 });
  });

  it('画面の端に近いセルでも、四角は画の内に収まる (大きさは変わらない)', () => {
    expect(cropRectAround({ x: 10, y: 5 }, FRAME)).toEqual({ x: 0, y: 0, width: 320, height: 240 });
    expect(cropRectAround({ x: 1275, y: 718 }, FRAME)).toEqual({ x: 960, y: 480, width: 320, height: 240 });
  });

  it('画の外の位置でも収める', () => {
    expect(cropRectAround({ x: -50, y: 900 }, FRAME)).toEqual({ x: 0, y: 480, width: 320, height: 240 });
  });

  it('小数の位置は整数の画素に丸める', () => {
    const r = cropRectAround({ x: 640.6, y: 400.4 }, FRAME);
    for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
  });

  it('画が切り抜きより小さければ画の全体', () => {
    expect(cropRectAround({ x: 50, y: 50 }, { width: 200, height: 100 })).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });
});
