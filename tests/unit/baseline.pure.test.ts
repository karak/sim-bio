import { describe, expect, it } from 'vitest';
import { BASELINE_OPTIONS, baselineName, CANVAS_TARGET, optionsFor, shouldCompareBaselines, TEXT_STRIP_RATIO } from '../e2e/baseline';

describe('基準画の決まり (M25-03)', () => {
  it('閾値は ADR 0001 の値 (threshold 0.2・maxDiffPixelRatio 0.02)', () => {
    expect(BASELINE_OPTIONS.threshold).toBe(0.2);
    expect(BASELINE_OPTIONS.maxDiffPixelRatio).toBe(0.02);
  });

  it('手元の Mac だけが比べる。CI と Linux は比べない', () => {
    expect(shouldCompareBaselines({}, 'darwin')).toBe(true);
    expect(shouldCompareBaselines({ CI: 'true' }, 'darwin')).toBe(false);
    expect(shouldCompareBaselines({ CI: '1' }, 'linux')).toBe(false);
    expect(shouldCompareBaselines({}, 'linux')).toBe(false);
  });

  it('基準画の名前は <ID>-<n>-<要素名>.png。3D の面は DOM の板と別の名前になる', () => {
    expect(baselineName('CNF-002', 1, '確かめの板')).toBe('CNF-002-1-確かめの板.png');
    expect(baselineName('SEL-003', 2, CANVAS_TARGET)).not.toBe(baselineName('SEL-003', 2, 'セルの詳細'));
  });
});

describe('字の細い板の閾値', () => {
  it('ADR の閾値は確かめの板と 3D の面に使い、字だけの細い板は 0.12 にする', () => {
    expect(optionsFor('確かめの板').maxDiffPixelRatio).toBe(0.02);
    expect(optionsFor(CANVAS_TARGET).maxDiffPixelRatio).toBe(0.02);
    expect(optionsFor('セルの詳細').maxDiffPixelRatio).toBe(TEXT_STRIP_RATIO);
    expect(optionsFor('セルの詳細').threshold).toBe(0.2);
  });
});
