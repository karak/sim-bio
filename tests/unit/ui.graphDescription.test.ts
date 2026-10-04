import { describe, it, expect } from 'vitest';
import { describeGraph } from '../../src/ui/graphDescription';

describe('describeGraph (M25-02: グラフの目印は canvas の外にも文で出す)', () => {
  it('点の年の範囲と数、目印の文と年を並べる', () => {
    expect(describeGraph([0, 4], 5, [{ x: 4, label: '漂着 (狼・鹿)' }, { x: 2, label: '隕石' }])).toBe(
      '個体数と気温の推移。Y0 から Y4、5 点。目印: 漂着 (狼・鹿) Y4、隕石 Y2',
    );
  });

  it('目印が無ければ目印の句を出さない', () => {
    expect(describeGraph([0, 0], 1, [])).toBe('個体数と気温の推移。Y0 から Y0、1 点');
  });

  it('点が無ければ空の知らせ', () => {
    expect(describeGraph([0, 0], 0, [])).toBe('個体数と気温の推移。点はまだ無い');
  });
});
