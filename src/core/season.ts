/** 季節の名。1 年 (360 日) を 90 日ずつに分ける。HUD の「春 · Day 0」と観察画面の下の帯が同じ区切りを使う */
const SEASONS = ['春', '夏', '秋', '冬'] as const;
const DAYS_PER_YEAR = 360;

export function seasonOf(dayOfYear: number): string {
  return SEASONS[Math.floor((dayOfYear / DAYS_PER_YEAR) * SEASONS.length) % SEASONS.length];
}

/**
 * 観察画面の下の帯の年 (M19-09 の直し)。観察画面は 10 倍速までなので 1 年が実時間 36 秒かかり、年だけでは
 * 訪問の再生が止まって見えた。季節も添え、9 秒ごとに進むのが見えるようにする
 */
export function observeYearText(s: { year: number; dayOfYear: number }): string {
  return `${s.year} 年 · ${seasonOf(s.dayOfYear)}`;
}
