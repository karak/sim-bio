import { describe, it, expect } from 'vitest';
import { observeYearText, seasonOf } from '../../src/core/season';

describe('季節と観察画面の帯の年 (M19-09 の直し)', () => {
  it('1 年 360 日を 90 日ずつ春夏秋冬に分ける (HUD の「春 · Day 0」と同じ区切り)', () => {
    expect([0, 89, 90, 179, 180, 269, 270, 359].map(seasonOf)).toEqual(['春', '春', '夏', '夏', '秋', '秋', '冬', '冬']);
  });

  it('帯は年と季節を言う。10 倍速では 1 年が実時間 36 秒かかるので、年だけだと止まって見える', () => {
    expect(observeYearText({ year: 0, dayOfYear: 0 })).toBe('0 年 · 春');
    expect(observeYearText({ year: 0, dayOfYear: 95 })).toBe('0 年 · 夏');
    expect(observeYearText({ year: 12, dayOfYear: 300 })).toBe('12 年 · 冬');
  });
});
