/**
 * 境界で unknown を型に読む parse の共通の形 (設計書 2026-09-26-cloudflare-architecture.md §5.1・§5.2)。
 * ログのバッチ (core/log/batch.ts) と港の契約 (M19-07、harbor/contract.ts) が同じ形で拒否理由を返す。
 * path は拒否した場所 (例 records[1].level、いちばん外なら空)
 */
export type ParseError = { path: string; reason: string };
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

export function fail(path: string, reason: string): { ok: false; error: ParseError } {
  return { ok: false, error: { path, reason } };
}

/** 配列と null を除いた object */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 入れ子の parse の拒否の場所 (その値から見た相対の道) に、外側の鍵を前置する */
export function under<T>(key: string, p: Parsed<T>): Parsed<T> {
  return p.ok ? p : fail(p.error.path === '' ? key : `${key}.${p.error.path}`, p.error.reason);
}

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
