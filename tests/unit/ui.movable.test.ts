import { describe, it, expect } from 'vitest';
import { clampOffset } from '../../src/ui/movable';

const view = { width: 1000, height: 500 };

describe('clampOffset (M19-15: 判定の板の取っ手を画面の外へ出さない)', () => {
  it('取っ手が画面の内なら位置はそのまま', () => {
    expect(clampOffset({ x: 30, y: -20 }, { left: 100, top: 10, right: 300, bottom: 40 }, view)).toEqual({ x: 30, y: -20 });
  });
  it('左上へはみ出た分だけ戻す', () => {
    expect(clampOffset({ x: -500, y: -300 }, { left: -120, top: -50, right: 80, bottom: -20 }, view)).toEqual({ x: -380, y: -250 });
  });
  it('右下へはみ出た分だけ戻す', () => {
    expect(clampOffset({ x: 900, y: 600 }, { left: 950, top: 520, right: 1150, bottom: 550 }, view)).toEqual({ x: 750, y: 550 });
  });
});
