/**
 * 観察画面の昼夜 (M22-07、設計 §4「昼夜 1 周 = 6 分、実時間」)。純粋関数のみ (Three.js に依存しない)。
 *
 * 契約:
 * - phase は 0〜1 (0 = 夜明け)。DAY_CYCLE_S 秒で 1 周する。
 * - 昼は長く (約 6 割)、夕と明けの色の変わり目は短く、夜は約 3 割。見る人が長く居るのは昼。
 * - 光は 1 本の平行光を日と月で使い回す (影の draw call を増やさない)。dir は光の来る向き (地面 → 光源) の単位ベクトル、
 *   x = 東・y = 上・z = 南。日は東から南を通って西へ、月は日が沈んでいるあいだ南の空に高く掛かる。
 * - 色は '#RRGGBB'、キーの間を線形に補間する。
 */
export const DAY_CYCLE_S = 360;

export type Daylight = {
  phase: number;
  /** 0 = 昼、1 = 深夜 (灯り・鐘・蛍・星の強さに使う) */
  night: number;
  lightDir: { x: number; y: number; z: number };
  lightColor: string;
  lightIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  /** 空の天頂と地平、霧 (空気の色) */
  zenith: string;
  horizon: string;
  fog: string;
  /** 空気の濃さの倍率 (明けと夕は靄が濃い) */
  haze: number;
  /** 光の筋の強さ (日が低いほど長く斜めに入るが、夜は月の淡い筋) */
  shafts: number;
};

type Key = { at: number; night: number; light: string; li: number; sky: string; ground: string; hi: number; zenith: string; horizon: string; fog: string; haze: number; shafts: number };

// 夜明け → 朝 → 昼 → 午後 → 夕 → 宵 → 夜 → 夜明け前
const KEYS: Key[] = [
  { at: 0.0, night: 0.2, light: '#FFB27A', li: 1.2, sky: '#E9C9B2', ground: '#5E5A48', hi: 0.8, zenith: '#6F8FB8', horizon: '#F6C9A0', fog: '#E8CDB6', haze: 1.6, shafts: 1.2 },
  { at: 0.08, night: 0.0, light: '#FFE3B6', li: 2.2, sky: '#D7E8F2', ground: '#6F7A4E', hi: 1.05, zenith: '#7FA9C9', horizon: '#F0E2C6', fog: '#C9D6CF', haze: 1.2, shafts: 1.0 },
  { at: 0.3, night: 0.0, light: '#FFF0D2', li: 2.6, sky: '#D7E8F2', ground: '#6F7A4E', hi: 1.15, zenith: '#7FA9C9', horizon: '#CFE0E4', fog: '#B9CED3', haze: 0.9, shafts: 0.7 },
  { at: 0.5, night: 0.0, light: '#FFE3B6', li: 2.3, sky: '#D9E6EC', ground: '#737A4C', hi: 1.05, zenith: '#7AA2C4', horizon: '#F3E3C4', fog: '#C4D2CC', haze: 1.0, shafts: 1.0 },
  { at: 0.6, night: 0.05, light: '#FF9E66', li: 1.4, sky: '#E6B9A4', ground: '#5A4C3E', hi: 0.75, zenith: '#5E6F9E', horizon: '#F4A878', fog: '#E3B79C', haze: 1.5, shafts: 1.3 },
  { at: 0.66, night: 0.7, light: '#8FA6D8', li: 0.45, sky: '#6E7FA6', ground: '#2E3440', hi: 0.45, zenith: '#27335A', horizon: '#7A7FA8', fog: '#5E6A8A', haze: 1.2, shafts: 0.4 },
  { at: 0.72, night: 1.0, light: '#9DB7E8', li: 0.55, sky: '#3E4E78', ground: '#1E2430', hi: 0.38, zenith: '#101A36', horizon: '#34466E', fog: '#2E3C5E', haze: 1.0, shafts: 0.5 },
  { at: 0.94, night: 1.0, light: '#9DB7E8', li: 0.55, sky: '#3E4E78', ground: '#1E2430', hi: 0.38, zenith: '#101A36', horizon: '#34466E', fog: '#2E3C5E', haze: 1.1, shafts: 0.5 },
  { at: 1.0, night: 0.2, light: '#FFB27A', li: 1.2, sky: '#E9C9B2', ground: '#5E5A48', hi: 0.8, zenith: '#6F8FB8', horizon: '#F6C9A0', fog: '#E8CDB6', haze: 1.6, shafts: 1.2 },
];

/** 日が地平の上にある区間 (phase)。0 で東の地平、SUNSET で西の地平 */
const SUNSET = 0.63;

export function phaseAt(seconds: number, offset = 0): number {
  const p = (seconds / DAY_CYCLE_S + offset) % 1;
  return p < 0 ? p + 1 : p;
}

export function daylightAt(phase: number): Daylight {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].at <= p) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const f = b.at > a.at ? (p - a.at) / (b.at - a.at) : 0;
  const n = (x: number, y: number) => x + (y - x) * f;
  const c = (x: string, y: string) => mixHex(x, y, f);
  return {
    phase: p,
    night: n(a.night, b.night),
    lightDir: lightDirAt(p),
    lightColor: c(a.light, b.light),
    lightIntensity: n(a.li, b.li),
    skyColor: c(a.sky, b.sky),
    groundColor: c(a.ground, b.ground),
    hemiIntensity: n(a.hi, b.hi),
    zenith: c(a.zenith, b.zenith),
    horizon: c(a.horizon, b.horizon),
    fog: c(a.fog, b.fog),
    haze: n(a.haze, b.haze),
    shafts: n(a.shafts, b.shafts),
  };
}

/** 日 (昼) か月 (夜) の来る向き。どちらも地平から 8° 以上に保ち、影が無限に伸びないようにする */
export function lightDirAt(phase: number): { x: number; y: number; z: number } {
  const MIN_EL = (8 * Math.PI) / 180;
  let az: number;
  let el: number;
  if (phase < SUNSET) {
    // 日: 東 (az 0) → 南 (az π/2) → 西 (az π)。高さは正午に 58°
    const s = phase / SUNSET;
    az = s * Math.PI;
    el = Math.max(MIN_EL, Math.sin(s * Math.PI) * ((58 * Math.PI) / 180));
  } else {
    // 月: 南東から南西へ、高さ 40° 前後
    const s = (phase - SUNSET) / (1 - SUNSET);
    az = Math.PI * (0.3 + 0.4 * s);
    el = Math.max(MIN_EL, Math.sin(s * Math.PI) * ((40 * Math.PI) / 180));
  }
  // az は東 (+x) から南 (+z) へ回る角
  return { x: Math.cos(az) * Math.cos(el), y: Math.sin(el), z: Math.sin(az) * Math.cos(el) };
}

export function mixHex(x: string, y: string, f: number): string {
  const px = parseInt(x.slice(1), 16);
  const py = parseInt(y.slice(1), 16);
  let out = 0;
  for (const sh of [16, 8, 0]) {
    const cx = (px >> sh) & 255;
    const cy = (py >> sh) & 255;
    out |= Math.round(cx + (cy - cx) * f) << sh;
  }
  return `#${out.toString(16).padStart(6, '0').toUpperCase()}`;
}
