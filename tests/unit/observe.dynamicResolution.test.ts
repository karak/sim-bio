import { describe, it, expect } from 'vitest';
import { createDynamicResolution } from '../../src/observe/render/dynamicResolution';

/** 同じコマの時間を n コマ渡し、最後の倍率を返す */
const feed = (d: ReturnType<typeof createDynamicResolution>, ms: number, n: number) => {
  let s = d.scale;
  for (let i = 0; i < n; i++) s = d.update(ms);
  return s;
};

describe('動的な解像度 (M23-07)', () => {
  it('予算の中で描けているあいだは倍率 1 のまま (60 fps の張り付き・120 fps)', () => {
    const d = createDynamicResolution();
    expect(feed(d, 16.7, 600)).toBe(1);
    expect(feed(d, 8.3, 600)).toBe(1);
  });

  it('中央値が予算 × 1.15 を超えた窓ごとに 0.1 ずつ下げ、下限 0.6 で止まる', () => {
    const d = createDynamicResolution();
    expect(feed(d, 25, 29)).toBe(1);
    expect(feed(d, 25, 1)).toBe(0.9);
    expect(feed(d, 25, 30)).toBe(0.8);
    expect(feed(d, 25, 30 * 10)).toBe(0.6);
  });

  it('窓の中の 1 コマの引っかかりでは下げない (中央値で見る)', () => {
    const d = createDynamicResolution();
    for (let w = 0; w < 10; w++) {
      feed(d, 16.7, 27);
      feed(d, 40, 3);
    }
    expect(d.scale).toBe(1);
  });

  it('250 ms を超えるコマ (タブの切り替えなど) は数えず、窓を数え直す', () => {
    const d = createDynamicResolution();
    feed(d, 25, 20);
    d.update(1000);
    expect(feed(d, 25, 29)).toBe(1);
    expect(feed(d, 25, 1)).toBe(0.9);
  });

  it('下げたあと 8 秒、予算の中で描けていれば 1 段戻す', () => {
    const d = createDynamicResolution();
    feed(d, 25, 30);
    expect(d.scale).toBe(0.9);
    // 16.7 ms × 450 コマ = 7.5 秒ではまだ戻さない
    expect(feed(d, 16.7, 450)).toBe(0.9);
    expect(feed(d, 16.7, 60)).toBe(1);
  });

  it('戻して 3 秒のうちにまた下がったら、次に戻すまでの待ちを倍 (16 秒) にする', () => {
    const d = createDynamicResolution();
    feed(d, 25, 30);
    feed(d, 16.7, 510);
    expect(d.scale).toBe(1);
    // 戻した直後に重い (戻した倍率では描けない)
    expect(feed(d, 25, 30)).toBe(0.9);
    // 8 秒 (+ 窓 1 つ) では戻さず、16 秒で戻す
    expect(feed(d, 16.7, 510)).toBe(0.9);
    expect(feed(d, 16.7, 480)).toBe(1);
  });

  it('予算と刻み・下限・窓は指定できる', () => {
    const d = createDynamicResolution({ budgetMs: 10, step: 0.25, min: 0.5, window: 4 });
    expect(feed(d, 12, 4)).toBe(0.75);
    expect(feed(d, 12, 8)).toBe(0.5);
  });
});
