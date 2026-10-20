/**
 * タイトルのコンフィグ (M24-02、docs/uiux/2026-10-04-title-flow.md の決めること 2 の案 A)。起動をまたいで残す好み。
 * 置き場 (localStorage) の 1 つの鍵に JSON で置く。壊れた項目は、その項目だけ既定に戻す (ほかの項目は残す)
 */
/** 画質 (観察画面の影・草・解像度)。auto は今の既定のまま */
export type Quality = 'auto' | 'light' | 'fine';
/** 動きを減らす (背景の動きなど)。os は OS の prefers-reduced-motion に従う */
export type Motion = 'os' | 'on' | 'off';
/** 島を開いたときの速さ */
export type StartSpeed = 1 | 10;
export type Config = { quality: Quality; motion: Motion; speed: StartSpeed };

export const DEFAULT_CONFIG: Config = { quality: 'auto', motion: 'os', speed: 1 };

export const QUALITIES: readonly Quality[] = ['auto', 'light', 'fine'];
export const MOTIONS: readonly Motion[] = ['os', 'on', 'off'];
export const START_SPEEDS: readonly StartSpeed[] = [1, 10];

const KEY = 'biotope.config';

const pick = <T>(choices: readonly T[], v: unknown, fallback: T): T => (choices.includes(v as T) ? (v as T) : fallback);

/** 読めない置き場・JSON でない値は既定。項目ごとに並びに無い値は既定に戻し、知らない項目は捨てる */
export function readConfig(storage: Pick<Storage, 'getItem'>): Config {
  let raw: unknown;
  try {
    const text = storage.getItem(KEY);
    raw = text === null ? null : JSON.parse(text);
  } catch {
    return DEFAULT_CONFIG;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_CONFIG;
  const o = raw as Record<string, unknown>;
  return {
    quality: pick(QUALITIES, o.quality, DEFAULT_CONFIG.quality),
    motion: pick(MOTIONS, o.motion, DEFAULT_CONFIG.motion),
    speed: pick(START_SPEEDS, o.speed, DEFAULT_CONFIG.speed),
  };
}

/** 書けない置き場 (使えない localStorage) では false。好みは残らないが、遊ぶのは止めない */
export function writeConfig(storage: Pick<Storage, 'setItem'>, config: Config): boolean {
  try {
    storage.setItem(KEY, JSON.stringify({ quality: config.quality, motion: config.motion, speed: config.speed }));
    return true;
  } catch {
    return false;
  }
}

/** 動きを減らすか。os なら OS の設定 (prefers-reduced-motion: reduce) に従う */
export function reducedMotionOf(motion: Motion, osReduce: boolean): boolean {
  return motion === 'os' ? osReduce : motion === 'on';
}
